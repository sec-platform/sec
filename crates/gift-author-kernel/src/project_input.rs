//! Pure preparation over fixed source and append-only capture observations.
//! The host owns physical acquisition. This module owns scope selection and
//! actual module/import preparation, using the original Reader and arenas.
use std::collections::{BTreeMap,BTreeSet,VecDeque};
use serde::{Serialize,Deserialize};
use crate::{binding::{Budget,ImportBinding},captured_input::{BindingLocation,CapturedSourceInfo,FixedContext,ModuleCapture,ModuleUse,PreparationNeed,PreparedInput},
    model::{Diagnostic,fail},reader::{self,DecodedSource},source::Node};

type Result<T> = std::result::Result<T,Diagnostic>;
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum CaptureOutcome {Complete,Found,Partial,Absent,Denied,Unavailable,Failed}
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum EntryKind {File,Directory,Link,Other}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DirectoryEntry {pub name:String,pub kind:EntryKind,pub byte_length:u64}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum CaptureObservation {
    Directory {path:String,outcome:CaptureOutcome,entries:Vec<DirectoryEntry>},
    File {path:String,outcome:CaptureOutcome,bytes:Vec<u8>},
}

/// Private native transport limits are separate from author source limits.
pub const MAX_REQUEST_BYTES:usize=64*1024*1024;
pub const MAX_RESULT_BYTES:usize=64*1024*1024;
#[derive(Clone,Copy,Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeBudget {pub work:usize,pub allocation_bytes:usize}
impl Default for NativeBudget {fn default()->Self {Self {work:8_000_000,allocation_bytes:48*1024*1024}}}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeRequest<'a> {
    schema:&'a str,purpose:&'a str,
    #[serde(borrow)] root:&'a serde_json::value::RawValue,
    #[serde(borrow)] context:&'a serde_json::value::RawValue,
    interpretation:Option<&'a str>,
    #[serde(borrow)] observations:&'a serde_json::value::RawValue,
    #[serde(default)] budget:NativeBudget,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeRoot {locator:String,bytes:Vec<u8>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeContext {project_instance:String,resolution_domain:String}
