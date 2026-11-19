//! Callable freezing consumes the retained semantic session, never a mutable
//! report or a target's supported-type table. Entries qualify direct functions
//! only; they do not qualify an entire module, termination or a target ABI.
use std::collections::{BTreeMap,BTreeSet,VecDeque};
use crate::{binding::{DeclarationId,NameAnalysis,Resolution},body_analysis::{BodyAnalysis,BodyState,ValueRelation},
    effect_analysis::{CodeIdentity,EffectState,EffectSummarySet},header_seeds::{HeaderKind,HeaderSeed},
    lexical::LocalResolution,model::{Diagnostic,fail},semantic_types::*,
    signature_resolution::{ClosedAnalysis,SignatureResolution,Signature,SignatureState,SignatureProblem},
    type_constraints::{ConstraintMachine,ConstraintNeed,Relation}};

type Result<T> = std::result::Result<T,Diagnostic>;
#[derive(Debug)]
pub struct CallableEntry {
    pub declaration:DeclarationId,
    pub source:SourceId,
    pub signature:TypeId,
    pub body:usize,
    pub direct_calls:BTreeSet<DeclarationId>,
}
#[derive(Debug,Default)]
pub struct CallableIndex { entries:BTreeMap<DeclarationId,CallableEntry> }
impl CallableIndex {
    pub fn get(&self,declaration:DeclarationId)->Option<&CallableEntry> {self.entries.get(&declaration)}
    pub fn entries(&self)->impl Iterator<Item=&CallableEntry> {self.entries.values()}
}
pub struct CallableAnalysis {closed:ClosedAnalysis,index:CallableIndex}
impl CallableAnalysis {
    pub fn resolution(&self)->&SignatureResolution {self.closed.resolution()}
    pub fn callables(&self)->&CallableIndex {&self.index}
    pub fn needs(&self)->&[ConstraintNeed] {&self.closed.resolution().needs}
    pub fn into_parts(self)->SignatureResolution {self.closed.into_parts()}
    /// A target continuation takes this exact session, not reconstructed aliases
    /// or another Budget. No public report can enter this consuming boundary.
    pub(crate) fn into_session(self)->(ClosedAnalysis,CallableIndex) {(self.closed,self.index)}
}
pub(crate) fn freeze(closed:ClosedAnalysis)->Result<CallableAnalysis> {
    let (mut resolution,mut budget,state)=closed.into_session();
    let mut solver=ConstraintMachine::resume(&mut resolution.types,&mut budget,state);
    let (index,consumed)=freeze_index(&resolution.names,&resolution.headers,&resolution.signatures,
        &resolution.bodies,&resolution.effects,&resolution.needs,&mut resolution.problems,&mut solver)?;
    let generated=std::mem::take(&mut solver.needs);
    let mut identities=BTreeSet::new();let mut needs=Vec::new();
    for need in std::mem::take(&mut resolution.needs).into_iter().chain(generated) {
        solver.work(1+4*(consumed.len()+1).ilog2() as usize)?;
        if consumed.contains(&(need.source,need.code)){continue;}
        if crate::signature_resolution::insert_need_identity(&mut solver,&mut identities,need.source,need.code)? {
            solver.charge(96)?;needs.push(need);
        }
    }
    resolution.needs=needs;
    let state=solver.into_state();
    Ok(CallableAnalysis {closed:ClosedAnalysis::from_session(resolution,budget,state),index})
}

fn add_need(solver:&mut ConstraintMachine<'_>,source:SourceId,code:&'static str)->Result<()> {
    solver.work(solver.needs.len()+1)?;
    solver.need(source,code)?;Ok(())
}
fn push_type(solver:&mut ConstraintMachine<'_>,stack:&mut Vec<TypeId>,ty:TypeId)->Result<()> {
    solver.work(1)?;solver.charge(32)?;stack.push(ty);Ok(())
}

