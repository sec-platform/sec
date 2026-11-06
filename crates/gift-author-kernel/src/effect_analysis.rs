//! Finite effects over real BodyAnalysis values and closure environments.
//! Effect sets are may summaries, never execution or callable permissions.
use std::collections::{BTreeMap,BTreeSet,VecDeque};
use std::sync::Arc;
use crate::{binding::{DeclarationId,NameAnalysis},body_analysis::{BodyAnalysis,BodyState,ValueRelation,ValueProjection,NormalResult,EffectTerm,EffectId,ExitKind},
    header_seeds::{HeaderSeed,HeaderKind},lexical::{LocalBindingId,ScopeId,OccurrenceId},model::{Diagnostic,fail},
    semantic_types::*,signature_resolution::Signature,type_constraints::ConstraintMachine};

type Result<T> = std::result::Result<T,Diagnostic>;
#[derive(Clone,Copy,Debug)]
pub struct EffectLimits { pub work:usize,pub bytes:usize }
impl Default for EffectLimits {fn default()->Self {Self {work:usize::MAX,bytes:usize::MAX}}}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct ValueId(pub usize);
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct ClosureId(pub usize);
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
/// A retained static analysis context, never a runtime occurrence identity.
pub struct InstanceId(pub usize);
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub enum CodeIdentity { Declaration(DeclarationId), Lambda(SourceId), Constructor(SourceId) }
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct EffectKey {pub class:String,pub port:Option<DeclarationId>,pub resource:Option<DeclarationId>,pub scope:Option<String>}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
/// The lexical position and its retained allocation-analysis context. This
/// dependency does not establish a physical allocation or an external effect.
pub struct StorageAccess {pub binding:LocalBindingId,pub instance:InstanceId,pub write:bool}
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum EffectState { BodyDerived,ConservativeBound,Unknown,Rejected }
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct EffectNeed {pub source:SourceId,pub code:&'static str}
#[derive(Clone,Debug)]
pub struct EffectSummary {
    pub state:EffectState,pub may:BTreeSet<EffectKey>,pub internal:BTreeSet<StorageAccess>,pub needs:BTreeSet<EffectNeed>,
}
impl EffectSummary {
    fn bottom()->Self {Self {state:EffectState::BodyDerived,may:BTreeSet::new(),internal:BTreeSet::new(),needs:BTreeSet::new()}}
}
#[derive(Debug)]
pub struct EffectProblem {pub source:SourceId,pub diagnostic:Diagnostic}
#[derive(Debug)]
pub struct ClosureSummary {pub code:CodeIdentity,pub environment:Vec<(LocalBindingId,ValueId)>,pub latent:EffectSummary,pub ready:bool}
#[derive(Debug,Default)]
pub struct EffectSummarySet {
    pub declarations:BTreeMap<DeclarationId,EffectSummary>,
    pub expressions:BTreeMap<(InstanceId,SourceId),EffectSummary>,
    pub values:BTreeMap<(InstanceId,SourceId),Vec<ClosureId>>,
    pub closures:Vec<ClosureSummary>,pub needs:Vec<EffectNeed>,pub problems:Vec<EffectProblem>,
    pub(crate) consumed:BTreeSet<(SourceId,&'static str)>,
}

#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
enum InputOrigin { Binding(LocalBindingId),Constructor(SourceId) }
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
enum ValueTerm {
    Data,Closure(ClosureId),Contract {origin:InputOrigin,ty:TypeId,source:SourceId},
    Record(Vec<(String,ValueId)>),List {items:Vec<ValueId>,tail:Option<ValueId>,element:Option<ValueId>},
    Variant {name:String,payload:ValueId},Location {binding:LocalBindingId,instance:InstanceId,contents:ValueId},
    Unknown(EffectNeed),
}
struct ValueSlot {terms:BTreeSet<ValueTerm>,guards:BTreeSet<ValueId>,provided:bool,source:Option<SourceId>}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct Location {owner:InstanceId,binding:LocalBindingId}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct StateId(usize);
enum StateTerm {Root(BTreeMap<Location,ValueId>),Join,Write {location:Location,value:ValueId},Call(usize)}
struct StateNode {source:SourceId,term:StateTerm,inputs:BTreeSet<StateId>,reverse:BTreeSet<StateId>,
    escapes:BTreeSet<Location>,queries:BTreeSet<usize>,calls:BTreeSet<usize>}
struct StateQuery {state:StateId,location:Location,fallback:Option<ValueId>,value:ValueId,inputs:BTreeSet<ValueId>,unknown:bool}
struct FlowEnvironment {bindings:BTreeMap<LocalBindingId,ValueId>,state:StateId}
#[derive(Clone)]
enum ValueOp {Union(Vec<ValueId>),Field(ValueId,String),Update(ValueId,Vec<(String,ValueId)>),Projection(ValueId,ValueProjection),Load(ValueId)}
struct Transfer {output:ValueId,operation:ValueOp}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct ClosureKey {code:usize,environment:Vec<(LocalBindingId,ValueId)>}
struct Closure {key:ClosureKey,value:ValueId,strict:Vec<ValueId>,general:Option<InstanceId>}
struct Template {identity:CodeIdentity,root:Option<usize>,parameters:Vec<(LocalBindingId,TypeId)>,scope:Option<ScopeId>,
    source:SourceId,bound_source:SourceId,ty:TypeId,globals:Vec<DeclarationId>,constructor:Option<String>}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct InstanceKey {closure:ClosureId,arguments:Vec<ValueId>,world:usize,context:Vec<usize>}
#[derive(Default)]
struct Activation {effects:BTreeSet<usize>,calls:BTreeSet<usize>}
struct Instance {
    closure:Option<ClosureId>,root:usize,environment:BTreeMap<LocalBindingId,ValueId>,
    result:ValueId,effect:usize,memo:BTreeMap<usize,ValueId>,built:bool,world:usize,activation:Arc<Activation>,
    input_state:StateId,output_state:StateId,context:Vec<usize>,point_states:BTreeMap<SourceId,StateId>,
}
struct EffectNode {seed:EffectSummary,dependencies:BTreeSet<usize>,result:EffectSummary}
struct CallJob {world:usize,call:usize,callee:ValueId,arguments:Vec<ValueId>,result:ValueId,effect:usize,targets:BTreeSet<InstanceId>,
    input_state:StateId,output_state:StateId,context:Vec<usize>,opaque:bool,exposed:BTreeSet<Location>}
struct BoundObligation {source:SourceId,value:ValueId,expected:TypeId,state:StateId,world:usize,instances:BTreeSet<InstanceId>}
struct CaptureCheck {source:SourceId,value:ValueId,effect:usize}
struct Driver<'a,'b> {
    names:&'a NameAnalysis,headers:&'a [HeaderSeed],signatures:&'a [Signature],bodies:&'a BodyAnalysis,solver:&'b mut ConstraintMachine<'a>,
    values:Vec<ValueSlot>,transfers:Vec<Transfer>,reverse:BTreeMap<ValueId,BTreeSet<usize>>,value_queue:VecDeque<usize>,queued_values:BTreeSet<usize>,
    templates:Vec<Template>,declaration_codes:BTreeMap<DeclarationId,usize>,lambda_codes:BTreeMap<SourceId,usize>,constructor_codes:BTreeMap<SourceId,usize>,
    closures:Vec<Closure>,closure_keys:BTreeMap<ClosureKey,ClosureId>,instances:Vec<Instance>,instance_keys:BTreeMap<InstanceKey,InstanceId>,build_queue:VecDeque<InstanceId>,
    constants:BTreeMap<DeclarationId,ValueId>,declaration_roots:BTreeMap<DeclarationId,InstanceId>,region_roots:Vec<InstanceId>,
    effects:Vec<EffectNode>,effect_map:BTreeMap<(InstanceId,usize),usize>,calls:Vec<CallJob>,call_map:BTreeMap<(InstanceId,usize),usize>,
    locations:BTreeMap<(InstanceId,LocalBindingId),Location>,next_world:usize,
    obligations:Vec<BoundObligation>,occurrences:BTreeMap<(InstanceId,SourceId),ValueId>,
    needs:BTreeSet<EffectNeed>,problems:Vec<EffectProblem>,plain:ValueId,
    reverse_calls:BTreeMap<ValueId,BTreeSet<usize>>,call_queue:VecDeque<usize>,queued_calls:BTreeSet<usize>,
    binding_types:BTreeMap<LocalBindingId,TypeId>,parameter_values:BTreeMap<(InputOrigin,TypeId),ValueId>,
    capture_checks:Vec<CaptureCheck>,declaration_headers:BTreeMap<DeclarationId,usize>,
    canonical_values:BTreeMap<Vec<ValueTerm>,ValueId>,
    rejected_closures:BTreeSet<ClosureId>,
    code_scopes:BTreeMap<(OccurrenceId,&'static str),ScopeId>,
    activations:BTreeMap<usize,Arc<Activation>>,
    projections:BTreeMap<(ValueId,ValueProjection),ValueId>,
    states:Vec<StateNode>,state_queries:Vec<StateQuery>,state_values:BTreeMap<(StateId,Location,Option<ValueId>),ValueId>,
    state_queue:VecDeque<StateId>,queued_states:BTreeSet<StateId>,query_queue:VecDeque<usize>,queued_queries:BTreeSet<usize>,
    reverse_obligations:BTreeMap<ValueId,BTreeSet<usize>>,obligation_queue:VecDeque<usize>,queued_obligations:BTreeSet<usize>,
    closure_instances:BTreeMap<ClosureId,BTreeSet<InstanceId>>,
}

fn term_cost(term:&ValueTerm)->usize {
    match term {ValueTerm::Record(fields)=>192+fields.iter().map(|(name,_)|name.len()*6+96).sum::<usize>(),
        ValueTerm::List {items,..}=>192+items.len()*32,ValueTerm::Variant {name,..}=>192+name.len()*6,_=>192}
}
fn summary_cost(summary:&EffectSummary)->usize {
    192+summary.may.iter().map(|atom|192+atom.class.len()*6+atom.scope.as_ref().map_or(0,|scope|scope.len()*6)).sum::<usize>()+
        summary.internal.len()*128+summary.needs.len()*96
}
impl<'a,'b> Driver<'a,'b> {
    fn new(names:&'a NameAnalysis,headers:&'a [HeaderSeed],signatures:&'a [Signature],bodies:&'a BodyAnalysis,solver:&'b mut ConstraintMachine<'a>)->Result<Self> {
        let mut driver=Self {names,headers,signatures,bodies,solver,values:Vec::new(),transfers:Vec::new(),reverse:BTreeMap::new(),value_queue:VecDeque::new(),queued_values:BTreeSet::new(),
            templates:Vec::new(),declaration_codes:BTreeMap::new(),lambda_codes:BTreeMap::new(),constructor_codes:BTreeMap::new(),closures:Vec::new(),closure_keys:BTreeMap::new(),
            instances:Vec::new(),instance_keys:BTreeMap::new(),build_queue:VecDeque::new(),constants:BTreeMap::new(),declaration_roots:BTreeMap::new(),region_roots:Vec::new(),
            effects:Vec::new(),effect_map:BTreeMap::new(),calls:Vec::new(),call_map:BTreeMap::new(),locations:BTreeMap::new(),next_world:0,obligations:Vec::new(),occurrences:BTreeMap::new(),
            needs:BTreeSet::new(),problems:Vec::new(),plain:ValueId(0),reverse_calls:BTreeMap::new(),call_queue:VecDeque::new(),queued_calls:BTreeSet::new(),
            binding_types:BTreeMap::new(),parameter_values:BTreeMap::new(),capture_checks:Vec::new(),declaration_headers:BTreeMap::new(),canonical_values:BTreeMap::new(),rejected_closures:BTreeSet::new(),code_scopes:BTreeMap::new(),activations:BTreeMap::new(),projections:BTreeMap::new(),
            states:Vec::new(),state_queries:Vec::new(),state_values:BTreeMap::new(),state_queue:VecDeque::new(),queued_states:BTreeSet::new(),query_queue:VecDeque::new(),queued_queries:BTreeSet::new(),
            reverse_obligations:BTreeMap::new(),obligation_queue:VecDeque::new(),queued_obligations:BTreeSet::new(),closure_instances:BTreeMap::new()};
        for scope in &names.lexical.scopes {
            driver.solver.work(1)?;
            let kind=match scope.kind{"function"=>"function","lambda"=>"lambda",_=>continue};
            driver.solver.charge(128)?;driver.code_scopes.insert((scope.occurrence,kind),scope.id);
        }
        driver.plain=driver.seed(ValueTerm::Data,true)?;Ok(driver)
    }
    fn slot(&mut self)->Result<ValueId> {
        self.solver.work(1)?;self.solver.charge(192)?;let id=ValueId(self.values.len());
        self.values.push(ValueSlot {terms:BTreeSet::new(),guards:BTreeSet::new(),provided:false,source:None});Ok(id)
    }
    fn seed(&mut self,term:ValueTerm,provided:bool)->Result<ValueId> {
        self.solver.charge(term_cost(&term))?;let id=self.slot()?;
        if let ValueTerm::Unknown(need)=&term{self.values[id.0].source=Some(need.source);}
        self.values[id.0].terms.insert(term);self.values[id.0].provided=provided;Ok(id)
    }
    fn unknown(&mut self,source:SourceId,code:&'static str)->Result<ValueId> {self.seed(ValueTerm::Unknown(EffectNeed {source,code}),false)}
    fn effect_node(&mut self,source:SourceId,seed:EffectSummary)->Result<usize> {
        self.solver.charge(summary_cost(&seed)+192)?;let id=self.effects.len();
        let _=source;
        self.effects.push(EffectNode {seed,dependencies:BTreeSet::new(),result:EffectSummary::bottom()});Ok(id)
    }
    fn need_summary(source:SourceId,code:&'static str)->EffectSummary {
        let mut summary=EffectSummary::bottom();summary.state=EffectState::Unknown;summary.needs.insert(EffectNeed {source,code});summary
    }
    fn dependency(&mut self,from:usize,to:usize)->Result<()> {
        self.solver.work(1)?;if !self.effects[from].dependencies.contains(&to){self.solver.charge(64)?;self.effects[from].dependencies.insert(to);}Ok(())
    }
    fn enqueue_transfer(&mut self,index:usize)->Result<()> {
        self.solver.work(1)?;if !self.queued_values.contains(&index){self.solver.charge(96)?;self.queued_values.insert(index);self.value_queue.push_back(index);}Ok(())
    }
    fn watch(&mut self,input:ValueId,transfer:usize)->Result<()> {
        self.solver.work(1)?;
        if !self.reverse.get(&input).is_some_and(|consumers|consumers.contains(&transfer)) {
            self.solver.charge(192)?;self.reverse.entry(input).or_default().insert(transfer);
        }Ok(())
    }
    fn transfer(&mut self,output:ValueId,operation:ValueOp)->Result<()> {
        let count=match &operation {ValueOp::Union(inputs)=>inputs.len(),ValueOp::Update(_,fields)=>fields.len()+1,_=>1};
        self.solver.charge(count*96+192)?;
        let inputs=match &operation {ValueOp::Union(inputs)=>inputs.clone(),ValueOp::Field(input,_)|ValueOp::Projection(input,_)|ValueOp::Load(input)=>vec![*input],
            ValueOp::Update(input,fields)=>std::iter::once(*input).chain(fields.iter().map(|(_,value)|*value)).collect()};
        let index=self.transfers.len();self.transfers.push(Transfer {output,operation});
        for input in inputs{self.watch(input,index)?;}self.enqueue_transfer(index)
    }
    fn union(&mut self,inputs:Vec<ValueId>)->Result<ValueId> {let result=self.slot()?;self.transfer(result,ValueOp::Union(inputs))?;Ok(result)}
    fn alias(&mut self,output:ValueId,input:ValueId)->Result<()> {self.transfer(output,ValueOp::Union(vec![input]))}
    fn projection(&mut self,input:ValueId,projection:&ValueProjection)->Result<ValueId> {
        self.solver.work(1)?;
        self.solver.charge(match projection{ValueProjection::Variant(name)=>name.len()*12+256,_=>256})?;
        let key=(input,projection.clone());
        if let Some(value)=self.projections.get(&key){return Ok(*value);}
        let value=self.slot()?;self.projections.insert(key,value);
        self.transfer(value,ValueOp::Projection(input,projection.clone()))?;Ok(value)
    }
    fn state(&mut self,source:SourceId,term:StateTerm)->Result<StateId> {
        self.solver.work(1)?;self.solver.charge(320)?;let id=StateId(self.states.len());
        self.states.push(StateNode {source,term,inputs:BTreeSet::new(),reverse:BTreeSet::new(),escapes:BTreeSet::new(),queries:BTreeSet::new(),calls:BTreeSet::new()});Ok(id)
    }
    fn queue_state(&mut self,state:StateId)->Result<()> {
        self.solver.work(1)?;if !self.queued_states.contains(&state){self.solver.charge(96)?;self.queued_states.insert(state);self.state_queue.push_back(state);}Ok(())
    }
    fn queue_query(&mut self,query:usize)->Result<()> {
        self.solver.work(1)?;if !self.queued_queries.contains(&query){self.solver.charge(96)?;self.queued_queries.insert(query);self.query_queue.push_back(query);}Ok(())
    }
    fn state_changed(&mut self,state:StateId)->Result<()> {
        self.queue_state(state)?;self.solver.charge(self.states[state.0].queries.len()*32)?;
        let queries=self.states[state.0].queries.iter().copied().collect::<Vec<_>>();
        for query in queries{self.queue_query(query)?;}Ok(())
    }
    fn state_input(&mut self,state:StateId,input:StateId)->Result<()> {
        self.solver.work(1)?;if self.states[state.0].inputs.contains(&input){return Ok(());}
        self.solver.charge(192)?;self.states[state.0].inputs.insert(input);self.states[input.0].reverse.insert(state);self.state_changed(state)
    }
    fn join_states(&mut self,source:SourceId,inputs:&[StateId])->Result<StateId> {
        let state=self.state(source,StateTerm::Join)?;for input in inputs{self.state_input(state,*input)?;}Ok(state)
    }
    fn state_value_with_default(&mut self,state:StateId,location:Location,fallback:Option<ValueId>)->Result<ValueId> {
        self.solver.work(1)?;if let Some(value)=self.state_values.get(&(state,location,fallback)){return Ok(*value);}
        self.solver.charge(256)?;let value=self.slot()?;self.values[value.0].source=Some(self.states[state.0].source);
        let query=self.state_queries.len();self.state_queries.push(StateQuery {state,location,fallback,value,inputs:BTreeSet::new(),unknown:false});
        self.state_values.insert((state,location,fallback),value);self.states[state.0].queries.insert(query);self.queue_query(query)?;Ok(value)
    }
    fn query_input(&mut self,query:usize,input:ValueId)->Result<()> {
        self.solver.work(1)?;if self.state_queries[query].inputs.contains(&input){return Ok(());}
        self.solver.charge(64)?;self.state_queries[query].inputs.insert(input);self.alias(self.state_queries[query].value,input)
    }
    fn process_states(&mut self)->Result<()> {
        while let Some(state)=self.state_queue.pop_front() {
            self.queued_states.remove(&state);self.solver.work(1)?;
            self.solver.charge(self.states[state.0].inputs.len()*32)?;
            let inputs=self.states[state.0].inputs.iter().copied().collect::<Vec<_>>();let mut additions=BTreeSet::new();
            for input in inputs {
                self.solver.work(1)?;self.solver.charge(self.states[input.0].escapes.len()*96)?;
                additions.extend(self.states[input.0].escapes.iter().copied());
            }
            if let StateTerm::Call(job)=self.states[state.0].term {
                if self.calls[job].opaque {self.solver.charge(self.calls[job].exposed.len()*96)?;additions.extend(self.calls[job].exposed.iter().copied());}
            }
            let before=self.states[state.0].escapes.len();self.solver.charge(additions.len()*96)?;
            self.states[state.0].escapes.extend(additions);
            if before!=self.states[state.0].escapes.len() {
                self.solver.charge((self.states[state.0].reverse.len()+self.states[state.0].calls.len())*32)?;
                let reverse=self.states[state.0].reverse.iter().copied().collect::<Vec<_>>();
                let calls=self.states[state.0].calls.iter().copied().collect::<Vec<_>>();
                for consumer in reverse{self.queue_state(consumer)?;}
                for job in calls{self.enqueue_call(job)?;}
            }
        }
        while let Some(query)=self.query_queue.pop_front() {
            self.queued_queries.remove(&query);self.solver.work(1)?;
            let (state,location,fallback)=(self.state_queries[query].state,self.state_queries[query].location,self.state_queries[query].fallback);
            let direct=match &self.states[state.0].term {
                StateTerm::Root(values)=>Some(values.get(&location).copied().or(fallback)),
                StateTerm::Write {location:target,value} if *target==location=>Some(Some(*value)),_=>None,
            };
            if let Some(value)=direct {
                if let Some(value)=value{self.query_input(query,value)?;}
                else if !self.state_queries[query].unknown {
                    self.state_queries[query].unknown=true;
                    let value=self.unknown(self.states[state.0].source,"NeedsPositionAtEntry")?;self.query_input(query,value)?;
                }
                continue;
            }
            self.solver.charge(self.states[state.0].inputs.len()*32)?;
            let inputs=self.states[state.0].inputs.iter().copied().collect::<Vec<_>>();
            for input in inputs{let value=self.state_value_with_default(input,location,fallback)?;self.query_input(query,value)?;}
            if let StateTerm::Call(job)=self.states[state.0].term {
                let affected=self.calls[job].opaque&&(self.calls[job].exposed.contains(&location)||self.states[self.calls[job].input_state.0].escapes.contains(&location));
                if affected&&!self.state_queries[query].unknown {
                    self.state_queries[query].unknown=true;
                    let value=self.unknown(self.bodies.calls[self.calls[job].call].source,"NeedsCapturedPositionCallContract")?;self.query_input(query,value)?;
                }
            }
        }
        Ok(())
    }
    fn propagate_values(&mut self)->Result<bool> {
        let mut changed=false;
        while let Some(index)=self.value_queue.pop_front() {
            self.queued_values.remove(&index);self.solver.work(1)?;
            let output=self.transfers[index].output;
            let cost=match &self.transfers[index].operation {ValueOp::Union(inputs)=>inputs.len()*32+128,
                ValueOp::Field(_,name)|ValueOp::Projection(_,ValueProjection::Variant(name))=>name.len()*6+128,
                ValueOp::Update(_,fields)=>fields.iter().map(|(name,_)|name.len()*6+96).sum::<usize>()+128,_=>256};
            self.solver.charge(cost)?;let operation=self.transfers[index].operation.clone();
            let mut incoming=BTreeSet::new();let mut copies=Vec::new();let mut logical_projections=Vec::new();
            match operation {
                ValueOp::Union(inputs)=>copies.extend(inputs),
                ValueOp::Field(input,name)=>{
                    self.solver.charge(64)?;self.values[output.0].guards.insert(input);
                    for term in &self.values[input.0].terms {
                        match term {ValueTerm::Record(fields)=>{if let Some((_,value))=fields.iter().find(|(field,_)|*field==name){copies.push(*value);}},
                            ValueTerm::Unknown(need)=>{incoming.insert(ValueTerm::Unknown(need.clone()));},_=>{}}
                    }
                },
                ValueOp::Update(input,replacements)=>{
                    self.solver.charge(64)?;self.values[output.0].guards.insert(input);
                    for term in &self.values[input.0].terms {
                        self.solver.charge(term_cost(term))?;
                        match term {ValueTerm::Record(fields)=>{let mut fields=fields.clone();for(name,value)in &replacements{if let Some(field)=fields.iter_mut().find(|(field,_)|field==name){field.1=*value;}}incoming.insert(ValueTerm::Record(fields));},
                            ValueTerm::Unknown(need)=>{incoming.insert(ValueTerm::Unknown(need.clone()));},_=>{}}
                    }
                },
                ValueOp::Projection(input,projection)=>{
                    self.solver.charge(64)?;self.values[output.0].guards.insert(input);
                    for term in &self.values[input.0].terms {
                        match (term,&projection) {
                            (ValueTerm::Variant {name,payload},ValueProjection::Variant(expected)) if name==expected=>copies.push(*payload),
                            (ValueTerm::List {items,tail,element},ValueProjection::Head)=>{
                                if let Some(value)=items.first().or(element.as_ref()){copies.push(*value);}
                                else if let Some(tail)=tail{self.solver.charge(64)?;logical_projections.push((*tail,ValueProjection::Head));}
                            },
                            (ValueTerm::List {items,tail,element},ValueProjection::Tail)=>{
                                if items.len()==1&&tail.is_some()&&element.is_none(){copies.push(tail.unwrap());}
                                else if items.is_empty(){
                                    if element.is_some(){
                                        // The abstract supplied List's tail is
                                        // another List from this same domain.
                                        copies.push(tail.unwrap_or(input));
                                    }else if let Some(tail)=tail{self.solver.charge(64)?;logical_projections.push((*tail,ValueProjection::Tail));}
                                }else {
                                    self.solver.charge(items.len()*32+192)?;incoming.insert(ValueTerm::List {items:items.iter().skip(1).copied().collect(),tail:*tail,element:*element});
                                }
                            },
                            (ValueTerm::Unknown(need),_)=>{incoming.insert(ValueTerm::Unknown(need.clone()));},_=>{},
                        }
                    }
                },
                ValueOp::Load(input)=>{
                    self.solver.charge(64)?;self.values[output.0].guards.insert(input);
                    for term in &self.values[input.0].terms {
                        match term {ValueTerm::Location {contents,..}=>copies.push(*contents),other=>{self.solver.charge(term_cost(other))?;incoming.insert(other.clone());}}
                    }
                },
            }
            for (input,projection) in logical_projections{copies.push(self.projection(input,&projection)?);}
            for input in copies {
                self.watch(input,index)?;
                for term in &self.values[input.0].terms {self.solver.charge(term_cost(term))?;incoming.insert(term.clone());}
            }
            let before=self.values[output.0].terms.len();
            for term in incoming {if !self.values[output.0].terms.contains(&term){self.solver.charge(term_cost(&term))?;self.values[output.0].terms.insert(term);}}
            if self.values[output.0].terms.len()!=before {
                changed=true;
                self.solver.charge(self.reverse.get(&output).map_or(0,BTreeSet::len)*32)?;
                let consumers=self.reverse.get(&output).map_or(Vec::new(),|consumers|consumers.iter().copied().collect());
                for consumer in consumers{self.enqueue_transfer(consumer)?;}
                self.solver.charge(self.reverse_calls.get(&output).map_or(0,BTreeSet::len)*32)?;
                let calls=self.reverse_calls.get(&output).map_or(Vec::new(),|calls|calls.iter().copied().collect());
                for call in calls{self.enqueue_call(call)?;}
                self.solver.charge(self.reverse_obligations.get(&output).map_or(0,BTreeSet::len)*32)?;
                let obligations=self.reverse_obligations.get(&output).map_or(Vec::new(),|items|items.iter().copied().collect());
                for obligation in obligations{self.enqueue_obligation(obligation)?;}
            }
        }
        Ok(changed)
    }
    fn enqueue_call(&mut self,index:usize)->Result<()> {
        self.solver.work(1)?;if !self.queued_calls.contains(&index){self.solver.charge(96)?;self.queued_calls.insert(index);self.call_queue.push_back(index);}Ok(())
    }
    fn enqueue_obligation(&mut self,index:usize)->Result<()> {
        self.solver.work(1)?;if !self.queued_obligations.contains(&index){self.solver.charge(96)?;self.queued_obligations.insert(index);self.obligation_queue.push_back(index);}Ok(())
    }
    fn source_type(&self,index:usize)->Option<TypeId> {match self.bodies.expressions[index].normal{NormalResult::Value(ty)=>Some(self.solver.arena().resolved(ty)),_=>None}}
    fn source_scope(&self,source:SourceId,kind:&'static str)->Option<ScopeId> {
        let occurrence=self.solver.arena().source(source).lexical?;
        self.code_scopes.get(&(occurrence,kind)).copied()
    }
    fn problem(&mut self,source:SourceId,code:&'static str,message:&str)->Result<()> {
        self.solver.charge(self.solver.arena().source(source).expanded_path.len()*6+message.len()*6+256)?;
        self.problems.push(EffectProblem {source,diagnostic:fail(code,&self.solver.arena().source(source).expanded_path,message)});Ok(())
    }
    fn prepare(&mut self)->Result<()> {
        let mut row_sources=BTreeMap::new();
        for index in 0..self.solver.arena().sources.len() {
            self.solver.work(1)?;self.solver.charge(self.solver.arena().sources[index].expanded_path.len()*6+128)?;
            let source=&self.solver.arena().sources[index];
            row_sources.insert((source.module,source.expanded_path.clone()),source.id);
        }
        for fact in &self.bodies.bindings {self.solver.charge(96)?;self.binding_types.insert(fact.binding,fact.ty);}
        for binder in &self.solver.arena().binders {
            if let (Some(binding),SemanticKind::Value(ty))=(binder.binding,&binder.kind){self.binding_types.insert(binding,*ty);}
        }
        for (index,header) in self.headers.iter().enumerate() {
            self.solver.work(1)?;self.solver.charge(128)?;self.declaration_headers.insert(header.declaration,index);
            if let HeaderKind::Constant {..}=header.kind {let value=self.slot()?;self.values[value.0].source=Some(header.source);self.constants.insert(header.declaration,value);}
            if let HeaderKind::Function {parameters,..}=&header.kind {
                self.solver.charge(parameters.len()*96+192)?;
                let typed=parameters.iter().map(|parameter|(parameter.binding,parameter.ty)).collect::<Vec<_>>();
                for (binding,ty) in &typed {self.binding_types.insert(*binding,*ty);}
                if let Some(ty)=self.signatures[index].ty {
                    let root=self.bodies.declarations.get(&header.declaration).map(|summary|summary.expression);
                    let scope=self.source_scope(header.source,"function");let code=self.templates.len();
                    self.solver.charge(self.solver.arena().source(header.source).expanded_path.len()*6+32)?;
                    let declaration_path=self.solver.arena().source(header.source).expanded_path.clone();
                    let path=self.solver.path(&declaration_path,"body")?;
                    let path=self.solver.path(&path,"effects")?;
                    let bound_source=row_sources.get(&(header.module,path)).copied().unwrap_or(header.source);
                    self.templates.push(Template {identity:CodeIdentity::Declaration(header.declaration),root,parameters:typed,scope,source:header.source,bound_source,ty,globals:Vec::new(),constructor:None});
                    self.declaration_codes.insert(header.declaration,code);
                }
            }
        }
        for (index,summary) in self.bodies.expressions.iter().enumerate() {
            if let ValueRelation::Lambda {body,parameters}=&summary.value {
                let Some(ty)=self.source_type(index) else{continue;};
                let SemanticType::Function(function)=self.solver.copy_type(ty)? else{continue;};
                let mut typed=Vec::new();
                for (binding,argument) in parameters.iter().zip(&function.parameters) {
                    if let SemanticArgument::Type(ty)=argument {self.solver.charge(96)?;typed.push((*binding,*ty));self.binding_types.insert(*binding,*ty);}
                }
                let mut globals=BTreeSet::new();let mut stack=vec![*body];
                while let Some(child)=stack.pop() {
                    self.solver.work(1)?;let summary=&self.bodies.expressions[child];
                    if let ValueRelation::Declaration(declaration)=summary.value {
                        if self.constants.contains_key(&declaration){self.solver.charge(64)?;globals.insert(declaration);}
                    }
                    self.solver.charge(summary.children.len()*32)?;stack.extend(&summary.children);
                }
                self.solver.charge(globals.len()*32+192)?;let code=self.templates.len();
                self.templates.push(Template {identity:CodeIdentity::Lambda(summary.source),root:Some(*body),parameters:typed,
                    scope:self.source_scope(summary.source,"lambda"),source:summary.source,bound_source:summary.source,ty,globals:globals.into_iter().collect(),constructor:None});
                self.lambda_codes.insert(summary.source,code);
            }
            if let ValueRelation::Constructor {name,..}=&summary.value {
                if let Some(ty)=self.source_type(index) {
                    self.solver.charge(name.len()*6+256)?;let code=self.templates.len();
                    self.templates.push(Template {identity:CodeIdentity::Constructor(summary.source),root:None,parameters:Vec::new(),scope:None,
                        source:summary.source,bound_source:summary.source,ty,globals:Vec::new(),constructor:Some(name.clone())});
                    self.constructor_codes.insert(summary.source,code);
                }
            }
        }
        self.solver.charge(self.declaration_codes.len()*32)?;
        let declarations=self.declaration_codes.iter().map(|(declaration,code)|(*declaration,*code)).collect::<Vec<_>>();
        for (declaration,code) in declarations {
            let closure=self.closure(code,Vec::new())?;let instance=self.general_instance(closure)?;self.declaration_roots.insert(declaration,instance);
        }
        for header in self.headers {
            if let HeaderKind::Constant {..}=header.kind {
                if let Some(summary)=self.bodies.declarations.get(&header.declaration) {
                    let world=self.fresh_world()?;let instance=self.root_instance(summary.expression,BTreeMap::new(),world,None,Vec::new())?;
                    self.declaration_roots.insert(header.declaration,instance);let result=self.instances[instance.0].result;
                    self.alias(self.constants[&header.declaration],result)?;
                }
            }
        }
        for root in &self.bodies.regions {let world=self.fresh_world()?;let instance=self.root_instance(*root,BTreeMap::new(),world,None,Vec::new())?;self.region_roots.push(instance);}
        Ok(())
    }
    fn parameter_value(&mut self,binding:LocalBindingId,ty:TypeId,source:SourceId)->Result<ValueId> {
        self.input_value(InputOrigin::Binding(binding),ty,source)
    }
    fn input_value(&mut self,origin:InputOrigin,ty:TypeId,source:SourceId)->Result<ValueId> {
        if let Some(value)=self.parameter_values.get(&(origin.clone(),ty)){return Ok(*value);}
        let slot=self.slot()?;self.values[slot.0].provided=true;self.solver.charge(128)?;self.parameter_values.insert((origin.clone(),ty),slot);
        let normalized=self.solver.normalize(ty,source)?;
        let view=self.solver.declaration_body(normalized,source)?.unwrap_or(normalized);
        let term=match self.solver.copy_type(view)? {
            SemanticType::Function(_)=>ValueTerm::Contract {origin:origin.clone(),ty:normalized,source},
            SemanticType::Record {fields,..}=>{
                self.solver.charge(fields.len()*64)?;let mut values=Vec::new();
                for(name,field)in fields {let value=self.input_value(origin.clone(),field.ty,source)?;values.push((name,value));}ValueTerm::Record(values)
            },
            SemanticType::List(item)|SemanticType::Sequence {item,ordered:true}=>{
                let element=self.input_value(origin.clone(),item,source)?;ValueTerm::List {items:Vec::new(),tail:Some(slot),element:Some(element)}
            },
            SemanticType::Scalar(_)|SemanticType::Rational=>ValueTerm::Data,
            _=>ValueTerm::Unknown(EffectNeed {source,code:"NeedsProfessionalValueFlow"}),
        };
        self.solver.charge(term_cost(&term))?;self.values[slot.0].terms.insert(term);Ok(slot)
    }
    fn closure(&mut self,code:usize,environment:Vec<(LocalBindingId,ValueId)>)->Result<ClosureId> {
        self.solver.charge(environment.len()*128+256)?;let key=ClosureKey {code,environment};
        if let Some(closure)=self.closure_keys.get(&key){return Ok(*closure);}
        self.solver.charge(self.templates[code].globals.len()*32+192)?;
        let strict=self.templates[code].globals.iter().filter_map(|declaration|self.constants.get(declaration).copied()).collect::<Vec<_>>();
        let closure=ClosureId(self.closures.len());let value=self.seed(ValueTerm::Closure(closure),false)?;
        self.closure_keys.insert(key.clone(),closure);self.closures.push(Closure {key,value,strict,general:None});Ok(closure)
    }
    fn general_instance(&mut self,closure:ClosureId)->Result<InstanceId> {
        if let Some(instance)=self.closures[closure.0].general{return Ok(instance);}
        let code=self.closures[closure.0].key.code;let source=self.templates[code].source;
        let world=self.fresh_world()?;
        let input=self.capture_state(closure,source)?;
        if self.templates[code].constructor.is_none()&&self.templates[code].root.is_none_or(|root|self.bodies.expressions[root].state!=BodyState::TypeChecked) {
            let instance=self.instance(closure,Vec::new(),world,input,Vec::new())?;self.closures[closure.0].general=Some(instance);return Ok(instance);
        }
        self.solver.charge(self.templates[code].parameters.len()*32)?;let parameters=self.templates[code].parameters.clone();let mut arguments=Vec::new();
        for(binding,ty)in parameters {arguments.push(self.parameter_value(binding,ty,source)?);}
        if self.templates[code].constructor.is_some() {
            let ty=self.templates[code].ty;
            if let SemanticType::Function(function)=self.solver.copy_type(ty)? {
                for argument in function.parameters {
                    if let SemanticArgument::Type(ty)=argument{arguments.push(self.input_value(InputOrigin::Constructor(source),ty,source)?);}
                }
            }
        }
        let instance=self.instance(closure,arguments,world,input,Vec::new())?;self.closures[closure.0].general=Some(instance);Ok(instance)
    }
    fn capture_state(&mut self,closure:ClosureId,source:SourceId)->Result<StateId> {
        let mut values=BTreeMap::new();
        for (_,value) in &self.closures[closure.0].key.environment {
            for term in &self.values[value.0].terms {
                self.solver.work(1)?;
                if let ValueTerm::Location {binding,instance,contents}=term {
                    self.solver.charge(128)?;values.insert(Location {owner:*instance,binding:*binding},*contents);
                }
            }
        }
        self.state(source,StateTerm::Root(values))
    }
    fn fresh_world(&mut self)->Result<usize> {
        self.solver.work(1)?;let world=self.next_world;self.next_world+=1;Ok(world)
    }
    fn activation(&mut self,root:usize)->Result<Arc<Activation>> {
        if let Some(activation)=self.activations.get(&root){return Ok(Arc::clone(activation));}
        self.solver.charge(256)?;let mut activation=Activation::default();let mut stack=vec![self.bodies.expressions[root].immediate];
        while let Some(effect)=stack.pop() {
            self.solver.work(1)?;if activation.effects.contains(&effect.0){continue;}
            self.solver.charge(96)?;activation.effects.insert(effect.0);
            let mut edge=|effect:EffectId|{stack.push(effect);};
            match &self.bodies.effects[effect.0].term {
                EffectTerm::Sequence(children)|EffectTerm::Unqualified {children,..}=>{self.solver.charge(children.len()*32)?;stack.extend(children);},
                EffectTerm::Conditional {condition,branches,active}=>{
                    self.solver.charge((branches.len()+1)*32)?;edge(*condition);
                    for (branch,active) in branches.iter().zip(active){if *active{edge(*branch);}}
                },
                EffectTerm::Loop {condition,body,body_active,..}=>{self.solver.charge(64)?;edge(*condition);if *body_active{edge(*body);}},
                EffectTerm::Try {body,handler,..}=>{self.solver.charge(64)?;edge(*body);edge(*handler);},
                EffectTerm::Call(call)=>{self.solver.charge(64)?;activation.calls.insert(*call);},_=>{},
            }
        }
        let activation=Arc::new(activation);self.activations.insert(root,Arc::clone(&activation));Ok(activation)
    }
    fn active(&self,instance:InstanceId,index:usize)->bool {
        self.instances[instance.0].activation.effects.contains(&self.bodies.expressions[index].immediate.0)
    }
    fn root_instance(&mut self,root:usize,environment:BTreeMap<LocalBindingId,ValueId>,world:usize,input:Option<StateId>,context:Vec<usize>)->Result<InstanceId> {
        let source=self.bodies.expressions[root].source;let result=self.slot()?;let effect=self.effect_node(source,EffectSummary::bottom())?;
        self.values[result.0].source=Some(source);
        self.solver.charge(environment.len()*96+256)?;let instance=InstanceId(self.instances.len());
        let activation=self.activation(root)?;
        let input_state=match input{Some(state)=>state,None=>self.state(source,StateTerm::Root(BTreeMap::new()))?};
        let output_state=self.state(source,StateTerm::Join)?;
        self.instances.push(Instance {closure:None,root,environment,result,effect,memo:BTreeMap::new(),built:false,world,activation,
            input_state,output_state,context,point_states:BTreeMap::new()});self.build_queue.push_back(instance);Ok(instance)
    }
    fn instance(&mut self,closure:ClosureId,arguments:Vec<ValueId>,world:usize,input:StateId,context:Vec<usize>)->Result<InstanceId> {
        self.solver.charge(arguments.len()*96+context.len()*64+256)?;let key=InstanceKey {closure,arguments,world,context};
        if let Some(instance)=self.instance_keys.get(&key).copied(){self.state_input(self.instances[instance.0].input_state,input)?;return Ok(instance);}
        let code=self.closures[closure.0].key.code;
        let source=self.templates[code].source;let input_state=self.join_states(source,&[input])?;
        if let Some(name)=&self.templates[code].constructor {
            self.solver.charge(name.len()*6+256)?;let name=name.clone();let source=self.templates[code].source;
            let payload=key.arguments.first().copied().unwrap_or(self.plain);
            let result=self.seed(ValueTerm::Variant {name,payload},false)?;
            let effect=self.effect_node(source,EffectSummary::bottom())?;let instance=InstanceId(self.instances.len());
            let output_state=self.join_states(source,&[input_state])?;
            self.instances.push(Instance {closure:Some(closure),root:0,environment:BTreeMap::new(),result,effect,memo:BTreeMap::new(),built:true,world,activation:Arc::new(Activation::default()),
                input_state,output_state,context:key.context.clone(),point_states:BTreeMap::new()});
            self.register_instance(key,instance)?;return Ok(instance);
        }
        let Some(root)=self.templates[code].root else {
            let source=self.templates[code].source;let value=self.unknown(source,"NeedsBodyType")?;
            let effect=self.effect_node(source,Self::need_summary(source,"NeedsBodyType"))?;
            let output_state=self.join_states(source,&[input_state])?;
            let instance=InstanceId(self.instances.len());self.instances.push(Instance {closure:Some(closure),root:0,environment:BTreeMap::new(),result:value,effect,memo:BTreeMap::new(),built:true,world,activation:Arc::new(Activation::default()),
                input_state,output_state,context:key.context.clone(),point_states:BTreeMap::new()});
            self.register_instance(key,instance)?;return Ok(instance);
        };
        self.solver.charge(self.closures[closure.0].key.environment.len()*96+self.templates[code].parameters.len()*96)?;
        let mut environment=self.closures[closure.0].key.environment.iter().copied().collect::<BTreeMap<_,_>>();
        for((binding,_),argument)in self.templates[code].parameters.iter().zip(&key.arguments){environment.insert(*binding,*argument);}
        self.solver.charge(key.context.len()*32)?;
        let instance=self.root_instance(root,environment,world,Some(input_state),key.context.clone())?;self.instances[instance.0].closure=Some(closure);self.register_instance(key,instance)?;Ok(instance)
    }
    fn register_instance(&mut self,key:InstanceKey,instance:InstanceId)->Result<()> {
        self.solver.charge(192)?;self.closure_instances.entry(key.closure).or_default().insert(instance);self.instance_keys.insert(key,instance);Ok(())
    }
    fn copy_environment(&mut self,environment:&FlowEnvironment)->Result<FlowEnvironment> {
        self.solver.charge(environment.bindings.len()*96+128)?;Ok(FlowEnvironment {bindings:environment.bindings.clone(),state:environment.state})
    }
    fn retained_location(&self,instance:InstanceId,binding:LocalBindingId)->Option<Location> {
        self.locations.get(&(instance,binding)).copied().or_else(||{
            let value=self.instances[instance.0].environment.get(&binding)?;
            self.values[value.0].terms.iter().find_map(|term|match term {
                ValueTerm::Location {binding:original,instance,..} if *original==binding=>Some(Location {owner:*instance,binding}),_=>None,
            })
        })
    }
    fn captured_default(&self,instance:InstanceId,binding:LocalBindingId)->Option<ValueId> {
        let value=self.instances[instance.0].environment.get(&binding)?;
        self.values[value.0].terms.iter().find_map(|term|match term {
            ValueTerm::Location {binding:original,contents,..} if *original==binding=>Some(*contents),_=>None,
        })
    }
    fn allocation(&mut self,instance:InstanceId,binding:LocalBindingId)->Result<Location> {
        self.solver.work(1)?;if let Some(location)=self.retained_location(instance,binding){return Ok(location);}
        let location=Location {owner:instance,binding};self.solver.charge(128)?;self.locations.insert((instance,binding),location);Ok(location)
    }
    fn write_location(&mut self,instance:InstanceId,binding:LocalBindingId,value:ValueId,environment:&mut FlowEnvironment,source:SourceId)->Result<()> {
        let location=self.allocation(instance,binding)?;
        let state=self.state(source,StateTerm::Write {location,value})?;self.state_input(state,environment.state)?;environment.state=state;Ok(())
    }
    fn declaration_value(&mut self,declaration:DeclarationId,source:SourceId)->Result<ValueId> {
        if let Some(code)=self.declaration_codes.get(&declaration).copied(){let closure=self.closure(code,Vec::new())?;return Ok(self.closures[closure.0].value);}
        if let Some(value)=self.constants.get(&declaration){return Ok(*value);}
        self.unknown(source,"NeedsProfessionalEffectValue")
    }
    fn detached_region(&mut self,instance:InstanceId,root:usize,environment:&FlowEnvironment)->Result<ValueId> {
        let mut environment=self.copy_environment(environment)?;
        for (binding,value) in &mut environment.bindings {
            if let Some(location)=self.retained_location(instance,*binding) {
                let fallback=self.captured_default(instance,*binding);
                let contents=self.state_value_with_default(environment.state,location,fallback)?;
                *value=self.seed(ValueTerm::Location {binding:*binding,instance:location.owner,contents},true)?;
            }
        }
        let world=self.fresh_world()?;let region=self.root_instance(root,environment.bindings,world,Some(environment.state),Vec::new())?;
        Ok(self.instances[region.0].result)
    }
    fn eval(&mut self,instance:InstanceId,index:usize,environment:&mut FlowEnvironment,depth:usize)->Result<ValueId> {
        self.solver.work(1)?;if depth>192{return Err(fail("ResourceLimit","","Effect value-flow depth budget exceeded"));}
        if let Some(value)=self.instances[instance.0].memo.get(&index){return Ok(*value);}
        if !self.active(instance,index) {
            let value=self.detached_region(instance,index,environment)?;self.solver.charge(128)?;
            self.instances[instance.0].memo.insert(index,value);return Ok(value);
        }
        let bodies=self.bodies;let summary=&bodies.expressions[index];let source=summary.source;
        let value=match &summary.value {
            ValueRelation::Data=>{for child in &summary.children{self.eval(instance,*child,environment,depth+1)?;}self.plain},
            ValueRelation::Unknown=>{for child in &summary.children{self.eval(instance,*child,environment,depth+1)?;}self.unknown(source,"NeedsEffectValueFlow")?},
            ValueRelation::Declaration(declaration)=>self.declaration_value(*declaration,source)?,
            ValueRelation::Binding(binding)=>{
                let input=if self.names.lexical.bindings[binding.index()].mutable {
                    let location=self.allocation(instance,*binding)?;let fallback=self.captured_default(instance,*binding);
                    self.state_value_with_default(environment.state,location,fallback)?
                }else if let Some(value)=environment.bindings.get(binding){*value}
                    else if let Some(ty)=self.binding_types.get(binding).copied(){self.parameter_value(*binding,ty,source)?}
                    else{self.unknown(source,"NeedsProfessionalValueEnvironment")?};
                let value=self.slot()?;self.transfer(value,ValueOp::Load(input))?;value
            },
            ValueRelation::Lambda {..}=>{
                if let Some(code)=self.lambda_codes.get(&source).copied() {
                    self.solver.charge(summary.captures.len()*192)?;let mut captures=Vec::new();
                    for binding in &summary.captures {
                        let value=if let Some(value)=environment.bindings.get(binding){*value}
                            else if let Some(ty)=self.binding_types.get(binding).copied(){self.parameter_value(*binding,ty,source)?}
                            else{self.unknown(source,"NeedsCaptureEnvironment")?};
                        let value=if self.names.lexical.bindings[binding.index()].mutable {
                            let location=self.allocation(instance,*binding)?;let fallback=self.captured_default(instance,*binding);
                            let contents=self.state_value_with_default(environment.state,location,fallback)?;
                            self.seed(ValueTerm::Location {binding:*binding,instance:location.owner,contents},true)?
                        }else{value};
                        captures.push((*binding,value));
                    }
                    let closure=self.closure(code,captures)?;self.general_instance(closure)?;self.closures[closure.0].value
                }else{self.unknown(source,"NeedsLambdaType")?}
            },
            ValueRelation::Forward(child)=>self.eval(instance,*child,environment,depth+1)?,
            ValueRelation::Let {binding,initializer,continuation}=>{
                let value=self.eval(instance,*initializer,environment,depth+1)?;self.solver.charge(96)?;environment.bindings.insert(*binding,value);
                self.eval(instance,*continuation,environment,depth+1)?
            },
            ValueRelation::Region {bindings,result}=>{
                for(binding,initializer)in bindings{let value=self.eval(instance,*initializer,environment,depth+1)?;self.solver.charge(96)?;environment.bindings.insert(*binding,value);}
                self.eval(instance,*result,environment,depth+1)?
            },
            ValueRelation::Initialize {binding,initializer}=>{
                let value=self.eval(instance,*initializer,environment,depth+1)?;self.solver.charge(96)?;environment.bindings.insert(*binding,value);
                if self.names.lexical.bindings[binding.index()].mutable{self.write_location(instance,*binding,value,environment,source)?;}self.plain
            },
            ValueRelation::Assign {binding,value}=>{
                let value=self.eval(instance,*value,environment,depth+1)?;self.solver.charge(96)?;environment.bindings.insert(*binding,value);self.write_location(instance,*binding,value,environment,source)?;self.plain
            },
            ValueRelation::Sequence {steps,result}=>{
                for child in steps{self.eval(instance,*child,environment,depth+1)?;}
                match result{Some(result)=>self.eval(instance,*result,environment,depth+1)?,None=>self.plain}
            },
            ValueRelation::Choose(branches)=>{
                if summary.children.len()>branches.len(){if let Some(condition)=summary.children.first(){self.eval(instance,*condition,environment,depth+1)?;}}
                let original=self.copy_environment(environment)?;let mut values=Vec::new();let mut states=Vec::new();
                let is_try=matches!(bodies.effects[summary.immediate.0].term,EffectTerm::Try {..});let mut body_state=None;
                for (position,branch) in branches.iter().enumerate() {
                    let mut branch_environment=self.copy_environment(&original)?;
                    if is_try&&position>0{if let Some(body)=body_state{branch_environment.state=self.join_states(source,&[original.state,body])?;}}
                    let value=self.eval(instance,*branch,&mut branch_environment,depth+1)?;
                    if position==0{body_state=Some(branch_environment.state);}
                    if self.active(instance,*branch)&&matches!(bodies.expressions[*branch].normal,NormalResult::Value(_)){values.push(value);states.push(branch_environment);}
                }
                if branches.len()==1{values.push(self.plain);states.push(self.copy_environment(&original)?);}
                self.merge_environments(environment,&original,&states,source)?;self.union(values)?
            },
            ValueRelation::Match {subject,arms}=>{
                let subject=self.eval(instance,*subject,environment,depth+1)?;let original=self.copy_environment(environment)?;let mut values=Vec::new();let mut states=Vec::new();
                for(arm,body)in arms {
                    let mut arm_environment=self.copy_environment(&original)?;
                    for binding in &bodies.pattern_values {
                        if binding.arm==*arm {
                            let mut value=subject;
                            for projection in &binding.projection {
                                self.solver.charge(match projection{ValueProjection::Variant(name)=>name.len()*6+128,_=>128})?;
                                value=self.projection(value,projection)?;
                            }
                            self.solver.charge(96)?;arm_environment.bindings.insert(binding.binding,value);
                        }
                    }
                    let value=self.eval(instance,*body,&mut arm_environment,depth+1)?;
                    if self.active(instance,*body)&&matches!(bodies.expressions[*body].normal,NormalResult::Value(_)){values.push(value);states.push(arm_environment);}
                }
                self.merge_environments(environment,&original,&states,source)?;self.union(values)?
            },
            ValueRelation::Loop {condition,body}=>{
                let original=self.copy_environment(environment)?;let mut loop_environment=self.copy_environment(environment)?;
                let entry=self.join_states(source,&[original.state])?;loop_environment.state=entry;
                self.eval(instance,*condition,&mut loop_environment,depth+1)?;
                let condition_state=loop_environment.state;
                self.eval(instance,*body,&mut loop_environment,depth+1)?;
                let (target,condition_false)=match bodies.effects[summary.immediate.0].term {
                    EffectTerm::Loop {target,condition_false,..}=>(target,condition_false),_ => (None,false),
                };
                let mut exits=Vec::new();
                if condition_false{self.solver.charge(32)?;exits.push(condition_state);}
                if self.active(instance,*body) {
                    if matches!(bodies.expressions[*body].normal,NormalResult::Value(_)){self.state_input(entry,loop_environment.state)?;}
                }
                for index in [condition,body] {
                    if !self.active(instance,*index){continue;}
                    for exit in &bodies.expressions[*index].exits {
                        self.solver.work(1)?;
                        if target.is_none()||exit.target!=target{continue;}
                        if let Some(state)=self.instances[instance.0].point_states.get(&exit.source).copied(){match exit.kind {
                            ExitKind::Continue=>self.state_input(entry,state)?,ExitKind::Break=>{self.solver.charge(32)?;exits.push(state);},_=>{},
                        }}
                    }
                }
                environment.state=self.join_states(source,&exits)?;self.plain
            },
            ValueRelation::Record(fields)=>{
                self.solver.charge(fields.iter().map(|(name,_)|name.len()*6+96).sum::<usize>())?;let mut values=Vec::new();
                for(name,child)in fields{values.push((name.clone(),self.eval(instance,*child,environment,depth+1)?));}self.seed(ValueTerm::Record(values),false)?
            },
            ValueRelation::List {items,tail}=>{
                self.solver.charge(items.len()*32)?;let mut values=Vec::new();for child in items{values.push(self.eval(instance,*child,environment,depth+1)?);}
                let tail=match tail{Some(tail)=>Some(self.eval(instance,*tail,environment,depth+1)?),None=>None};self.seed(ValueTerm::List {items:values,tail,element:None},false)?
            },
            ValueRelation::Field {receiver,name}=>{
                let receiver=self.eval(instance,*receiver,environment,depth+1)?;self.solver.charge(name.len()*6+128)?;
                let value=self.slot()?;self.transfer(value,ValueOp::Field(receiver,name.clone()))?;value
            },
            ValueRelation::RecordUpdate {receiver,fields}=>{
                let receiver=self.eval(instance,*receiver,environment,depth+1)?;
                self.solver.charge(fields.iter().map(|(name,_)|name.len()*6+96).sum::<usize>())?;let mut values=Vec::new();
                for(name,child)in fields{values.push((name.clone(),self.eval(instance,*child,environment,depth+1)?));}
                let value=self.slot()?;self.transfer(value,ValueOp::Update(receiver,values))?;value
            },
            ValueRelation::Variant {name,payload}=>{
                let payload=self.eval(instance,*payload,environment,depth+1)?;self.solver.charge(name.len()*6+128)?;self.seed(ValueTerm::Variant {name:name.clone(),payload},false)?
            },
            ValueRelation::Constructor {..}=>{
                if let Some(code)=self.constructor_codes.get(&source).copied(){
                    let closure=self.closure(code,Vec::new())?;self.general_instance(closure)?;self.closures[closure.0].value
                }else{self.unknown(source,"NeedsConstructorValueEffects")?}
            },
            ValueRelation::Call(call)=>self.call_value(instance,*call,environment,depth)?,
        };
        self.solver.charge(192)?;self.instances[instance.0].memo.insert(index,value);self.occurrences.insert((instance,source),value);
        self.solver.charge(96)?;self.instances[instance.0].point_states.insert(source,environment.state);
        if self.values[value.0].source.is_none(){self.values[value.0].source=Some(source);}
        if let Some(expected)=summary.expected {
            let expected=self.solver.normalize(expected,source)?;
            if matches!(self.solver.arena().get(expected),SemanticType::Function(function) if !function.pending_effects){
                let world=self.fresh_world()?;self.solver.charge(192)?;
                let index=self.obligations.len();self.obligations.push(BoundObligation {source,value,expected,state:environment.state,world,instances:BTreeSet::new()});
                self.solver.charge(64)?;self.reverse_obligations.entry(value).or_default().insert(index);self.enqueue_obligation(index)?;
            }
        }
        Ok(value)
    }
    fn merge_environments(&mut self,environment:&mut FlowEnvironment,original:&FlowEnvironment,states:&[FlowEnvironment],source:SourceId)->Result<()> {
        for(binding,initial)in &original.bindings {
            self.solver.charge(states.len()*32)?;
            let values=states.iter().map(|state|state.bindings.get(binding).copied().unwrap_or(*initial)).collect::<Vec<_>>();
            let value=if values.is_empty(){*initial}else{self.union(values)?};environment.bindings.insert(*binding,value);
        }
        self.solver.charge(states.len()*32)?;let inputs=states.iter().map(|state|state.state).collect::<Vec<_>>();
        environment.state=self.join_states(source,&inputs)?;
        Ok(())
    }
    fn call_value(&mut self,instance:InstanceId,call:usize,environment:&mut FlowEnvironment,depth:usize)->Result<ValueId> {
        let fact=&self.bodies.calls[call];let callee=self.eval(instance,fact.callee_value,environment,depth+1)?;
        self.solver.charge(fact.arguments.len()*64+256)?;let mut arguments=vec![self.plain;fact.arguments.len()];
        for(index,argument)in fact.arguments.iter().enumerate(){let value=self.eval(instance,*argument,environment,depth+1)?;arguments[fact.source_to_formal[index]]=value;}
        let result=self.slot()?;let effect=self.effect_node(fact.source,EffectSummary::bottom())?;let job=self.calls.len();
        let world=if self.instances[instance.0].activation.calls.contains(&call){self.instances[instance.0].world}else{self.fresh_world()?};
        self.solver.charge(self.instances[instance.0].context.len()*64+128)?;self.solver.work(self.instances[instance.0].context.len()+1)?;
        let mut context=self.instances[instance.0].context.clone();
        // A context is a simple path of static call occurrences. A repeated
        // site closes the corresponding graph backedge and joins its incoming
        // states. Distinct acyclic caller paths retain their program points.
        if let Some(position)=context.iter().position(|site|*site==call){context.truncate(position+1);}else{context.push(call);}
        let input_state=environment.state;let output_state=self.state(fact.source,StateTerm::Call(job))?;
        self.solver.charge(64)?;self.states[input_state.0].calls.insert(job);
        self.calls.push(CallJob {world,call,callee,arguments:arguments.clone(),result,effect,targets:BTreeSet::new(),input_state,output_state,context,opaque:false,exposed:BTreeSet::new()});
        if self.instances[instance.0].activation.calls.contains(&call){environment.state=output_state;}
        self.call_map.insert((instance,call),job);
        for value in std::iter::once(callee).chain(arguments){self.solver.charge(128)?;self.values[result.0].guards.insert(value);self.reverse_calls.entry(value).or_default().insert(job);}
        self.enqueue_call(job)?;Ok(result)
    }
    fn build_instance(&mut self,instance:InstanceId)->Result<()> {
        if self.instances[instance.0].built{return Ok(());}self.instances[instance.0].built=true;
        let root=self.instances[instance.0].root;let bodies=self.bodies;let summary=&bodies.expressions[root];
        if summary.state!=BodyState::TypeChecked {
            let mut blocked=Self::need_summary(summary.source,"NeedsBodyType");
            if summary.state==BodyState::Rejected{blocked.state=EffectState::Rejected;}
            self.effects[self.instances[instance.0].effect].seed=blocked;
            let unknown=self.unknown(summary.source,"NeedsBodyType")?;self.alias(self.instances[instance.0].result,unknown)?;return Ok(());
        }
        self.solver.charge(self.instances[instance.0].environment.len()*96+128)?;
        let mut environment=FlowEnvironment {bindings:self.instances[instance.0].environment.clone(),state:self.instances[instance.0].input_state};
        let value=self.eval(instance,root,&mut environment,0)?;let mut results=Vec::new();
        if matches!(summary.normal,NormalResult::Value(_)){results.push(value);self.state_input(self.instances[instance.0].output_state,environment.state)?;}
        let scope=self.instances[instance.0].closure.and_then(|closure|self.templates[self.closures[closure.0].key.code].scope);
        for exit in &summary.exits {
            if exit.kind==ExitKind::Return&&exit.target==scope {
                if let Some(state)=self.instances[instance.0].point_states.get(&exit.source).copied(){self.state_input(self.instances[instance.0].output_state,state)?;}
                if let Some(expression)=exit.expression {
                    if let Some(value)=self.instances[instance.0].memo.get(&expression){results.push(*value);}
                }else{results.push(self.plain);}
            }
        }
        self.solver.charge(results.len()*32)?;let returns=self.union(results)?;self.alias(self.instances[instance.0].result,returns)?;
        let effect=self.effect_for(instance,summary.immediate)?;self.dependency(self.instances[instance.0].effect,effect)?;Ok(())
    }
    fn effect_for(&mut self,instance:InstanceId,effect:EffectId)->Result<usize> {
        if let Some(node)=self.effect_map.get(&(instance,effect.0)){return Ok(*node);}
        let bodies=self.bodies;let equation=&bodies.effects[effect.0];let source=equation.source;
        let node=self.effect_node(source,EffectSummary::bottom())?;self.solver.charge(96)?;self.effect_map.insert((instance,effect.0),node);
        match &equation.term {
            EffectTerm::Empty=>{},
            EffectTerm::Sequence(children)=>for child in children{let dependency=self.effect_for(instance,*child)?;self.dependency(node,dependency)?;},
            EffectTerm::Conditional {condition,branches,active}=>{
                let condition=self.effect_for(instance,*condition)?;self.dependency(node,condition)?;
                for (branch,active) in branches.iter().zip(active){if *active{let dependency=self.effect_for(instance,*branch)?;self.dependency(node,dependency)?;}}
            },
            EffectTerm::Read(binding)|EffectTerm::Write(binding)=>{
                let mut summary=Self::need_summary(source,"NeedsLocalStateProjection");
                let owner=self.retained_location(instance,*binding).map_or(instance,|location|location.owner);
                summary.internal.insert(StorageAccess {binding:*binding,instance:owner,write:matches!(equation.term,EffectTerm::Write(_))});self.effects[node].seed=summary;
            },
            EffectTerm::Call(call)=>{
                if let Some(job)=self.call_map.get(&(instance,*call)).copied(){self.dependency(node,self.calls[job].effect)?;}
                else{self.effects[node].seed=Self::need_summary(source,"NeedsCallableEffectContract");}
            },
            EffectTerm::Try {body,handler,qualification}=>{
                let body=self.effect_for(instance,*body)?;let handler=self.effect_for(instance,*handler)?;
                self.dependency(node,body)?;self.dependency(node,handler)?;self.effects[node].seed=Self::need_summary(source,qualification);
            },
            EffectTerm::Loop {condition,body,body_active,..}=>{
                let condition=self.effect_for(instance,*condition)?;self.dependency(node,condition)?;
                if *body_active{let body=self.effect_for(instance,*body)?;self.dependency(node,body)?;}
            },
            EffectTerm::Unqualified {code,children}=>{
                for child in children{let child=self.effect_for(instance,*child)?;self.dependency(node,child)?;}
                if *code=="NeedsCaptureEvaluation" {
                    if let Some(value)=self.occurrences.get(&(instance,source)).copied(){self.solver.charge(96)?;self.capture_checks.push(CaptureCheck {source,value,effect:node});}
                    else{self.effects[node].seed=Self::need_summary(source,"NeedsCaptureEnvironment");}
                }else{self.effects[node].seed=Self::need_summary(source,code);}
            },
        }
        Ok(node)
    }
    fn read_row(&mut self,row:Option<&EffectRow>,source:SourceId,source_members:bool)->Result<EffectSummary> {
        let mut result=EffectSummary::bottom();let Some(row)=row else{return Ok(result);};
        if row.tail.is_some(){self.solver.charge(96)?;result.state=EffectState::Unknown;result.needs.insert(EffectNeed {source,code:"NeedsOpenEffectRow"});}
        for atom in &row.members {
            self.solver.work(1)?;self.solver.charge(256)?;
            let mut qualified=true;
            let key=match atom {
                EffectAtom::Declaration(_)=>{result.needs.insert(EffectNeed {source,code:"NeedsNominalEffectInterpretation"});None},
                EffectAtom::Structured {class,port,resource,scope_ref,error}=>{
                    if class!="raise"&&error.is_some(){
                        self.problem(source,"InvalidEffectAtom","Only raise atoms may carry an error type")?;
                        result.state=EffectState::Rejected;None
                    }else if class=="raise"{result.needs.insert(EffectNeed {source,code:"NeedsManagedErrorProfile"});None}
                    else if scope_ref.is_some(){result.needs.insert(EffectNeed {source,code:"NeedsEffectScopeIdentity"});None}
                    else if port.as_ref().is_some_and(|reference|reference.declaration.is_none())||resource.as_ref().is_some_and(|reference|reference.declaration.is_none()) {
                        result.needs.insert(EffectNeed {source,code:"NeedsEffectQualifierIdentity"});None
                    }else {
                        if port.is_some()||resource.is_some(){qualified=false;result.needs.insert(EffectNeed {source,code:"NeedsEffectQualifierInterpretation"});}
                        self.solver.charge(class.len()*6+128)?;
                        Some(EffectKey {class:class.clone(),port:port.as_ref().and_then(|reference|reference.declaration),resource:resource.as_ref().and_then(|reference|reference.declaration),scope:None})
                    }
                },
            };
            if let Some(key)=key {
                if source_members&&qualified&&result.may.contains(&key) {
                    self.problem(source,"DuplicateEffectAtom","Repeated semantic atom in one source effect member table")?;
                    result.state=EffectState::Rejected;
                }
                self.solver.charge(192+key.class.len()*6)?;result.may.insert(key);
            }
        }
        if !result.needs.is_empty()&&result.state!=EffectState::Rejected{result.state=EffectState::Unknown;}Ok(result)
    }
    fn function_bound(&mut self,ty:TypeId,source:SourceId,source_members:bool)->Result<EffectSummary> {
        let ty=self.solver.normalize(ty,source)?;
        match self.solver.copy_type(ty)? {
            SemanticType::Function(function) if !function.pending_effects=>self.read_row(function.effects.as_ref(),source,source_members),
            _=>Ok(Self::need_summary(source,"NeedsFunctionEffectBound")),
        }
    }
    fn process_calls(&mut self)->Result<bool> {
        let mut progress=false;
        while let Some(job)=self.call_queue.pop_front() {
            self.queued_calls.remove(&job);self.solver.work(1)?;
            let exposed=self.exposed_positions(job)?;
            let callee=self.calls[job].callee;
            let cost=self.values[callee.0].terms.iter().map(term_cost).sum::<usize>();self.solver.charge(cost+128)?;
            let terms=self.values[callee.0].terms.iter().cloned().collect::<Vec<_>>();
            for term in terms {
                match term {
                    ValueTerm::Closure(closure)=>{
                        self.solver.charge(self.calls[job].arguments.len()*32)?;
                        let arguments=self.calls[job].arguments.clone();let mut canonical=Vec::new();
                        for argument in arguments{canonical.push(self.canonical_value(argument,&mut BTreeSet::new())?);}
                        let world=self.calls[job].world;self.solver.charge(self.calls[job].context.len()*32)?;
                        let context=self.calls[job].context.clone();
                        let instance=self.instance(closure,canonical,world,self.calls[job].input_state,context)?;
                        if !self.calls[job].targets.contains(&instance) {
                            self.solver.charge(96)?;self.calls[job].targets.insert(instance);self.alias(self.calls[job].result,self.instances[instance.0].result)?;
                            self.state_input(self.calls[job].output_state,self.instances[instance.0].output_state)?;
                            self.dependency(self.calls[job].effect,self.instances[instance.0].effect)?;progress=true;
                        }
                    },
                    ValueTerm::Contract {origin,ty,source}=>{
                        self.calls[job].opaque=true;
                        let mut bound=self.function_bound(ty,source,false)?;
                        if bound.state==EffectState::BodyDerived{bound.state=EffectState::ConservativeBound;}
                        self.merge_seed(self.calls[job].effect,&bound)?;
                        let ty=self.solver.normalize(ty,source)?;
                        if let SemanticType::Function(function)=self.solver.arena().get(ty) {
                            let returns=function.returns;
                            let value=self.input_value(origin,returns,source)?;self.alias(self.calls[job].result,value)?;
                        }
                    },
                    ValueTerm::Unknown(need)=>{self.calls[job].opaque=true;self.merge_seed(self.calls[job].effect,&Self::need_summary(need.source,need.code))?;},
                    _=>{},
                }
            }
            if self.calls[job].opaque {
                self.solver.charge(exposed.len()*96)?;self.calls[job].exposed.extend(exposed);
                self.state_input(self.calls[job].output_state,self.calls[job].input_state)?;
                self.state_changed(self.calls[job].output_state)?;
            }
        }
        Ok(progress)
    }
    fn exposed_positions(&mut self,job:usize)->Result<BTreeSet<Location>> {
        self.solver.charge(self.calls[job].arguments.len()*32+128)?;
        let mut stack=self.calls[job].arguments.clone();let mut seen=BTreeSet::new();let mut locations=BTreeSet::new();
        while let Some(value)=stack.pop() {
            self.solver.work(1)?;if !seen.insert(value){continue;}
            self.solver.charge(128)?;
            if !self.reverse_calls.get(&value).is_some_and(|jobs|jobs.contains(&job)) {
                self.solver.charge(192)?;self.reverse_calls.entry(value).or_default().insert(job);
            }
            self.solver.charge(self.values[value.0].terms.iter().map(term_cost).sum::<usize>())?;
            let terms=self.values[value.0].terms.iter().cloned().collect::<Vec<_>>();
            for term in terms {
                match term {
                    ValueTerm::Location {binding,instance,contents}=>{
                        let location=Location {owner:instance,binding};self.solver.charge(128)?;locations.insert(location);
                        stack.push(self.state_value_with_default(self.calls[job].input_state,location,Some(contents))?);
                    },
                    ValueTerm::Closure(closure)=>{self.solver.charge(self.closures[closure.0].key.environment.len()*32)?;stack.extend(self.closures[closure.0].key.environment.iter().map(|(_,value)|*value));},
                    ValueTerm::Record(fields)=>{self.solver.charge(fields.len()*32)?;stack.extend(fields.into_iter().map(|(_,value)|value));},
                    ValueTerm::List {items,tail,element}=>{self.solver.charge((items.len()+2)*32)?;stack.extend(items);stack.extend(tail);stack.extend(element);},
                    ValueTerm::Variant {payload,..}=>{self.solver.charge(32)?;stack.push(payload);},_=>{},
                }
            }
        }
        Ok(locations)
    }
    fn process_obligations(&mut self)->Result<()> {
        while let Some(index)=self.obligation_queue.pop_front() {
            self.queued_obligations.remove(&index);self.solver.work(1)?;
            let value=self.obligations[index].value;
            self.solver.charge(self.values[value.0].terms.len()*32)?;
            let closures=self.values[value.0].terms.iter().filter_map(|term|match term{ValueTerm::Closure(id)=>Some(*id),_=>None}).collect::<Vec<_>>();
            for closure in closures {
                let general=self.general_instance(closure)?;
                let code=self.closures[closure.0].key.code;self.solver.charge(self.templates[code].parameters.len()*32)?;
                let parameters=self.templates[code].parameters.clone();let mut arguments=Vec::new();
                for (binding,ty) in parameters{arguments.push(self.parameter_value(binding,ty,self.templates[code].source)?);}
                if self.templates[code].constructor.is_some(){
                    // Constructor general instances have already retained the
                    // typed abstract payload without an authored binding.
                    if let SemanticType::Function(function)=self.solver.copy_type(self.templates[code].ty)? {
                        for argument in function.parameters{if let SemanticArgument::Type(ty)=argument{arguments.push(self.input_value(InputOrigin::Constructor(self.templates[code].source),ty,self.templates[code].source)?);}}
                    }
                }
                let _=general;
                let instance=self.instance(closure,arguments,self.obligations[index].world,self.obligations[index].state,Vec::new())?;
                if !self.obligations[index].instances.contains(&instance){self.solver.charge(96)?;self.obligations[index].instances.insert(instance);}
            }
        }
        Ok(())
    }
    fn merge_seed(&mut self,node:usize,summary:&EffectSummary)->Result<()> {
        self.solver.charge(summary_cost(summary))?;merge_summary(&mut self.effects[node].seed,summary);Ok(())
    }
    fn canonical_value(&mut self,value:ValueId,active:&mut BTreeSet<ValueId>)->Result<ValueId> {
        self.solver.work(1)?;
        if active.len()>192{return Err(fail("ResourceLimit","","Effect value canonicalization depth exceeded"));}
        if self.values[value.0].terms.is_empty()||!active.insert(value){return Ok(value);}
        let cost=self.values[value.0].terms.iter().map(term_cost).sum::<usize>();self.solver.charge(cost+128)?;
        let terms=self.values[value.0].terms.iter().cloned().collect::<Vec<_>>();let mut normalized=BTreeSet::new();
        for term in terms {
            let term=match term {
                ValueTerm::Record(fields)=>{
                    let mut result=Vec::new();for(name,child)in fields{result.push((name,self.canonical_value(child,active)?));}ValueTerm::Record(result)
                },
                ValueTerm::List {items,tail,element}=>{
                    let mut result=Vec::new();for child in items{result.push(self.canonical_value(child,active)?);}
                    let tail=match tail{Some(child)=>Some(self.canonical_value(child,active)?),None=>None};
                    let element=match element{Some(child)=>Some(self.canonical_value(child,active)?),None=>None};
                    ValueTerm::List {items:result,tail,element}
                },
                ValueTerm::Variant {name,payload}=>ValueTerm::Variant {name,payload:self.canonical_value(payload,active)?},other=>other,
            };
            normalized.insert(term);
        }
        self.solver.charge(normalized.iter().map(term_cost).sum::<usize>()+128)?;
        let key=normalized.into_iter().collect::<Vec<_>>();
        let direct=if key.len()==1 {match &key[0] {
            ValueTerm::Data=>Some(self.plain),ValueTerm::Closure(closure)=>Some(self.closures[closure.0].value),
            ValueTerm::Contract {origin,ty,source}=>Some(self.input_value(origin.clone(),*ty,*source)?),_=>None,
        }}else{None};
        let result=if let Some(result)=direct{result}else if let Some(result)=self.canonical_values.get(&key){*result}else {
            let result=self.slot()?;self.solver.charge(key.iter().map(term_cost).sum::<usize>()+self.values[value.0].guards.len()*96+128)?;
            self.values[result.0].terms.extend(key.iter().cloned());self.values[result.0].provided=self.values[value.0].provided;
            self.values[result.0].guards=self.values[value.0].guards.clone();self.values[result.0].source=self.values[value.0].source;
            self.canonical_values.insert(key,result);result
        };
        active.remove(&value);Ok(result)
    }
    fn settle(&mut self)->Result<()> {
        loop {
            while let Some(instance)=self.build_queue.pop_front(){self.build_instance(instance)?;}
            self.process_states()?;
            let values=self.propagate_values()?;let calls=self.process_calls()?;
            self.process_obligations()?;
            if self.build_queue.is_empty()&&self.value_queue.is_empty()&&self.call_queue.is_empty()&&self.state_queue.is_empty()&&self.query_queue.is_empty()&&self.obligation_queue.is_empty()&&!values&&!calls{break;}
        }
        Ok(())
    }
    fn materialize(&mut self)->Result<()> {
        self.settle()?;
        // Empty value cycles have no initialized value witness. They never
        // acquire a callable origin merely because the effect domain has bottom.
        for index in 0..self.values.len() {
            if self.values[index].terms.is_empty(){
                let Some(source)=self.values[index].source else{continue;};
                self.solver.charge(192)?;self.values[index].terms.insert(ValueTerm::Unknown(EffectNeed {source,code:"NeedsFunctionValueOrigin"}));
                self.solver.charge(self.reverse.get(&ValueId(index)).map_or(0,BTreeSet::len)*32)?;
                let consumers=self.reverse.get(&ValueId(index)).map_or(Vec::new(),|consumers|consumers.iter().copied().collect());
                for consumer in consumers{self.enqueue_transfer(consumer)?;}
            }
        }
        self.settle()?;Ok(())
    }
    fn ready_values(&mut self)->Result<Vec<bool>> {
        self.solver.charge(self.values.len()*128)?;
        let mut dependencies=Vec::new();let mut reverse=vec![Vec::new();self.values.len()];let mut impossible=Vec::new();
        for (index,slot) in self.values.iter().enumerate() {
            let edges=slot.terms.iter().map(|term|match term {
                ValueTerm::Closure(closure)=>self.closures[closure.0].strict.len()+self.closures[closure.0].key.environment.len(),
                ValueTerm::Record(fields)=>fields.len(),ValueTerm::List {items,tail,element}=>items.len()+usize::from(tail.is_some())+usize::from(element.is_some()),
                ValueTerm::Variant {..}=>1,_=>0}).sum::<usize>();
            self.solver.work(slot.terms.len()+1)?;self.solver.charge((slot.guards.len()+edges)*96+128)?;
            let mut required=slot.guards.clone();let mut blocked=slot.terms.is_empty();
            for term in &slot.terms {
                match term {
                    ValueTerm::Unknown(_)=>blocked=true,
                    ValueTerm::Closure(closure)=>{
                        required.extend(self.closures[closure.0].strict.iter().copied());required.extend(self.closures[closure.0].key.environment.iter().map(|(_,value)|*value));
                    },
                    ValueTerm::Record(fields)=>required.extend(fields.iter().map(|(_,value)|*value)),
                    ValueTerm::List {items,tail,element}=>{required.extend(items);required.extend(tail);required.extend(element);},
                    ValueTerm::Variant {payload,..}=>{required.insert(*payload);},_=>{},
                }
            }
            if slot.provided{blocked=false;required.clear();}
            self.solver.charge(required.len()*96+128)?;
            for dependency in &required{reverse[dependency.0].push(index);}
            dependencies.push(required.len());impossible.push(blocked);
        }
        let mut ready=vec![false;self.values.len()];let mut queue=VecDeque::new();
        for index in 0..ready.len(){if dependencies[index]==0&&!impossible[index]{queue.push_back(index);}}
        while let Some(index)=queue.pop_front(){self.solver.work(1)?;if ready[index]{continue;}ready[index]=true;
            for consumer in &reverse[index]{dependencies[*consumer]-=1;if dependencies[*consumer]==0&&!impossible[*consumer]{queue.push_back(*consumer);}}
        }
        Ok(ready)
    }
    fn passive_value(&mut self,value:ValueId,ready:&[bool])->Result<bool> {
        if !ready[value.0]{return Ok(false);}
        self.solver.charge(self.values.len()*8+128)?;let mut seen=BTreeSet::new();let mut stack=vec![value];
        while let Some(value)=stack.pop(){self.solver.work(1)?;if !seen.insert(value){continue;}
            for term in &self.values[value.0].terms {
                match term {
                    ValueTerm::Unknown(_)=>return Ok(false),
                    ValueTerm::Record(fields)=>stack.extend(fields.iter().map(|(_,value)|*value)),
                    ValueTerm::List {items,tail,element}=>{stack.extend(items);stack.extend(tail);stack.extend(element);},
                    ValueTerm::Variant {payload,..}=>stack.push(*payload),_=>{},
                }
            }
        }
        Ok(true)
    }
    fn freeze_inputs(&mut self,ready:&[bool])->Result<()> {
        for index in 0..self.calls.len() {
            if !ready[self.calls[index].callee.0]||self.calls[index].arguments.iter().any(|argument|!ready[argument.0]) {
                let source=self.bodies.calls[self.calls[index].call].source;
                let strict=self.values[self.calls[index].callee.0].terms.iter().any(|term|matches!(term,ValueTerm::Closure(closure) if !self.closures[closure.0].strict.is_empty()));
                self.merge_seed(self.calls[index].effect,&Self::need_summary(source,if strict{"NeedsStrictValueInitialization"}else{"NeedsFunctionValueOrigin"}))?;
            }
        }
        for index in 0..self.capture_checks.len() {
            let check=&self.capture_checks[index];let (source,value,effect)=(check.source,check.value,check.effect);
            if !self.passive_value(value,ready)?{self.merge_seed(effect,&Self::need_summary(source,"NeedsCaptureEvaluation"))?;}
        }
        Ok(())
    }
    fn solve_effects(&mut self)->Result<()> {
        let count=self.effects.len();self.solver.charge(count*256)?;
        let mut reverse=vec![Vec::new();count];
        for (node,effect) in self.effects.iter().enumerate(){for dependency in &effect.dependencies{self.solver.work(1)?;self.solver.charge(32)?;reverse[*dependency].push(node);}}
        let mut visited=BTreeSet::new();let mut order=Vec::new();
        for root in 0..count {
            let mut stack=vec![(root,false)];
            while let Some((node,exit))=stack.pop(){self.solver.work(1)?;if exit{order.push(node);continue;}if !visited.insert(node){continue;}
                self.solver.charge(self.effects[node].dependencies.len()*32+64)?;stack.push((node,true));for dependency in &self.effects[node].dependencies{stack.push((*dependency,false));}}
        }
        visited.clear();let mut components=Vec::new();let mut component_of=vec![0;count];
        for root in order.into_iter().rev(){if visited.contains(&root){continue;}let mut component=Vec::new();let mut stack=vec![root];
            while let Some(node)=stack.pop(){self.solver.work(1)?;if !visited.insert(node){continue;}component_of[node]=components.len();component.push(node);stack.extend(&reverse[node]);}
            components.push(component);
        }
        // SCCs identify recursion. The reverse worklist propagates only actual
        // growth, starting every current-generation variable at bottom.
        let mut queue=VecDeque::new();let mut queued=vec![false;count];
        for component in components.iter().rev(){for node in component{queue.push_back(*node);queued[*node]=true;}}
        while let Some(node)=queue.pop_front(){queued[node]=false;self.solver.work(1)?;
            self.solver.charge(summary_cost(&self.effects[node].seed))?;let mut value=self.effects[node].seed.clone();
            for dependency in &self.effects[node].dependencies {self.solver.charge(summary_cost(&self.effects[*dependency].result))?;merge_summary(&mut value,&self.effects[*dependency].result);}
            if merge_summary(&mut self.effects[node].result,&value){for consumer in &reverse[node]{if !queued[*consumer]{self.solver.charge(32)?;queue.push_back(*consumer);queued[*consumer]=true;}}}
        }
        Ok(())
    }
    fn latent_value(&mut self,value:ValueId,source:SourceId,ready:&[bool])->Result<EffectSummary> {
        self.latent_value_context(value,source,ready,None)
    }
    fn latent_value_context(&mut self,value:ValueId,source:SourceId,ready:&[bool],contexts:Option<&BTreeSet<InstanceId>>)->Result<EffectSummary> {
        if !ready[value.0]{return Ok(Self::need_summary(source,"NeedsFunctionValueOrigin"));}
        let cost=self.values[value.0].terms.iter().map(term_cost).sum::<usize>();self.solver.charge(cost+128)?;
        let terms=self.values[value.0].terms.iter().cloned().collect::<Vec<_>>();let mut result=EffectSummary::bottom();let mut callable=false;
        for term in terms {
            match term {
                ValueTerm::Closure(closure)=>{
                    callable=true;
                    let instances=contexts.or_else(||self.closure_instances.get(&closure));let mut found=false;
                    if let Some(instances)=instances{for instance in instances {
                        self.solver.work(1)?;if self.instances[instance.0].closure!=Some(closure){continue;}found=true;
                        let summary=&self.effects[self.instances[instance.0].effect].result;self.solver.charge(summary_cost(summary))?;merge_summary(&mut result,summary);
                    }}
                    if !found{merge_summary(&mut result,&Self::need_summary(source,"NeedsFunctionEffectBound"));}
                    if self.rejected_closures.contains(&closure){result.state=EffectState::Rejected;}
                },
                ValueTerm::Contract {ty,source,..}=>{
                    callable=true;let mut summary=self.function_bound(ty,source,false)?;
                    if summary.state==EffectState::BodyDerived{summary.state=EffectState::ConservativeBound;}merge_summary(&mut result,&summary);
                },
                ValueTerm::Unknown(need)=>{merge_summary(&mut result,&Self::need_summary(need.source,need.code));},
                _=>{merge_summary(&mut result,&Self::need_summary(source,"NeedsFunctionValueOrigin"));},
            }
        }
        if !callable{merge_summary(&mut result,&Self::need_summary(source,"NeedsFunctionValueOrigin"));}Ok(result)
    }
    fn check_bound(&mut self,actual:&EffectSummary,bound:&EffectSummary,source:SourceId)->Result<()> {
        for need in actual.needs.iter().chain(&bound.needs){record_effect_need(self.solver,&mut self.needs,need.clone())?;}
        if actual.state==EffectState::Rejected||bound.state==EffectState::Rejected{return Ok(());}
        if actual.state==EffectState::Unknown||bound.state==EffectState::Unknown {
            record_effect_need(self.solver,&mut self.needs,EffectNeed {source,code:"NeedsEffectBoundComparison"})?;
            // Unprojected local accesses add uncertainty. They do not erase
            // independently closed atoms already known to violate a bound.
            if bound.state==EffectState::Unknown||actual.needs.iter().any(|need|need.code!="NeedsLocalStateProjection"){return Ok(());}
        }
        for atom in &actual.may {
            let covered=bound.may.iter().any(|upper|upper.class==atom.class&&upper.port.is_none_or(|port|atom.port==Some(port))&&
                upper.resource.is_none_or(|resource|atom.resource==Some(resource))&&upper.scope.as_ref().is_none_or(|_|upper.scope==atom.scope));
            if !covered {
                self.problem(source,"EffectUpperBoundExceeded","Closed latent effects exceed the required effect upper bound")?;break;
            }
        }
        Ok(())
    }
    fn check_obligations(&mut self,ready:&[bool])->Result<()> {
        self.solver.charge(self.solver.arena().occurrences.len()*32)?;
        let occurrences=self.solver.arena().occurrences.iter().map(|occurrence|(occurrence.source,occurrence.ty)).collect::<Vec<_>>();
        for (source,ty) in occurrences {
            if matches!(self.solver.arena().get(ty),SemanticType::Function(_)){
                let bound=self.function_bound(ty,source,true)?;
                for need in bound.needs{record_effect_need(self.solver,&mut self.needs,need)?;}
            }
        }
        for index in 0..self.templates.len() {
            let (source,ty)=(self.templates[index].bound_source,self.templates[index].ty);
            let function=self.solver.copy_type(ty)?;
            if let SemanticType::Function(function)=function {
                if !function.pending_effects {
                    let bound=self.read_row(function.effects.as_ref(),source,true)?;
                    for closure in 0..self.closures.len() {
                        self.solver.work(1)?;
                        if self.closures[closure].key.code!=index{continue;}
                        let value=self.closures[closure].value;let actual=self.latent_value(value,source,ready)?;let before=self.problems.len();
                        self.check_bound(&actual,&bound,source)?;
                        if bound.state==EffectState::Rejected||self.problems.len()>before{self.solver.charge(64)?;self.rejected_closures.insert(ClosureId(closure));}
                    }
                }
            }
        }
        for index in 0..self.obligations.len() {
            let obligation=&self.obligations[index];let (source,value,expected)=(obligation.source,obligation.value,obligation.expected);
            self.solver.charge(obligation.instances.len()*96)?;let contexts=obligation.instances.clone();
            let actual=self.latent_value_context(value,source,ready,Some(&contexts))?;let bound=self.function_bound(expected,source,false)?;self.check_bound(&actual,&bound,source)?;
        }
        Ok(())
    }
    fn output(mut self,ready:&[bool])->Result<EffectSummarySet> {
        self.check_obligations(ready)?;let mut result=EffectSummarySet::default();
        for index in 0..self.closures.len() {
            self.solver.work(1)?;
            let closure=&self.closures[index];let code=closure.key.code;let value=closure.value;
            let summary=self.latent_value(value,self.templates[code].source,ready)?;
            self.solver.charge(summary_cost(&summary)+self.closures[index].key.environment.len()*96+192)?;
            result.closures.push(ClosureSummary {code:self.templates[code].identity.clone(),environment:self.closures[index].key.environment.clone(),latent:summary,ready:ready[value.0]});
        }
        for (declaration,instance) in &self.declaration_roots {
            self.solver.work(1)?;
            self.solver.charge(summary_cost(&self.effects[self.instances[instance.0].effect].result))?;
            let mut summary=self.effects[self.instances[instance.0].effect].result.clone();
            if let Some(value)=self.constants.get(declaration){if !ready[value.0]{merge_summary(&mut summary,&Self::need_summary(self.headers[self.declaration_headers[declaration]].source,"NeedsStrictValueInitialization"));}}
            for need in &summary.needs{record_effect_need(self.solver,&mut self.needs,need.clone())?;}
            self.solver.charge(128)?;
            result.declarations.insert(*declaration,summary);
            let source=self.headers[self.declaration_headers[declaration]].source;record_consumed(self.solver,&mut result.consumed,source,"NeedsEffectClosure")?;
        }
        for ((instance,source),value) in &self.occurrences {
            self.solver.work(1)?;
            self.solver.charge(self.values[value.0].terms.len()*32+192)?;
            let closures=self.values[value.0].terms.iter().filter_map(|term|match term{ValueTerm::Closure(closure)=>Some(*closure),_=>None}).collect::<Vec<_>>();
            result.values.insert((*instance,*source),closures);
        }
        for (instance,context) in self.instances.iter().enumerate() {
            for index in context.memo.keys() {
                self.solver.work(1)?;
                let summary=&self.bodies.expressions[*index];
                if let Some(node)=self.effect_map.get(&(InstanceId(instance),summary.immediate.0)) {
                    let effect=&self.effects[*node].result;self.solver.charge(summary_cost(effect)+128)?;
                    result.expressions.insert((InstanceId(instance),summary.source),effect.clone());
                }
                if summary.latent.is_some(){record_consumed(self.solver,&mut result.consumed,summary.source,"NeedsLambdaCaptureAndEffectAnalysis")?;}
            }
        }
        for check in &self.capture_checks {
            self.solver.work(1)?;
            if self.effects[check.effect].result.state!=EffectState::Unknown {record_consumed(self.solver,&mut result.consumed,check.source,"NeedsCaptureEvaluation")?;}
        }
        for obligation in &self.obligations {
            record_consumed(self.solver,&mut result.consumed,obligation.source,"NeedsEffectClosure")?;
            record_consumed(self.solver,&mut result.consumed,obligation.source,"NeedsEffectRowRelation")?;
        }
        for problem in &self.problems {
            self.solver.work(1)?;
            if let Some(owner)=self.solver.arena().source(problem.source).owner {
                if let Some(summary)=result.declarations.get_mut(&owner){summary.state=EffectState::Rejected;}
            }
        }
        for node in &self.effects {
            self.solver.work(1)?;for need in &node.result.needs{record_effect_need(self.solver,&mut self.needs,need.clone())?;}
        }
        self.solver.work(self.needs.len())?;self.solver.charge(self.needs.len()*96)?;
        result.needs=self.needs.into_iter().collect();result.problems=self.problems;Ok(result)
    }
}

fn record_effect_need(solver:&mut ConstraintMachine<'_>,needs:&mut BTreeSet<EffectNeed>,need:EffectNeed)->Result<()> {
    solver.work(1+4*(needs.len()+1).ilog2() as usize)?;
    if !needs.contains(&need){solver.charge(96)?;needs.insert(need);}Ok(())
}
fn record_consumed(solver:&mut ConstraintMachine<'_>,consumed:&mut BTreeSet<(SourceId,&'static str)>,source:SourceId,code:&'static str)->Result<()> {
    solver.work(1+4*(consumed.len()+1).ilog2() as usize)?;
    if !consumed.contains(&(source,code)){solver.charge(96)?;consumed.insert((source,code));}Ok(())
}

fn merge_summary(target:&mut EffectSummary,source:&EffectSummary)->bool {
    let before=(target.may.len(),target.internal.len(),target.needs.len(),target.state);
    target.may.extend(source.may.iter().cloned());target.internal.extend(source.internal.iter().cloned());target.needs.extend(source.needs.iter().cloned());
    target.state=if target.state==EffectState::Rejected||source.state==EffectState::Rejected{EffectState::Rejected}
        else if target.state==EffectState::Unknown||source.state==EffectState::Unknown||!target.needs.is_empty(){EffectState::Unknown}
        else if target.state==EffectState::ConservativeBound||source.state==EffectState::ConservativeBound{EffectState::ConservativeBound}else{EffectState::BodyDerived};
    before!=(target.may.len(),target.internal.len(),target.needs.len(),target.state)
}

pub(crate) fn close<'a>(names:&'a NameAnalysis,headers:&'a [HeaderSeed],signatures:&'a [Signature],bodies:&'a BodyAnalysis,
    qualifications:&[crate::type_constraints::ConstraintNeed],solver:&mut ConstraintMachine<'a>)->Result<EffectSummarySet> {
    let mut driver=Driver::new(names,headers,signatures,bodies,solver)?;driver.prepare()?;
    for need in qualifications {
        driver.solver.work(1)?;
        if need.code!="NeedsNestedFunctionCompatibility"{continue;}
        record_effect_need(driver.solver,&mut driver.needs,EffectNeed {source:need.source,code:need.code})?;
        if let Some(owner)=driver.solver.arena().source(need.source).owner {
            if let Some(instance)=driver.declaration_roots.get(&owner).copied(){
                driver.merge_seed(driver.instances[instance.0].effect,&Driver::need_summary(need.source,need.code))?;
            }
        }
    }
    driver.materialize()?;
    let ready=driver.ready_values()?;driver.freeze_inputs(&ready)?;driver.solve_effects()?;driver.output(&ready)
}