#[derive(Serialize)]
struct NativeBudgetReport {requested:NativeBudget,remaining:NativeBudget,consumed:NativeBudget}
#[derive(Serialize)]
struct ModuleReport {id:usize,locator:String,module_use:ModuleUse,source_revision:String}
#[derive(Serialize)]
struct SourceReport<'a> {id:usize,module:usize,owner:Option<usize>,path:&'a str,origin:Option<&'a crate::source::Origin>}
#[derive(Serialize)]
struct SignatureReport {declaration:usize,ty:Option<usize>,state:&'static str,body_type_checked:bool}
#[derive(Serialize)]
struct BodyReport {source:usize,state:&'static str,normal:&'static str,ty:Option<usize>}
#[derive(Serialize)]
struct NeedReport<'a> {source:usize,code:&'a str}
#[derive(Serialize)]
struct SourceProblemReport<'a> {source:usize,diagnostic:&'a Diagnostic}
#[derive(Serialize)]
struct SignatureProblemReport<'a> {declaration:usize,diagnostic:&'a Diagnostic}
#[derive(Serialize)]
struct AtomReport<'a> {class:&'a str,port:Option<usize>,resource:Option<usize>,scope:Option<&'a str>}
#[derive(Serialize)]
struct AccessReport {binding:usize,instance:usize,write:bool}
#[derive(Serialize)]
struct EffectReport<'a> {declaration:usize,state:&'static str,may:Vec<AtomReport<'a>>,internal:Vec<AccessReport>,needs:Vec<NeedReport<'a>>}
#[derive(Serialize)]
struct EffectsReport<'a> {declarations:Vec<EffectReport<'a>>,needs:Vec<NeedReport<'a>>,problems:Vec<SourceProblemReport<'a>>}
#[derive(Serialize)]
struct AnalysisReport<'a> {
    input_basis:&'a str,names:&'a crate::binding::NameAnalysis,type_count:usize,sources:Vec<SourceReport<'a>>,
    signatures:Vec<SignatureReport>,bodies:Vec<BodyReport>,effects:EffectsReport<'a>,needs:Vec<NeedReport<'a>>,
    problems:Vec<SignatureProblemReport<'a>>,body_problems:Vec<SourceProblemReport<'a>>,
}
#[derive(Serialize)]
struct NativeResult<'a> {
    schema:&'static str,purpose:&'static str,state:PreparationState,basis:&'a str,interpretation:&'static str,
    requests:&'a [CaptureRequest],needs:&'a [PreparationNeed],sources:&'a [CapturedSourceInfo],module_uses:&'a [ModuleUse],
    modules:Vec<ModuleReport>,analysis:Option<AnalysisReport<'a>>,budget:NativeBudgetReport,
}
fn report_analysis<'a>(result:&'a crate::signature_resolution::SignatureResolution,budget:&mut Budget)->Result<AnalysisReport<'a>> {
    use crate::{body_analysis::{NormalResult,BodyState},signature_resolution::SignatureState,effect_analysis::EffectState};
    let effect_items=result.effects.declarations.values().map(|summary|summary.may.len()+summary.internal.len()+summary.needs.len()).sum::<usize>();
    let count=result.types.sources.len()+result.signatures.len()+result.bodies.expressions.len()+effect_items+result.effects.declarations.len()+result.effects.needs.len()+result.effects.problems.len()+result.needs.len()+result.problems.len()+result.bodies.problems.len();
    budget.work(count)?;budget.charge(count.saturating_mul(256))?;
    let sources=result.types.sources.iter().enumerate().map(|(id,source)|SourceReport {id,module:source.module.index(),owner:source.owner.map(|id|id.index()),path:&source.expanded_path,origin:source.origin.as_ref()}).collect();
    let signatures=result.signatures.iter().map(|signature|SignatureReport {declaration:signature.declaration.index(),ty:signature.ty.map(|id|id.index()),state:match signature.state {SignatureState::TypeReady=>"type_ready",SignatureState::NeedsAnnotation=>"needs_annotation",SignatureState::NeedsInput=>"needs_input",SignatureState::Rejected=>"rejected"},body_type_checked:signature.body_type_checked}).collect();
    let bodies=result.bodies.expressions.iter().map(|body|BodyReport {source:body.source.index(),state:match body.state {BodyState::TypeChecked=>"type_checked",BodyState::Pending=>"pending",BodyState::Rejected=>"rejected"},normal:match body.normal {NormalResult::Value(_)=>"value",NormalResult::NoNormal=>"no_normal",NormalResult::Pending=>"pending"},ty:if let NormalResult::Value(ty)=body.normal{Some(ty.index())}else{None}}).collect();
    let declarations=result.effects.declarations.iter().map(|(id,summary)|EffectReport {declaration:id.index(),state:match summary.state {EffectState::BodyDerived=>"body_derived",EffectState::ConservativeBound=>"conservative_bound",EffectState::Unknown=>"unknown",EffectState::Rejected=>"rejected"},
        may:summary.may.iter().map(|atom|AtomReport {class:&atom.class,port:atom.port.map(|id|id.index()),resource:atom.resource.map(|id|id.index()),scope:atom.scope.as_deref()}).collect(),
        internal:summary.internal.iter().map(|access|AccessReport {binding:access.binding.index(),instance:access.instance.0,write:access.write}).collect(),needs:summary.needs.iter().map(|need|NeedReport {source:need.source.index(),code:need.code}).collect()}).collect();
    Ok(AnalysisReport {input_basis:result.input().basis(),names:&result.names,type_count:result.types.nodes.len(),sources,signatures,bodies,
        effects:EffectsReport {declarations,needs:result.effects.needs.iter().map(|need|NeedReport {source:need.source.index(),code:need.code}).collect(),problems:result.effects.problems.iter().map(|problem|SourceProblemReport {source:problem.source.index(),diagnostic:&problem.diagnostic}).collect()},
        needs:result.needs.iter().map(|need|NeedReport {source:need.source.index(),code:need.code}).collect(),problems:result.problems.iter().map(|problem|SignatureProblemReport {declaration:problem.declaration.index(),diagnostic:&problem.diagnostic}).collect(),body_problems:result.bodies.problems.iter().map(|problem|SourceProblemReport {source:problem.source.index(),diagnostic:&problem.diagnostic}).collect()})
}
struct OutputCounter<'a> {size:usize,budget:&'a mut Budget}
impl std::io::Write for OutputCounter<'_> {
    fn write(&mut self,bytes:&[u8])->std::io::Result<usize> {
        self.budget.work(bytes.len()/16+1).map_err(|error|std::io::Error::other(error.message))?;
        self.size=self.size.checked_add(bytes.len()).filter(|size|*size<=MAX_RESULT_BYTES-512).ok_or_else(||std::io::Error::other("Analysis result exceeds transport limit"))?;Ok(bytes.len())
    }
    fn flush(&mut self)->std::io::Result<()> {Ok(())}
}
/// One native successor consumes the host's remaining original budget. The
/// read-only observer survives every stage and every error without a refill.
pub fn analyze_request(bytes:&[u8])->Result<Vec<u8>> {
    if bytes.len()>MAX_REQUEST_BYTES{return Err(fail("ResourceLimit","","Analysis request exceeds transport limit"));}
    let request:NativeRequest<'_>=serde_json::from_slice(bytes).map_err(|e|fail("InvalidAnalysisRequest","",e.to_string()))?;
    if request.schema!="gift.author-analysis-request/1"||request.purpose!="analyze"{return Err(fail("InvalidAnalysisRequest","","Expected the selected analysis transport/purpose"));}
    let mut budget=Budget::new();budget.tighten(request.budget.work,request.budget.allocation_bytes);let observer=budget.observer();
    let (initial_work,initial_bytes)=observer.remaining();let requested=NativeBudget {work:initial_work,allocation_bytes:initial_bytes};
    // Reserve a bounded terminal report before any stage may exhaust the run.
    let reserve=4096;let mut output_budget;
    let parsed:Result<(NativeRoot,FixedContext,Vec<CaptureObservation>)>=(|| {
        budget.charge(reserve)?;budget.work(32)?;
        budget.work(bytes.len()/16+1)?;budget.charge(bytes.len().saturating_mul(2))?;
        let root:NativeRoot=serde_json::from_str(request.root.get()).map_err(|e|fail("InvalidAnalysisRequest","/root",e.to_string()))?;
        let context:NativeContext=serde_json::from_str(request.context.get()).map_err(|e|fail("InvalidAnalysisRequest","/context",e.to_string()))?;
        let observations:Vec<CaptureObservation>=serde_json::from_str(request.observations.get()).map_err(|e|fail("InvalidAnalysisRequest","/observations",e.to_string()))?;
        let context=FixedContext::new(&context.project_instance,&context.resolution_domain)?;
        if let Some(interpretation)=request.interpretation{context.require_interpretation(interpretation)?;}
        Ok((root,context,observations))
    })();
    let (root,context,observations)=parsed?;
    let mut preparation=Preparation::with_budget(&root.bytes,&root.locator,context,PreparationLimits::default(),budget)?;
    let mut status=preparation.advance(&observations)?;
    if matches!(status.state,PreparationState::Stopped|PreparationState::Conflict) {
        // A failed acquisition may have retained only a compatible prefix.
        // The existing typed failure preserves the reason without presenting
        // that prefix as the host's entire submitted capture catalog.
        let need=status.needs.first().ok_or_else(||fail("ReaderInvariant","","Terminal preparation lost its reason"))?;
        return Err(fail(&need.code,&need.path,&need.message));
    }
    let mut resolution=None;let mut modules=Vec::new();
    if !matches!(status.state,PreparationState::Stopped|PreparationState::Conflict)&&!preparation.modules.is_empty() {
        let analysis=preparation.finish().and_then(crate::signature_resolution::prepare_input).and_then(|prepared|prepared.close_effects_retained(crate::effect_analysis::EffectLimits::default()));
        match analysis {Ok((result,remaining))=>{resolution=Some(result);output_budget=Some(remaining);},Err(error)=>return Err(error)}
    }else{output_budget=Some(preparation.budget);}
    if let (Some(result),Some(budget))=(&resolution,&mut output_budget) {
        let copied_strings=result.input().locators().iter().map(String::len).sum::<usize>()+result.input().module_uses().iter().map(module_use_length).sum::<usize>()*2;
        budget.work(result.input().sources().len()+copied_strings/16)?;budget.charge(result.input().sources().len()*1024+copied_strings*6)?;
        modules=result.input().sources().iter().enumerate().map(|(id,source)|ModuleReport {id,locator:result.input().locators()[id].clone(),module_use:result.input().module_uses()[id].clone(),source_revision:crate::digest(source.bytes())}).collect();
        status.module_uses=result.input().module_uses().to_vec();
    }
    let mut analysis=None;
    if let (Some(result),Some(budget))=(&resolution,&mut output_budget) {
        let projection=(|| {
            report_analysis(result,budget)
        })();
        match projection {Ok(report)=>analysis=Some(report),Err(error)=>{status.state=PreparationState::Stopped;status.needs.push(PreparationNeed::new("",&error.path,&error.code,&error.message));}}
    }
    // Prepared module metadata is still useful in a waiting successor.
    if matches!(status.state,PreparationState::Stopped|PreparationState::Conflict){status.requests.clear();status.module_uses.clear();modules.clear();analysis=None;}
    let (work,allocation_bytes)=observer.remaining();
    let mut result=NativeResult {schema:"gift.author-analysis/1",purpose:"analyze",state:status.state,basis:&status.basis,interpretation:crate::captured_input::current_interpretation(),requests:&status.requests,needs:&status.needs,sources:&status.sources,module_uses:&status.module_uses,modules,analysis,
        budget:NativeBudgetReport {requested,remaining:NativeBudget {work,allocation_bytes},consumed:NativeBudget {work:initial_work-work,allocation_bytes:initial_bytes-allocation_bytes}}};
    if let Some(budget)=&mut output_budget {
        let mut counter=OutputCounter {size:0,budget};serde_json::to_writer(&mut counter,&result).map_err(|e|fail("ResourceLimit","",e.to_string()))?;
        let size=counter.size;budget.work(size/16+1)?;budget.charge((size+512).saturating_mul(2))?;
    }else {
        return Err(fail("ResourceLimit","","Analysis finalization exhausted its retained session budget"));
    }
    let (work,allocation_bytes)=observer.remaining();result.budget.remaining=NativeBudget {work,allocation_bytes};result.budget.consumed=NativeBudget {work:initial_work-work,allocation_bytes:initial_bytes-allocation_bytes};
    serde_json::to_vec(&result).map_err(|e|fail("OutputFailure","",e.to_string()))
}
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum CaptureKind {Directory,File}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureRequest {pub kind:CaptureKind,pub path:String,pub scope_root:String}
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize)]
#[serde(rename_all="snake_case")]
pub enum PreparationState {Prepared,Waiting,Conflict,Stopped}
#[derive(Clone,Debug,Serialize)]
pub struct PreparationStatus {
    pub state:PreparationState,pub basis:String,pub requests:Vec<CaptureRequest>,pub needs:Vec<PreparationNeed>,
    pub sources:Vec<CapturedSourceInfo>,pub module_uses:Vec<ModuleUse>,
}
#[derive(Clone,Copy,Debug)]
pub struct PreparationLimits {pub entries:u64,pub bytes:u64,pub work:usize}
impl Default for PreparationLimits {fn default()->Self {Self {entries:20_000,bytes:32*1024*1024,work:8_000_000}}}
struct Scope {root:String,kind:String,mode:String,includes:Vec<Pattern>,excludes:Vec<Pattern>}
struct Pattern {segments:Vec<String>}
impl Pattern {
    fn parse(text:&str,budget:&mut Budget)->Result<Self> {
        if text.is_empty()||text.starts_with('/')||text.contains('\\')||text.len()>4096{return Err(fail("InvalidSourcePattern","",text));}
        let segments=text.split('/').map(str::to_owned).collect::<Vec<_>>();
        if segments.iter().any(|segment|segment.is_empty()||segment=="."||segment==".."||segment.contains("**")&&segment!="**") {
            return Err(fail("InvalidSourcePattern","",text));
        }
        budget.text(text)?;budget.charge(segments.len()*64)?;Ok(Self {segments})
    }
    fn matches(&self,path:&str,budget:&mut Budget)->Result<bool> {
        let parts=if path.is_empty(){Vec::new()}else{path.split('/').collect::<Vec<_>>()};
        let cells=(self.segments.len()+1).saturating_mul(parts.len()+1);budget.work(cells)?;budget.charge(cells+128)?;
        let mut table=vec![false;cells];let width=parts.len()+1;table[0]=true;
        for (row,segment) in self.segments.iter().enumerate() {
            for column in 0..=parts.len() {
                if segment=="**" {
                    table[(row+1)*width+column]=table[row*width+column]||column>0&&table[(row+1)*width+column-1];
                }else if column>0&&table[row*width+column-1]&&segment_matches(segment,parts[column-1],budget)? {table[(row+1)*width+column]=true;}
            }
        }
        Ok(table[cells-1])
    }
    fn descendant_possible(&self,path:&str,budget:&mut Budget)->Result<bool> {
        let parts=if path.is_empty(){Vec::new()}else{path.split('/').collect::<Vec<_>>()};
        let mut active=BTreeSet::from([0usize]);
        for part in parts {
            let mut next=BTreeSet::new();let mut queue=active.into_iter().collect::<VecDeque<_>>();let mut seen=BTreeSet::new();
            while let Some(index)=queue.pop_front() {
                budget.work(1)?;budget.charge(96)?;if !seen.insert(index){continue;}
                let Some(segment)=self.segments.get(index) else{continue;};
                if segment=="**"{next.insert(index);queue.push_back(index+1);}
                else if segment_matches(segment,part,budget)?{next.insert(index+1);}
            }
            active=next;
        }
        Ok(active.iter().any(|index|*index<self.segments.len()))
    }
    fn covers_descendants(&self,path:&str,budget:&mut Budget)->Result<bool> {
        if self.segments.last().is_none_or(|segment|segment!="**"){return Ok(false);}
        let prefix=Self {segments:self.segments[..self.segments.len()-1].to_vec()};
        budget.charge(self.segments.iter().map(|segment|segment.len()+64).sum())?;
        prefix.matches(path,budget)
    }
}
fn segment_matches(pattern:&str,text:&str,budget:&mut Budget)->Result<bool> {
    budget.charge((pattern.len()+text.len())*4+128)?;
    let pattern=pattern.chars().collect::<Vec<_>>();let text=text.chars().collect::<Vec<_>>();
    let width=text.len()+1;let cells=(pattern.len()+1).saturating_mul(width);budget.work(cells)?;budget.charge(cells+128)?;
    let mut table=vec![false;cells];table[0]=true;
    for (row,token) in pattern.iter().enumerate(){for column in 0..=text.len(){
        table[(row+1)*width+column]=if *token=='*'{table[row*width+column]||column>0&&table[(row+1)*width+column-1]}
            else{column>0&&table[row*width+column-1]&&(*token=='?'||*token==text[column-1])};
    }}
    Ok(table[cells-1])
}
pub(crate) fn relative_path(path:&str)->Result<String> {
    if path.is_empty()||path.len()>16384||path.starts_with('/')||path.starts_with('\\')||path.contains(':')||path.contains('\0') {
        return Err(fail("InvalidSourcePath",path,"Expected a bounded workspace-relative locator"));
    }
    if path=="."{return Ok(path.into());}
    if path.contains('\\')||path.split('/').any(|part|part.is_empty()||part=="."||part=="..") {
        return Err(fail("InvalidSourcePath",path,"Expected canonical relative path segments without traversal"));
    }
    Ok(path.into())
}
fn join(parent:&str,child:&str)->Result<String> {
    let parent=relative_path(parent)?;let child=relative_path(child)?;
    if child=="."{return Ok(parent);}
    if parent=="."{return Ok(child);}
    relative_path(&format!("{parent}/{child}"))
}
fn inside(root:&str,path:&str)->bool {root=="."||root==path||path.strip_prefix(root).is_some_and(|tail|tail.starts_with('/'))}
fn protected(name:&str)->bool {matches!(name,".git"|".gift"|".sec"|".codex"|".agents"|".documentation"|"node_modules"|"target")}
fn text<'a>(node:&'a Node,key:&str)->Result<&'a str>{node.get(key).and_then(Node::as_str).ok_or_else(||fail("InvalidPreparationInput","",format!("Missing {key}")))}
fn lock_validator()->Result<&'static jsonschema::Validator> {
    static VALIDATOR:std::sync::OnceLock<Result<jsonschema::Validator>>=std::sync::OnceLock::new();
    VALIDATOR.get_or_init(|| {
        let bytes=crate::grammar::RULE_CAPTURE.iter().find(|(name,_)|*name=="schema/source/binding-lock-1.schema.json").unwrap().1;
        let schema:serde_json::Value=serde_json::from_slice(bytes).map_err(|e|fail("GrammarDrift","",e.to_string()))?;
        jsonschema::options().with_draft(jsonschema::Draft::Draft202012).build(&schema).map_err(|e|fail("GrammarDrift","",e.to_string()))
    }).as_ref().map_err(Clone::clone)
}