/// Check semantic qualification, independently of target representation. Alias
/// normalization uses the retained original ConstraintState. Nominal nodes
/// retain identity; an opaque representation is never opened by this pass.
fn signature_qualified(solver:&mut ConstraintMachine<'_>,ty:TypeId,source:SourceId,
    public:bool,headers:&BTreeMap<DeclarationId,&HeaderSeed>,exports:&BTreeSet<DeclarationId>)->Result<bool> {
    if solver.validate_type(ty,source)?!=Relation::Equal||solver.unresolved(ty)? {return Ok(false);}
    let mut stack=Vec::new();push_type(solver,&mut stack,ty)?;
    let mut visited=BTreeSet::new();let mut qualified=true;
    // TypeId is an arena allocation identity. Instantiating a recursive
    // nominal body creates fresh nodes even for the same Node<Bool>. Keep one
    // representative for each semantically equal nominal instance, using the
    // original constraint interpreter for arguments/aliases/rigid identities.
    let mut nominal_instances:BTreeMap<DeclarationId,Vec<TypeId>>=BTreeMap::new();
    while let Some(current)=stack.pop() {
        solver.work(1+4*(visited.len()+1).ilog2() as usize)?;
        let current=solver.normalize(current,source)?;
        if visited.contains(&current){continue;}solver.charge(64)?;visited.insert(current);
        let node=solver.copy_type(current)?;
        match node {
            SemanticType::Function(function) if current==ty=>{
                if function.captures.as_ref().is_some_and(|c|!c.is_empty()) {
                    add_need(solver,source,"NeedsExplicitCaptureCallableQualification")?;qualified=false;
                }
                if function.call_mode.as_deref().is_some_and(|mode|mode!="shared")||
                    function.parameter_contracts.as_ref().is_some_and(|contracts|!contracts.is_empty()) {
                    add_need(solver,source,"NeedsCallableParameterContractQualification")?;qualified=false;
                }
                for binder in function.binders {
                    solver.work(1)?;
                    let binder=&solver.arena().binders[binder.index()];
                    let pending=binder.kind!=SemanticKind::Type||!binder.constraints.is_empty()||!binder.trait_bounds.is_empty();
                    let binder_source=binder.source;
                    if pending {
                        add_need(solver,binder_source,"NeedsCallableSemanticBinderQualification")?;qualified=false;
                    }
                }
                for argument in function.parameters {
                    match argument {SemanticArgument::Type(ty)=>push_type(solver,&mut stack,ty)?,
                        _=>{add_need(solver,source,"NeedsCallableSemanticArgumentQualification")?;qualified=false;}}
                }
                push_type(solver,&mut stack,function.returns)?;
            },
            SemanticType::Function(_)=>{add_need(solver,source,"NeedsFunctionValueCallableQualification")?;qualified=false;},
            SemanticType::Declaration {target,..}=>{
                if let Some(declaration)=target.declaration {
                    let mut repeated=false;
                    if let Some(instances)=nominal_instances.get(&declaration) {
                        for previous in instances {
                            solver.work(1)?;
                            // A probe cannot bind an inference variable or add
                            // an obligation to the closed session merely while
                            // comparing traversal identities. Both IDs predate
                            // its checkpoint, so no speculative node escapes.
                            match solver.probe(|solver|solver.unify(*previous,current,source)) {
                                Ok(Relation::Equal)=>{repeated=true;break;},
                                Ok(Relation::Needs)=>{
                                    add_need(solver,source,"NeedsNominalInstanceEquality")?;
                                    return Ok(false);
                                },
                                Err(error) if matches!(error.code.as_str(),"TypeMismatch"|"TypeKindMismatch")=>{},
                                Err(error)=>return Err(error),
                            }
                        }
                    }
                    if repeated{continue;}
                    solver.charge(128)?;nominal_instances.entry(declaration).or_default().push(current);
                    if public&&!exports.contains(&declaration) {
                        return Err(fail("PrivateTypeInPublicSignature",&solver.arena().source(source).expanded_path,
                            "A public callable signature exposes a private nominal type"));
                    }
                    match headers.get(&declaration).map(|header|&header.kind) {
                        Some(HeaderKind::Type {opaque:Some(true),..})=>{
                            add_need(solver,source,"NeedsOpaqueCallableQualification")?;qualified=false;
                        },
                        Some(HeaderKind::Type {..})=>{
                            if let Some(body)=solver.declaration_body(current,source)?{
                                // A nominal identity closes references, not its
                                // representation's type/kind obligations. Check
                                // the original instantiated body once before
                                // traversing its qualifications; recursive refs
                                // terminate at the semantic nominal instance.
                                qualified&=solver.validate_type(body,source)?==Relation::Equal&&!solver.unresolved(body)?;
                                push_type(solver,&mut stack,body)?;
                            }
                            else{qualified=false;}
                        },
                        _=>{add_need(solver,source,"NeedsProfessionalTypeQualification")?;qualified=false;},
                    }
                }else{add_need(solver,source,"NeedsDeclaredTypeQualification")?;qualified=false;}
            },
            SemanticType::Scalar(_)|SemanticType::Parameter(_)|SemanticType::Rational=>{},
            SemanticType::Record {fields,row,open}=>{
                if row.is_some()||open==Some(true){add_need(solver,source,"NeedsOpenRecordCallableQualification")?;qualified=false;}
                for field in fields.values(){
                    if field.mutable==Some(true){add_need(solver,source,"NeedsMutableValueCallableQualification")?;qualified=false;}
                    push_type(solver,&mut stack,field.ty)?;
                }
            },
            SemanticType::Variant(cases)=>for ty in cases.values(){push_type(solver,&mut stack,*ty)?;},
            SemanticType::Tuple(arguments)=>for argument in arguments {
                if let SemanticArgument::Type(ty)=argument{push_type(solver,&mut stack,ty)?;}
                else{add_need(solver,source,"NeedsCallableSemanticArgumentQualification")?;qualified=false;}
            },
            SemanticType::Option(ty)|SemanticType::List(ty)|SemanticType::Sequence {item:ty,..}=>push_type(solver,&mut stack,ty)?,
            SemanticType::Result {ok,error}=>{push_type(solver,&mut stack,ok)?;push_type(solver,&mut stack,error)?;},
            SemanticType::Set {item,equality}|SemanticType::Bag {item,equality}=>{
                push_type(solver,&mut stack,item)?;
                if equality.is_some(){add_need(solver,source,"NeedsEqualityCallableQualification")?;qualified=false;}
            },
            SemanticType::Map {key,value,equality}=>{
                push_type(solver,&mut stack,key)?;push_type(solver,&mut stack,value)?;
                if equality.is_some(){add_need(solver,source,"NeedsEqualityCallableQualification")?;qualified=false;}
            },
            _=>{add_need(solver,source,"NeedsTypeCallableQualification")?;qualified=false;},
        }
    }
    Ok(qualified)
}

