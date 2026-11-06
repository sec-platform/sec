//! Common signature constraints consuming the existing Reader, names, lexical
//! identities, type arena and HeaderSeeds. Type readiness is not callability.
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use crate::{binding::{DeclarationId, ImportBinding, ModuleId, NameAnalysis, Resolution},
    header_seeds::{self, HeaderCollection, HeaderKind, HeaderSeed, TypeRequest, EffectRequest, Representation},
    lexical::{LocalBindingId, LocalResolution}, model::{Diagnostic,fail}, reader::{self,DecodedSource},
    reference_slots::Navigation, semantic_types::*, source::{Node,Kind as JsonKind},
    type_constraints::{ConstraintMachine,ConstraintNeed,Relation}};

type Result<T> = std::result::Result<T,Diagnostic>;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum SignatureState { TypeReady, NeedsAnnotation, NeedsInput, Rejected }
#[derive(Debug)]
pub struct Signature {
    pub declaration: DeclarationId,
    pub ty: Option<TypeId>,
    pub state: SignatureState,
    /// Only the implemented common body type constraints. Effects, contracts,
    /// source-value profiles, captures and callable freezing remain explicit.
    pub body_type_checked: bool,
}
#[derive(Debug)]
pub struct SignatureProblem { pub declaration: DeclarationId, pub diagnostic: Diagnostic }
#[derive(Debug)]
pub struct SignatureResolution {
    pub names: NameAnalysis,
    pub types: TypeArena,
    pub headers: Vec<HeaderSeed>,
    pub signatures: Vec<Signature>,
    pub needs: Vec<ConstraintNeed>,
    pub problems: Vec<SignatureProblem>,
    pub dependencies: BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    pub annotation_cycles: Vec<Vec<DeclarationId>>,
}
pub fn resolve(bytes:&[u8])->Result<SignatureResolution> {
    resolve_sources(&[reader::read(bytes)?],&[],0)
}
pub fn resolve_sources(sources:&[DecodedSource],imports:&[ImportBinding],root:usize)->Result<SignatureResolution> {
    let header_seeds::PreparedHeaders {collection,navigation,mut budget}=header_seeds::prepare_sources(sources,imports,root)?;
    let HeaderCollection {names,mut types,headers}=collection;
    let mut solver=ConstraintMachine::shared(&mut types,&mut budget);
    solver.register_headers(&headers)?;
    let mut engine=Engine::new(&names,&headers,&navigation,solver)?;
    engine.run()?;
    let Engine {solver,signatures,needs,problems,dependencies,annotation_cycles,..}=engine;
    let mut all_needs=needs;
    for need in solver.needs {
        if !all_needs.contains(&need){all_needs.push(need);}
    }
    Ok(SignatureResolution {names,types,headers,signatures,needs:all_needs,problems,dependencies,annotation_cycles})
}