/// Directory member order is presentation. This is the sole merge point for
/// retained membership and coverage, with no member-by-member linear search.
fn merge_directory(path:&str,outcome:CaptureOutcome,entries:&[DirectoryEntry],previous:Option<&CaptureObservation>,
    remaining_entries:&mut u64,budget:&mut Budget)->Result<Option<CaptureObservation>> {
    if outcome==CaptureOutcome::Found||!matches!(outcome,CaptureOutcome::Complete|CaptureOutcome::Partial)&&!entries.is_empty() {
        return Err(fail("InvalidCaptureObservation",path,"Invalid directory outcome/entries combination"));
    }
    let (old_outcome,old_entries)=match previous {
        Some(CaptureObservation::Directory {outcome,entries,..})=>(Some(*outcome),entries.as_slice()),
        Some(_)=>return Err(fail("ReaderInvariant",path,"Directory fact has another retained kind")),
        None=>(None,&[][..]),
    };
    let count=entries.len().saturating_add(old_entries.len());
    let name_bytes=entries.iter().chain(old_entries).map(|entry|entry.name.len()).sum::<usize>();
    // Count bounded string comparisons as well as tree operations before
    // allocating keys. A work unit covers at most sixteen compared bytes.
    let comparison_steps=24*((count+1).ilog2() as usize+2);
    let comparison_work=entries.iter().chain(old_entries).map(|entry|entry.name.len().saturating_mul(4)/16+1).sum::<usize>();
    budget.work(comparison_work.saturating_mul(comparison_steps).saturating_add(count))?;
    budget.charge(count.saturating_mul(256).saturating_add(name_bytes.saturating_mul(6)).saturating_add(path.len()*6+256))?;
    let mut incoming=BTreeMap::new();
    for entry in entries {
        if entry.name.is_empty()||entry.name=="."||entry.name==".."||entry.name.contains(['/', '\\', '\0']) {
            return Err(fail("InputConflict",path,"Directory members must have direct child names"));
        }
        if incoming.insert(entry.name.to_lowercase(),entry).is_some(){return Err(fail("InputConflict",path,"Directory member identities collide"));}
    }
    let mut members=old_entries.iter().map(|entry|(entry.name.to_lowercase(),entry)).collect::<BTreeMap<_,_>>();
    if old_outcome==Some(CaptureOutcome::Absent)&&outcome!=CaptureOutcome::Absent {
        return Err(fail("InputConflict",path,"An exactly absent directory changed"));
    }
    if matches!(old_outcome,Some(CaptureOutcome::Complete|CaptureOutcome::Partial)) {
        if !matches!(outcome,CaptureOutcome::Complete|CaptureOutcome::Partial){return Err(fail("InputConflict",path,"Known directory membership cannot become absent or unavailable"));}
        for (key,entry) in &members {
            match incoming.get(key) {
                Some(new) if *new!=*entry=>return Err(fail("InputConflict",path,"Captured member metadata changed")),
                None if outcome==CaptureOutcome::Complete=>return Err(fail("InputConflict",path,"Complete successor omitted an observed member")),
                _=>{},
            }
        }
    }
    let mut added=0usize;
    for (key,entry) in incoming {
        if !members.contains_key(&key) {
            if old_outcome==Some(CaptureOutcome::Complete){return Err(fail("InputConflict",path,"Complete membership changed"));}
            added+=1;
        }
        members.insert(key,entry);
    }
    let coverage=if old_outcome==Some(CaptureOutcome::Complete){CaptureOutcome::Complete}else{outcome};
    if added==0&&old_outcome==Some(coverage){return Ok(None);}
    *remaining_entries=remaining_entries.checked_sub(added as u64).ok_or_else(||fail("ResourceLimit",path,"Logical run capture entry budget exhausted"))?;
    budget.charge(members.values().map(|entry|entry.name.len()*6+192).sum::<usize>()+path.len()*6+256)?;
    let entries=members.into_values().cloned().collect();
    Ok(Some(CaptureObservation::Directory {path:path.into(),outcome:coverage,entries}))
}

