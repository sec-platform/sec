//! Fixed in-process interpretation and captured module-use inputs. These values
//! preserve semantic scope and content. They grant no filesystem or execution access.
use std::{collections::{BTreeMap,BTreeSet},sync::{Arc,OnceLock}};
use serde::{Serialize,Deserialize};
use crate::{binding::{Budget,ImportBinding},grammar,model::{Diagnostic,fail},reader::{self,DecodedSource}};

type Result<T> = std::result::Result<T,Diagnostic>;
pub const RESOLVER_ID:&str="gift:captured-author-resolver/1";

pub fn current_interpretation()->&'static str {
    static REVISION:OnceLock<String>=OnceLock::new();
    REVISION.get_or_init(||crate::digest(format!("{}\n{}",grammar::revision(),grammar::rules_revision()).as_bytes()))
}
#[derive(Clone,Debug)]
pub struct FixedContext {project_instance:String,resolution_domain:String}
impl FixedContext {
    pub fn new(project_instance:&str,resolution_domain:&str)->Result<Self> {
        if project_instance.is_empty()||resolution_domain.is_empty()||project_instance.len()+resolution_domain.len()>16384 {
            return Err(fail("InvalidInputContext","","Expected bounded nonempty context identities"));
        }
        Ok(Self {project_instance:project_instance.into(),resolution_domain:resolution_domain.into()})
    }
    pub fn interpretation(&self)->&'static str {current_interpretation()}
    pub fn require_interpretation(&self,revision:&str)->Result<()> {
        if revision!=current_interpretation(){return Err(fail("NeedsInterpretationBinding","","Requested interpretation is not this installed method binding"));}Ok(())
    }
    pub fn module_use(&self,module_id:&str)->ModuleUse {
        ModuleUse {project_instance:self.project_instance.clone(),module_id:module_id.into(),resolution_domain:self.resolution_domain.clone(),interpretation:current_interpretation().into()}
    }
    pub fn resolver_binding(&self)->ResolverBinding {ResolverBinding {id:RESOLVER_ID.into(),revision:grammar::rules_revision()}}
    pub(crate) fn charge(&self,budget:&mut Budget)->Result<()> {budget.text(&self.project_instance)?;budget.text(&self.resolution_domain)}
}
#[derive(Clone,Debug,PartialEq,Eq,PartialOrd,Ord,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleUse {pub project_instance:String,pub module_id:String,pub resolution_domain:String,pub interpretation:String}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolverBinding {pub id:String,pub revision:String}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BindingLocation {pub project_scope:String,pub module_id:String,pub resolution_domain:String,pub interpretation:String,pub slot:BindingSlot}
#[derive(Clone,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(tag="role",rename_all="snake_case",deny_unknown_fields)]
pub enum BindingSlot {Import {alias:String}}
impl BindingLocation {
    pub fn import(module_use:ModuleUse,alias:&str)->Self {Self {project_scope:module_use.project_instance,module_id:module_use.module_id,
        resolution_domain:module_use.resolution_domain,interpretation:module_use.interpretation,slot:BindingSlot::Import {alias:alias.into()}}}
    pub fn for_import(context:&FixedContext,module_id:&str,alias:&str)->Self {Self::import(context.module_use(module_id),alias)}
    pub fn encode(&self)->Result<String> {serde_json::to_string(self).map_err(|e|fail("InputEncoding","",e.to_string()))}
    pub fn decode(key:&str)->Result<Self> {
        let node=crate::source::decode(key.as_bytes())?;
        let value:Self=serde_json::from_value(node.to_value()).map_err(|e|fail("InvalidBindingLocation","",e.to_string()))?;
        if value.encode()?!=key{return Err(fail("InvalidBindingLocation","","Binding location is not the fixed Resolver's canonical encoding"));}
        Ok(value)
    }
}
#[derive(Clone,Debug,Serialize)]
pub struct CapturedSourceInfo {pub locator:String,pub revision:String,pub byte_length:usize,pub layer:String}
#[derive(Clone,Debug,Serialize)]
pub struct PreparationNeed {pub locator:String,pub path:String,pub code:String,pub message:String}
impl PreparationNeed {
    pub(crate) fn new(locator:&str,path:&str,code:&str,message:&str)->Self {
        Self {locator:locator.into(),path:path.into(),code:code.into(),message:message.into()}
    }
}
#[derive(Clone)]
pub struct ModuleCapture {pub(crate) source:DecodedSource,pub(crate) locator:String,pub(crate) module_use:ModuleUse}
impl ModuleCapture {
    pub fn read(bytes:&[u8],locator:&str,context:&FixedContext)->Result<Self> {
        let source=reader::read(bytes)?;
        Self::from_source(source,locator,context)
    }
    pub(crate) fn from_source(source:DecodedSource,locator:&str,context:&FixedContext)->Result<Self> {
        if source.source_format()!="gift.author-module/design-converged"{return Err(fail("NeedsModuleCapture",locator,"Expected captured module content"));}
        let module_id=source.expanded().get("moduleId").and_then(crate::source::Node::as_str).unwrap();
        let module_use=context.module_use(module_id);
        Ok(Self {source,locator:locator.into(),module_use})
    }
    pub fn module_use(&self)->&ModuleUse {&self.module_use}
    pub fn source(&self)->&DecodedSource {&self.source}
}
pub struct CapturedInput {
    pub(crate) sources:Vec<DecodedSource>,pub(crate) imports:Vec<ImportBinding>,pub(crate) root:usize,
    module_uses:Vec<ModuleUse>,locators:Vec<String>,needs:Vec<PreparationNeed>,
    pub(crate) qualified_imports:BTreeSet<(usize,String)>,
    basis:String,
    root_capture:Option<DecodedSource>,root_locator:Option<String>,observations:Vec<crate::project_input::CaptureObservation>,
    project_instances:Vec<ProjectInstanceRecord>,
}
/// A local project occurrence is meaningful only in this retained candidate.
/// Logical lock coordinates remain independent of this capture provenance.
#[derive(Clone,Debug)]
pub struct ProjectInstanceRecord {
    pub local_ref:String,pub candidate_basis:String,pub logical_project_id:Option<String>,
    pub root_locator:Option<String>,pub modules:Vec<usize>,
}
impl std::fmt::Debug for CapturedInput {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result {f.debug_struct("CapturedInput").field("basis",&self.basis).field("module_uses",&self.module_uses).finish_non_exhaustive()}
}
/// Coordinates are scoped by the exact captured basis before they may be
/// compared across preparations. They do not establish declaration lineage.
#[derive(Clone,Debug,PartialEq,Eq,Serialize)]
pub struct QualifiedModuleUse {pub basis:String,pub module_use:ModuleUse}
impl CapturedInput {
    pub(crate) fn legacy(sources:&[DecodedSource],imports:&[ImportBinding],root:usize,basis:&str,budget:&mut Budget)->Result<Arc<Self>> {
        let mut retained=Vec::new();let mut module_uses=Vec::new();let mut locators=Vec::new();
        for (index,source) in sources.iter().enumerate() {
            budget.work(1)?;budget.charge(1024)?;
            retained.push(source.clone());
            module_uses.push(ModuleUse {project_instance:"capture-local".into(),module_id:source.expanded().get("moduleId").and_then(crate::source::Node::as_str).unwrap().into(),resolution_domain:format!("slot:{index}"),interpretation:current_interpretation().into()});
            locators.push(format!("capture-{index}.json"));
        }
        budget.charge(imports.iter().map(|edge|edge.alias.len()+128).sum())?;
        let project_instances=project_records(&module_uses,basis,budget)?;
        Ok(Arc::new(Self {sources:retained,imports:imports.to_vec(),root,module_uses,locators,needs:Vec::new(),qualified_imports:BTreeSet::new(),basis:basis.into(),root_capture:None,root_locator:None,observations:Vec::new(),project_instances}))
    }
    pub fn basis(&self)->&str {&self.basis}
    pub fn qualified_module_use(&self,index:usize)->Option<QualifiedModuleUse> {
        self.module_uses.get(index).map(|module_use|QualifiedModuleUse {basis:self.basis.clone(),module_use:module_use.clone()})
    }
    pub fn sources(&self)->&[DecodedSource] {&self.sources}
    pub fn module_uses(&self)->&[ModuleUse] {&self.module_uses}
    pub fn locators(&self)->&[String] {&self.locators}
    pub fn needs(&self)->&[PreparationNeed] {&self.needs}
    pub fn root(&self)->usize {self.root}
    pub fn imports(&self)->&[ImportBinding] {&self.imports}
    pub fn root_capture(&self)->Option<&DecodedSource> {self.root_capture.as_ref()}
    pub fn root_locator(&self)->Option<&str> {self.root_locator.as_deref()}
    pub fn observations(&self)->&[crate::project_input::CaptureObservation] {&self.observations}
    pub fn project_instances(&self)->&[ProjectInstanceRecord] {&self.project_instances}
}
pub struct PreparedInput {pub(crate) capture:Arc<CapturedInput>,pub(crate) budget:Budget}
impl PreparedInput {
    pub fn capture(&self)->&CapturedInput {&self.capture}
    pub fn from_modules(modules:Vec<ModuleCapture>,imports:Vec<ImportBinding>,root:usize)->Result<Self> {
        Self::build(modules,imports,root,Vec::new(),BTreeSet::new(),Budget::new())
    }
    pub(crate) fn build(mut modules:Vec<ModuleCapture>,mut imports:Vec<ImportBinding>,mut root:usize,needs:Vec<PreparationNeed>,mut qualified:BTreeSet<(usize,String)>,mut budget:Budget)->Result<Self> {
        if modules.is_empty()||root>=modules.len(){return Err(fail("NeedsModuleCapture","","No captured module selected"));}
        if modules.len()>128{return Err(fail("ResourceLimit","","Module-use input limit exceeded"));}
        canonicalize_modules(&mut modules,&mut imports,&mut root,&mut qualified,&mut budget)?;
        let mut uses:BTreeMap<ModuleUse,usize>=BTreeMap::new();let mut remap=Vec::new();let mut sources:Vec<DecodedSource>=Vec::new();let mut locators:Vec<String>=Vec::new();let mut module_uses=Vec::new();
        for module in modules {
            budget.work(1)?;
            if module.module_use.interpretation!=current_interpretation(){return Err(fail("NeedsInterpretationBinding",&module.locator,"Captured use has another interpretation"));}
            if let Some(index)=uses.get(&module.module_use).copied() {
                if sources[index].bytes()!=module.source.bytes()||locators[index]!=module.locator{return Err(fail("InputConflict",&module.locator,"One module use has competing captured content or owners"));}
                remap.push(index);continue;
            }
            budget.charge(module.source.bytes().len()+512)?;budget.text(&module.locator)?;
            for value in [&module.module_use.project_instance,&module.module_use.module_id,&module.module_use.resolution_domain,&module.module_use.interpretation]{budget.text(value)?;}
            let index=sources.len();uses.insert(module.module_use.clone(),index);remap.push(index);
            sources.push(module.source);locators.push(module.locator);module_uses.push(module.module_use);
        }
        let mut edges=Vec::new();let mut slots=BTreeMap::new();let mut qualified_imports=BTreeSet::new();
        for edge in imports {
            budget.work(1)?;
            if edge.from>=remap.len()||edge.target>=remap.len(){return Err(fail("InvalidNameInput","","Import edge selects an uncaptured module use"));}
            let from=remap[edge.from];let target=remap[edge.target];
            let request=sources[from].expanded().get("imports").and_then(|imports|imports.get(&edge.alias)).ok_or_else(||fail("InvalidNameInput","","Import edge selects no real author slot"))?;
            if request.get("moduleId").and_then(crate::source::Node::as_str)!=Some(module_uses[target].module_id.as_str()){return Err(fail("ImportModuleMismatch","","Captured module use does not match the author request"));}
            let key=(from,edge.alias.clone());
            if let Some(previous)=slots.get(&key){if *previous!=target{return Err(fail("InputConflict","","One import slot has competing module-use targets"));}continue;}
            budget.charge(256)?;budget.text(&edge.alias)?;
            slots.insert(key.clone(),target);
            if qualified.contains(&(edge.from,edge.alias.clone()))||request.get("mode").and_then(crate::source::Node::as_str)==Some("workspace"){qualified_imports.insert(key);}
            edges.push(ImportBinding {from,alias:edge.alias,target});
        }
        budget.work(sources.iter().map(|source|source.bytes().len()/16+1).sum())?;
        budget.charge(module_uses.iter().enumerate().map(|(index,use_id)|use_length(use_id)+locators[index].len()+1024).sum())?;
        let mut revision_inputs=module_uses.iter().enumerate().map(|(index,module_use)|
            (module_use.clone(),crate::digest(sources[index].bytes()),locators[index].clone())).collect::<Vec<_>>();
        revision_inputs.sort();
        let mut revision_edges=edges.iter().map(|edge|(&module_uses[edge.from],&edge.alias,&module_uses[edge.target])).collect::<Vec<_>>();revision_edges.sort();
        let encoding_bound=1024+module_uses.iter().enumerate().map(|(index,use_id)|(use_length(use_id)+locators[index].len())*6+1024).sum::<usize>()
            +edges.iter().map(|edge|(use_length(&module_uses[edge.from])+use_length(&module_uses[edge.target])+edge.alias.len())*6+1024).sum::<usize>();
        budget.work(revision_inputs.len()+revision_edges.len()+encoding_bound/16)?;budget.charge(encoding_bound.saturating_mul(2))?;
        let basis=crate::digest(&serde_json::to_vec(&(&revision_inputs,revision_edges,&module_uses[remap[root]])).map_err(|e|fail("InputEncoding","",e.to_string()))?);
        let project_instances=project_records(&module_uses,&basis,&mut budget)?;
        Ok(Self {capture:Arc::new(CapturedInput {sources,imports:edges,root:remap[root],module_uses,locators,needs,qualified_imports,basis,
            root_capture:None,root_locator:None,observations:Vec::new(),project_instances}),budget})
    }
    pub(crate) fn retain_preparation(&mut self,root:DecodedSource,locator:String,observations:BTreeMap<(crate::project_input::CaptureKind,String),crate::project_input::CaptureObservation>,request_basis:String)->Result<()> {
        let capture=Arc::get_mut(&mut self.capture).ok_or_else(||fail("ReaderInvariant","","Input capture was published before preparation sealed"))?;
        self.budget.charge(observations.len()*std::mem::size_of::<crate::project_input::CaptureObservation>())?;
        let observations=observations.into_values().collect::<Vec<_>>();
        self.budget.work(observations.len()+1)?;
        let cost=observations.iter().map(|fact|match fact {
            crate::project_input::CaptureObservation::File {path,bytes,..}=>path.len()*6+bytes.len()*4+256,
            crate::project_input::CaptureObservation::Directory {path,entries,..}=>path.len()*6+entries.iter().map(|entry|entry.name.len()*6+256).sum::<usize>()+256,
        }).sum::<usize>();self.budget.work(cost/16+1)?;self.budget.charge(cost.saturating_mul(2))?;
        capture.basis=crate::digest(&serde_json::to_vec(&(&capture.basis,&request_basis,&observations)).map_err(|e|fail("InputEncoding","",e.to_string()))?);
        let logical_id=root.expanded().get("projectId").and_then(crate::source::Node::as_str);
        for record in &mut capture.project_instances {
            record.candidate_basis=self.budget.copy(&capture.basis)?;
            record.logical_project_id=logical_id.map(|id|self.budget.copy(id)).transpose()?;
            record.root_locator=Some(self.budget.copy(&locator)?);
        }
        capture.root_capture=Some(root);capture.root_locator=Some(locator);capture.observations=observations;Ok(())
    }
}

