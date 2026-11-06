//! Common signature constraints consuming the existing Reader, names, lexical
//! identities, type arena and HeaderSeeds. Type readiness is not callability.
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use crate::{binding::{DeclarationId, ModuleId, NameAnalysis, Resolution},
    header_seeds::{HeaderKind, HeaderSeed, TypeRequest, EffectRequest, Representation},
    lexical::{LocalBindingId, LocalResolution, ScopeId, ControlResolution}, model::{Diagnostic,fail},
    reference_slots::Navigation, semantic_types::*, source::{Node,Kind as JsonKind},
    type_constraints::{ConstraintMachine,ConstraintNeed,Relation}};

use crate::signature_resolution::{Signature,SignatureState,SignatureProblem};

type Result<T> = std::result::Result<T,Diagnostic>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NormalResult { Value(TypeId), NoNormal, Pending }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyState { TypeChecked, Pending, Rejected }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitKind { Return, Break, Continue, UnqualifiedRaise }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExitFact {
    pub source: SourceId,
    pub kind: ExitKind,
    pub target: Option<ScopeId>,
    pub value: Option<TypeId>,
    pub expression: Option<usize>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EffectId(pub usize);
#[derive(Debug)]
pub enum EffectTerm {
    Empty,
    Sequence(Vec<EffectId>),
    Conditional { condition: EffectId, branches: Vec<EffectId>, active: Vec<bool> },
    Read(LocalBindingId),
    Write(LocalBindingId),
    Call(usize),
    Unqualified { code: &'static str, children: Vec<EffectId> },
    Try { body: EffectId, handler: EffectId, qualification: &'static str },
    Loop { target: Option<ScopeId>, condition: EffectId, body: EffectId, body_active: bool, condition_false: bool },
}
#[derive(Debug)]
pub struct EffectEquation { pub source: SourceId, pub term: EffectTerm }
#[derive(Debug)]
pub struct ExpressionSummary {
    pub source: SourceId,
    pub expected: Option<TypeId>,
    pub normal: NormalResult,
    pub state: BodyState,
    pub exits: Vec<ExitFact>,
    pub immediate: EffectId,
    pub latent: Option<EffectId>,
    pub children: Vec<usize>,
    pub captures: Vec<LocalBindingId>,
    pub value: ValueRelation,
}
/// Function-bearing value relations over already checked occurrences. These
/// edges retain provenance and environments, not another syntax/type tree.
#[derive(Debug)]
pub enum ValueRelation {
    Data, Unknown, Declaration(DeclarationId), Binding(LocalBindingId),
    Lambda { body: usize, parameters: Vec<LocalBindingId> },
    Forward(usize), Choose(Vec<usize>),
    Let { binding: LocalBindingId, initializer: usize, continuation: usize },
    Region { bindings: Vec<(LocalBindingId,usize)>, result: usize },
    Loop { condition: usize, body: usize },
    Record(Vec<(String,usize)>), List { items: Vec<usize>, tail: Option<usize> },
    Field { receiver: usize, name: String },
    RecordUpdate { receiver: usize, fields: Vec<(String,usize)> },
    Variant { name: String, payload: usize },
    Constructor { ty: TypeId, name: String },
    Call(usize),
    Sequence { steps: Vec<usize>, result: Option<usize> },
    Initialize { binding: LocalBindingId, initializer: usize },
    Assign { binding: LocalBindingId, value: usize },
    Match { subject: usize, arms: Vec<(SourceId,usize)> },
}
#[derive(Debug)]
pub struct CallFact {
    pub source: SourceId,
    pub callee: Option<DeclarationId>,
    pub function_type: TypeId,
    pub source_to_formal: Vec<usize>,
    pub callee_value: usize,
    pub arguments: Vec<usize>,
}
#[derive(Debug)]
pub struct BindingFact { pub source: SourceId, pub binding: LocalBindingId, pub ty: TypeId }
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub enum ValueProjection { Head, Tail, Variant(String) }
#[derive(Debug)]
pub struct PatternValueBinding { pub arm: SourceId, pub binding: LocalBindingId, pub projection: Vec<ValueProjection> }
#[derive(Debug)]
pub struct BodyProblem { pub source: SourceId, pub diagnostic: Diagnostic }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Coverage { Exhaustive, Missing(Vec<String>), Unknown }
#[derive(Debug)]
pub struct MatchCoverage { pub source: SourceId, pub result: Coverage, pub redundant_arms: Vec<usize> }
#[derive(Debug)]
pub struct DeclarationSummary { pub source: SourceId, pub expression: usize }
/// Derived facts over the retained source and TypeArena. No equation here is
/// an effect fixed point or a callable/resource qualification.
#[derive(Debug,Default)]
pub struct BodyAnalysis {
    pub expressions: Vec<ExpressionSummary>,
    pub declarations: BTreeMap<DeclarationId,DeclarationSummary>,
    pub effects: Vec<EffectEquation>,
    pub calls: Vec<CallFact>,
    pub bindings: Vec<BindingFact>,
    pub coverage: Vec<MatchCoverage>,
    pub problems: Vec<BodyProblem>,
    pub regions: Vec<usize>,
    pub pattern_values: Vec<PatternValueBinding>,
}
struct Frame { source: SourceId, children: Vec<usize>, normal: Option<NormalResult>, extra_effects: Vec<EffectId>, exits: Vec<ExitFact> }
struct AnalysisPoint { expressions: usize, effects: usize, calls: usize, bindings: usize, coverage: usize, pattern_values:usize }
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
enum PatternShape { Any, Case(String,Vec<PatternShape>), Atom(String), Unknown }
struct Constructor { name: String, fields: Vec<TypeId> }
enum Domain { Closed(Vec<Constructor>), Open, Unknown }
fn literal_boolean(node:&Node)->Option<bool> {
    node.get("op").or_else(||node.get("tag")).and_then(Node::as_str).filter(|tag|*tag=="literal")
        .and_then(|_|node.get("value")).and_then(Node::as_bool)
}
fn condition_false(normal:NormalResult,literal:Option<bool>)->bool {
    matches!(normal,NormalResult::Value(_))&&literal!=Some(true)
}
#[derive(Clone)]
enum Search { Witness(Vec<PatternShape>), Covered, Unknown }
type PatternState = (Vec<Vec<PatternShape>>,Vec<PatternShape>,Vec<TypeId>);
fn pattern_size(pattern:&PatternShape)->usize {
    match pattern {PatternShape::Case(name,fields)=>name.len()+128+fields.iter().map(pattern_size).sum::<usize>(),
        PatternShape::Atom(value)=>value.len()+128,_=>128}
}
fn pattern_text(pattern:&PatternShape)->String {
    fn write(pattern:&PatternShape,output:&mut String) {
        match pattern {PatternShape::Any=>output.push('_'),PatternShape::Unknown=>output.push('?'),PatternShape::Atom(value)=>output.push_str(value),
            PatternShape::Case(name,fields)=>{output.push_str(name);if !fields.is_empty(){output.push('(');for(index,field)in fields.iter().enumerate(){if index>0{output.push(',');}write(field,output);}output.push(')');}}}
    }
    let mut output=String::with_capacity(pattern_size(pattern));write(pattern,&mut output);output
}
fn search_size(search:&Search)->usize {match search {Search::Witness(patterns)=>128+patterns.iter().map(pattern_size).sum::<usize>(),_=>128}}
impl BodyAnalysis {
    fn checkpoint(&self)->AnalysisPoint { AnalysisPoint {expressions:self.expressions.len(),effects:self.effects.len(),
        calls:self.calls.len(),bindings:self.bindings.len(),coverage:self.coverage.len(),pattern_values:self.pattern_values.len()} }
    fn rollback(&mut self,point:AnalysisPoint) {
        self.expressions.truncate(point.expressions);self.effects.truncate(point.effects);self.calls.truncate(point.calls);
        self.bindings.truncate(point.bindings);self.coverage.truncate(point.coverage);
        self.pattern_values.truncate(point.pattern_values);
        // Diagnostics contain source identities only and survive failed probes.
    }
}

pub(crate) struct Engine<'a> {
    names:&'a NameAnalysis,
    headers:&'a [HeaderSeed],
    navigation:&'a [Navigation],
    pub(crate) solver:ConstraintMachine<'a>,
    pub(crate) signatures:Vec<Signature>,
    pub(crate) needs:Vec<ConstraintNeed>,
    pub(crate) problems:Vec<SignatureProblem>,
    pub(crate) dependencies:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    pub(crate) annotation_cycles:Vec<Vec<DeclarationId>>,
    slots:BTreeMap<DeclarationId,usize>,
    sources:BTreeMap<(ModuleId,String),SourceId>,
    local_uses:BTreeMap<(ModuleId,String),usize>,
    local_binders:BTreeMap<(ModuleId,String),LocalBindingId>,
    lexical_occurrences:BTreeMap<(ModuleId,String),crate::lexical::OccurrenceId>,
    type_ids:BTreeMap<(ModuleId,String),TypeId>,
    references:BTreeMap<(ModuleId,String),usize>,
    waiting:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    current_waiting:BTreeSet<DeclarationId>,
    blocked_headers:BTreeSet<DeclarationId>,
    pub(crate) analysis: BodyAnalysis,
    frames: Vec<Frame>,
    function_returns: BTreeMap<ScopeId,TypeId>,
    root_summaries: BTreeMap<DeclarationId,usize>,
    scopes: BTreeMap<(crate::lexical::OccurrenceId,&'static str),ScopeId>,
    captures: BTreeMap<ScopeId,Vec<LocalBindingId>>,
}
impl<'a> Engine<'a> {
    pub(crate) fn new(names:&'a NameAnalysis,headers:&'a [HeaderSeed],navigation:&'a [Navigation],solver:ConstraintMachine<'a>)->Result<Self> {
        let mut engine=Self {names,headers,navigation,solver,signatures:Vec::new(),needs:Vec::new(),problems:Vec::new(),
            dependencies:BTreeMap::new(),annotation_cycles:Vec::new(),slots:BTreeMap::new(),sources:BTreeMap::new(),
            local_uses:BTreeMap::new(),local_binders:BTreeMap::new(),lexical_occurrences:BTreeMap::new(),type_ids:BTreeMap::new(),
            references:BTreeMap::new(),waiting:BTreeMap::new(),current_waiting:BTreeSet::new(),blocked_headers:BTreeSet::new(),
            analysis:BodyAnalysis::default(),frames:Vec::new(),function_returns:BTreeMap::new(),root_summaries:BTreeMap::new(),scopes:BTreeMap::new(),captures:BTreeMap::new()};
        for scope in &names.lexical.scopes {engine.solver.work(1)?;engine.solver.charge(96)?;engine.scopes.insert((scope.occurrence,scope.kind),scope.id);}
        for capture in &names.lexical.captures {
            engine.solver.work(1)?;engine.solver.charge(96)?;engine.captures.entry(capture.scope).or_default().push(capture.binding);
        }
        for index in 0..engine.solver.arena.sources.len() {
            let size=engine.solver.arena.sources[index].expanded_path.len();
            engine.solver.charge(96+size*6)?;
            let source=&engine.solver.arena.sources[index];
            engine.sources.insert((source.module,source.expanded_path.clone()),source.id);
        }
        for index in 0..engine.solver.arena.occurrences.len() {
            let occurrence=&engine.solver.arena.occurrences[index];
            let ty=occurrence.ty;let source=occurrence.source;
            engine.solver.charge(96+engine.solver.arena.source(source).expanded_path.len()*6)?;
            let source=engine.solver.arena.source(source);
            engine.type_ids.insert((source.module,source.expanded_path.clone()),ty);
        }
        for occurrence in &names.lexical.occurrences {
            engine.solver.charge(96+occurrence.expanded_path.len()*6)?;
            engine.lexical_occurrences.insert((occurrence.module,occurrence.expanded_path.clone()),occurrence.id);
        }
        for (index,usage) in names.lexical.uses.iter().enumerate() {
            let occurrence=&names.lexical.occurrences[usage.occurrence.index()];
            engine.solver.charge(96+occurrence.expanded_path.len()*6)?;
            engine.local_uses.insert((occurrence.module,occurrence.expanded_path.clone()),index);
        }
        for binding in &names.lexical.bindings {
            let occurrence=&names.lexical.occurrences[binding.occurrence.index()];
            engine.solver.charge(96+occurrence.expanded_path.len()*6)?;
            engine.local_binders.insert((occurrence.module,occurrence.expanded_path.clone()),binding.id);
        }
        for (index,reference) in names.references.iter().enumerate() {
            engine.solver.charge(96+reference.expanded_path.len()*6)?;
            engine.references.insert((reference.module,reference.expanded_path.clone()),index);
        }
        for header in headers {
            engine.solver.work(1)?;
            let visible=match &header.kind {HeaderKind::Function {binders,..}|HeaderKind::Type {binders,..}=>binders.iter().copied().collect(),_=>BTreeSet::new()};
            let ty=match &header.kind {
                HeaderKind::Function {binders,parameters,returns,effects,call_mode,parameter_contracts,captures,..}=>{
                    let result=match returns {TypeRequest::Explicit(t)=>*t,_=>engine.solver.fresh(SemanticKind::Type,visible)?};
                    engine.solver.account_function_metadata(match effects{EffectRequest::Explicit(row)=>Some(row),_=>None},
                        parameter_contracts.as_deref(),captures.as_deref(),call_mode.as_deref())?;
                    Some(engine.solver.insert(SemanticType::Function(FunctionType {binders:binders.clone(),parameters:parameters.iter().map(|p|SemanticArgument::Type(p.ty)).collect(),returns:result,
                        effects:match effects {EffectRequest::Explicit(row)=>Some(row.clone()),_=>None},pending_effects:matches!(effects,EffectRequest::InferFromBody(_)),pending_captures:captures.is_none(),
                        call_mode:call_mode.clone(),parameter_contracts:parameter_contracts.clone(),captures:captures.clone()}))?)
                },
                HeaderKind::Constant {expected,..}=>Some(match expected {TypeRequest::Explicit(t)=>*t,_=>engine.solver.fresh(SemanticKind::Type,visible)?}),
                _=>None,
            };
            let ready=match ty {Some(t)=>!engine.solver.unresolved(t)?,None=>false};
            engine.slots.insert(header.declaration,engine.signatures.len());
            engine.solver.charge(192)?;
            engine.signatures.push(Signature {declaration:header.declaration,ty,state:if ready {SignatureState::TypeReady}else{SignatureState::NeedsInput},body_type_checked:false});
            engine.dependencies.insert(header.declaration,BTreeSet::new());
        }
        Ok(engine)
    }
    fn add_need(&mut self,source:SourceId,code:&'static str)->Result<()> {
        if !self.needs.iter().any(|n|n.source==source&&n.code==code) {
            self.solver.charge(96)?;self.needs.push(ConstraintNeed {source,code});
        }
        Ok(())
    }
    pub(crate) fn run(&mut self)->Result<()> {
        for header in self.headers {
            if let Err(diagnostic)=self.solver.validate_aliases(std::slice::from_ref(header)) {
                if diagnostic.code=="ResourceLimit" {return Err(diagnostic);}
                self.problems.push(SignatureProblem {declaration:header.declaration,diagnostic});
                self.signatures[self.slots[&header.declaration]].state=SignatureState::Rejected;
            }
        }
        for index in 0..self.headers.len() {
            let declaration=self.headers[index].declaration;
            if self.signatures[index].state==SignatureState::Rejected {continue;}
            match self.validate_header(index) {
                Err(diagnostic) if diagnostic.code=="ResourceLimit"=>return Err(diagnostic),
                Err(diagnostic)=>{
                    self.signatures[index].state=SignatureState::Rejected;
                    self.problems.push(SignatureProblem {declaration,diagnostic});
                },
                Ok(Relation::Needs)=>{
                    self.signatures[index].state=SignatureState::NeedsInput;
                    self.blocked_headers.insert(declaration);
                },
                Ok(Relation::Equal)=>{},
            }
        }
        let mut queue:VecDeque<_>=self.headers.iter().filter(|h|matches!(h.kind,HeaderKind::Function {..}|HeaderKind::Constant {..})).map(|h|h.declaration).collect();
        let mut queued:BTreeSet<_>=queue.iter().copied().collect();
        while let Some(declaration)=queue.pop_front() {
            self.solver.work(1)?;queued.remove(&declaration);
            let slot=self.slots[&declaration];
            if self.signatures[slot].body_type_checked||self.signatures[slot].state==SignatureState::Rejected||self.blocked_headers.contains(&declaration) {continue;}
            self.current_waiting.clear();
            let mut point=Some(self.solver.checkpoint()?);
            let mut body_point=Some(self.analysis.checkpoint());
            let needs_start=self.solver.needs.len();
            let result=self.check_body(slot);
            if let Err(error)=&result {
                if error.code=="ResourceLimit" {
                    self.solver.rollback(point.take().unwrap());self.analysis.rollback(body_point.take().unwrap());
                    self.root_summaries.remove(&declaration);return Err(error.clone());
                }
            }
            self.solver.charge((self.solver.needs.len()-needs_start)*32)?;
            let attempt_needs=self.solver.needs[needs_start..].to_vec();
            let successful=matches!(result,Ok(Some(_)));
            if !successful {
                let source=match &self.headers[slot].kind {HeaderKind::Function {body,..}|HeaderKind::Constant {initializer:body,..}=>body.source,_=>self.headers[slot].source};
                let exits=if let Some(root)=self.root_summaries.get(&declaration) {
                    let exits=&self.analysis.expressions[*root].exits;self.solver.charge(exits.len()*128)?;
                    exits.iter().map(|exit|ExitFact {source:exit.source,kind:exit.kind,target:exit.target,value:None,expression:None}).collect()
                }else{Vec::new()};
                self.solver.rollback(point.take().unwrap());self.analysis.rollback(body_point.take().unwrap());
                self.root_summaries.remove(&declaration);
                if !matches!(&result,Err(error) if error.code=="ResourceLimit") {
                    self.pending_summary(declaration,source,exits,&attempt_needs,result.is_err())?;
                }
            }
            for need in attempt_needs {self.add_need(need.source,need.code)?;}
            match result {
                Err(diagnostic) if diagnostic.code=="ResourceLimit"=>return Err(diagnostic),
                Err(diagnostic)=>{
                    self.solver.charge(192)?;
                    self.problems.push(SignatureProblem {declaration,diagnostic});
                    self.signatures[slot].state=SignatureState::Rejected;
                },
                Ok(Some(_))=>{
                    let ty=self.signatures[slot].ty.expect("computational signature");
                    let readiness=self.solver.validate_type(ty,self.headers[slot].source);
                    let qualified=match readiness {
                        Err(diagnostic) if diagnostic.code=="ResourceLimit"=>{
                            self.solver.rollback(point.take().unwrap());self.analysis.rollback(body_point.take().unwrap());
                            self.root_summaries.remove(&declaration);return Err(diagnostic);
                        },
                        Err(diagnostic)=>{
                            self.solver.rollback(point.take().unwrap());self.analysis.rollback(body_point.take().unwrap());
                            self.root_summaries.remove(&declaration);
                            self.pending_summary(declaration,self.headers[slot].source,Vec::new(),&[],true)?;
                            self.problems.push(SignatureProblem {declaration,diagnostic});
                            self.signatures[slot].state=SignatureState::Rejected;
                            continue;
                        },
                        Ok(relation)=>relation==Relation::Equal,
                    };
                    let ready=qualified&&!self.solver.unresolved(ty)?;
                    self.signatures[slot].body_type_checked=true;
                    if let Some(expression)=self.root_summaries.get(&declaration).copied() {
                        self.solver.charge(128)?;
                        self.analysis.declarations.insert(declaration,DeclarationSummary {source:self.headers[slot].source,expression});
                    }
                    if ready {
                        self.signatures[slot].state=SignatureState::TypeReady;
                        if let Some(waiters)=self.waiting.remove(&declaration) {
                            for waiter in waiters {if queued.insert(waiter){queue.push_back(waiter);}}
                        }
                    }
                },
                Ok(None)=>{},
            }
            for dependency in self.current_waiting.clone() {
                self.solver.charge(96)?;
                self.waiting.entry(dependency).or_default().insert(declaration);
            }
        }
        self.cycles()?;
        for index in 0..self.headers.len() {
            let header=&self.headers[index];
            let signature=&self.signatures[index];
            if signature.state==SignatureState::Rejected {continue;}
            if let Some(ty)=signature.ty {
                if self.solver.unresolved(ty)? {
                    self.signatures[index].state=SignatureState::NeedsAnnotation;
                    self.add_need(header.source,"AnnotationRequired")?;
                }
            }
            if matches!(header.kind,HeaderKind::Function {..}) {
                self.add_need(header.source,"NeedsEffectClosure")?;
                self.add_need(header.source,"NeedsCaptureAndCallableQualification")?;
                if matches!(header.kind,HeaderKind::Function {contract:Some(_),..}) {self.add_need(header.source,"NeedsContractQualification")?;}
            }
            if matches!(header.kind,HeaderKind::Constant {..}) {self.add_need(header.source,"NeedsStaticConstructionQualification")?;}
        }
        self.analyze_regions()
    }
    fn validate_header(&mut self,index:usize)->Result<Relation> {
        let header=&self.headers[index];
        let mut pending=false;
        match &header.kind {
            HeaderKind::Function {parameters,returns,..}=>{
                for parameter in parameters {
                    pending|=self.solver.validate_type(parameter.ty,parameter.source)?==Relation::Needs;
                }
                if let TypeRequest::Explicit(ty)=returns {pending|=self.solver.validate_type(*ty,header.source)?==Relation::Needs;}
            },
            HeaderKind::Constant {expected:TypeRequest::Explicit(ty),..}|HeaderKind::Type {ty,..}=>{
                pending|=self.solver.validate_type(*ty,header.source)?==Relation::Needs;
            },_=>{},
        }
        Ok(if pending{Relation::Needs}else{Relation::Equal})
    }
    fn pending_summary(&mut self,declaration:DeclarationId,source:SourceId,exits:Vec<ExitFact>,needs:&[ConstraintNeed],rejected:bool)->Result<()> {
        self.solver.charge(needs.len()*32+256)?;let mut effects=Vec::new();
        for need in needs {effects.push(self.effect(need.source,EffectTerm::Unqualified {code:need.code,children:Vec::new()})?);}
        if effects.is_empty(){effects.push(self.effect(source,EffectTerm::Unqualified {code:"NeedsBodyType",children:Vec::new()})?);}
        let immediate=self.effect(source,EffectTerm::Sequence(effects))?;
        let index=self.analysis.expressions.len();
        self.analysis.expressions.push(ExpressionSummary {source,expected:None,normal:NormalResult::Pending,
            state:if rejected{BodyState::Rejected}else{BodyState::Pending},exits,immediate,latent:None,children:Vec::new(),captures:Vec::new(),value:ValueRelation::Unknown});
        self.analysis.declarations.insert(declaration,DeclarationSummary {source,expression:index});Ok(())
    }
    fn analyze_regions(&mut self)->Result<()> {
        let mut roots=Vec::new();
        let mut completed=BTreeMap::<ModuleId,BTreeSet<String>>::new();
        for header in self.headers {
            if self.analysis.declarations.contains_key(&header.declaration) {
                if let HeaderKind::Function {body,..}|HeaderKind::Constant {initializer:body,..}=&header.kind {
                    let path=&self.solver.arena.source(body.source).expanded_path;
                    self.solver.charge(path.len()*6+96)?;
                    completed.entry(header.module).or_default().insert(self.solver.arena.source(body.source).expanded_path.clone());
                }
            }
        }
        for (index,navigation) in self.navigation.iter().enumerate() {
            let module= self.names.modules[index].id;
            let mut selected=BTreeSet::new();
            for (path,site) in &navigation.sites {
                self.solver.work(1)?;
                if site.schemas.iter().any(|schema|schema.split_once('#').is_some_and(|(_,fragment)|
                    matches!(fragment,"/$defs/Expr"|"/$defs/ClosedExpr"|"/$defs/ExecBlock"))) {
                    self.solver.charge(path.len()*6+96)?;selected.insert(path.clone());
                }
            }
            for path in &selected {
                let mut parent=path.as_str();let mut nested=completed.get(&module).is_some_and(|paths|paths.contains(parent));
                while let Some((prefix,_))=parent.rsplit_once('/') {
                    if selected.contains(prefix)||completed.get(&module).is_some_and(|paths|paths.contains(prefix)){nested=true;break;}parent=prefix;
                }
                if !nested {self.solver.charge(path.len()*6+96)?;roots.push((module,path.clone()));}
            }
        }
        for (module,path) in roots {
            let source=self.source(module,&path)?;self.function_returns.clear();
            let mut env=BTreeMap::new();let mut visible=BTreeSet::new();
            for index in 0..self.solver.arena.binders.len() {
                let binder=&self.solver.arena.binders[index];let id=binder.id;
                let value=match binder.kind{SemanticKind::Value(ty)=>Some(ty),_=>None};
                if let Some(binding)=binder.binding {
                    let local=&self.names.lexical.bindings[binding.index()];
                    let scope=&self.names.lexical.scopes[local.scope.index()];
                    let occurrence=&self.names.lexical.occurrences[scope.occurrence.index()];
                    let allowed=occurrence.module==module&&(path==occurrence.expanded_path||
                        path.strip_prefix(&occurrence.expanded_path).is_some_and(|tail|tail.starts_with('/')));
                    self.solver.work(1)?;
                    if allowed {
                        self.solver.charge(96)?;visible.insert(id);
                        if let Some(ty)=value{env.insert(binding,ty);}
                    }
                }
            }
            let point=self.solver.checkpoint()?;let body_point=self.analysis.checkpoint();
            let start=self.analysis.problems.len();
            let root=match self.judge(module,&path,&env,&visible,None,0) {
                Ok(root)=>root,Err(error)=>{self.solver.rollback(point);self.analysis.rollback(body_point);return Err(error);},
            };
            if self.analysis.problems.len()>start {
                self.solver.rollback(point);self.analysis.rollback(body_point);
            }else {self.solver.charge(32)?;self.analysis.regions.push(root);}
            self.add_need(source,"NeedsProfessionalBodyQualification")?;
        }
        Ok(())
    }
    fn check_body(&mut self,index:usize)->Result<Option<TypeId>> {
        let header=&self.headers[index];
        let mut env=BTreeMap::new();
        let (expression,expected,visible)=match &header.kind {
            HeaderKind::Function {parameters,body,binders,..}=>{
                for p in parameters {env.insert(p.binding,p.ty);}
                let SemanticType::Function(function)=self.solver.copy_type(self.signatures[index].ty.unwrap())? else {unreachable!()};
                (body.clone(),function.returns,binders.iter().copied().collect())
            },
            HeaderKind::Constant {initializer,..}=>(initializer.clone(),self.signatures[index].ty.unwrap(),BTreeSet::new()),
            _=>return Ok(None),
        };
        let source=self.solver.arena.source(expression.source);
        let module=source.module;let path=source.expanded_path.clone();
        self.function_returns.clear();
        let header_path=self.solver.arena.source(header.source).expanded_path.clone();
        if matches!(header.kind,HeaderKind::Function {..}) {
            if let Some(scope)=self.scope_at(module,&header_path,"function") {self.function_returns.insert(scope,expected);}
        }
        let problems=self.analysis.problems.len();
        let root=self.judge(module,&path,&env,&visible,Some(expected),0)?;
        self.solver.charge(96)?;
        self.root_summaries.insert(header.declaration,root);
        if self.analysis.problems.len()>problems {return Err(self.analysis.problems[problems].diagnostic.clone());}
        Ok(match self.analysis.expressions[root].normal {
            NormalResult::Value(ty)=>Some(ty),
            NormalResult::NoNormal if matches!(header.kind,HeaderKind::Function {..})=>Some(expected),
            _=>None,
        })
    }
    fn source(&mut self,module:ModuleId,path:&str)->Result<SourceId> {
        self.solver.work(1)?;
        self.solver.charge(path.len()*3+32)?;
        if let Some(id)=self.sources.get(&(module,path.to_owned())) {return Ok(*id);}
        let node=self.node(module,path)?;
        self.solver.charge(320+path.len()*6)?;
        let lexical=self.lexical_occurrences.get(&(module,path.into())).copied();
        let owner=lexical.and_then(|occurrence|self.names.lexical.occurrences[occurrence.index()].owner);
        let origin=node.origin().cloned();
        if let Some(origin)=&origin {self.solver.charge(origin.pointer.len()*6+128)?;}
        let id=SourceId(self.solver.arena.sources.len());
        self.solver.arena.sources.push(SourceOccurrence {id,module,owner,expanded_path:path.into(),origin,lexical,syntax:node});
        self.sources.insert((module,path.into()),id);Ok(id)
    }
    fn node(&self,module:ModuleId,path:&str)->Result<Node> {
        self.navigation[module.index()].sites.get(path).map(|site|site.node.clone()).ok_or_else(||fail("ReaderInvariant",path,"Missing retained semantic navigation"))
    }
    fn type_at(&self,module:ModuleId,path:&str)->Option<TypeId> {self.type_ids.get(&(module,path.into())).copied()}
    fn child(&mut self,module:ModuleId,path:&str,key:&str,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<Option<TypeId>> {
        let child=self.solver.path(path,key)?;self.infer(module,&child,env,visible,expected,depth+1)
    }
    fn infer(&mut self,module:ModuleId,path:&str,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<Option<TypeId>> {
        let index=self.judge(module,path,env,visible,expected,depth)?;
        let summary=&self.analysis.expressions[index];
        Ok(if summary.state==BodyState::Rejected {None}else{match summary.normal {NormalResult::Value(ty)=>Some(ty),_=>None}})
    }
    fn effect(&mut self,source:SourceId,term:EffectTerm)->Result<EffectId> {
        self.solver.work(1)?;self.solver.charge(160)?;
        let id=EffectId(self.analysis.effects.len());self.analysis.effects.push(EffectEquation {source,term});Ok(id)
    }
    fn extra_effect(&mut self,source:SourceId,term:EffectTerm)->Result<()> {
        let effect=self.effect(source,term)?;self.solver.charge(32)?;
        self.frames.last_mut().expect("active judgment").extra_effects.push(effect);Ok(())
    }
    fn judge(&mut self,module:ModuleId,path:&str,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<usize> {
        self.solver.work(1)?;
        if depth>128{return Err(fail("ResourceLimit",path,"Body analysis depth exceeded"));}
        let source=self.source(module,path)?;let node=self.node(module,path)?;
        self.solver.charge(192)?;
        self.frames.push(Frame {source,children:Vec::new(),normal:None,extra_effects:Vec::new(),exits:Vec::new()});
        let result=self.infer_node(module,path,env,visible,expected,depth);
        let rejected=match &result {
            Err(error) if error.code=="ResourceLimit"=>{self.frames.pop();return result.map(|_|0);},
            Err(error)=>{
                self.solver.charge(192+error.path.len()*6+error.message.len()*6)?;
                self.analysis.problems.push(BodyProblem {source,diagnostic:error.clone()});true
            },_=>false,
        };
        let frame=self.frames.pop().expect("balanced judgment");
        let operation=node.get("op").or_else(||node.get("tag")).and_then(Node::as_str).unwrap_or("");
        let latent=operation=="lambda";
        let branched=matches!(operation,"if"|"match"|"try")||operation=="binary"&&
            node.get("operator").and_then(Node::as_str).is_some_and(|op|matches!(op,"&&"|"||"));
        let exit_count=frame.children.iter().map(|i|self.analysis.expressions[*i].exits.len()).sum::<usize>();
        self.solver.charge(frame.children.len()*96+exit_count*128+192)?;
        let mut exits=Vec::new();let mut effects=Vec::new();let mut activations=Vec::new();let mut continues=true;
        let mut child_rejected=false;let mut child_pending=false;
        let condition=node.get(if operation=="binary"{"left"}else{"condition"}).and_then(literal_boolean);
        let redundant=self.analysis.coverage.last().filter(|coverage|coverage.source==source);
        for (position,index) in frame.children.iter().enumerate() {
            let child=&self.analysis.expressions[*index];
            child_rejected|=child.state==BodyState::Rejected;
            child_pending|=child.normal==NormalResult::Pending;
            let branch_active=match operation {
                "if" if position>0=>condition.is_none_or(|value|position==if value{1}else{2}),
                "binary" if position>0=>!matches!((node.get("operator").and_then(Node::as_str),condition),(Some("&&"),Some(false))|(Some("||"),Some(true))),
                "match" if position>0=>redundant.is_none_or(|coverage|!coverage.redundant_arms.contains(&(position-1))),
                "while" if position>0=>condition!=Some(false),_=>true,
            };
            if continues&&!latent {
                if branch_active{exits.extend(child.exits.iter().cloned());}
                effects.push(child.immediate);activations.push(branch_active);
            }
            if !branched&&child.normal==NormalResult::NoNormal {continues=false;}
            if branched&&operation!="try"&&position==0&&child.normal==NormalResult::NoNormal {continues=false;}
        }
        if continues {activations.extend(frame.extra_effects.iter().map(|_|true));effects.extend(frame.extra_effects);exits.extend(frame.exits);}
        let ty=result.ok().flatten();
        let override_normal=match frame.normal {Some(NormalResult::Value(_)) if ty.is_none()=>Some(NormalResult::Pending),other=>other};
        let normal=if !continues&&!latent&&operation!="while" {NormalResult::NoNormal}else{override_normal.unwrap_or_else(||if latent {ty.map(NormalResult::Value).unwrap_or(NormalResult::Pending)}
            else if !continues {NormalResult::NoNormal}
            else if child_pending {NormalResult::Pending}
            else {ty.map(NormalResult::Value).unwrap_or(NormalResult::Pending)})};
        if operation=="while" {
            if let Some(scope)=self.scope_at(module,path,"loop") {
                exits.retain(|exit|!(exit.target==Some(scope)&&matches!(exit.kind,ExitKind::Break|ExitKind::Continue)));
            }
        }
        let latent_effect=if latent {
            let bodies=frame.children.iter().map(|index|self.analysis.expressions[*index].immediate).collect();
            Some(self.effect(source,EffectTerm::Sequence(bodies))?)
        }else{None};
        let term=if latent {EffectTerm::Empty}
            else if operation=="try"&&frame.children.len()>=2 {EffectTerm::Try {body:self.analysis.expressions[frame.children[0]].immediate,
                handler:self.analysis.expressions[frame.children[1]].immediate,qualification:"NeedsManagedErrorProfile"}}
            else if operation=="while"&&frame.children.len()>=2 {EffectTerm::Loop {target:self.scope_at(module,path,"loop"),
                condition:self.analysis.expressions[frame.children[0]].immediate,body:self.analysis.expressions[frame.children[1]].immediate,
                body_active:condition!=Some(false)&&self.analysis.expressions[frame.children[0]].normal!=NormalResult::NoNormal,
                condition_false:condition_false(self.analysis.expressions[frame.children[0]].normal,condition)}}
            else if branched&&!effects.is_empty() {EffectTerm::Conditional {condition:effects[0],branches:effects[1..].to_vec(),active:activations[1..].to_vec()}}
            else {EffectTerm::Sequence(effects)};
        let immediate=self.effect(source,term)?;
        let index=self.analysis.expressions.len();
        let captures=if latent {
            let scope=self.scope_at(module,path,"lambda");
            let captures=scope.and_then(|scope|self.captures.get(&scope));
            self.solver.charge(captures.map_or(0,Vec::len)*32)?;
            captures.cloned().unwrap_or_default()
        }else{Vec::new()};
        if latent&&!captures.is_empty() {
            self.solver.need(source,"NeedsCaptureEvaluation")?;
            self.analysis.effects[immediate.0].term=EffectTerm::Unqualified {code:"NeedsCaptureEvaluation",children:Vec::new()};
        }
        let value=if rejected||child_rejected {ValueRelation::Unknown}else{self.value_relation(module,path,&node,operation,&frame.children)?};
        self.analysis.expressions.push(ExpressionSummary {source,expected,normal,state:if rejected||child_rejected{BodyState::Rejected}
            else if normal==NormalResult::Pending{BodyState::Pending}else{BodyState::TypeChecked},exits,immediate,latent:latent_effect,children:frame.children,captures,value});
        if let Some(parent)=self.frames.last_mut(){self.solver.charge(32)?;parent.children.push(index);}
        Ok(index)
    }
    fn scope_at(&self,module:ModuleId,path:&str,kind:&str)->Option<ScopeId> {
        let occurrence=self.lexical_occurrences.get(&(module,path.into()))?;
        self.scopes.get(&(*occurrence,kind)).copied()
    }
    fn value_relation(&mut self,module:ModuleId,path:&str,node:&Node,operation:&str,children:&[usize])->Result<ValueRelation> {
        self.solver.charge(children.len()*64+192)?;
        let first=children.first().copied();let last=children.last().copied();
        let binding=self.local_binders.get(&(module,path.into())).copied();
        let usage=self.local_uses.get(&(module,path.into())).and_then(|index|match self.names.lexical.uses[*index].resolution{
            LocalResolution::Resolved {binding}=>Some(binding),_=>None});
        match operation {
            "var" if first.is_some()&&binding.is_some()=>Ok(ValueRelation::Initialize {binding:binding.unwrap(),initializer:first.unwrap()}),
            "var"=>Ok(usage.map(ValueRelation::Binding).unwrap_or(ValueRelation::Unknown)),
            "reference" if node.get("ref").is_some_and(|reference|reference.get("binding").is_some())=>Ok(usage.map(ValueRelation::Binding).unwrap_or(ValueRelation::Unknown)),
            "reference"|"symbol"=>{
                let reference=self.solver.path(path,"ref")?;
                if let Some(constructor)=node.get("ref").and_then(|reference|reference.get("constructor")) {
                    let constructor_path=self.solver.path(&reference,"constructor")?;let type_path=self.solver.path(&constructor_path,"type")?;
                    if let Some(ty)=self.type_at(module,&type_path) {
                        let name=constructor.get("name").and_then(Node::as_str).unwrap_or("");self.solver.charge(name.len()*6+96)?;
                        return Ok(ValueRelation::Constructor {ty,name:name.into()});
                    }
                }
                Ok(self.references.get(&(module,reference)).and_then(|index|match self.names.references[*index].resolution{
                    Resolution::Resolved {declaration,..}=>Some(ValueRelation::Declaration(declaration)),_=>None}).unwrap_or(ValueRelation::Unknown))
            },
            "lambda"=>{
                let mut parameters=Vec::new();let parent=self.solver.path(path,"params")?;
                for index in 0..node.get("params").and_then(Node::as_array).map_or(0,|parameters|parameters.len()) {
                    let parameter=self.solver.path(&parent,&index.to_string())?;
                    if let Some(binding)=self.local_binders.get(&(module,parameter)){self.solver.charge(32)?;parameters.push(*binding);}
                }
                Ok(last.map(|body|ValueRelation::Lambda {body,parameters}).unwrap_or(ValueRelation::Unknown))
            },
            "let" if children.len()>=2=>{
                let binding_path=if node.get("op").is_none(){self.solver.path(path,"binding")?}else{path.into()};
                Ok(self.local_binders.get(&(module,binding_path)).map(|binding|ValueRelation::Let {binding:*binding,initializer:children[0],continuation:*children.last().unwrap()}).unwrap_or(ValueRelation::Unknown))
            },
            "let"=>Ok(match (binding,first){(Some(binding),Some(initializer))=>ValueRelation::Initialize {binding,initializer},_=>ValueRelation::Unknown}),
            "set"=>Ok(match (usage,last){(Some(binding),Some(value))=>ValueRelation::Assign {binding,value},_=>ValueRelation::Unknown}),
            "region"=>{
                let mut bindings=Vec::new();let parent=self.solver.path(path,"bindings")?;
                for index in 0..node.get("bindings").and_then(Node::as_array).map_or(0,|bindings|bindings.len()) {
                    let entry=self.solver.path(&parent,&index.to_string())?;let binding_path=self.solver.path(&entry,"binding")?;
                    if let (Some(binding),Some(initializer))=(self.local_binders.get(&(module,binding_path)),children.get(index)){bindings.push((*binding,*initializer));}
                }
                Ok(last.map(|result|ValueRelation::Region {bindings,result}).unwrap_or(ValueRelation::Unknown))
            },
            "if"=>Ok(ValueRelation::Choose(children.iter().skip(1).copied().collect())),
            "try"=>Ok(ValueRelation::Choose(children.to_vec())),
            "match"=>{
                let parent=self.solver.path(path,if node.get("op").is_some(){"cases"}else{"arms"})?;let mut arms=Vec::new();
                for (index,expression) in children.iter().skip(1).enumerate() {
                    let entry=self.solver.path(&parent,&index.to_string())?;let source=self.source(module,&entry)?;arms.push((source,*expression));
                }
                Ok(first.map(|subject|ValueRelation::Match {subject,arms}).unwrap_or(ValueRelation::Unknown))
            },
            "record"|"record-update"=>{
                let fields=node.get("fields").and_then(Node::as_array).unwrap_or(&[]);let offset=usize::from(operation=="record-update");let mut values=Vec::new();
                for (index,field) in fields.iter().enumerate() {
                    if let Some(value)=children.get(index+offset) {
                        let name=field.get("name").and_then(Node::as_str).unwrap_or("");self.solver.charge(name.len()*6+96)?;values.push((name.into(),*value));
                    }
                }
                if operation=="record-update"{Ok(first.map(|receiver|ValueRelation::RecordUpdate {receiver,fields:values}).unwrap_or(ValueRelation::Unknown))}
                else {Ok(ValueRelation::Record(values))}
            },
            "list"|"sequence"=>{
                let count=node.get("items").and_then(Node::as_array).map_or(0,|items|items.len());
                Ok(ValueRelation::List {items:children.iter().take(count).copied().collect(),tail:if node.get("tail").is_some(){last}else{None}})
            },
            "field"=>{
                let name=node.get("name").and_then(Node::as_str).unwrap_or("");self.solver.charge(name.len()*6+96)?;
                Ok(first.map(|receiver|ValueRelation::Field {receiver,name:name.into()}).unwrap_or(ValueRelation::Unknown))
            },
            "variant"=>{
                let name=node.get("constructor").and_then(Node::as_str).unwrap_or("");self.solver.charge(name.len()*6+96)?;
                Ok(last.map(|payload|ValueRelation::Variant {name:name.into(),payload}).unwrap_or(ValueRelation::Unknown))
            },
            "call"=>Ok(self.analysis.calls.last().filter(|call|self.solver.arena.source(call.source).expanded_path==path&&self.solver.arena.source(call.source).module==module)
                .map(|_|ValueRelation::Call(self.analysis.calls.len()-1)).unwrap_or(ValueRelation::Unknown)),
            "while"=>Ok(if children.len()>=2 {ValueRelation::Loop {condition:children[0],body:children[1]}}else{ValueRelation::Unknown}),
            "exec:block"|"do"=>Ok(ValueRelation::Sequence {steps:children.to_vec(),result:if node.get("result").is_some(){last}else{None}}),
            "scope"|"eval"=>Ok(ValueRelation::Sequence {steps:children.to_vec(),result:None}),
            "return"=>Ok(last.map(ValueRelation::Forward).unwrap_or(ValueRelation::Data)),
            "literal"|"unary"|"binary"=>Ok(ValueRelation::Data),
            _=>Ok(ValueRelation::Unknown),
        }
    }
    fn owns(&self,module:ModuleId,path:&str,name:&str)->bool {
        self.navigation[module.index()].sites.get(path).is_some_and(|site|site.schemas.iter().any(|schema|
            schema.split_once('#').is_some_and(|(_,fragment)|fragment.strip_prefix("/$defs/")==Some(name))))
    }
    fn bind_type(&mut self,module:ModuleId,path:&str,ty:TypeId)->Result<LocalBindingId> {
        let binding=*self.local_binders.get(&(module,path.into())).ok_or_else(||fail("ReaderInvariant",path,"Missing retained local binding"))?;
        let source=self.source(module,path)?;self.solver.charge(96)?;
        self.analysis.bindings.push(BindingFact {source,binding,ty});Ok(binding)
    }
    fn block(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<Option<TypeId>> {
        self.solver.charge(env.len()*96)?;let mut inner=env.clone();
        let parent=self.solver.path(path,"statements")?;
        for (index,statement) in node.get("statements").and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let child=self.solver.path(&parent,&index.to_string())?;
            self.infer(module,&child,&inner,visible,None,depth+1)?;
            if statement.get("op").and_then(Node::as_str).is_some_and(|op|matches!(op,"let"|"var")) {
                if let Some(binding)=self.local_binders.get(&(module,child.clone())).copied() {
                    if let Some(fact)=self.analysis.bindings.last().filter(|fact|fact.binding==binding) {
                        self.solver.charge(96)?;inner.insert(binding,fact.ty);
                    }
                }
            }
        }
        let normal=!self.frames.last().unwrap().children.iter().any(|index|self.analysis.expressions[*index].normal==NormalResult::NoNormal);
        if node.get("result").is_some(){self.child(module,path,"result",&inner,visible,if normal{expected}else{None},depth)}
        else {let unit=self.scalar("unit")?;let source=self.source(module,path)?;if normal {if let Some(expected)=expected {self.solver.compatible(unit,expected,source)?;}}Ok(Some(unit))}
    }
    fn statement(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,depth:usize)->Result<Option<TypeId>> {
        let source=self.source(module,path)?;let unit=self.scalar("unit")?;
        match node.get("op").and_then(Node::as_str).unwrap_or("") {
            "let"|"var"=>{
                let type_path=self.solver.path(path,"type")?;let annotation=self.type_at(module,&type_path);
                let value=self.child(module,path,"value",env,visible,annotation,depth)?;
                let ty=match annotation.or(value){Some(ty)=>ty,None=>self.solver.fresh(SemanticKind::Type,visible.clone())?};
                self.bind_type(module,path,ty)?;
            },
            "set"=>{
                let index=self.local_uses.get(&(module,path.into())).copied().ok_or_else(||fail("ReaderInvariant",path,"Missing set target"))?;
                let binding=match self.names.lexical.uses[index].resolution {
                    LocalResolution::Resolved {binding}=>Some(binding),
                    LocalResolution::Rejected {code}=>{self.child(module,path,"value",env,visible,None,depth)?;return Err(fail(code,path,"Rejected set target"));},
                    LocalResolution::Needs {code}=>{self.solver.need(source,code)?;None},
                };
                let expected=binding.and_then(|b|env.get(&b).copied());
                self.child(module,path,"value",env,visible,expected,depth)?;
                if let Some(binding)=binding {
                    if !self.names.lexical.bindings[binding.index()].mutable {return Err(fail("ImmutableAssignment",path,"Target is immutable"));}
                    self.extra_effect(source,EffectTerm::Write(binding))?;
                }
                if expected.is_none(){self.solver.need(source,"NeedsProfessionalValueEnvironment")?;self.frames.last_mut().unwrap().normal=Some(NormalResult::Pending);}
            },
            "if"=>{
                let boolean=self.scalar("bool")?;self.child(module,path,"condition",env,visible,Some(boolean),depth)?;
                self.child(module,path,"then",env,visible,Some(unit),depth)?;
                if node.get("else").is_some(){self.child(module,path,"else",env,visible,Some(unit),depth)?;}
                self.branch_normal(node.get("else").is_none(),Some(unit))?;
            },
            "while"=>{
                let boolean=self.scalar("bool")?;self.child(module,path,"condition",env,visible,Some(boolean),depth)?;
                self.child(module,path,"body",env,visible,Some(unit),depth)?;
                let condition=self.frames.last().unwrap().children.first().copied().unwrap();
                let child=&self.analysis.expressions[condition];
                let body=*self.frames.last().unwrap().children.last().unwrap();
                let body=&self.analysis.expressions[body];
                let literal=node.get("condition").and_then(literal_boolean);
                let body_active=child.normal!=NormalResult::NoNormal&&literal!=Some(false);
                let loop_scope=self.scope_at(module,path,"loop");
                self.solver.work(child.exits.len()+if body_active{body.exits.len()}else{0})?;
                let has_break=loop_scope.is_some()&&child.exits.iter().chain(body.exits.iter().filter(|_|body_active))
                    .any(|exit|exit.kind==ExitKind::Break&&exit.target==loop_scope);
                self.frames.last_mut().unwrap().normal=Some(if child.normal==NormalResult::Pending||body_active&&body.normal==NormalResult::Pending {
                    NormalResult::Pending
                }else if has_break||condition_false(child.normal,literal){NormalResult::Value(unit)}else{NormalResult::NoNormal});
            },
            "return"|"break"|"continue"=>{
                let occurrence=self.lexical_occurrences.get(&(module,path.into())).copied();
                let exit=self.names.lexical.exits.iter().find(|exit|Some(exit.occurrence)==occurrence);
                let target=match exit.map(|exit|&exit.target) {
                    Some(ControlResolution::Resolved {scope})=>Some(*scope),
                    Some(ControlResolution::Rejected {code})=>return Err(fail(code,path,"Rejected control target")),
                    Some(ControlResolution::Needs {code})=>{self.solver.need(source,code)?;None},
                    None=>{self.solver.need(source,"NeedsControlEnvironment")?;None},
                };
                let is_return=node.get("op").and_then(Node::as_str)==Some("return");
                let expected=target.and_then(|target|self.function_returns.get(&target).copied());
                let value=if node.get("value").is_some(){self.child(module,path,"value",env,visible,expected,depth)?}
                    else if is_return {if let Some(expected)=expected{self.solver.compatible(unit,expected,source)?;}Some(unit)}else{None};
                let kind=if is_return{ExitKind::Return}else if node.get("op").and_then(Node::as_str)==Some("break"){ExitKind::Break}else{ExitKind::Continue};
                self.solver.charge(128)?;
                let frame=self.frames.last_mut().unwrap();let expression=if node.get("value").is_some(){frame.children.last().copied()}else{None};
                frame.exits.push(ExitFact {source,kind,target,value,expression});
                frame.normal=Some(if target.is_none()||is_return&&value.is_none(){NormalResult::Pending}else{NormalResult::NoNormal});
            },
            "eval"=>{self.child(module,path,"value",env,visible,None,depth)?;},
            "scope"=>{self.child(module,path,"body",env,visible,None,depth)?;},
            _=>return Err(fail("GrammarDrift",path,"Unknown selected ExecStatement")),
        }
        Ok(Some(unit))
    }
    fn branch_normal(&mut self,implicit_unit:bool,expected:Option<TypeId>)->Result<Option<TypeId>> {
        let frame=self.frames.last().unwrap();
        self.solver.charge(frame.children.len()*32)?;
        let branches=frame.children.iter().skip(1).copied().collect::<Vec<_>>();
        let source=frame.source;let mut result=if implicit_unit{expected}else{None};let mut pending=false;
        for index in branches {
            match self.analysis.expressions[index].normal {
                NormalResult::Value(ty)=>{if let Some(wanted)=result {pending|=!self.compatible_types(ty,wanted,source)?;}else{result=Some(ty);}},
                NormalResult::NoNormal=>{},NormalResult::Pending=>pending=true,
            }
        }
        let condition=self.frames.last().unwrap().children.first().map(|index|self.analysis.expressions[*index].normal);
        self.frames.last_mut().unwrap().normal=Some(match condition {
            Some(NormalResult::NoNormal)=>NormalResult::NoNormal,
            Some(NormalResult::Pending)=>NormalResult::Pending,
            _=>if pending{NormalResult::Pending}else{result.map(NormalResult::Value).unwrap_or(NormalResult::NoNormal)},
        });
        Ok(result)
    }
    fn compatible_types(&mut self,actual:TypeId,expected:TypeId,source:SourceId)->Result<bool> {
        self.solver.compatible_type_shape(actual,expected,source)
    }
    /// Only a completed nonlocal exit removes the continuation's result
    /// expectation. Local annotations and operand/call contracts are passed
    /// independently to their own judgments, including unreachable source.
    fn continuation_expected(&self,expected:Option<TypeId>)->Option<TypeId> {
        if self.frames.last().unwrap().children.iter().any(|index|self.analysis.expressions[*index].normal==NormalResult::NoNormal){None}else{expected}
    }
    fn no_normal_result(&self,operation:&str,node:&Node)->bool {
        if operation=="lambda" {return false;}
        let frame=self.frames.last().unwrap();
        let condition=matches!(operation,"if"|"match")||operation=="binary"&&node.get("operator").and_then(Node::as_str).is_some_and(|operator|matches!(operator,"&&"|"||"));
        if condition&&frame.children.first().is_some_and(|index|self.analysis.expressions[*index].normal==NormalResult::NoNormal){return true;}
        if let Some(normal)=frame.normal {return normal==NormalResult::NoNormal;}
        frame.children.iter().any(|index|self.analysis.expressions[*index].normal==NormalResult::NoNormal)
    }
    fn infer_node(&mut self,module:ModuleId,path:&str,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<Option<TypeId>> {
        self.solver.work(1)?;
        if depth>128 {return Err(fail("ResourceLimit",path,"Signature expression depth exceeded"));}
        let source=self.source(module,path)?;let node=self.node(module,path)?;
        if self.owns(module,path,"ExecBlock") {return self.block(module,path,&node,env,visible,expected,depth);}
        if self.owns(module,path,"ExecStatement") {return self.statement(module,path,&node,env,visible,depth);}
        let shared=node.get("op").is_none();
        let operation=node.get(if shared {"tag"}else{"op"}).and_then(Node::as_str).unwrap_or("");
        let ty=match operation {
            "literal"=>self.literal(module,path,&node,source)?,
            "var"=>self.variable(module,path,env,source)?,
            "reference" if shared&&node.get("ref").is_some_and(|r|r.get("binding").is_some())=>self.variable(module,path,env,source)?,
            "reference" if shared&&node.get("ref").is_some_and(|r|r.get("resultOf").is_some())=>{self.solver.need(source,"NeedsPostconditionEnvironment")?;None},
            "reference" if shared&&node.get("ref").is_some_and(|r|r.get("constructor").is_some())=>self.constructor_value(module,path,&node,source)?,
            "symbol"|"reference"=>self.symbol(module,path,visible,source)?,
            "let"=>{
                let binding_path=if shared {self.solver.path(path,"binding")?}else{path.into()};
                let annotation_path=self.solver.path(&binding_path,"type")?;
                let annotation=self.type_at(module,&annotation_path);
                let value=self.child(module,path,if shared {"initializer"}else{"value"},env,visible,annotation,depth)?;
                let Some(binding)=self.local_binders.get(&(module,binding_path)).copied() else {return Err(fail("ReaderInvariant",path,"Missing lexical let binder"));};
                let value=match annotation.or(value){Some(value)=>value,None=>self.solver.fresh(SemanticKind::Type,visible.clone())?};
                self.solver.charge(env.len()*96+96)?;
                let mut inner=env.clone();inner.insert(binding,value);
                let continuation_expected=self.continuation_expected(expected);
                self.child(module,path,if shared {"continuation"}else{"body"},&inner,visible,continuation_expected,depth)?
            },
            "if"=>{
                let boolean=self.scalar("bool")?;
                self.child(module,path,"condition",env,visible,Some(boolean),depth)?;
                let branch_expected=self.continuation_expected(expected);
                self.child(module,path,"then",env,visible,branch_expected,depth)?;
                self.child(module,path,"otherwise",env,visible,branch_expected,depth)?;
                self.branch_normal(false,branch_expected)?
            },
            "call"=>self.call(module,path,&node,env,visible,source,depth)?,
            "lambda"=>self.lambda(module,path,&node,env,visible,expected,source,shared,depth)?,
            "record"=>self.record(module,path,&node,env,visible,expected,source,depth)?,
            "record-update" if shared=>self.record_update(module,path,&node,env,visible,source,depth)?,
            "region" if shared=>self.region(module,path,&node,env,visible,expected,depth)?,
            "unary" if shared=>{
                let boolean=node.get("operator").and_then(Node::as_str)==Some("!");
                let operand=self.scalar(if boolean{"bool"}else{"int"})?;
                self.child(module,path,"operand",env,visible,Some(operand),depth)?.map(|_|operand)
            },
            "variant"=>self.variant(module,path,&node,env,visible,expected,source,depth)?,
            "match"=>self.match_value(module,path,&node,env,visible,expected,source,shared,depth)?,
            "sequence"|"list"=>{
                let item=if let Some(expected)=expected {
                    let expected=self.solver.normalize(expected,source)?;
                    match self.solver.arena.get(expected) {SemanticType::Sequence {item,..}|SemanticType::List(item)=>*item,_=>self.solver.fresh(SemanticKind::Type,visible.clone())?}
                }else{self.solver.fresh(SemanticKind::Type,visible.clone())?};
                let items_path=self.solver.path(path,"items")?;
                let mut complete=true;
                for index in 0..node.get("items").and_then(Node::as_array).map_or(0,|a|a.len()) {
                    let child=self.solver.path(&items_path,&index.to_string())?;
                    complete&=self.infer(module,&child,env,visible,Some(item),depth+1)?.is_some();
                }
                if shared&&node.get("tail").is_some() {
                    let list=self.solver.insert(SemanticType::List(item))?;
                    complete&=self.child(module,path,"tail",env,visible,Some(list),depth)?.is_some();
                }
                if complete {Some(self.solver.insert(if shared{SemanticType::List(item)}else{SemanticType::Sequence {item,ordered:true}})?)}else{None}
            },
            "field"=>{
                let receiver=self.child(module,path,if shared {"receiver"}else{"record"},env,visible,None,depth)?;
                if let Some(receiver)=receiver {
                    let receiver=self.solver.normalize(receiver,source)?;
                    let view=self.representation(module,receiver,source)?;
                    match view.map(|view|self.solver.copy_type(view)).transpose()? {
                        Some(SemanticType::Record {fields,..})=>{
                            let name=node.get("name").and_then(Node::as_str).unwrap_or("");
                            let field=fields.get(name).ok_or_else(||fail("UnknownField",path,name))?;
                            if field.optional.unwrap_or(false)||field.mutable.unwrap_or(false) {self.solver.need(source,"NeedsFieldAccessQualification")?;None}else{Some(field.ty)}
                        },
                        Some(SemanticType::Inference(_)|SemanticType::Hole {..}|SemanticType::Needs {..})=>{self.solver.need(source,"AnnotationRequiredField")?;None},
                        Some(SemanticType::Scalar(_)|SemanticType::Variant(_)|SemanticType::Tuple(_)|SemanticType::Option(_)|SemanticType::Result {..}|
                        SemanticType::List(_)|SemanticType::Sequence {..}|SemanticType::Set {..}|SemanticType::Bag {..}|SemanticType::Map {..}|SemanticType::Function(_)|SemanticType::Rational)=>{
                            return Err(fail("InvalidFieldReceiver",path,"This known value type has no record fields"));
                        },
                        _=>{self.solver.need(source,"NeedsFieldProjectionQualification")?;None},
                    }
                }else{None}
            },
            "do"=>{
                let parent=self.solver.path(path,"steps")?;let mut complete=true;
                for index in 0..node.get("steps").and_then(Node::as_array).map_or(0,|a|a.len()) {
                    let child=self.solver.path(&parent,&index.to_string())?;complete&=self.infer(module,&child,env,visible,None,depth+1)?.is_some();
                }
                let result_expected=self.continuation_expected(expected);
                let value=self.child(module,path,"result",env,visible,result_expected,depth)?;if complete {value}else{None}
            },
            "binary" if shared=>{
                let op=node.get("operator").and_then(Node::as_str).unwrap_or("");
                if matches!(op,"/"|"%") {
                    self.solver.need(source,"NeedsArithmeticErrorProfile")?;
                    self.extra_effect(source,EffectTerm::Unqualified {code:"NeedsArithmeticErrorProfile",children:Vec::new()})?;
                }
                if matches!(op,"=="|"!=") {
                    let a=self.child(module,path,"left",env,visible,None,depth)?;
                    self.child(module,path,"right",env,visible,a,depth)?;
                    self.solver.need(source,"NeedsEqualityQualification")?;return Ok(None);
                }
                let (operand,result)=match op {"+"|"-"|"*"|"/"|"%"=>("int","int"),"<"|"<="|">"|">="=>("int","bool"),"&&"|"||"=>("bool","bool"),_=>{self.solver.need(source,"NeedsOperatorQualification")?;return Ok(None);}};
                let operand=self.scalar(operand)?;
                let a=self.child(module,path,"left",env,visible,Some(operand),depth)?;
                let b=self.child(module,path,"right",env,visible,Some(operand),depth)?;
                if a.is_some()&&b.is_some(){Some(self.scalar(result)?)}else{None}
            },
            "throw"=>{
                let value=self.child(module,path,"error",env,visible,None,depth)?;
                self.solver.need(source,"NeedsManagedErrorProfile")?;
                self.extra_effect(source,EffectTerm::Unqualified {code:"NeedsManagedErrorProfile",children:Vec::new()})?;
                let expression=self.frames.last().unwrap().children.last().copied();
                self.frames.last_mut().unwrap().exits.push(ExitFact {source,kind:ExitKind::UnqualifiedRaise,target:None,value,expression});
                None
            },
            "try"=>self.try_value(module,path,&node,env,visible,expected,source,depth)?,
            "perform"=>{
                let parent=self.solver.path(path,"arguments")?;
                for index in 0..node.get("arguments").and_then(Node::as_array).map_or(0,|a|a.len()) {
                    let child=self.solver.path(&parent,&index.to_string())?;self.infer(module,&child,env,visible,None,depth+1)?;
                }
                self.solver.need(source,"NeedsPortOperationSignature")?;
                self.extra_effect(source,EffectTerm::Unqualified {code:"NeedsPortOperationSignature",children:Vec::new()})?;None
            },
            "await"=>{
                let value=self.child(module,path,"future",env,visible,None,depth)?;
                self.solver.need(source,"NeedsAsyncResourceQualification")?;
                self.extra_effect(source,EffectTerm::Unqualified {code:"NeedsAsyncResourceQualification",children:Vec::new()})?;
                match value {Some(ty)=>{let ty=self.solver.normalize(ty,source)?;match self.solver.arena.get(ty){SemanticType::Future(item)=>Some(*item),
                    SemanticType::Inference(_)|SemanticType::Needs {..}|SemanticType::Hole {..}=>{self.solver.need(source,"NeedsFutureType")?;None},
                    _=>return Err(fail("NotFutureType",path,"Await requires Future"))}},None=>None}
            },
            "hole" if shared=>{self.solver.need(source,"NeedsExpressionHole")?;None},
            _=>{self.solver.need(source,if node.get("statements").is_some(){"NeedsExecBodyAnalysis"}else{"NeedsExpressionTypeRule"})?;None},
        };
        if let (Some(actual),Some(expected))=(ty,expected.filter(|_|!self.no_normal_result(operation,&node))) {
            if !self.compatible_types(actual,expected,source)? {return Ok(None);}
        }
        Ok(ty)
    }
    fn scalar(&mut self,name:&str)->Result<TypeId> {
        self.solver.insert(SemanticType::Scalar(ScalarType {name:name.into(),bits:None,scale:None,overflow:None,text_index:None,rounding:None,nan_policy:None,encoding:None,clock_ref:None}))
    }
    fn literal(&mut self,module:ModuleId,path:&str,node:&Node,source:SourceId)->Result<Option<TypeId>> {
        let type_path=self.solver.path(path,"type")?;
        let ty=if let Some(ty)=self.type_at(module,&type_path){ty}
            else if let Some(name)=node.get("type").and_then(Node::as_str) {self.scalar(match name {"Int"=>"int","Bool"=>"bool","Text"=>"text","Unit"=>"unit",_=>{self.solver.need(source,"NeedsLiteralValueQualification")?;return Ok(None);}})?}
            else{return Err(fail("ReaderInvariant",path,"Literal type was not formed"));};
        let normalized=self.solver.normalize(ty,source)?;
        let value=node.get("value");
        let valid=match self.solver.arena.get(normalized) {
            SemanticType::Scalar(s) if s.bits.is_none()&&s.scale.is_none()&&s.overflow.is_none()&&s.text_index.is_none()&&s.encoding.is_none()&&s.rounding.is_none()&&s.nan_policy.is_none()&&s.clock_ref.is_none()=>{
                match s.name.as_str() {
                    "int"=>value.and_then(Node::as_str).is_some_and(|v|v=="0"||{
                        let digits=v.strip_prefix('-').unwrap_or(v);
                        !digits.is_empty()&&!digits.starts_with('0')&&digits.bytes().all(|c|c.is_ascii_digit())
                    }),
                    "bool"=>value.and_then(Node::as_bool).is_some(),"text"=>value.and_then(Node::as_str).is_some(),
                    "unit"=>value.is_none_or(|value|matches!(value.kind(),JsonKind::Null)),
                    _=>{self.solver.need(source,"NeedsLiteralValueQualification")?;return Ok(None);},
                }
            },
            _=>{self.solver.need(source,"NeedsLiteralValueQualification")?;return Ok(None);},
        };
        if !valid{return Err(fail("InvalidLiteralValue",path,"Value does not inhabit its declared literal type"));}
        Ok(Some(ty))
    }
    fn variable(&mut self,module:ModuleId,path:&str,env:&BTreeMap<LocalBindingId,TypeId>,source:SourceId)->Result<Option<TypeId>> {
        if let Some(index)=self.local_uses.get(&(module,path.into())) {
            match self.names.lexical.uses[*index].resolution {
                LocalResolution::Resolved {binding}=>{
                    if let Some(ty)=env.get(&binding){
                        if self.names.lexical.bindings[binding.index()].mutable {self.extra_effect(source,EffectTerm::Read(binding))?;}
                        return Ok(Some(*ty));
                    }
                    self.solver.need(source,"NeedsProfessionalValueEnvironment")?;
                },
                LocalResolution::Needs {code}=>{self.solver.need(source,code)?;},
                LocalResolution::Rejected {code}=>return Err(fail(code,path,"Rejected lexical reference")),
            }
        }else{self.solver.need(source,"NeedsLexicalValueBinding")?;}
        Ok(None)
    }
    fn representation(&mut self,module:ModuleId,ty:TypeId,source:SourceId)->Result<Option<TypeId>> {
        let ty=self.solver.normalize(ty,source)?;
        if let SemanticType::Declaration {target,..}=self.solver.arena.get(ty) {
            if let Some(declaration)=target.declaration {
                let header=&self.headers[self.slots[&declaration]];
                if matches!(header.kind,HeaderKind::Type {opaque:Some(true),..})&&header.module!=module {
                    self.solver.need(source,"NeedsOpaqueRepresentationRights")?;return Ok(None);
                }
            }
        }
        self.solver.declaration_body(ty,source)
    }
    fn region(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,depth:usize)->Result<Option<TypeId>> {
        self.solver.charge(env.len()*96)?;let mut inner=env.clone();let parent=self.solver.path(path,"bindings")?;
        for (index,_) in node.get("bindings").and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let entry=self.solver.path(&parent,&index.to_string())?;let binding_path=self.solver.path(&entry,"binding")?;
            let type_path=self.solver.path(&binding_path,"type")?;let annotation=self.type_at(module,&type_path);
            let value=self.child(module,&entry,"initializer",&inner,visible,annotation,depth)?;
            let ty=match annotation.or(value){Some(ty)=>ty,None=>self.solver.fresh(SemanticKind::Type,visible.clone())?};
            let binding=self.bind_type(module,&binding_path,ty)?;self.solver.charge(96)?;inner.insert(binding,ty);
        }
        let result_expected=self.continuation_expected(expected);
        self.child(module,path,"expression",&inner,visible,result_expected,depth)
    }
    fn record_update(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,source:SourceId,depth:usize)->Result<Option<TypeId>> {
        let receiver=self.child(module,path,"receiver",env,visible,None,depth)?;
        let view=match receiver{Some(ty)=>self.representation(module,ty,source)?,None=>None};
        let fields=match view.map(|ty|self.solver.copy_type(ty)).transpose()? {
            Some(SemanticType::Record {fields,..})=>Some(fields),
            Some(SemanticType::Inference(_)|SemanticType::Hole {..}|SemanticType::Needs {..})|None=>{self.solver.need(source,"NeedsRecordUpdateType")?;None},
            _=>return Err(fail("InvalidRecordUpdate",path,"Update requires a record")),
        };
        let parent=self.solver.path(path,"fields")?;let mut names=BTreeSet::new();let mut complete=fields.is_some();
        for (index,field) in node.get("fields").and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let name=field.get("name").and_then(Node::as_str).unwrap_or("");let entry=self.solver.path(&parent,&index.to_string())?;
            if !names.insert(name){return Err(fail("DuplicateRecordField",path,name));}
            let expected=fields.as_ref().and_then(|fields|fields.get(name));
            let value=self.child(module,&entry,"value",env,visible,expected.map(|field|field.ty),depth)?;
            if fields.is_some()&&expected.is_none(){return Err(fail("UnknownField",path,name));}
            if expected.is_some_and(|field|field.mutable.unwrap_or(false)) {self.solver.need(source,"NeedsRecordUpdateOwnershipQualification")?;complete=false;}
            complete&=value.is_some();
        }
        Ok(if complete{receiver}else{None})
    }
    fn constructor_value(&mut self,module:ModuleId,path:&str,node:&Node,source:SourceId)->Result<Option<TypeId>> {
        let reference=self.solver.path(path,"ref")?;let constructor=self.solver.path(&reference,"constructor")?;
        let type_path=self.solver.path(&constructor,"type")?;
        let Some(ty)=self.type_at(module,&type_path) else{self.solver.need(source,"NeedsConstructorType")?;return Ok(None);};
        let Some(view)=self.representation(module,ty,source)? else{return Ok(None);};
        let name=node.get("ref").and_then(|r|r.get("constructor")).and_then(|c|c.get("name")).and_then(Node::as_str).unwrap_or("");
        let SemanticType::Variant(cases)=self.solver.copy_type(view)? else{return Err(fail("InvalidConstructorType",path,"Constructor requires sum type"));};
        let payload=*cases.get(name).ok_or_else(||fail("UnknownConstructor",path,name))?;
        let payload=self.solver.normalize(payload,source)?;
        let parameters=if matches!(self.solver.arena.get(payload),SemanticType::Scalar(scalar) if scalar.name=="unit"){vec![]}else{vec![SemanticArgument::Type(payload)]};
        Ok(Some(self.solver.insert(SemanticType::Function(FunctionType {binders:vec![],parameters,returns:ty,
            effects:None,pending_effects:false,pending_captures:false,call_mode:None,parameter_contracts:None,captures:None}))?))
    }
    fn variant(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,source:SourceId,depth:usize)->Result<Option<TypeId>> {
        let view=match expected{Some(ty)=>self.representation(module,ty,source)?,None=>None};
        let payload=match view.map(|ty|self.solver.copy_type(ty)).transpose()? {
            Some(SemanticType::Variant(cases))=>{
                let name=node.get("constructor").and_then(Node::as_str).unwrap_or("");
                Some(*cases.get(name).ok_or_else(||fail("UnknownConstructor",path,name))?)
            },
            None=>{self.solver.need(source,if expected.is_some(){"NeedsVariantRepresentation"}else{"AnnotationRequiredVariant"})?;None},
            Some(SemanticType::Inference(_)|SemanticType::Needs {..}|SemanticType::Hole {..})=>{self.solver.need(source,"AnnotationRequiredVariant")?;None},
            _=>return Err(fail("InvalidConstructorType",path,"Variant requires sum type")),
        };
        let value=self.child(module,path,"payload",env,visible,payload,depth)?;
        Ok(if value.is_some()&&payload.is_some(){expected}else{None})
    }
    fn try_value(&mut self,module:ModuleId,path:&str,_node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,source:SourceId,depth:usize)->Result<Option<TypeId>> {
        let body=self.child(module,path,"body",env,visible,expected,depth)?;
        self.solver.need(source,"NeedsManagedErrorProfile")?;self.solver.need(source,"NeedErrorType")?;
        let error=self.solver.fresh(SemanticKind::Type,visible.clone())?;
        self.solver.charge(env.len()*96+96)?;let mut handler=env.clone();let binding=self.bind_type(module,path,error)?;handler.insert(binding,error);
        self.child(module,path,"onError",&handler,visible,expected.or(body),depth)?;
        // The normal type can be checked without assigning a managed Raise
        // domain or claiming that the handler catches any foreign failure.
        self.solver.charge(self.frames.last().unwrap().children.len()*32)?;
        let children=self.frames.last().unwrap().children.clone();
        let mut result=None;let mut pending=false;
        for index in children {
            match self.analysis.expressions[index].normal {
                NormalResult::Value(ty)=>{if let Some(wanted)=result{pending|=!self.compatible_types(ty,wanted,source)?;}else{result=Some(ty);}},
                NormalResult::Pending=>pending=true,NormalResult::NoNormal=>{},
            }
        }
        self.frames.last_mut().unwrap().normal=Some(if pending{NormalResult::Pending}else{result.map(NormalResult::Value).unwrap_or(NormalResult::NoNormal)});
        Ok(result)
    }
    fn domain(&mut self,module:ModuleId,ty:TypeId,source:SourceId)->Result<Domain> {
        let Some(view)=self.representation(module,ty,source)? else{return Ok(Domain::Unknown);};
        Ok(match self.solver.copy_type(view)? {
            SemanticType::Scalar(s) if s.name=="bool"=>Domain::Closed(vec![Constructor {name:"false".into(),fields:vec![]},Constructor {name:"true".into(),fields:vec![]}]),
            SemanticType::Scalar(s) if s.name=="unit"=>Domain::Closed(vec![Constructor {name:"unit".into(),fields:vec![]}]),
            SemanticType::Scalar(s) if matches!(s.name.as_str(),"int"|"text")=>Domain::Open,
            SemanticType::List(item)|SemanticType::Sequence {item,ordered:true}=>Domain::Closed(vec![Constructor {name:"Nil".into(),fields:vec![]},Constructor {name:"Cons".into(),fields:vec![item,ty]}]),
            SemanticType::Variant(cases)=>{
                let mut constructors=Vec::new();
                for (name,payload) in cases {
                    let payload=self.solver.normalize(payload,source)?;
                    let unit=matches!(self.solver.arena.get(payload),SemanticType::Scalar(s) if s.name=="unit");
                    self.solver.charge(160)?;constructors.push(Constructor {name,fields:if unit{vec![]}else{vec![payload]}});
                }
                Domain::Closed(constructors)
            },_=>Domain::Unknown,
        })
    }
    fn pattern_value_binding(&mut self,arm:SourceId,binding:LocalBindingId,projection:&[ValueProjection])->Result<()> {
        self.solver.charge(projection.iter().map(|part|match part{ValueProjection::Variant(name)=>name.len()*6+96,_=>96}).sum::<usize>()+128)?;
        self.analysis.pattern_values.push(PatternValueBinding {arm,binding,projection:projection.to_vec()});Ok(())
    }
    fn pattern(&mut self,module:ModuleId,path:&str,node:&Node,ty:TypeId,env:&mut BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,source:SourceId,arm:SourceId,projection:&[ValueProjection],depth:usize)->Result<PatternShape> {
        self.solver.work(1)?;if depth>128{self.solver.need(source,"NeedsPatternCoverageBudget")?;return Ok(PatternShape::Unknown);}
        match node.get("tag").and_then(Node::as_str).unwrap_or("") {
            "wildcard"=>Ok(PatternShape::Any),
            "bind"=>{
                let binding_path=self.solver.path(path,"binding")?;let type_path=self.solver.path(&binding_path,"type")?;
                if let Some(annotation)=self.type_at(module,&type_path){self.solver.compatible(ty,annotation,source)?;}
                let binding=self.bind_type(module,&binding_path,ty)?;self.solver.charge(96)?;env.insert(binding,ty);
                self.pattern_value_binding(arm,binding,projection)?;Ok(PatternShape::Any)
            },
            "literal"=>{
                let Some(literal)=self.literal(module,path,node,source)? else{return Ok(PatternShape::Unknown);};
                if self.solver.compatible(literal,ty,source)?==Relation::Needs{return Ok(PatternShape::Unknown);}
                let literal=self.solver.normalize(literal,source)?;
                match self.solver.arena.get(literal) {
                    SemanticType::Scalar(scalar) if scalar.name=="unit"=>Ok(PatternShape::Case("unit".into(),vec![])),
                    SemanticType::Scalar(scalar) if scalar.name=="bool"=>{
                        let value=node.get("value").and_then(Node::as_bool).ok_or_else(||fail("ReaderInvariant",path,"Checked Bool literal lacks its value"))?;
                        Ok(PatternShape::Case(value.to_string(),vec![]))
                    },
                    SemanticType::Scalar(scalar) if matches!(scalar.name.as_str(),"int"|"text")=>{
                        let value=node.get("value").and_then(Node::as_str).ok_or_else(||fail("ReaderInvariant",path,"Checked literal lacks its value"))?;
                        self.solver.charge(value.len()*6+96)?;Ok(PatternShape::Atom(value.into()))
                    },_=>{self.solver.need(source,"NeedsLiteralPatternType")?;Ok(PatternShape::Unknown)},
                }
            },
            "unit"=>{
                let unit=self.scalar("unit")?;self.solver.compatible(ty,unit,source)?;Ok(PatternShape::Case("unit".into(),vec![]))
            },
            "empty-list"|"cons"=>{
                let normalized=self.solver.normalize(ty,source)?;
                let item=match self.solver.copy_type(normalized)? {
                    SemanticType::List(item)|SemanticType::Sequence {item,ordered:true}=>item,
                    SemanticType::Declaration {target,..}=>{
                        let nominal=target.declaration.is_some_and(|id|matches!(self.headers[self.slots[&id]].kind,
                            HeaderKind::Type {representation:Representation::NominalRecord|Representation::NominalVariant,..}));
                        if nominal{return Err(fail("InvalidPatternType",path,"List pattern requires the List type constructor"));}
                        self.solver.need(source,"NeedsListPatternType")?;return Ok(PatternShape::Unknown);
                    },
                    SemanticType::Inference(_)|SemanticType::Hole {..}|SemanticType::Needs {..}|SemanticType::Opaque {..}|
                    SemanticType::Apply {..}|SemanticType::Associated {..}|SemanticType::PackElement {..}|SemanticType::Refinement {..}|
                    SemanticType::Exists {..}|SemanticType::SubjectSchema {..}|SemanticType::DefinitionReference {..}=>{
                        self.solver.need(source,"NeedsListPatternType")?;return Ok(PatternShape::Unknown);
                    },_=>return Err(fail("InvalidPatternType",path,"List pattern requires the List type constructor")),
                };
                let cons=node.get("tag").and_then(Node::as_str)==Some("cons");let name=if cons{"Cons"}else{"Nil"};
                if cons {
                    for (field,ty) in [("head",item),("tail",ty)] {
                        let binding_path=self.solver.path(path,field)?;let binding=self.bind_type(module,&binding_path,ty)?;
                        self.solver.charge(96)?;env.insert(binding,ty);
                        self.solver.charge(projection.len()*128+128)?;let mut path=projection.to_vec();path.push(if field=="head"{ValueProjection::Head}else{ValueProjection::Tail});
                        self.pattern_value_binding(arm,binding,&path)?;
                    }
                }
                Ok(PatternShape::Case(name.into(),if cons{vec![PatternShape::Any,PatternShape::Any]}else{vec![]}))
            },
            "constructor"=>{
                let constructor_path=self.solver.path(path,"constructor")?;let type_path=self.solver.path(&constructor_path,"type")?;
                if let Some(declared)=self.type_at(module,&type_path){self.solver.compatible(ty,declared,source)?;}
                let name=node.get("constructor").and_then(|node|node.get("name")).and_then(Node::as_str).unwrap_or("");
                let Domain::Closed(constructors)=self.domain(module,ty,source)? else{self.solver.need(source,"NeedsConstructorPatternSignature")?;return Ok(PatternShape::Unknown);};
                let constructor=constructors.into_iter().find(|constructor|constructor.name==name).ok_or_else(||fail("UnknownConstructor",path,name))?;
                let patterns=node.get("patterns").and_then(Node::as_array).unwrap_or(&[]);
                if patterns.len()!=constructor.fields.len(){return Err(fail("PatternArity",path,"Constructor pattern arity differs"));}
                let parent=self.solver.path(path,"patterns")?;let mut result=Vec::new();
                let normalized=self.solver.normalize(ty,source)?;
                let list=matches!(self.solver.arena.get(normalized),SemanticType::List(_)|SemanticType::Sequence {ordered:true,..});
                for (index,(pattern,ty)) in patterns.iter().zip(constructor.fields).enumerate() {
                    let child=self.solver.path(&parent,&index.to_string())?;
                    self.solver.charge(projection.len()*128+name.len()*6+128)?;let mut path=projection.to_vec();
                    path.push(if list&&index==0{ValueProjection::Head}else if list{ValueProjection::Tail}else{ValueProjection::Variant(name.into())});
                    result.push(self.pattern(module,&child,pattern,ty,env,visible,source,arm,&path,depth+1)?);
                }
                self.solver.charge(name.len()*6+result.len()*128+96)?;Ok(PatternShape::Case(name.into(),result))
            },
            "hole"=>{self.solver.need(source,"NeedsPatternHole")?;Ok(PatternShape::Unknown)},
            _=>Err(fail("GrammarDrift",path,"Unknown selected Pattern")),
        }
    }
    fn match_value(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,source:SourceId,shared:bool,depth:usize)->Result<Option<TypeId>> {
        let subject=self.child(module,path,if shared{"subject"}else{"value"},env,visible,None,depth)?;
        let expected=self.continuation_expected(expected);
        let ty=match subject{Some(ty)=>ty,None=>self.solver.fresh(SemanticKind::Type,visible.clone())?};
        let field=if shared{"arms"}else{"cases"};let parent=self.solver.path(path,field)?;
        let mut matrix=Vec::new();let mut redundant=Vec::new();let mut cache=BTreeMap::new();let mut active=BTreeSet::new();
        for (index,arm) in node.get(field).and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let entry=self.solver.path(&parent,&index.to_string())?;
            let arm_source=self.source(module,&entry)?;
            self.solver.charge(env.len()*96+128)?;let mut inner=env.clone();
            let pattern=if shared {
                let pattern_path=self.solver.path(&entry,"pattern")?;
                self.pattern(module,&pattern_path,arm.get("pattern").unwrap(),ty,&mut inner,visible,source,arm_source,&[],depth+1)?
            }else {
                let name=arm.get("constructor").and_then(Node::as_str).unwrap_or("");
                match self.domain(module,ty,source)? {
                    Domain::Closed(constructors)=>{
                        let constructor=constructors.into_iter().find(|constructor|constructor.name==name).ok_or_else(||fail("UnknownConstructor",&entry,name))?;
                        let payload=if let Some(payload)=constructor.fields.first(){*payload}else{self.scalar("unit")?};
                        let binding=self.bind_type(module,&entry,payload)?;inner.insert(binding,payload);
                        self.pattern_value_binding(arm_source,binding,&[ValueProjection::Variant(name.into())])?;
                        self.solver.charge(name.len()*6+128)?;PatternShape::Case(name.into(),constructor.fields.iter().map(|_|PatternShape::Any).collect())
                    },_=>{self.solver.need(source,"NeedsMatchSubjectType")?;PatternShape::Unknown},
                }
            };
            self.solver.charge(pattern_size(&pattern)*2)?;
            if matches!(self.useful(module,&matrix,&[pattern.clone()],&[ty],source,&mut active,&mut cache,0)?,Search::Covered){redundant.push(index);}
            self.solver.charge(128)?;matrix.push(vec![pattern]);
            self.child(module,&entry,if shared{"expression"}else{"body"},&inner,visible,expected,depth)?;
        }
        let coverage=match self.useful(module,&matrix,&[PatternShape::Any],&[ty],source,&mut active,&mut cache,0)? {
            Search::Covered=>Coverage::Exhaustive,
            Search::Witness(pattern)=>{self.solver.charge(pattern.iter().map(pattern_size).sum::<usize>()*2)?;Coverage::Missing(pattern.iter().map(pattern_text).collect())},
            Search::Unknown=>Coverage::Unknown,
        };
        match &coverage {
            Coverage::Missing(_)=>{self.solver.need(source,"NonExhaustiveMatch")?;},
            Coverage::Unknown=>{self.solver.need(source,"NeedsPatternCoverage")?;},Coverage::Exhaustive=>{},
        }
        let exhaustive=coverage==Coverage::Exhaustive;self.solver.charge(192+redundant.len()*32)?;
        self.analysis.coverage.push(MatchCoverage {source,result:coverage,redundant_arms:redundant});
        let result=self.branch_normal(false,expected)?;
        if !exhaustive {self.frames.last_mut().unwrap().normal=Some(NormalResult::Pending);return Ok(None);}
        Ok(result)
    }
    fn useful(&mut self,module:ModuleId,matrix:&[Vec<PatternShape>],query:&[PatternShape],types:&[TypeId],source:SourceId,active:&mut BTreeSet<PatternState>,cache:&mut BTreeMap<PatternState,Search>,depth:usize)->Result<Search> {
        self.solver.work(1)?;
        if depth>128 {return Ok(Search::Unknown);}
        let size=matrix.iter().flatten().map(pattern_size).sum::<usize>()+query.iter().map(pattern_size).sum::<usize>();
        self.solver.charge(size*8+types.len()*64+192)?;
        let state=(matrix.to_vec(),query.to_vec(),types.to_vec());
        if let Some(result)=cache.get(&state){self.solver.charge(search_size(result)*2)?;return Ok(result.clone());}
        if !active.insert(state.clone()){return Ok(Search::Unknown);}
        let result=self.useful_inner(module,matrix,query,types,source,active,cache,depth);
        active.remove(&state);
        if let Ok(result)=&result {self.solver.charge(size*8+search_size(result)*2+192)?;cache.insert(state,result.clone());}
        result
    }
    fn useful_inner(&mut self,module:ModuleId,matrix:&[Vec<PatternShape>],query:&[PatternShape],types:&[TypeId],source:SourceId,active:&mut BTreeSet<PatternState>,cache:&mut BTreeMap<PatternState,Search>,depth:usize)->Result<Search> {
        if query.is_empty(){return Ok(if matrix.is_empty(){Search::Witness(vec![])}else{Search::Covered});}
        if matrix.iter().any(|row|row.len()==query.len()&&row.iter().all(|pattern|*pattern==PatternShape::Any)){return Ok(Search::Covered);}
        if query.iter().any(|pattern|*pattern==PatternShape::Unknown)||matrix.iter().flatten().any(|pattern|*pattern==PatternShape::Unknown){return Ok(Search::Unknown);}
        let domain=self.domain(module,types[0],source)?;
        let constructors=match &query[0] {
            PatternShape::Case(name,_)=>match domain {
                Domain::Closed(constructors)=>constructors.into_iter().filter(|constructor|constructor.name==*name).collect(),
                _=>return Ok(Search::Unknown),
            },
            PatternShape::Any=>match domain {
                Domain::Closed(constructors)=>constructors,
                Domain::Open=>{
                    let defaults=matrix.iter().filter(|row|row[0]==PatternShape::Any).map(|row|row[1..].to_vec()).collect::<Vec<_>>();
                    return Ok(match self.useful(module,&defaults,&query[1..],&types[1..],source,active,cache,depth+1)? {
                        Search::Witness(mut rest)=>{rest.insert(0,PatternShape::Any);Search::Witness(rest)},other=>other,
                    });
                },Domain::Unknown=>return Ok(Search::Unknown),
            },
            PatternShape::Atom(value)=>{
                let rows=matrix.iter().filter(|row|row[0]==PatternShape::Any||row[0]==query[0]).map(|row|row[1..].to_vec()).collect::<Vec<_>>();
                return Ok(match self.useful(module,&rows,&query[1..],&types[1..],source,active,cache,depth+1)? {
                    Search::Witness(mut rest)=>{rest.insert(0,PatternShape::Atom(value.clone()));Search::Witness(rest)},other=>other,
                });
            },PatternShape::Unknown=>return Ok(Search::Unknown),
        };
        let mut unknown=false;
        for constructor in constructors {
            let arity=constructor.fields.len();let mut rows=Vec::new();
            for row in matrix {
                let fields=match &row[0] {
                    PatternShape::Any=>Some(vec![PatternShape::Any;arity]),
                    PatternShape::Case(name,fields) if *name==constructor.name=>Some(fields.clone()),_=>None,
                };
                if let Some(mut fields)=fields{fields.extend_from_slice(&row[1..]);rows.push(fields);}
            }
            let mut next=match &query[0]{PatternShape::Case(_,fields)=>fields.clone(),_=>vec![PatternShape::Any;arity]};
            next.extend_from_slice(&query[1..]);let mut next_types=constructor.fields;next_types.extend_from_slice(&types[1..]);
            match self.useful(module,&rows,&next,&next_types,source,active,cache,depth+1)? {
                Search::Witness(mut witness)=>{
                    let rest=witness.split_off(arity);let mut result=vec![PatternShape::Case(constructor.name,witness)];result.extend(rest);return Ok(Search::Witness(result));
                },Search::Unknown=>unknown=true,Search::Covered=>{},
            }
        }
        Ok(if unknown{Search::Unknown}else{Search::Covered})
    }
    fn symbol(&mut self,module:ModuleId,path:&str,visible:&BTreeSet<SemanticBinderId>,source:SourceId)->Result<Option<TypeId>> {
        let reference_path=self.solver.path(path,"ref")?;
        let Some(index)=self.references.get(&(module,reference_path)) else {self.solver.need(source,"NeedsSymbolTypeQualification")?;return Ok(None);};
        let declaration=match self.names.references[*index].resolution {
            Resolution::Resolved {declaration,..}=>declaration,
            Resolution::Needs {code,..}=>{self.solver.need(source,code)?;return Ok(None);},
            Resolution::Rejected {code,..}=>return Err(fail(code,path,"Rejected declaration reference")),
        };
        self.solver.charge(64)?;
        if let Some(owner)=self.solver.arena.source(source).owner {
            self.dependencies.entry(owner).or_default().insert(declaration);
        }
        let slot=self.slots[&declaration];
        let signature=&self.signatures[slot];
        if signature.state==SignatureState::TypeReady {
            if let Some(ty)=signature.ty {
                let normalized=self.solver.normalize(ty,source)?;
                if matches!(self.headers[slot].kind,HeaderKind::Function {..}) {
                    if let SemanticType::Function(function)=self.solver.copy_type(normalized)? {
                        if !function.binders.is_empty() {
                            let Some(function)=self.solver.instantiate(function,visible.clone(),source)? else{return Ok(None);};
                            return Ok(Some(self.solver.insert(SemanticType::Function(function))?));
                        }
                    }
                }
            }
            return Ok(signature.ty);
        }
        if self.blocked_headers.contains(&declaration) {
            self.solver.need(source,"NeedsHeaderTypeQualification")?;return Ok(None);
        }
        if signature.ty.is_some() {
            self.current_waiting.insert(declaration);return Ok(None);
        }
        self.solver.need(source,"NeedsProfessionalValueSignature")?;Ok(None)
    }
    fn call(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,source:SourceId,depth:usize)->Result<Option<TypeId>> {
        let callee_path=self.solver.path(path,"callee")?;
        let reference_path=self.solver.path(&callee_path,"ref")?;
        let declaration=self.references.get(&(module,reference_path)).and_then(|index|match self.names.references[*index].resolution {
            Resolution::Resolved {declaration,..}=>Some(declaration),_=>None,
        });
        let callee=self.child(module,path,"callee",env,visible,None,depth)?;
        let mut error=None;
        let mut function=if let Some(callee)=callee {
            let callee=self.solver.normalize(callee,source)?;
            match self.solver.copy_type(callee)? {
                SemanticType::Function(function)=>self.solver.instantiate(function,visible.clone(),source)?,
                SemanticType::Inference(_)|SemanticType::Needs {..}|SemanticType::Hole {..}=>{self.solver.need(source,"AnnotationRequiredCallable")?;None},
                _=>{error=Some(fail("NotCallableType",path,"Callee has no function type"));None},
            }
        }else{None};
        if node.get("semanticArguments").is_some(){self.solver.need(source,"NeedsExplicitSemanticArguments")?;function=None;}
        if let Some(signature)=&function {
            if self.solver.has_expansion(&signature.parameters)? {self.solver.need(source,"NeedsPackExpansion")?;function=None;}
        }
        let names=if let Some(declaration)=declaration {
            match &self.headers[self.slots[&declaration]].kind {
                HeaderKind::Function {parameters,..}=>{
                    self.solver.charge(parameters.len()*16+64)?;
                    Some(parameters.iter().map(|parameter|self.names.lexical.bindings[parameter.binding.index()].name.as_str()).collect::<Vec<_>>())
                },_=>None,
            }
        }else{None};
        let arguments=node.get("arguments").and_then(Node::as_array).unwrap_or(&[]);
        let count=function.as_ref().map(|function|function.parameters.len()).unwrap_or(arguments.len());
        self.solver.charge(arguments.len()*128+count*32)?;
        let mut occupied=vec![false;count];let mut mapping=Vec::new();let mut named=false;let mut complete=function.is_some();
        let parent=self.solver.path(path,"arguments")?;
        for (index,argument) in arguments.iter().enumerate() {
            let label=if node.get("op").is_none(){argument.get("label").and_then(Node::as_str)}else{None};
            let slot=if let Some(label)=label {
                named=true;
                match &names {
                    Some(names)=>names.iter().position(|name|*name==label),
                    None=>{error.get_or_insert_with(||fail("NamedArgumentsRequireDeclaration",path,"Function values have no named argument contract"));None},
                }
            }else{
                if named {error.get_or_insert_with(||fail("PositionalAfterNamedArgument",path,"Positional argument follows a named argument"));}
                Some(index)
            };
            if label.is_some()&&slot.is_none(){error.get_or_insert_with(||fail("UnknownNamedArgument",path,label.unwrap()));}
            if let Some(slot)=slot {
                if slot>=count {error.get_or_insert_with(||fail("CallArity",path,"Too many arguments"));}
                else if occupied[slot] {error.get_or_insert_with(||fail("DuplicateNamedArgument",path,"A formal slot is supplied more than once"));}
                else {occupied[slot]=true;}
            }
            mapping.push(slot.unwrap_or(count));
            let expected=slot.and_then(|slot|function.as_ref().and_then(|function|function.parameters.get(slot))).and_then(|argument|
                match argument {SemanticArgument::Type(ty)=>Some(*ty),_=>None});
            let mut child=self.solver.path(&parent,&index.to_string())?;
            if node.get("op").is_none(){child=self.solver.path(&child,"value")?;}
            complete&=self.infer(module,&child,env,visible,expected,depth+1)?.is_some();
        }
        if function.is_some()&&(arguments.len()!=count||occupied.iter().any(|supplied|!*supplied)) {
            error.get_or_insert_with(||fail("CallArity",path,"Missing or extra call arguments"));
        }
        if let Some(error)=error{return Err(error);}
        if let Some(function)=function {
            let returns=function.returns;let function_type=self.solver.insert(SemanticType::Function(function))?;
            self.solver.charge(192+mapping.len()*32)?;
            let children=&self.frames.last().unwrap().children;
            self.solver.charge(children.len()*32)?;
            let callee_value=children[0];let arguments=children[1..].to_vec();
            let index=self.analysis.calls.len();self.analysis.calls.push(CallFact {source,callee:declaration,function_type,source_to_formal:mapping,callee_value,arguments});
            self.extra_effect(source,EffectTerm::Call(index))?;
            Ok(if complete{Some(returns)}else{None})
        }else{
            self.extra_effect(source,EffectTerm::Unqualified {code:"NeedsCallableEffectContract",children:Vec::new()})?;Ok(None)
        }
    }
    fn record(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,source:SourceId,depth:usize)->Result<Option<TypeId>> {
        let mut target=None;let mut fields_expected=BTreeMap::new();
        if let Some(expected)=expected {
            let normalized=self.solver.normalize(expected,source)?;
            match self.solver.copy_type(normalized)? {
                SemanticType::Record {fields,..}=>fields_expected=fields,
                SemanticType::Declaration {target:reference,arguments}=>{
                    if let Some(declaration)=reference.declaration {
                        let header=&self.headers[self.slots[&declaration]];
                        if let HeaderKind::Type {representation:Representation::NominalRecord,ty,opaque,..}=&header.kind {
                            if *opaque==Some(true)&&header.module!=module {self.solver.need(source,"NeedsOpaqueConstructionRights")?;return Ok(None);}
                            if !arguments.is_empty(){self.solver.need(source,"NeedsNominalInstantiation")?;return Ok(None);}
                            if let SemanticType::Record {fields,..}=self.solver.copy_type(*ty)?{fields_expected=fields;target=Some(normalized);}
                        }
                    }
                },_=>{},
            }
        }
        let mut fields=BTreeMap::new();let mut seen=BTreeSet::new();let parent=self.solver.path(path,"fields")?;let mut complete=true;
        for (index,item) in node.get("fields").and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let name=item.get("name").and_then(Node::as_str).unwrap_or("");
            self.solver.charge(48)?;
            if !seen.insert(name){return Err(fail("DuplicateRecordField",path,name));}
            let child=self.solver.path(&parent,&index.to_string())?;let value=self.solver.path(&child,"value")?;
            if let Some(ty)=self.infer(module,&value,env,visible,fields_expected.get(name).map(|f|f.ty),depth+1)? {
                self.solver.charge(name.len()*6+128)?;
                fields.insert(name.into(),Field {ty,optional:Some(false),mutable:Some(false)});
            }else{complete=false;}
        }
        if !complete{return Ok(None);}
        if let Some(target)=target {
            if fields.keys().any(|name|!fields_expected.contains_key(name))||fields_expected.iter().any(|(name,field)|!field.optional.unwrap_or(false)&&!fields.contains_key(name)) {
                return Err(fail("TypeMismatch",path,"Nominal record required fields differ"));
            }
            return Ok(Some(target));
        }
        Ok(Some(self.solver.insert(SemanticType::Record {fields,open:Some(false),row:None})?))
    }
    fn lambda(&mut self,module:ModuleId,path:&str,node:&Node,env:&BTreeMap<LocalBindingId,TypeId>,visible:&BTreeSet<SemanticBinderId>,expected:Option<TypeId>,source:SourceId,shared:bool,depth:usize)->Result<Option<TypeId>> {
        let expected=if let Some(t)=expected {let t=self.solver.normalize(t,source)?;match self.solver.copy_type(t)?{SemanticType::Function(f)=>Some(f),_=>None}}else{None};
        if let Some(function)=&expected {
            if self.solver.has_expansion(&function.parameters)? {self.solver.need(source,"NeedsPackExpansion")?;return Ok(None);}
        }
        let authored:Vec<_>=self.solver.arena.binders.iter().filter(|b|b.binding.is_some_and(|local|{
            let occurrence=&self.names.lexical.occurrences[self.names.lexical.bindings[local.index()].occurrence.index()];
            occurrence.module==module&&occurrence.expanded_path.strip_prefix(path).is_some_and(|tail|tail.starts_with("/typeParams/")&&!tail[12..].contains('/'))
        })).map(|b|b.id).collect();
        let expected=if node.get("typeParams").is_none(){
            if let Some(function)=expected {
                let Some(function)=self.solver.freshen_function(function,source)? else{return Ok(None);};
                Some(function)
            }else{None}
        }else{expected};
        let binders=if node.get("typeParams").is_none(){expected.as_ref().map(|f|f.binders.clone()).unwrap_or_default()}else{authored};
        let mut inner_visible=visible.clone();inner_visible.extend(&binders);
        let params=node.get("params").and_then(Node::as_array).unwrap_or(&[]);
        if let Some(expected)=&expected {if expected.parameters.len()!=params.len(){return Err(fail("CallArity",path,"Lambda parameter count differs"));}}
        let parent=self.solver.path(path,"params")?;let mut inner=env.clone();let mut parameters=Vec::new();
        self.solver.charge(env.len()*96+params.len()*192)?;
        for (index,param) in params.iter().enumerate() {
            let child=self.solver.path(&parent,&index.to_string())?;let type_path=self.solver.path(&child,"type")?;
            let ty=if param.get("type").is_some() {self.type_at(module,&type_path).ok_or_else(||fail("ReaderInvariant",&type_path,"Missing lambda type"))?}
                else if let Some(SemanticArgument::Type(t))=expected.as_ref().and_then(|f|f.parameters.get(index)){*t}
                else{self.solver.fresh(SemanticKind::Type,inner_visible.clone())?};
            let binding=self.local_binders.get(&(module,child.clone())).copied().ok_or_else(||fail("ReaderInvariant",&child,"Missing lambda binder"))?;
            inner.insert(binding,ty);parameters.push(SemanticArgument::Type(ty));
        }
        if expected.is_none()&&params.len()>1&&params.iter().any(|p|p.get("type").is_none()) {
            self.solver.need(source,"AnnotationRequiredLambdaParameters")?;return Ok(None);
        }
        let returns=match expected.as_ref(){Some(function)=>function.returns,None=>self.solver.fresh(SemanticKind::Type,inner_visible.clone())?};
        let scope=self.scope_at(module,path,"lambda");
        if let Some(scope)=scope {self.solver.charge(96)?;self.function_returns.insert(scope,returns);}
        let body_path=self.solver.path(path,if shared{"expression"}else{"body"})?;
        let body=self.judge(module,&body_path,&inner,&inner_visible,Some(returns),depth+1)?;
        if let Some(scope)=scope {self.function_returns.remove(&scope);}
        let result=match self.analysis.expressions[body].normal {
            NormalResult::Value(result)=>result,NormalResult::NoNormal=>returns,NormalResult::Pending=>return Ok(None),
        };
        let annotations=self.solver.copy_annotations(source)?
            .ok_or_else(||fail("ReaderInvariant",path,"Lambda annotations were not retained by formation"))?;
        let function=FunctionType {binders,parameters,returns:result,pending_effects:annotations.effects.is_none(),pending_captures:annotations.captures.is_none(),
            effects:annotations.effects,call_mode:annotations.call_mode,parameter_contracts:annotations.parameter_contracts,captures:annotations.captures};
        self.add_need(source,"NeedsLambdaCaptureAndEffectAnalysis")?;
        Ok(Some(self.solver.insert(SemanticType::Function(function))?))
    }
    fn cycles(&mut self)->Result<()> {
        let pending:BTreeSet<_>=self.signatures.iter().filter(|s|s.ty.is_some()&&!s.body_type_checked&&s.state!=SignatureState::Rejected).map(|s|s.declaration).collect();
        let edges:BTreeMap<_,BTreeSet<_>>=pending.iter().map(|id|(*id,self.dependencies[id].intersection(&pending).copied().collect())).collect();
        let mut visited=BTreeSet::new();let mut order=Vec::new();
        for root in &pending {
            let mut stack=vec![(*root,false)];
            while let Some((node,exit))=stack.pop(){
                self.solver.work(1)?;
                if exit{order.push(node);continue;}
                if !visited.insert(node){continue;}
                self.solver.charge(64)?;stack.push((node,true));
                for child in &edges[&node]{stack.push((*child,false));}
            }
        }
        let mut reverse:BTreeMap<_,BTreeSet<_>>=pending.iter().map(|id|(*id,BTreeSet::new())).collect();
        for (node,children) in &edges{for child in children{self.solver.work(1)?;reverse.get_mut(child).unwrap().insert(*node);}}
        visited.clear();
        for root in order.into_iter().rev(){
            if visited.contains(&root){continue;}
            let mut component=Vec::new();let mut stack=vec![root];
            while let Some(node)=stack.pop(){self.solver.work(1)?;if !visited.insert(node){continue;}component.push(node);stack.extend(&reverse[&node]);}
            if component.len()>1||edges[&root].contains(&root){
                for declaration in &component {let header=&self.headers[self.slots[declaration]];self.add_need(header.source,"AnnotationRequiredSignatureCycle")?;}
                self.annotation_cycles.push(component);
            }
        }
        Ok(())
    }
}