fn file_observation<'a>(observations:&'a BTreeMap<(CaptureKind,String),CaptureObservation>,path:&str,budget:&mut Budget)->Result<Option<(CaptureOutcome,&'a [u8])>> {
    budget.text(path)?;budget.work((path.len()/16+1)*12*((observations.len()+1).ilog2() as usize+1))?;
    Ok(match observations.get(&(CaptureKind::File,path.into())) {
        Some(CaptureObservation::File {outcome,bytes,..})=>Some((*outcome,bytes.as_slice())),_=>None,
    })
}

fn status_copy(status:&PreparationStatus,budget:&mut Budget)->Result<PreparationStatus> {
    let strings=status.basis.len()+status.requests.iter().map(|request|request.path.len()+request.scope_root.len()).sum::<usize>()
        +status.needs.iter().map(|need|need.locator.len()+need.path.len()+need.code.len()+need.message.len()).sum::<usize>()
        +status.sources.iter().map(|source|source.locator.len()+source.revision.len()+source.layer.len()).sum::<usize>()
        +status.module_uses.iter().map(module_use_length).sum::<usize>();
    let records=status.requests.len()+status.needs.len()+status.sources.len()+status.module_uses.len()+1;
    budget.work(records+strings/16)?;budget.charge(strings.saturating_mul(6)+records*256)?;
    Ok(status.clone())
}
fn copy_needs(needs:&[PreparationNeed],budget:&mut Budget)->Result<Vec<PreparationNeed>> {
    let strings=needs.iter().map(|need|need.locator.len()+need.path.len()+need.code.len()+need.message.len()).sum::<usize>();
    budget.work(needs.len()+strings/16)?;budget.charge(strings*6+needs.len()*256)?;Ok(needs.to_vec())
}
fn module_use_length(use_id:&ModuleUse)->usize {use_id.project_instance.len()+use_id.module_id.len()+use_id.resolution_domain.len()+use_id.interpretation.len()}
fn parent_path(path:&str)->&str {path.rsplit_once('/').map(|(parent,_)|parent).unwrap_or(".")}
fn retain_frontier(frontier:&mut BTreeSet<String>,path:&str,budget:&mut Budget)->Result<()> {
    budget.work((path.len()/16+1)*12*((frontier.len()+1).ilog2() as usize+1))?;
    frontier.insert(budget.copy(path)?);Ok(())
}
fn candidate_ancestor(path:&str,candidates:&BTreeSet<String>,budget:&mut Budget)->Result<bool> {
    let mut parent=parent_path(path);
    loop {
        budget.work((parent.len()/16+1)*12*((candidates.len()+1).ilog2() as usize+1))?;
        if candidates.contains(parent){return Ok(true);}
        if parent=="."{return Ok(false);}parent=parent_path(parent);
    }
}