fn project_records(uses:&[ModuleUse],basis:&str,budget:&mut Budget)->Result<Vec<ProjectInstanceRecord>> {
    let mut groups:BTreeMap<&str,Vec<usize>>=BTreeMap::new();
    for (index,module_use) in uses.iter().enumerate() {
        budget.work(1)?;budget.charge(128)?;
        groups.entry(&module_use.project_instance).or_default().push(index);
    }
    let mut records=Vec::new();
    for (local_ref,modules) in groups {
        budget.charge(256)?;
        records.push(ProjectInstanceRecord {local_ref:budget.copy(local_ref)?,candidate_basis:budget.copy(basis)?,logical_project_id:None,root_locator:None,modules});
    }
    Ok(records)
}
fn use_length(module_use:&ModuleUse)->usize {module_use.project_instance.len()+module_use.module_id.len()+module_use.resolution_domain.len()+module_use.interpretation.len()}

/// The dense arenas and the capture digest consume this same order. Legacy
/// capture-local source APIs deliberately retain their existing ordered input.
pub(crate) fn canonicalize_modules(modules:&mut Vec<ModuleCapture>,imports:&mut Vec<ImportBinding>,root:&mut usize,
    qualified:&mut BTreeSet<(usize,String)>,budget:&mut Budget)->Result<()> {
    if *root>=modules.len(){return Err(fail("InvalidNameInput","","Root must select an actual captured module"));}
    let module_steps=12*((modules.len()+1).ilog2() as usize+1);
    let edge_steps=12*((imports.len()+1).ilog2() as usize+1);
    let module_work=modules.iter().map(|module|(use_length(&module.module_use)+module.locator.len())/16+1).sum::<usize>();
    let edge_work=imports.iter().map(|edge|edge.alias.len()/16+1).sum::<usize>();
    budget.work(module_work.saturating_mul(module_steps)+edge_work.saturating_mul(edge_steps)+qualified.len())?;
    budget.charge(modules.len()*(std::mem::size_of::<ModuleCapture>()*3+64)+qualified.len()*128)?;
    let mut ordered=std::mem::take(modules).into_iter().enumerate().collect::<Vec<_>>();
    ordered.sort_unstable_by(|(_,left),(_,right)|left.module_use.cmp(&right.module_use).then_with(||left.locator.cmp(&right.locator)));
    let mut remap=vec![0;ordered.len()];
    for (index,(old,module)) in ordered.into_iter().enumerate(){remap[old]=index;modules.push(module);}
    for edge in imports.iter_mut() {
        if edge.from>=remap.len()||edge.target>=remap.len(){return Err(fail("InvalidNameInput","","Import edge selects an uncaptured module use"));}
        edge.from=remap[edge.from];edge.target=remap[edge.target];
    }
    imports.sort_unstable();
    let mut remapped=BTreeSet::new();
    for (from,alias) in std::mem::take(qualified) {
        if from>=remap.len(){return Err(fail("InvalidNameInput","","Qualified import slot selects an uncaptured module"));}
        remapped.insert((remap[from],alias));
    }
    *qualified=remapped;*root=remap[*root];Ok(())
}