fn freeze_index(names:&NameAnalysis,headers:&[HeaderSeed],signatures:&[Signature],bodies:&BodyAnalysis,
    effects:&EffectSummarySet,prior:&[ConstraintNeed],problems:&mut Vec<SignatureProblem>,solver:&mut ConstraintMachine<'_>)
    ->Result<(CallableIndex,BTreeSet<(SourceId,&'static str)>)> {
    let mut header_index=BTreeMap::new();let mut signature_index=BTreeMap::new();let mut exported=BTreeSet::new();
    let mut root_requests=BTreeSet::new();
    for header in headers {
        solver.work(1)?;solver.charge(96)?;header_index.insert(header.declaration,header);
        if matches!(header.kind,HeaderKind::Function {..}){solver.charge(64)?;root_requests.insert(header.source);}
    }
    for signature in signatures {solver.work(1)?;solver.charge(96)?;signature_index.insert(signature.declaration,signature);}
    for export in &names.exports {
        solver.work(1)?;if let Resolution::Resolved {declaration,..}=&export.resolution {solver.charge(64)?;exported.insert(*declaration);}
    }
    // Every residual obligation remains attached to its original source. Only
    // the exact root capture/callable request can be discharged by this proof.
    let mut blocked=BTreeSet::new();
    for need in prior {
        solver.work(1+4*(root_requests.len()+blocked.len()+1).ilog2() as usize)?;
        if need.code=="NeedsCaptureAndCallableQualification"&&root_requests.contains(&need.source){continue;}
        if let Some(owner)=solver.arena().source(need.source).owner {solver.charge(96)?;blocked.insert(owner);}
    }
    for index in 0..solver.arena().problems.len() {
        solver.work(1)?;
        if let Some(owner)=solver.arena().source(solver.arena().problems[index].source).owner {solver.charge(96)?;blocked.insert(owner);}
    }
    let mut index=CallableIndex::default();
    let mut reverse:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>=BTreeMap::new();
    for header in headers {
        solver.work(1)?;
        let HeaderKind::Function {contract,termination,..}=&header.kind else{continue;};
        let declaration=header.declaration;let source=header.source;
        let Some(signature)=signature_index.get(&declaration) else{continue;};
        if signature.state==SignatureState::Rejected{continue;}
        let Some(ty)=signature.ty else{continue;};
        let mut qualified=signature.state==SignatureState::TypeReady&&signature.body_type_checked&&!blocked.contains(&declaration);
        solver.work(names.lexical.scopes.len()+1)?;
        let lexical_source=solver.arena().source(source).lexical;
        let function_scope=names.lexical.scopes.iter().find(|scope|scope.kind=="function"&&Some(scope.occurrence)==lexical_source);
        if function_scope.is_none(){add_need(solver,source,"NeedsLexicalCallableQualification")?;qualified=false;}
        if let Some(scope)=function_scope {
            for capture in &names.lexical.captures {
                solver.work(1)?;
                if capture.scope==scope.id {add_need(solver,source,"NeedsRuntimeCaptureQualification")?;qualified=false;}
            }
        }
        for issue_index in 0..solver.arena().needs.len() {
            solver.work(1)?;
            let issue=&solver.arena().needs[issue_index];let (issue_source,code)=(issue.source,issue.code);
            if solver.arena().source(issue_source).owner!=Some(declaration){continue;}
            // Formation's declaration-role request is answered by the original
            // constraint interpreter on that exact formed occurrence, not by
            // deleting a code throughout the arena. All other qualifications
            // still require their own semantic consumer.
            let mut proved=false;
            if code=="NeedsDeclaredTypeQualification" {
                let mut found=false;let mut valid=true;
                for occurrence_index in 0..solver.arena().occurrences.len() {
                    solver.work(1)?;
                    let occurrence=&solver.arena().occurrences[occurrence_index];
                    if occurrence.source!=issue_source{continue;}
                    found=true;let formed=occurrence.ty;
                    valid&=solver.validate_type(formed,issue_source)?==Relation::Equal;
                }
                proved=found&&valid;
            }
            if !proved{add_need(solver,issue_source,code)?;qualified=false;}
        }
        if contract.is_some(){add_need(solver,source,"NeedsContractQualification")?;qualified=false;}
        if termination.as_deref().is_some_and(|mode|mode!="partial") {
            add_need(solver,source,"NeedsTerminationQualification")?;qualified=false;
        }
        match signature_qualified(solver,ty,source,exported.contains(&declaration),&header_index,&exported) {
            Ok(value)=>qualified&=value,
            Err(error) if error.code=="ResourceLimit"=>return Err(error),
            Err(diagnostic)=>{solver.charge(192+diagnostic.message.len()*2+diagnostic.path.len()*2)?;problems.push(SignatureProblem {declaration,diagnostic});qualified=false;},
        }
        solver.work(effects.closures.len().saturating_mul(2)+1)?;
        let closure_ok=effects.closures.iter().filter(|closure|closure.code==CodeIdentity::Declaration(declaration))
            .all(|closure|closure.ready&&closure.environment.is_empty()&&closure.latent.state==EffectState::BodyDerived&&closure.latent.needs.is_empty());
        let has_closure=effects.closures.iter().any(|closure|closure.code==CodeIdentity::Declaration(declaration));
        qualified&=has_closure&&closure_ok&&effects.declarations.get(&declaration).is_some_and(|summary|
            summary.state==EffectState::BodyDerived&&summary.needs.is_empty()&&summary.internal.is_empty());
        if !has_closure||!closure_ok {add_need(solver,source,"NeedsClosedCallableEnvironment")?;}
        for local in &names.lexical.uses {
            solver.work(1)?;
            if names.lexical.occurrences[local.occurrence.index()].owner!=Some(declaration){continue;}
            match local.resolution {
                LocalResolution::Resolved {binding}=>{
                    let binder=&names.lexical.bindings[binding.index()];
                    if names.lexical.occurrences[binder.occurrence.index()].owner!=Some(declaration) {
                        add_need(solver,source,"NeedsRuntimeCaptureQualification")?;qualified=false;
                    }
                },_=>{add_need(solver,source,"NeedsLexicalCallableQualification")?;qualified=false;},
            }
        }
        for region in names.lexical.pending_regions.iter().chain(&names.lexical.problems) {
            solver.work(1)?;
            if names.lexical.occurrences[region.occurrence.index()].owner==Some(declaration) {qualified=false;}
        }
        for reference in &names.references {
            solver.work(1)?;
            if reference.owner!=Some(declaration){continue;}
            if !matches!(reference.resolution,Resolution::Resolved {..}) {qualified=false;}
        }
        for problem in &names.problems {
            solver.work(1+problem.path.len())?;
            let root=&solver.arena().source(source).expanded_path;
            if problem.module==header.module&&(problem.path==*root||problem.path.strip_prefix(root).is_some_and(|tail|tail.starts_with('/'))) {qualified=false;}
        }
        let Some(body)=bodies.declarations.get(&declaration) else{continue;};
        let mut stack=Vec::new();solver.charge(32)?;stack.push(body.expression);let mut visited=BTreeSet::new();
        let mut calls=BTreeSet::new();let mut callee_expressions=BTreeSet::new();
        for call in &bodies.calls {
            solver.work(1)?;
            if solver.arena().source(call.source).owner!=Some(declaration){continue;}
            solver.charge(64)?;callee_expressions.insert(call.callee_value);
            if let Some(callee)=call.callee {
                if matches!(bodies.expressions[call.callee_value].value,ValueRelation::Declaration(actual) if actual==callee)
                    &&header_index.get(&callee).is_some_and(|header|matches!(header.kind,HeaderKind::Function {..})) {
                    solver.charge(192)?;calls.insert(callee);reverse.entry(callee).or_default().insert(declaration);
                }else{add_need(solver,call.source,"NeedsDirectCalleeCallableQualification")?;qualified=false;}
            }else{add_need(solver,call.source,"NeedsFunctionValueCallableQualification")?;qualified=false;}
        }
        while let Some(expression)=stack.pop() {
            solver.work(1+4*(visited.len()+1).ilog2() as usize)?;
            if visited.contains(&expression){continue;}solver.charge(64)?;visited.insert(expression);
            let summary=&bodies.expressions[expression];qualified&=summary.state==BodyState::TypeChecked;
            if !summary.captures.is_empty(){add_need(solver,summary.source,"NeedsRuntimeCaptureQualification")?;qualified=false;}
            match summary.value {
                ValueRelation::Lambda {..}=>{add_need(solver,summary.source,"NeedsLambdaCallableQualification")?;qualified=false;},
                ValueRelation::Declaration(target) if !callee_expressions.contains(&expression)=>{
                    add_need(solver,summary.source,if header_index.get(&target).is_some_and(|header|matches!(header.kind,HeaderKind::Constant {..})) {
                        "NeedsStaticConstructionQualification"}else{"NeedsFunctionValueCallableQualification"})?;qualified=false;
                },_=>{},
            }
            solver.charge(summary.children.len()*32)?;stack.extend(summary.children.iter().copied());
        }
        if qualified {
            solver.charge(256)?;
            index.entries.insert(declaration,CallableEntry {declaration,source,signature:ty,body:body.expression,direct_calls:calls});
        }
    }
    // Greatest closed subset of already proved entries: removing a failed
    // callee invalidates callers. A pure runtime SCC has no failing seed and
    // remains eligible; this is not a proof of termination or execution safety.
    let mut queue=VecDeque::new();
    for declaration in header_index.keys() {
        solver.work(1)?;if !index.entries.contains_key(declaration){solver.charge(32)?;queue.push_back(*declaration);}
    }
    while let Some(declaration)=queue.pop_front() {
        if let Some(callers)=reverse.get(&declaration) {
            for caller in callers {
                solver.work(1)?;
                if let Some(entry)=index.entries.remove(caller) {
                    add_need(solver,entry.source,"NeedsDirectCalleeCallableQualification")?;
                    solver.charge(32)?;queue.push_back(*caller);
                }
            }
        }
    }
    let mut consumed=BTreeSet::new();
    for entry in index.entries.values() {
        solver.work(1)?;solver.charge(96)?;
        consumed.insert((entry.source,"NeedsCaptureAndCallableQualification"));
    }
    Ok((index,consumed))
}