pub struct Preparation {
    root:DecodedSource,locator:String,base:String,context:FixedContext,basis:String,observations:BTreeMap<(CaptureKind,String),CaptureObservation>,
    budget:Budget,remaining_entries:u64,remaining_bytes:u64,terminal:Option<PreparationState>,terminal_needs:Vec<PreparationNeed>,
    modules:Vec<ModuleCapture>,imports:Vec<ImportBinding>,root_module:usize,qualified:BTreeSet<(usize,String)>,last_status:Option<PreparationStatus>,
}
impl Preparation {
    pub fn new(bytes:&[u8],locator:&str,context:FixedContext)->Result<Self> {Self::with_limits(bytes,locator,context,PreparationLimits::default())}
    pub fn with_limits(bytes:&[u8],locator:&str,context:FixedContext,limits:PreparationLimits)->Result<Self> {
        let mut budget=Budget::new();budget.tighten(limits.work,usize::MAX);
        Self::with_budget(bytes,locator,context,limits,budget)
    }
    pub(crate) fn with_budget(bytes:&[u8],locator:&str,context:FixedContext,limits:PreparationLimits,mut budget:Budget)->Result<Self> {
        budget.text(locator)?;context.charge(&mut budget)?;
        let locator=relative_path(locator)?;if locator=="."{return Err(fail("InvalidSourcePath",&locator,"The root source must be a file locator"));}
        budget.work(bytes.len()/16+1)?;budget.charge(bytes.len().saturating_mul(4)+1024)?;
        let root=reader::read(bytes)?;let base=locator.rsplit_once('/').map(|(parent,_)|parent).unwrap_or(".").to_owned();
        let remaining_bytes=limits.bytes.checked_sub(bytes.len() as u64).ok_or_else(||fail("ResourceLimit",&locator,"Root capture exceeds the run byte budget"))?;
        let basis=crate::digest(&serde_json::to_vec(&(&locator,crate::digest(bytes),context.module_use(""),"analyze")).map_err(|e|fail("InputEncoding","",e.to_string()))?);
        Ok(Self {root,locator,base,context,basis,observations:BTreeMap::new(),budget,remaining_entries:limits.entries,remaining_bytes,terminal:None,
            terminal_needs:Vec::new(),modules:Vec::new(),imports:Vec::new(),root_module:0,qualified:BTreeSet::new(),last_status:None})
    }
    pub fn basis(&self)->&str {&self.basis}
    pub fn root(&self)->&DecodedSource {&self.root}
    pub fn advance(&mut self,facts:&[CaptureObservation])->Result<PreparationStatus> {
        if self.terminal.is_some(){let needs=copy_needs(&self.terminal_needs,&mut self.budget)?;return self.status(Vec::new(),needs);}
        let mut changed=false;
        for fact in facts {
            match self.observe(fact) {
                Ok(progress)=>changed|=progress,
                Err(error)=>{self.terminal=Some(if error.code=="InputConflict"{PreparationState::Conflict}else{PreparationState::Stopped});
                    self.terminal_needs.push(PreparationNeed::new(&self.locator,&error.path,&error.code,&error.message));let needs=copy_needs(&self.terminal_needs,&mut self.budget)?;return self.status(Vec::new(),needs);},
            }
        }
        if !changed {
            if let Some(previous)=&self.last_status {
                let mut status=status_copy(previous,&mut self.budget)?;status.requests.clear();return Ok(status);
            }
        }
        let result=self.evaluate();
        match result {
            Ok((requests,needs))=>{
                let status=self.status(requests,needs)?;
                self.last_status=Some(status_copy(&status,&mut self.budget)?);Ok(status)
            },
            Err(error)=>{self.terminal=Some(if error.code=="InputConflict"{PreparationState::Conflict}else{PreparationState::Stopped});
                self.terminal_needs.push(PreparationNeed::new(&self.locator,&error.path,&error.code,&error.message));let needs=copy_needs(&self.terminal_needs,&mut self.budget)?;self.status(Vec::new(),needs)},
        }
    }
    fn observe(&mut self,fact:&CaptureObservation)->Result<bool> {
        let (kind,path,outcome)=match fact {CaptureObservation::Directory {path,outcome,..}=>(CaptureKind::Directory,path,*outcome),CaptureObservation::File {path,outcome,..}=>(CaptureKind::File,path,*outcome)};
        self.budget.text(path)?;
        let path=relative_path(path)?;
        if !inside(&self.base,&path)||path==self.locator{return Err(fail("InputConflict",&path,"Observation is outside the retained source scope or replaces the root"));}
        let key=(kind,path.clone());
        match fact {
            CaptureObservation::File {bytes,..}=>{
                self.budget.work(bytes.len()/16+1)?;
                if matches!(outcome,CaptureOutcome::Complete|CaptureOutcome::Partial)||outcome!=CaptureOutcome::Found&&!bytes.is_empty(){return Err(fail("InvalidCaptureObservation",&path,"Invalid file outcome/content combination"));}
                if let Some(old)=self.observations.get(&key) {
                    if old==fact{return Ok(false);}
                    if matches!(old,CaptureObservation::File {outcome:CaptureOutcome::Found|CaptureOutcome::Absent,..}){return Err(fail("InputConflict",&path,"Fixed file evidence changed"));}
                }
                self.remaining_bytes=self.remaining_bytes.checked_sub(bytes.len() as u64).ok_or_else(||fail("ResourceLimit",&path,"Logical run capture byte budget exhausted"))?;
                self.budget.work(bytes.len()/64+1)?;self.budget.charge(bytes.len()+path.len()*6+256)?;
            },
            CaptureObservation::Directory {entries,..}=>{
                let Some(merged)=merge_directory(&path,outcome,entries,self.observations.get(&key),&mut self.remaining_entries,&mut self.budget)? else{return Ok(false);};
                self.observations.insert(key,merged);return Ok(true);
            },
        }
        self.observations.insert(key,fact.clone());Ok(true)
    }
    fn request(&mut self,requests:&mut BTreeSet<CaptureRequest>,kind:CaptureKind,path:&str)->Result<()> {
        self.budget.work(1)?;self.budget.charge(path.len()*6+self.base.len()*6+192)?;
        requests.insert(CaptureRequest {kind,path:path.into(),scope_root:self.base.clone()});Ok(())
    }
    fn unavailable(&self,path:&str,outcome:CaptureOutcome)->PreparationNeed {
        let code=match outcome {CaptureOutcome::Absent=>"SourceAbsent",CaptureOutcome::Denied=>"SourceDenied",CaptureOutcome::Unavailable=>"SourceUnavailable",CaptureOutcome::Failed=>"SourceCaptureFailed",_=>"IncompleteEnumeration"};
        PreparationNeed::new(path,"",code,"The retained observation does not provide complete required source content")
    }
    fn evaluate(&mut self)->Result<(Vec<CaptureRequest>,Vec<PreparationNeed>)> {
        let mut requests=BTreeSet::new();let mut needs=Vec::new();let mut index_frontier=BTreeSet::new();
        self.modules.clear();self.imports.clear();self.qualified.clear();self.root_module=0;
        if self.root.source_format()=="gift.author-module/design-converged" {
            self.modules.push(ModuleCapture::read(self.root.bytes(),&self.locator,&self.context)?);
        }else {
            let scopes=self.scopes()?;let mut selected=BTreeMap::new();
            for (index,scope) in scopes.iter().enumerate() {
                if scope.includes.is_empty()||scope.excludes.iter().any(|pattern|pattern.segments==["**"]){continue;}
                let mut queue=VecDeque::from([(scope.root.clone(),String::new())]);
                while let Some((directory,relative))=queue.pop_front() {
                    self.budget.work(1)?;
                    let Some(observation)=self.observations.get(&(CaptureKind::Directory,directory.clone())) else{
                        if scope.kind=="semantic"&&scope.mode=="file"{retain_frontier(&mut index_frontier,&directory,&mut self.budget)?;}
                        self.request(&mut requests,CaptureKind::Directory,&directory)?;continue;
                    };
                    let CaptureObservation::Directory {outcome,entries,..}=observation else{unreachable!()};
                    if *outcome!=CaptureOutcome::Complete&&scope.kind=="semantic"&&scope.mode=="file"{retain_frontier(&mut index_frontier,&directory,&mut self.budget)?;}
                    if !matches!(outcome,CaptureOutcome::Complete|CaptureOutcome::Partial){needs.push(self.unavailable(&directory,*outcome));continue;}
                    if *outcome==CaptureOutcome::Partial{needs.push(self.unavailable(&directory,*outcome));}
                    self.budget.charge(entries.iter().map(|entry|entry.name.len()*6+192).sum())?;let entries=entries.clone();
                    for entry in entries {
                        let path=join(&directory,&entry.name)?;let member=if relative.is_empty(){entry.name.clone()}else{format!("{relative}/{}",entry.name)};
                        if entry.kind==EntryKind::Directory {
                            if protected(&entry.name){continue;}
                            let mut possible=false;for pattern in &scope.includes{possible|=pattern.descendant_possible(&member,&mut self.budget)?;}
                            let mut excluded=false;for pattern in &scope.excludes{excluded|=pattern.covers_descendants(&member,&mut self.budget)?;}
                            if possible&&!excluded{queue.push_back((path,member));}continue;
                        }
                        let mut included=false;for pattern in &scope.includes{included|=pattern.matches(&member,&mut self.budget)?;}
                        for pattern in &scope.excludes{if pattern.matches(&member,&mut self.budget)?{included=false;}}
                        if !included||path==self.locator{continue;}
                        if entry.kind!=EntryKind::File{
                            if scope.kind=="semantic"&&scope.mode=="file"{retain_frontier(&mut index_frontier,&path,&mut self.budget)?;}
                            needs.push(PreparationNeed::new(&path,"","NeedsOrdinarySource","A selected member is not an ordinary file"));continue;
                        }
                        if let Some((previous,_,_))=selected.get(&path){if *previous!=index{return Err(fail("InputConflict",&path,"Multiple source scopes claim one source member"));}}
                        selected.insert(path,(index,scope.kind.clone(),scope.mode.clone()));
                    }
                }
            }
            let mut decoded=Vec::new();let mut candidates=BTreeSet::new();
            self.budget.charge(selected.len()*256)?;
            for (path,(_,kind,mode)) in selected {
                if kind!="semantic"||mode!="file" {
                    needs.push(PreparationNeed::new(&path,"","NeedsSourceKindInterpretation","This source kind or producer-backed representation needs its actual source interpretation"));continue;
                }
                match file_observation(&self.observations,&path,&mut self.budget)? {
                    Some((CaptureOutcome::Found,bytes))=>{
                        self.budget.work(bytes.len()/16+1)?;self.budget.charge(bytes.len().saturating_mul(4)+1024)?;
                        let source=reader::read(bytes);
                        if source.as_ref().is_ok_and(|source|source.source_format()=="gift.project/design-converged") {
                            let parent=parent_path(&path);
                            if parent!=self.base{retain_frontier(&mut candidates,parent,&mut self.budget)?;}
                            retain_frontier(&mut index_frontier,&path,&mut self.budget)?;
                            needs.push(PreparationNeed::new(&path,"","NeedsNestedSourceOwner","Captured Project content is a candidate; its nested source ownership has not been adopted"));
                        }
                        decoded.push((path,source));
                    },
                    Some((outcome,_))=>{retain_frontier(&mut index_frontier,&path,&mut self.budget)?;needs.push(self.unavailable(&path,outcome));},
                    None=>{retain_frontier(&mut index_frontier,&path,&mut self.budget)?;self.request(&mut requests,CaptureKind::File,&path)?;},
                }
            }
            for (path,source) in decoded {
                if candidate_ancestor(&path,&candidates,&mut self.budget)? {
                    needs.push(PreparationNeed::new(&path,"","NeedsNestedSourceOwner","This captured member needs the candidate subtree's actual source ownership before parent module indexing"));continue;
                }
                let source=source?;
                if source.source_format()=="gift.project/design-converged"{continue;}
                self.modules.push(ModuleCapture::from_source(source,&path,&self.context)?);
            }
        }
        self.resolve_imports(&mut requests,&mut needs,&index_frontier)?;
        if !self.modules.is_empty(){crate::captured_input::canonicalize_modules(&mut self.modules,&mut self.imports,&mut self.root_module,&mut self.qualified,&mut self.budget)?;}
        if !requests.is_empty(){needs.push(PreparationNeed::new(&self.locator,"","NeedsSourceCapture","Actual source/coverage requests remain"));}
        if self.modules.is_empty(){needs.push(PreparationNeed::new(&self.locator,"","NeedsModuleCapture","No author module is captured in the selected scope"));}
        Ok((requests.into_iter().collect(),needs))
    }
    fn scopes(&mut self)->Result<Vec<Scope>> {
        let mut scopes=Vec::new();
        for node in self.root.expanded().get("sourceScopes").and_then(Node::as_array).unwrap_or(&[]) {
            self.budget.work(1)?;if scopes.len()>=128{return Err(fail("ResourceLimit","/sourceScopes","Source scope count exceeded"));}
            let relative=relative_path(text(node,"root")?)?;
            if relative.split('/').any(protected){return Err(fail("ProtectedSourceScope","/sourceScopes","A source root crosses a protected control/derived directory"));}
            let root=join(&self.base,&relative)?;let kind=text(node,"kind")?.to_owned();let edit=node.get("editSource").unwrap();let mode=text(edit,"mode")?.to_owned();
            let mut includes=Vec::new();let mut excludes=Vec::new();
            if let Some(items)=node.get("include").and_then(Node::as_array){for item in items{includes.push(Pattern::parse(item.as_str().unwrap(),&mut self.budget)?);}}
            else{includes.push(Pattern::parse("**",&mut self.budget)?);}
            if let Some(items)=node.get("exclude").and_then(Node::as_array){for item in items{excludes.push(Pattern::parse(item.as_str().unwrap(),&mut self.budget)?);}}
            self.budget.charge(root.len()*6+512)?;scopes.push(Scope {root,kind,mode,includes,excludes});
        }
        Ok(scopes)
    }
    fn resolve_imports(&mut self,requests:&mut BTreeSet<CaptureRequest>,needs:&mut Vec<PreparationNeed>,index_frontier:&BTreeSet<String>)->Result<()> {
        self.context.charge(&mut self.budget)?;let workspace_domain=self.context.module_use("").resolution_domain;
        let mut index=BTreeMap::new();
        for (slot,module) in self.modules.iter().enumerate() {
            self.budget.work(1)?;
            if index.insert(module.module_use.clone(),slot).is_some(){return Err(fail("InputConflict",&module.locator,"Competing sources claim the same module use"));}
        }
        let mut cursor=0;
        while cursor<self.modules.len() {
            self.budget.work(1)?;if self.modules.len()>128{return Err(fail("ResourceLimit","","Module closure limit exceeded"));}
            let module=self.modules[cursor].clone();
            if let Some(imports)=module.source.expanded().get("imports").and_then(Node::as_object) {
                for (alias,request) in imports {
                    self.budget.work(1)?;let id=text(request,"moduleId")?;
                    if text(request,"mode")?=="workspace" {
                        if !index_frontier.is_empty()&&module.module_use.resolution_domain==workspace_domain {
                            needs.push(PreparationNeed::new(&module.locator,&crate::source::pointer("/imports",alias),"NeedsWorkspaceModuleIndex","Unknown source membership or ownership prevents a unique workspace module selection"));continue;
                        }
                        let mut use_id=module.module_use.clone();use_id.module_id=id.into();
                        if let Some(target)=index.get(&use_id).copied(){self.imports.push(ImportBinding {from:cursor,alias:alias.clone(),target});self.qualified.insert((cursor,alias.clone()));}
                        else{needs.push(PreparationNeed::new(&module.locator,&crate::source::pointer("/imports",alias),"NeedsWorkspaceModule","The captured module index does not resolve this workspace import"));}
                    }else if let Some(target)=self.locked_target(&module,alias,request,requests,needs)? {
                        let slot=if let Some(slot)=index.get(&target.module_use).copied(){slot}else{let slot=self.modules.len();index.insert(target.module_use.clone(),slot);self.modules.push(target);slot};
                        self.imports.push(ImportBinding {from:cursor,alias:alias.clone(),target:slot});self.qualified.insert((cursor,alias.clone()));
                    }
                }
            }
            cursor+=1;
        }
        Ok(())
    }
    fn locked_target(&mut self,module:&ModuleCapture,alias:&str,request:&Node,requests:&mut BTreeSet<CaptureRequest>,needs:&mut Vec<PreparationNeed>)->Result<Option<ModuleCapture>> {
        let path=join(&self.base,"gift.lock.json")?;
        let Some((outcome,bytes))=file_observation(&self.observations,&path,&mut self.budget)? else{self.request(requests,CaptureKind::File,&path)?;return Ok(None);};
        if outcome!=CaptureOutcome::Found{needs.push(self.unavailable(&path,outcome));return Ok(None);}
        self.budget.work(bytes.len()/16+1)?;self.budget.charge(bytes.len().saturating_mul(4)+1024)?;
        let lock=crate::source::decode(bytes)?;let value=lock.to_value();
        if !lock_validator()?.is_valid(&value){return Err(fail("InvalidBindingLock",&path,"Lock does not satisfy its declared source shape"));}
        let expected_project=self.root.expanded().get("projectId").and_then(Node::as_str);
        if lock.get("schema").and_then(Node::as_str)!=Some("gift.binding-lock/1")||expected_project.is_none()||lock.get("projectId").and_then(Node::as_str)!=expected_project {
            return Err(fail("LockProjectMismatch",&path,"Lock does not belong to this actual Project"));
        }
        let inputs=lock.get("resolutionInputs");let binding=serde_json::to_value(self.context.resolver_binding()).unwrap();
        if inputs.and_then(|input|input.get("resolver")).map(Node::to_value)!=Some(binding)||inputs.and_then(|input|input.get("grammarRevision")).and_then(Node::as_str)!=Some(crate::grammar::revision().as_str()) {
            needs.push(PreparationNeed::new(&path,"/resolutionInputs","NeedsLockInterpretation","The lock's exact Resolver/grammar protocol is missing or unsupported"));return Ok(None);
        }
        let mut location=BindingLocation::import(module.module_use.clone(),alias);location.project_scope=expected_project.unwrap().into();
        let key=location.encode()?;
        if inputs.and_then(|input|input.get("requests")).and_then(|requests|requests.get(&key)).map(Node::to_value)!=Some(request.to_value()) {
            needs.push(PreparationNeed::new(&path,"/resolutionInputs/requests","NeedsLockRequestBasis","The lock does not bind this exact source import request"));return Ok(None);
        }
        let Some(node_id)=lock.get("bindings").and_then(|bindings|bindings.get(&key)).and_then(Node::as_str) else{needs.push(PreparationNeed::new(&path,"/bindings","NeedsLockBinding","No binding exists for this typed import occurrence"));return Ok(None);};
        let nodes=lock.get("nodes").and_then(Node::as_object).ok_or_else(||fail("InvalidBindingLock",&path,"Missing lock nodes"))?;
        for target in lock.get("bindings").and_then(Node::as_object).into_iter().flat_map(|bindings|bindings.values()) {
            if target.as_str().is_none_or(|id|!nodes.contains_key(id)){return Err(fail("InvalidLockNode",&path,"Binding targets a missing node"));}
        }
        for node in nodes.values(){for dependency in node.get("dependencies").and_then(Node::as_array).unwrap_or(&[]){if dependency.as_str().is_none_or(|id|!nodes.contains_key(id)){return Err(fail("InvalidLockDependency",&path,"Node dependency is missing"));}}}
        let node=nodes.get(node_id).ok_or_else(||fail("InvalidLockNode",&path,"Selected lock node is absent"))?;
        if text(node,"kind")?!="module"||text(node,"subjectId")?!=text(request,"moduleId")? {return Err(fail("InvalidLockNode",&path,"Selected node has the wrong kind or subject"));}
        if request.get("constraint").and_then(Node::as_str)!=Some(text(node,"revision")?) {
            needs.push(PreparationNeed::new(&path,"/nodes","NeedsLockedSelector","The fixed Resolver only supports exact opaque revision selectors"));return Ok(None);
        }
        let content=node.get("content").ok_or_else(||fail("InvalidLockNode",&path,"Missing node content"))?;
        if text(content,"algorithm")?!="sha256"||text(content,"format")?!="gift.author-module/design-converged" {needs.push(PreparationNeed::new(&path,"/nodes","NeedsLockedContentProfile","Unsupported locked content profile or digest domain"));return Ok(None);}
        let Some(hint)=node.get("locationHint").and_then(Node::as_str) else{needs.push(PreparationNeed::new(&path,"/nodes","NeedsLockedContent","Selected bytes have no local captured locator"));return Ok(None);};
        let hint=join(&self.base,hint)?;
        let Some((outcome,bytes))=file_observation(&self.observations,&hint,&mut self.budget)? else{self.request(requests,CaptureKind::File,&hint)?;return Ok(None);};
        if outcome!=CaptureOutcome::Found{needs.push(self.unavailable(&hint,outcome));return Ok(None);}
        let digest=crate::digest(bytes);
        if digest.strip_prefix("sha256:")!=content.get("digest").and_then(Node::as_str)||content.get("byteLength").and_then(|n|n.to_value().as_u64())!=Some(bytes.len() as u64) {return Err(fail("LockedContentMismatch",&hint,"Captured bytes do not match the selected content record"));}
        if node.get("dependencies").and_then(Node::as_array).is_some_and(|dependencies|!dependencies.is_empty()) {
            // Validate the selected finite dependency closure before issuing a
            // qualified edge. No dependency is inferred from a display name.
            let mut queue=node.get("dependencies").and_then(Node::as_array).unwrap().iter().map(|id|id.as_str().unwrap().to_owned()).collect::<VecDeque<_>>();
            self.budget.charge(queue.iter().map(|id|id.len()+96).sum())?;let mut seen=BTreeSet::new();
            while let Some(id)=queue.pop_front() {
                self.budget.work(1)?;self.budget.text(&id)?;if !seen.insert(id.clone()){continue;}
                let dependency=&nodes[&id];
                for next in dependency.get("dependencies").and_then(Node::as_array).unwrap_or(&[]) {
                    self.budget.work(1)?;let next=next.as_str().unwrap();self.budget.text(next)?;queue.push_back(next.to_owned());
                }
                let Some(locator)=dependency.get("locationHint").and_then(Node::as_str) else{needs.push(PreparationNeed::new(&path,"/nodes","NeedsLockedDependencyContent","Dependency bytes are not captured"));return Ok(None);};
                let locator=join(&self.base,locator)?;
                let Some((outcome,bytes))=file_observation(&self.observations,&locator,&mut self.budget)? else{self.request(requests,CaptureKind::File,&locator)?;return Ok(None);};
                if outcome!=CaptureOutcome::Found{needs.push(self.unavailable(&locator,outcome));return Ok(None);}
                let content=dependency.get("content").ok_or_else(||fail("InvalidLockDependency",&path,"Dependency content missing"))?;
                self.budget.work(bytes.len()/16+1)?;
                if text(content,"algorithm")?!="sha256"||text(content,"format")?!="gift.author-module/design-converged" {needs.push(PreparationNeed::new(&locator,"","NeedsLockedDependencyContent","Dependency content interpretation is unsupported"));return Ok(None);}
                if crate::digest(bytes).strip_prefix("sha256:")!=content.get("digest").and_then(Node::as_str)||content.get("byteLength").and_then(|n|n.to_value().as_u64())!=Some(bytes.len() as u64){return Err(fail("LockedContentMismatch",&locator,"Dependency content mismatch"));}
            }
        }
        self.budget.work(bytes.len()/16+1)?;self.budget.charge(bytes.len().saturating_mul(4)+1024)?;
        let mut target=ModuleCapture::read(bytes,&hint,&self.context)?;
        if target.module_use.module_id!=text(request,"moduleId")?{return Err(fail("ImportModuleMismatch",&hint,"Locked content self-reports another module"));}
        target.module_use.resolution_domain=crate::digest(&serde_json::to_vec(&(self.context.module_use("").resolution_domain,value["projectId"].clone(),node_id)).unwrap());
        Ok(Some(target))
    }
    fn status(&mut self,requests:Vec<CaptureRequest>,needs:Vec<PreparationNeed>)->Result<PreparationStatus> {
        let hash_work=self.root.bytes().len()/16+self.observations.values().map(|fact|if let CaptureObservation::File {outcome:CaptureOutcome::Found,bytes,..}=fact{bytes.len()/16+1}else{1}).sum::<usize>();
        self.budget.work(1+self.observations.len()+hash_work)?;
        let source_strings=self.locator.len()+self.observations.values().map(|fact|if let CaptureObservation::File {path,outcome:CaptureOutcome::Found,..}=fact{path.len()+96}else{0}).sum::<usize>();
        let use_strings=self.modules.iter().map(|module|module_use_length(&module.module_use)).sum::<usize>();
        self.budget.charge(1024+(source_strings+use_strings)*6+self.observations.len()*256+self.modules.len()*256)?;
        let mut sources=vec![CapturedSourceInfo {locator:self.locator.clone(),revision:crate::digest(self.root.bytes()),byte_length:self.root.bytes().len(),layer:"captured".into()}];
        for observation in self.observations.values(){if let CaptureObservation::File {path,outcome:CaptureOutcome::Found,bytes}=observation {sources.push(CapturedSourceInfo {locator:path.clone(),revision:crate::digest(bytes),byte_length:bytes.len(),layer:"captured".into()});}}
        let state=self.terminal.unwrap_or(if needs.is_empty()&&requests.is_empty(){PreparationState::Prepared}else{PreparationState::Waiting});
        Ok(PreparationStatus {state,basis:self.basis.clone(),requests,needs,sources,module_uses:self.modules.iter().map(|module|module.module_use.clone()).collect()})
    }
    pub fn finish(mut self)->Result<PreparedInput> {
        if self.last_status.is_none(){self.advance(&[])?;}
        if self.terminal.is_some(){return Err(fail("PreparationStopped",&self.locator,"Conflicting or stopped preparation cannot issue an analysis input"));}
        let needs=if let Some(status)=&self.last_status{copy_needs(&status.needs,&mut self.budget)?}else{Vec::new()};
        let mut input=PreparedInput::build(self.modules,self.imports,self.root_module,needs,self.qualified,self.budget)?;
        input.retain_preparation(self.root,self.locator,self.observations,self.basis)?;Ok(input)
    }
    pub fn binding_location(&self,module_id:&str,alias:&str)->Result<BindingLocation> {
        let project_scope=self.root.expanded().get("projectId").and_then(Node::as_str).ok_or_else(||fail("NeedsStableProjectScope","","A durable lock occurrence requires an actual Project logical identity"))?;
        let mut location=BindingLocation::for_import(&self.context,module_id,alias);location.project_scope=project_scope.into();Ok(location)
    }
}