struct Engine<'a> {
    names:&'a NameAnalysis,
    headers:&'a [HeaderSeed],
    navigation:&'a [Navigation],
    solver:ConstraintMachine<'a>,
    signatures:Vec<Signature>,
    needs:Vec<ConstraintNeed>,
    problems:Vec<SignatureProblem>,
    dependencies:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    annotation_cycles:Vec<Vec<DeclarationId>>,
    slots:BTreeMap<DeclarationId,usize>,
    sources:BTreeMap<(ModuleId,String),SourceId>,
    local_uses:BTreeMap<(ModuleId,String),usize>,
    local_binders:BTreeMap<(ModuleId,String),LocalBindingId>,
    lexical_occurrences:BTreeMap<(ModuleId,String),crate::lexical::OccurrenceId>,
    type_ids:BTreeMap<(ModuleId,String),TypeId>,
    references:BTreeMap<(ModuleId,String),usize>,
    waiting:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    current:Option<DeclarationId>,
    current_waiting:BTreeSet<DeclarationId>,
    blocked_headers:BTreeSet<DeclarationId>,
}
impl<'a> Engine<'a> {
    fn new(names:&'a NameAnalysis,headers:&'a [HeaderSeed],navigation:&'a [Navigation],solver:ConstraintMachine<'a>)->Result<Self> {
        let current=None;
        let mut engine=Self {names,headers,navigation,solver,signatures:Vec::new(),needs:Vec::new(),problems:Vec::new(),
            dependencies:BTreeMap::new(),annotation_cycles:Vec::new(),slots:BTreeMap::new(),sources:BTreeMap::new(),
            local_uses:BTreeMap::new(),local_binders:BTreeMap::new(),lexical_occurrences:BTreeMap::new(),type_ids:BTreeMap::new(),
            references:BTreeMap::new(),waiting:BTreeMap::new(),current,current_waiting:BTreeSet::new(),blocked_headers:BTreeSet::new()};
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
    fn run(&mut self)->Result<()> {
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
            self.current=Some(declaration);self.current_waiting.clear();
            let point=self.solver.checkpoint()?;
            let needs_start=self.solver.needs.len();
            let result=self.check_body(slot);
            let attempt_needs=self.solver.needs[needs_start..].to_vec();
            let successful=matches!(result,Ok(Some(_)));
            if !successful {self.solver.rollback(point);}
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
                        Err(diagnostic) if diagnostic.code=="ResourceLimit"=>return Err(diagnostic),
                        Err(diagnostic)=>{
                            self.problems.push(SignatureProblem {declaration,diagnostic});
                            self.signatures[slot].state=SignatureState::Rejected;
                            continue;
                        },
                        Ok(relation)=>relation==Relation::Equal,
                    };
                    let ready=qualified&&!self.solver.unresolved(ty)?;
                    self.signatures[slot].body_type_checked=true;
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
        }
        Ok(())
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
        self.infer(module,&path,&env,&visible,Some(expected),0)
    }
    fn source(&mut self,module:ModuleId,path:&str)->Result<SourceId> {
        self.solver.work(1)?;
        if let Some(id)=self.sources.get(&(module,path.to_owned())) {return Ok(*id);}
        let node=self.node(module,path)?;
        self.solver.charge(320+path.len()*6)?;
        let lexical=self.lexical_occurrences.get(&(module,path.into())).copied();
        let origin=node.origin().cloned();
        if let Some(origin)=&origin {self.solver.charge(origin.pointer.len()*6+128)?;}
        let id=SourceId(self.solver.arena.sources.len());
        self.solver.arena.sources.push(SourceOccurrence {id,module,owner:self.current,expanded_path:path.into(),origin,lexical,syntax:node});
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
        self.solver.work(1)?;
        if depth>128 {return Err(fail("ResourceLimit",path,"Signature expression depth exceeded"));}
        let source=self.source(module,path)?;let node=self.node(module,path)?;
        let shared=node.get("op").is_none();
        let operation=node.get(if shared {"tag"}else{"op"}).and_then(Node::as_str).unwrap_or("");
        let ty=match operation {
            "literal"=>self.literal(module,path,&node,source)?,
            "var"=>self.variable(module,path,env,source)?,
            "reference" if shared&&node.get("ref").is_some_and(|r|r.get("binding").is_some())=>self.variable(module,path,env,source)?,
            "symbol"|"reference"=>self.symbol(module,path,visible,source)?,
            "let"=>{
                let value=self.child(module,path,if shared {"initializer"}else{"value"},env,visible,None,depth)?;
                let binding_path=if shared {self.solver.path(path,"binding")?}else{path.into()};
                let Some(binding)=self.local_binders.get(&(module,binding_path)).copied() else {return Err(fail("ReaderInvariant",path,"Missing lexical let binder"));};
                let Some(value)=value else {return Ok(None);};
                self.solver.charge(env.len()*96+96)?;
                let mut inner=env.clone();inner.insert(binding,value);
                self.child(module,path,if shared {"continuation"}else{"body"},&inner,visible,expected,depth)?
            },
            "if"=>{
                let boolean=self.scalar("bool")?;
                let condition=self.child(module,path,"condition",env,visible,Some(boolean),depth)?;
                let a=self.child(module,path,"then",env,visible,expected,depth)?;
                let b=self.child(module,path,"otherwise",env,visible,expected.or(a),depth)?;
                if condition.is_some()&&a.is_some()&&b.is_some(){a}else{None}
            },
            "call"=>self.call(module,path,&node,env,visible,source,depth)?,
            "lambda"=>self.lambda(module,path,&node,env,visible,expected,source,shared,depth)?,
            "record"=>self.record(module,path,&node,env,visible,expected,source,depth)?,
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
                    match self.solver.copy_type(receiver)? {
                        SemanticType::Record {fields,..}=>{
                            let name=node.get("name").and_then(Node::as_str).unwrap_or("");
                            let field=fields.get(name).ok_or_else(||fail("UnknownField",path,name))?;
                            if field.optional.unwrap_or(false)||field.mutable.unwrap_or(false) {self.solver.need(source,"NeedsFieldAccessQualification")?;None}else{Some(field.ty)}
                        },
                        SemanticType::Inference(_)|SemanticType::Hole {..}|SemanticType::Needs {..}=>{self.solver.need(source,"AnnotationRequiredField")?;None},
                        SemanticType::Declaration {target,..} if target.declaration.is_some_and(|id|matches!(self.headers[self.slots[&id]].kind,HeaderKind::Type {representation:Representation::NominalRecord,..}))=>{
                            self.solver.need(source,"NeedsNominalFieldProjection")?;None
                        },
                        SemanticType::Scalar(_)|SemanticType::Variant(_)|SemanticType::Tuple(_)|SemanticType::Option(_)|SemanticType::Result {..}|
                        SemanticType::List(_)|SemanticType::Sequence {..}|SemanticType::Set {..}|SemanticType::Bag {..}|SemanticType::Map {..}|SemanticType::Function(_)|SemanticType::Rational=>{
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
                let value=self.child(module,path,"result",env,visible,expected,depth)?;if complete {value}else{None}
            },
            "binary" if shared=>{
                let op=node.get("operator").and_then(Node::as_str).unwrap_or("");
                let (operand,result)=match op {"+"|"-"|"*"|"/"|"%"=>("int","int"),"<"|"<="|">"|">="=>("int","bool"),"&&"|"||"=>("bool","bool"),_=>{self.solver.need(source,"NeedsOperatorQualification")?;return Ok(None);}};
                let operand=self.scalar(operand)?;
                let a=self.child(module,path,"left",env,visible,Some(operand),depth)?;
                let b=self.child(module,path,"right",env,visible,Some(operand),depth)?;
                if a.is_some()&&b.is_some(){Some(self.scalar(result)?)}else{None}
            },
            _=>{self.solver.need(source,if node.get("statements").is_some(){"NeedsExecBodyAnalysis"}else{"NeedsExpressionTypeRule"})?;None},
        };
        if let (Some(actual),Some(expected))=(ty,expected) {
            let before=self.solver.needs.len();
            let relation=self.solver.compatible(actual,expected,source)?;
            if relation==Relation::Needs&&self.solver.needs[before..].iter().any(|n|!matches!(n.code,"NeedsEffectClosure"|"NeedsCaptureRelation")) {return Ok(None);}
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
        let value=node.get("value").ok_or_else(||fail("ReaderInvariant",path,"Missing literal value"))?;
        let valid=match self.solver.arena.get(normalized) {
            SemanticType::Scalar(s) if s.bits.is_none()&&s.scale.is_none()&&s.overflow.is_none()&&s.text_index.is_none()&&s.encoding.is_none()&&s.rounding.is_none()&&s.nan_policy.is_none()&&s.clock_ref.is_none()=>{
                match s.name.as_str() {
                    "int"=>value.as_str().is_some_and(|v|v=="0"||{
                        let digits=v.strip_prefix('-').unwrap_or(v);
                        !digits.is_empty()&&!digits.starts_with('0')&&digits.bytes().all(|c|c.is_ascii_digit())
                    }),
                    "bool"=>value.as_bool().is_some(),"text"=>value.as_str().is_some(),"unit"=>matches!(value.kind(),JsonKind::Null),
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
                    if let Some(ty)=env.get(&binding){return Ok(Some(*ty));}
                    self.solver.need(source,"NeedsProfessionalValueEnvironment")?;
                },
                LocalResolution::Needs {code}=>{self.solver.need(source,code)?;},
                LocalResolution::Rejected {code}=>return Err(fail(code,path,"Rejected lexical reference")),
            }
        }else{self.solver.need(source,"NeedsLexicalValueBinding")?;}
        Ok(None)
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
        self.dependencies.entry(self.current.expect("body analysis owns a declaration")).or_default().insert(declaration);
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
        let callee=self.child(module,path,"callee",env,visible,None,depth)?;
        let Some(callee)=callee else{
            let parent=self.solver.path(path,"arguments")?;
            for index in 0..node.get("arguments").and_then(Node::as_array).map_or(0,|a|a.len()) {
                let mut child=self.solver.path(&parent,&index.to_string())?;
                if node.get("op").is_none(){child=self.solver.path(&child,"value")?;}
                self.infer(module,&child,env,visible,None,depth+1)?;
            }
            return Ok(None);
        };
        let callee=self.solver.normalize(callee,source)?;
        let SemanticType::Function(function)=self.solver.copy_type(callee)? else {
            if self.solver.unresolved(callee)? {self.solver.need(source,"AnnotationRequiredCallable")?;return Ok(None);}
            return Err(fail("NotCallableType",path,"Callee has no function type"));
        };
        if node.get("semanticArguments").is_some() {self.solver.need(source,"NeedsExplicitSemanticArguments")?;return Ok(None);}
        let Some(function)=self.solver.instantiate(function,visible.clone(),source)? else{return Ok(None);};
        if self.solver.has_expansion(&function.parameters)? {self.solver.need(source,"NeedsPackExpansion")?;return Ok(None);}
        let arguments=node.get("arguments").and_then(Node::as_array).unwrap_or(&[]);
        if arguments.len()!=function.parameters.len(){return Err(fail("CallArity",path,"Argument count differs from signature"));}
        let parent=self.solver.path(path,"arguments")?;let mut complete=true;
        for (index,parameter) in function.parameters.iter().enumerate() {
            let SemanticArgument::Type(parameter)=parameter else{self.solver.need(source,"NeedsRuntimeParameterQualification")?;return Ok(None);};
            let mut child=self.solver.path(&parent,&index.to_string())?;
            if node.get("op").is_none() {
                if arguments[index].get("value").is_none(){self.solver.need(source,"NeedsNamedArgumentMapping")?;return Ok(None);}
                child=self.solver.path(&child,"value")?;
            }
            complete&=self.infer(module,&child,env,visible,Some(*parameter),depth+1)?.is_some();
        }
        Ok(if complete{Some(function.returns)}else{None})
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
        let mut fields=BTreeMap::new();let parent=self.solver.path(path,"fields")?;let mut complete=true;
        for (index,item) in node.get("fields").and_then(Node::as_array).unwrap_or(&[]).iter().enumerate() {
            let name=item.get("name").and_then(Node::as_str).unwrap_or("");
            if fields.contains_key(name){return Err(fail("DuplicateRecordField",path,name));}
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
        let returns=expected.as_ref().map(|f|f.returns);
        let result=self.child(module,path,if shared{"expression"}else{"body"},&inner,&inner_visible,returns,depth)?;
        let Some(result)=result else{return Ok(None);};
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
