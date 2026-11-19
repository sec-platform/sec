//! Installed source-only Rust library Method. This consumes the original
//! Callable/session and captured Target/Profile; a report DTO cannot bind it.
use std::collections::{BTreeMap,BTreeSet,VecDeque};
use serde::Serialize;
use crate::{Artifact,binding::{Budget,DeclarationId,ExportHop,Resolution},body_analysis::{NormalResult,ValueRelation},
    callable_analysis::{CallableAnalysis,CallableIndex},captured_input::{BindingLocation,PreparationNeed},
    header_seeds::HeaderKind,model::{Diagnostic,fail},semantic_types::*,source::Node,
    signature_resolution::{SignatureResolution,SignatureState},type_constraints::{ConstraintMachine,ConstraintState,Relation}};
type Result<T> = std::result::Result<T,Diagnostic>;

#[derive(Debug,Serialize)]
pub struct RustMethodAddress {pub module_id:&'static str,pub export:&'static str,pub implementation_revision:String}
/// The constructor refers to this actual compiled export. Its descriptor is
/// source data, not an alternate route to construct a library binding.
pub struct RustLibraryMethod {private:()}
pub fn rust_library_method()->RustLibraryMethod {RustLibraryMethod {private:()}}
impl RustLibraryMethod {
    pub fn address(&self)->RustMethodAddress {RustMethodAddress {module_id:"gift:rust-source-library",export:"emit",implementation_revision:crate::grammar::rules_revision()}}
    pub fn generate(self,analysis:CallableAnalysis)->Result<RustGenerationSession> {emit(analysis)}
}
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize)]
#[serde(rename_all="snake_case")]
pub enum RustGenerationState {Complete,Needs,Rejected}
#[derive(Debug,Serialize)]
pub struct RustTargetProvenance {
    pub target:String,pub binding:BindingLocation,pub profile_id:String,pub profile_revision:String,
    pub profile_source_revision:String,pub profile_locator:String,pub lock_locator:String,pub lock_revision:String,pub node_id:String,
}
#[derive(Debug,Serialize)]
pub struct RustToolchainRequirement {pub id:String,pub revision:String}
#[derive(Debug,Serialize)]
pub struct RustLibraryContext {
    pub crate_name:String,pub edition:String,pub std_profile:String,pub crate_shape:String,pub emit:String,
    pub toolchain_requirements:Vec<RustToolchainRequirement>,pub runtime_requirements:Vec<String>,pub evidence_obligations:Vec<String>,
}
#[derive(Debug,Serialize)]
pub struct RustSourceMapping {
    pub source_module:usize,pub declaration:usize,pub definition:String,pub source_pointer:String,
    pub source_revision:String,pub artifact:String,pub start_line:usize,pub end_line:usize,
}
#[derive(Debug,Serialize)]
pub struct RustExport {
    pub root_id:String,pub export:String,pub rust_name:String,pub root_module:usize,pub declaration:usize,pub route:Vec<ExportHop>,
}
#[derive(Debug,Serialize)]
pub struct RustDeclarationDependency {pub source_module:usize,pub declaration:usize,pub source_revision:String,pub callees:Vec<usize>}
#[derive(Debug,Serialize)]
pub struct RustGenerationResult {
    pub state:RustGenerationState,pub input_basis:String,pub method:RustMethodAddress,
    pub provenance:Option<RustTargetProvenance>,pub context:Option<RustLibraryContext>,pub members_complete:bool,
    pub artifacts:Vec<Artifact>,pub source_map:Vec<RustSourceMapping>,pub exports:Vec<RustExport>,
    pub dependencies:Vec<RustDeclarationDependency>,pub needs:Vec<PreparationNeed>,pub problems:Vec<PreparationNeed>,pub unrequested_checks:Vec<String>,
}
pub struct RustGenerationSession {resolution:SignatureResolution,result:RustGenerationResult,budget:Budget}
impl RustGenerationSession {
    pub fn result(&self)->&RustGenerationResult {&self.result}
    pub fn resolution(&self)->&SignatureResolution {&self.resolution}
    /// Reporting deliberately terminates semantic continuation. Serialization
    /// still consumes this exact run's remaining allocation/work budget.
    pub(crate) fn into_report_parts(self)->(SignatureResolution,RustGenerationResult,Budget) {(self.resolution,self.result,self.budget)}
}

fn formatted(budget:&mut Budget,args:std::fmt::Arguments<'_>)->Result<String> {
    struct Count(usize);impl std::fmt::Write for Count {fn write_str(&mut self,s:&str)->std::fmt::Result {self.0=self.0.checked_add(s.len()).ok_or(std::fmt::Error)?;Ok(())}}
    let mut count=Count(0);std::fmt::write(&mut count,args).map_err(|_|fail("ResourceLimit","","Rust output size overflow"))?;
    budget.work(count.0/16+1)?;budget.charge(count.0.saturating_mul(2)+64)?;
    let mut value=String::with_capacity(count.0);std::fmt::write(&mut value,args).map_err(|_|fail("OutputFailure","","Rust source formatting failed"))?;Ok(value)
}
fn joined(budget:&mut Budget,values:&[String],separator:&str)->Result<String> {
    let length=values.iter().map(String::len).sum::<usize>()+separator.len()*values.len();budget.work(length/16+1)?;budget.charge(length*2+64)?;Ok(values.join(separator))
}
fn issue(budget:&mut Budget,items:&mut Vec<PreparationNeed>,locator:&str,path:&str,code:&str,message:&str)->Result<()> {
    budget.work(items.len()+locator.len()/16+path.len()/16+message.len()/16+1)?;
    if items.iter().any(|item|item.locator==locator&&item.path==path&&item.code==code&&item.message==message){return Ok(());}
    budget.charge((locator.len()+path.len()+code.len()+message.len())*6+256)?;
    items.push(PreparationNeed::new(locator,path,code,message));Ok(())
}

struct Parameters {public_names:BTreeMap<(String,String),String>,fields:BTreeMap<String,String>}
struct RootExport {root_id:String,name:String,module:usize,declaration:DeclarationId,route:Vec<ExportHop>,spelling:String}
struct RecordLayout {ty:TypeId,source:SourceId,name:String,fields:Vec<(String,String)>}
/// No public constructor or mutable report input: the retained Callable is the
/// only producer of this binding. Its plan is target spelling, not semantic IR.
struct RustLibraryBinding {
    report:SignatureResolution,budget:Budget,constraints:Option<ConstraintState>,index:CallableIndex,result:RustGenerationResult,
    blocked:bool,parameters:Parameters,roots:Vec<RootExport>,required:BTreeSet<DeclarationId>,
    selected_modules:BTreeSet<usize>,
    type_names:BTreeMap<TypeId,String>,records:Vec<RecordLayout>,field_names:BTreeMap<String,String>,
    function_names:BTreeMap<DeclarationId,String>,occupied:BTreeSet<String>,counter:usize,
}
impl RustLibraryBinding {
    fn new(analysis:CallableAnalysis)->Result<Self> {
        let (closed,index)=analysis.into_session();let (report,mut budget,state)=closed.into_session();
        budget.charge(4096)?;
        let input_basis=budget.copy(report.input().basis())?;
        let method=rust_library_method().address();
        let mut unrequested_checks=Vec::new();
        for value in ["rustc-compilation","cargo-build","execution","toolchain-materialization","abi-check"] {unrequested_checks.push(budget.copy(value)?);}
        Ok(Self {report,budget,constraints:Some(state),index,
            result:RustGenerationResult {state:RustGenerationState::Needs,input_basis,method,provenance:None,context:None,members_complete:false,
                artifacts:Vec::new(),source_map:Vec::new(),exports:Vec::new(),dependencies:Vec::new(),needs:Vec::new(),problems:Vec::new(),unrequested_checks},
            blocked:false,parameters:Parameters {public_names:BTreeMap::new(),fields:BTreeMap::new()},roots:Vec::new(),required:BTreeSet::new(),selected_modules:BTreeSet::new(),
            type_names:BTreeMap::new(),records:Vec::new(),field_names:BTreeMap::new(),function_names:BTreeMap::new(),occupied:BTreeSet::new(),counter:0})
    }
    fn solve<T>(&mut self,run:impl FnOnce(&mut ConstraintMachine<'_>)->Result<T>)->Result<T> {
        let state=self.constraints.take().expect("One retained constraint state");
        let mut solver=ConstraintMachine::resume(&mut self.report.types,&mut self.budget,state);
        let result=run(&mut solver);let needs=std::mem::take(&mut solver.needs);self.constraints=Some(solver.into_state());
        for need in needs {
            self.budget.work(self.report.needs.len()+1)?;
            if !self.report.needs.iter().any(|old|old.source==need.source&&old.code==need.code){self.budget.charge(96)?;self.report.needs.push(need);}
        }
        result
    }
    fn need(&mut self,locator:&str,path:&str,code:&str,message:&str,blocking:bool)->Result<()> {
        self.blocked|=blocking;issue(&mut self.budget,&mut self.result.needs,locator,path,code,message)
    }
    fn problem(&mut self,locator:&str,path:&str,code:&str,message:&str)->Result<()> {
        self.blocked=true;issue(&mut self.budget,&mut self.result.problems,locator,path,code,message)
    }
    fn at_need(&mut self,source:SourceId,code:&str,message:&str)->Result<()> {
        let occurrence=self.report.types.source(source);let locator=self.budget.copy(&self.report.input().locators()[occurrence.module.index()])?;
        let path=self.budget.copy(&occurrence.expanded_path)?;self.need(&locator,&path,code,message,true)
    }
    fn identifier(&mut self,value:&str,locator:&str,path:&str)->Result<Option<crate::rust_syntax::RustIdentifier>> {
        match crate::rust_syntax::identifier(value,path,&mut self.budget) {
            Ok(name)=>{
                if name.needs_unicode_conformance {self.need(locator,path,"NeedsRustUnicodeConformance","Identifier spelling is parsed, but acceptance by the selected rustc Unicode version is unqualified",false)?;}
                Ok(Some(name))
            },
            Err(error) if error.code=="ResourceLimit"=>Err(error),
            Err(error)=>{self.need(locator,path,&error.code,&error.message,true)?;Ok(None)},
        }
    }
    fn fresh(&mut self,label:&str)->Result<String> {
        loop {
            self.budget.work(1)?;let name=formatted(&mut self.budget,format_args!("__gift_{label}_{}",self.counter))?;self.counter+=1;
            if !self.occupied.contains(&name) {self.budget.charge(name.len()+96)?;self.occupied.insert(self.budget.copy(&name)?);return Ok(name);}
        }
    }
    fn bind(&mut self)->Result<()> {
        let capture=self.report.input();let Some(selected)=capture.selected_target() else{
            return self.need("","/targets","NeedsSelectedTarget","Generation needs an explicitly prepared Project Target",true);
        };
        let Some(profile)=selected.profile() else{
            let locator=self.budget.copy(capture.root_locator().unwrap_or(""))?;
            return self.need(&locator,"/targets","NeedsCapturedTargetProfile","The selected Target has no complete locked Profile capture",true);
        };
        let target=selected.target().clone();let manifest=profile.manifest().clone();
        let root_locator=self.budget.copy(capture.root_locator().unwrap_or(""))?;
        let target_path=self.budget.copy(selected.source_pointer())?;
        let profile_locator=self.budget.copy(profile.locator())?;
        let coordinate=selected.binding_location();
        self.budget.charge((coordinate.project_scope.len()+coordinate.resolution_domain.len()+coordinate.interpretation.len()+selected.name().len())*6+2048)?;
        let identity=manifest.get("profile").unwrap();
        self.result.provenance=Some(RustTargetProvenance {target:self.budget.copy(selected.name())?,binding:coordinate.clone(),
            profile_id:self.budget.copy(text(identity,"id").unwrap())?,profile_revision:self.budget.copy(text(identity,"revision").unwrap())?,
            profile_source_revision:self.budget.copy(profile.source_revision())?,profile_locator:self.budget.copy(profile.locator())?,
            lock_locator:self.budget.copy(profile.lock_locator())?,lock_revision:self.budget.copy(profile.lock_revision())?,node_id:self.budget.copy(profile.node_id())?});
        let representation=manifest.get("representation").unwrap();
        for (key,expected) in [("language","rust"),("textIndexUnit","unicode-scalar"),("integerMode","other-qualified"),("exceptionModel","panic"),("moduleMode","library")] {
            if text(representation,key)!=Some(expected) {self.need(&profile_locator,"/representation","NeedsRustRepresentationProfile","The installed source Method does not implement this representation contract",true)?;}
        }
        if manifest.get("accepts").and_then(Node::as_array).unwrap().iter().any(|kind|kind.as_str()!=Some("core:function")) {
            self.need(&profile_locator,"/accepts","NeedsRustAcceptedRole","This installed Method accepts qualified function roots only",true)?;
        }
        let refs=manifest.get("loweringRefs").and_then(Node::as_array).unwrap();
        if refs.len()!=1||text(&refs[0],"moduleId")!=Some(self.result.method.module_id)||text(&refs[0],"export")!=Some(self.result.method.export) {
            self.need(&profile_locator,"/loweringRefs","NeedsRustLoweringMethodBinding","All lowering references must resolve to this actual compiled Method export",true)?;
        }
        let members=manifest.get("members").and_then(Node::as_array).unwrap();
        if members.len()!=1||text(&members[0],"role")!=Some("source")||text(&members[0],"pathPattern")!=Some("lib.rs")||members[0].get("required").and_then(Node::as_bool)!=Some(true) {
            self.need(&profile_locator,"/members","NeedsRustMemberLayout","This source-only Method emits one complete crate root lib.rs",true)?;
        }
        let host=manifest.get("host").unwrap();
        if !host.get("effects").and_then(Node::as_array).unwrap().is_empty(){self.need(&profile_locator,"/host/effects","NeedsRustHostRequirement","No host effect is implemented by this pure source emitter",true)?;}
        if text(manifest.get("compatibility").unwrap(),"policy")!=Some("exact")||manifest.get("compatibility").unwrap().get("migrationRequired").and_then(Node::as_bool)!=Some(false) {
            self.need(&profile_locator,"/compatibility","NeedsRustCompatibilityPolicy","This Method implements exact preservation without a migration",true)?;
        }
        let mut requirements=Vec::new();
        for item in manifest.get("toolchainRequirements").and_then(Node::as_array).unwrap() {
            self.budget.charge(128)?;
            requirements.push(RustToolchainRequirement {id:self.budget.copy(text(item,"id").unwrap())?,revision:self.budget.copy(text(item,"revision").unwrap())?});
            if text(item,"id")!=Some("rustc"){self.need(&profile_locator,"/toolchainRequirements","NeedsRustToolchainRequirement","Unknown toolchain requirement is not implemented",true)?;}
        }
        let mut runtime=Vec::new();
        for item in host.get("runtimeRequirements").and_then(Node::as_array).unwrap() {
            let value=item.as_str().unwrap();runtime.push(self.budget.copy(value)?);
            if value!="std" {self.need(&profile_locator,"/host/runtimeRequirements","NeedsRustRuntimeRequirement","Unknown runtime requirement is not implemented",true)?;}
        }
        let mut evidence=Vec::new();
        for item in manifest.get("evidenceObligations").and_then(Node::as_array).unwrap() {
            let value=item.as_str().unwrap();evidence.push(self.budget.copy(value)?);
            match value {
                "source-preservation"|"source-map"=>{},
                "rustc-compilation"|"cargo-build"|"execution"|"abi-check"=>{
                    self.need(&profile_locator,"/evidenceObligations","NeedsRustRequestedCheck","The Profile requests additional evidence beyond emitted source",false)?;
                    self.budget.work(self.result.unrequested_checks.len()+1)?;self.result.unrequested_checks.retain(|check|check!=value);
                },
                _=>self.need(&profile_locator,"/evidenceObligations","NeedsRustEvidenceObligation","The installed Method cannot interpret this evidence obligation",true)?,
            }
        }
        self.parse_parameters(target.get("parameters"),&root_locator,&target_path,requirements,runtime,evidence)?;
        self.select_roots(&target,&root_locator,&target_path)?;
        Ok(())
    }
    fn parse_parameters(&mut self,node:Option<&Node>,locator:&str,path:&str,requirements:Vec<RustToolchainRequirement>,runtime:Vec<String>,evidence:Vec<String>)->Result<()> {
        let Some(parameters)=node.and_then(Node::as_object) else{return self.need(locator,path,"NeedsRustTargetParameters","The source Method needs its explicit typed Target parameters",true);};
        for key in parameters.keys() {
            self.budget.work(1)?;
            if !matches!(key.as_str(),"edition"|"crateName"|"stdProfile"|"crateShape"|"emit"|"publicNameMappings"|"fieldNameMappings") {
                self.problem(locator,path,"InvalidRustTargetParameter","Unknown source Method parameter")?;
            }
        }
        let mut values=Vec::new();
        for (key,accepted) in [("edition",&["2021","2024"][..]),("crateName",&[][..]),("stdProfile",&["std"][..]),("crateShape",&["library"][..]),("emit",&["source"][..])] {
            let Some(value)=parameters.get(key).and_then(Node::as_str) else{self.need(locator,path,"NeedsRustTargetParameters","Required typed Method parameter is missing",true)?;return Ok(());};
            if !accepted.is_empty()&&!accepted.contains(&value){self.need(locator,path,"NeedsRustTargetParameterValue","The installed Method does not support this parameter value",true)?;return Ok(());}
            values.push(self.budget.copy(value)?);
        }
        if self.identifier(&values[1],locator,path)?.is_none(){return Ok(());}
        for (key,public) in [("publicNameMappings",true),("fieldNameMappings",false)] {
            if let Some(items)=parameters.get(key) {
                let Some(items)=items.as_array() else{self.problem(locator,path,"InvalidRustNameMapping","Name mappings must be an array")?;continue;};
                for item in items {
                    self.budget.work(1)?;
                    let Some(fields)=item.as_object() else{self.problem(locator,path,"InvalidRustNameMapping","Mapping is not an object")?;continue;};
                    let expected=if public{&["rootId","export","rustName"][..]}else{&["field","rustName"][..]};
                    if fields.len()!=expected.len()||expected.iter().any(|key|text(item,key).is_none()) {self.problem(locator,path,"InvalidRustNameMapping","Mapping fields must be exact typed strings")?;continue;}
                    let native=self.budget.copy(text(item,"rustName").unwrap())?;
                    if public {
                        let coordinate=(self.budget.copy(text(item,"rootId").unwrap())?,self.budget.copy(text(item,"export").unwrap())?);
                        if self.parameters.public_names.contains_key(&coordinate){self.problem(locator,path,"DuplicateRustNameMapping","A root/export mapping occurs twice")?;}
                        else{self.budget.charge(128)?;self.parameters.public_names.insert(coordinate,native);}
                    }else{
                        let field=self.budget.copy(text(item,"field").unwrap())?;
                        if self.parameters.fields.contains_key(&field){self.problem(locator,path,"DuplicateRustNameMapping","An author field mapping occurs twice")?;}
                        else{self.budget.charge(128)?;self.parameters.fields.insert(field,native);}
                    }
                }
            }
        }
        let mut values=values.into_iter();let edition=values.next().unwrap();let crate_name=values.next().unwrap();
        self.result.context=Some(RustLibraryContext {crate_name,edition,std_profile:values.next().unwrap(),crate_shape:values.next().unwrap(),emit:values.next().unwrap(),
            toolchain_requirements:requirements,runtime_requirements:runtime,evidence_obligations:evidence});Ok(())
    }
    fn select_roots(&mut self,target:&Node,locator:&str,path:&str)->Result<()> {
        let roots=target.get("outputRoots").and_then(Node::as_array).unwrap();let mut identities=BTreeSet::new();
        let mut used_mappings=BTreeSet::new();
        if roots.is_empty(){self.need(locator,path,"NeedsRustOutputRootEntry","An empty root list is not a generated library",true)?;}
        for root in roots {
            self.budget.work(1)?;
            let root_id=match text(root,"rootId") {Some(value)=>self.budget.copy(value)?,None if roots.len()==1=>self.budget.copy("main")?,None=>{self.problem(locator,path,"RustRootIdentity","Multiple roots require stable occurrence IDs")?;continue;}};
            if identities.contains(&root_id){self.problem(locator,path,"RustRootIdentity","Root occurrence IDs must be unique")?;continue;}self.budget.charge(root_id.len()+96)?;identities.insert(self.budget.copy(&root_id)?);
            if root.get("contextBindings").is_some()||root.get("argumentBindings").is_some(){self.need(locator,path,"NeedsRustRootBindings","Component/context bindings need their professional root consumer",true)?;continue;}
            let module_id=text(root,"moduleId").unwrap();let input=self.report.input();let selected=input.selected_target().unwrap();let binding=selected.binding_location();
            let mut candidates=Vec::new();
            for (index,use_id) in input.module_uses().iter().enumerate() {
                self.budget.work(input.project_instances().len()+1)?;
                if use_id.module_id==module_id&&use_id.resolution_domain==binding.resolution_domain&&use_id.interpretation==binding.interpretation&&input.project_instances().iter().any(|project|
                    project.local_ref==use_id.project_instance&&project.logical_project_id.as_deref()==Some(selected.project_id())&&project.candidate_basis==input.basis()&&project.root_locator.as_deref()==input.root_locator()&&project.modules.contains(&index)) {
                    self.budget.charge(32)?;candidates.push(index);
                }
            }
            if candidates.len()!=1 {self.need(locator,path,"NeedsRustRootModuleUse","Root selection does not identify one exact Project/domain ModuleUse",true)?;continue;}
            let module=candidates[0];self.budget.charge(64)?;self.selected_modules.insert(module);let mut selected_exports=Vec::new();
            for export in &self.report.names.exports {
                self.budget.work(1)?;
                if export.module.index()==module&&text(root,"export").is_none_or(|name|name==export.name) {self.budget.charge(32)?;selected_exports.push(export);}
            }
            if selected_exports.is_empty() {
                if text(root,"export").is_some(){self.problem(locator,path,"RustExportNotPublic","The selected name is missing or private; no private fallback is permitted")?;}
                else{self.need(locator,path,"NeedsRustOutputRootEntry","The selected public export set is empty",true)?;}continue;
            }
            // Copy only the compiler-resolved route before mutably continuing.
            let mut resolved=Vec::new();
            for export in selected_exports {
                if let Resolution::Resolved {declaration,route}=&export.resolution {
                    self.budget.charge(256+route.iter().map(|hop|hop.export.len()*6+hop.via_import.as_ref().map_or(0,|alias|alias.len()*6)+128).sum::<usize>())?;
                    resolved.push((self.budget.copy(&export.name)?,*declaration,route.clone()));
                }else{self.blocked=true;issue(&mut self.budget,&mut self.result.needs,locator,path,"NeedsRustPublicExportResolution","A public route remains unresolved")?;}
            }
            for (name,declaration,route) in resolved {
                self.budget.charge((route.len()+1)*64)?;
                self.selected_modules.insert(self.report.names.declarations[declaration.index()].module.index());
                for hop in &route{self.selected_modules.insert(hop.module.index());}
                if self.index.get(declaration).is_none(){self.need(locator,path,"NeedsRustCallableRoot","The selected export has no same-session Callable entry",true)?;continue;}
                let coordinate=(self.budget.copy(&root_id)?,self.budget.copy(&name)?);
                let chosen=match self.parameters.public_names.get(&coordinate){Some(value)=>self.budget.copy(value)?,None=>self.budget.copy(&name)?};
                if self.parameters.public_names.contains_key(&coordinate){self.budget.charge(96)?;used_mappings.insert(coordinate);}
                let Some(native)=self.identifier(&chosen,locator,path)? else{continue;};
                if self.occupied.contains(&native.key){self.problem(locator,path,"RustPublicNameCollision","Selected root occurrences map to the same native public symbol")?;continue;}
                self.budget.charge(256)?;self.occupied.insert(native.key);
                self.roots.push(RootExport {root_id:self.budget.copy(&root_id)?,name,module,declaration,route,spelling:native.spelling});
            }
        }
        for coordinate in self.parameters.public_names.keys() {
            self.budget.work(1)?;
            if !used_mappings.contains(coordinate){self.blocked=true;issue(&mut self.budget,&mut self.result.needs,locator,path,"NeedsRustNameMappingTarget","A mapping has no resolved selected root/export occurrence")?;}
        }
        Ok(())
    }
}
fn text<'a>(node:&'a Node,key:&str)->Option<&'a str> {node.get(key).and_then(Node::as_str)}

impl RustLibraryBinding {
    fn collect(&mut self)->Result<()> {
        let mut queue=VecDeque::new();for root in &self.roots{self.budget.charge(32)?;queue.push_back(root.declaration);}
        while let Some(declaration)=queue.pop_front() {
            self.budget.work(1)?;if self.required.contains(&declaration){continue;}
            self.budget.charge(96)?;self.required.insert(declaration);
            let Some(entry)=self.index.get(declaration) else{self.need("","","NeedsRustCallableDependency","Direct callee lacks a same-session Callable",true)?;continue;};
            self.budget.charge(entry.direct_calls.len()*32+128)?;
            queue.extend(entry.direct_calls.iter().copied());
        }
        self.budget.charge(self.selected_modules.len()*64)?;let mut modules=self.selected_modules.clone();
        for root in &self.roots {self.budget.charge((root.route.len()+1)*64)?;modules.insert(root.module);for hop in &root.route{modules.insert(hop.module.index());}}
        for declaration in &self.required {self.budget.charge(64)?;modules.insert(self.report.names.declarations[declaration.index()].module.index());}
        // Known errors in a required module are not hidden by selecting its
        // Good export. Needs retain their actual dependency/initialization scope.
        for problem in &self.report.problems {
            let module=self.report.names.declarations[problem.declaration.index()].module.index();self.budget.work(1)?;
            if modules.contains(&module) {self.blocked=true;let d=&problem.diagnostic;issue(&mut self.budget,&mut self.result.problems,&self.report.input().locators()[module],&d.path,&d.code,&d.message)?;}
        }
        for problem in &self.report.names.problems {
            self.budget.work(1)?;if modules.contains(&problem.module.index()){self.blocked=true;issue(&mut self.budget,&mut self.result.problems,&self.report.input().locators()[problem.module.index()],&problem.path,problem.code,"Retained module name problem")?;}
        }
        for problem in &self.report.names.lexical.problems {
            let source=&self.report.names.lexical.occurrences[problem.occurrence.index()];self.budget.work(1)?;
            if modules.contains(&source.module.index()){self.blocked=true;issue(&mut self.budget,&mut self.result.problems,&self.report.input().locators()[source.module.index()],&source.expanded_path,problem.code,"Retained lexical problem")?;}
        }
        for problem in &self.report.types.problems {
            let source=self.report.types.source(problem.source);self.budget.work(1)?;
            if modules.contains(&source.module.index()){self.blocked=true;issue(&mut self.budget,&mut self.result.problems,&self.report.input().locators()[source.module.index()],&source.expanded_path,problem.code,"Retained type formation problem")?;}
        }
        for (source,d) in self.report.bodies.problems.iter().map(|p|(p.source,&p.diagnostic)).chain(self.report.effects.problems.iter().map(|p|(p.source,&p.diagnostic))) {
            let source=self.report.types.source(source);self.budget.work(1)?;
            if modules.contains(&source.module.index()){self.blocked=true;issue(&mut self.budget,&mut self.result.problems,&self.report.input().locators()[source.module.index()],&d.path,&d.code,&d.message)?;}
        }
        for need in self.report.input().needs() {
            self.blocked=true;issue(&mut self.budget,&mut self.result.needs,&need.locator,&need.path,&need.code,&need.message)?;
        }
        // The original common typing judgment, not the target representation
        // or unused Callable qualification, owns module typing completion.
        let mut signatures=BTreeMap::new();
        for signature in &self.report.signatures {self.budget.work(1)?;self.budget.charge(96)?;signatures.insert(signature.declaration,signature);}
        let mut pending_typing=BTreeSet::new();
        for header in &self.report.headers {
            self.budget.work(1)?;if !modules.contains(&header.module.index()){continue;}
            let signature=signatures.get(&header.declaration).copied();
            let complete=match &header.kind {
                HeaderKind::Type {..}=>signature.is_some_and(|signature|signature.state==SignatureState::TypeReady),
                HeaderKind::Function {..}|HeaderKind::Constant {..}=>signature.is_some_and(|signature|signature.state==SignatureState::TypeReady&&signature.body_type_checked),
                HeaderKind::Uninterpreted {..}=>continue,
            };
            if complete{continue;}
            self.blocked=true;self.budget.charge(96)?;pending_typing.insert(header.declaration);
            self.budget.work(self.report.needs.len()+self.report.types.needs.len()+1)?;
            let has_need=self.report.needs.iter().any(|need|self.report.types.source(need.source).owner==Some(header.declaration))||
                self.report.types.needs.iter().any(|need|self.report.types.source(need.source).owner==Some(header.declaration));
            if !has_need&&!signature.is_some_and(|signature|signature.state==SignatureState::Rejected) {
                let source=self.report.types.source(header.source);
                issue(&mut self.budget,&mut self.result.needs,&self.report.input().locators()[header.module.index()],&source.expanded_path,
                    "NeedsModuleTypeCheck","A required module declaration has not completed its original common typing judgment")?;
            }
        }
        for need in &self.report.needs {
            self.budget.work(1)?;let source=self.report.types.source(need.source);
            if source.owner.is_some_and(|owner|self.required.contains(&owner)||pending_typing.contains(&owner))||modules.contains(&source.module.index())&&(source.owner.is_none()||need.code=="NeedsStaticConstructionQualification") {
                self.blocked=true;issue(&mut self.budget,&mut self.result.needs,&self.report.input().locators()[source.module.index()],&source.expanded_path,need.code,"Required semantic obligation remains open")?;
            }
        }
        for need in &self.report.types.needs {
            self.budget.work(1)?;let source=self.report.types.source(need.source);
            if source.owner.is_some_and(|owner|pending_typing.contains(&owner)) {
                self.blocked=true;issue(&mut self.budget,&mut self.result.needs,&self.report.input().locators()[source.module.index()],&source.expanded_path,need.code,"Required common type formation remains open")?;
            }
        }
        Ok(())
    }
    fn type_name(&mut self,ty:TypeId,source:SourceId)->Result<Option<String>> {
        self.budget.work(1)?;
        if let Some(name)=self.type_names.get(&ty){return Ok(Some(self.budget.copy(name)?));}
        let normalized=self.solve(|solver|solver.normalize(ty,source))?;
        if let Some(name)=self.type_names.get(&normalized) {
            let name=self.budget.copy(name)?;self.budget.charge(96)?;self.type_names.insert(ty,self.budget.copy(&name)?);return Ok(Some(name));
        }
        let node=self.solve(|solver|solver.copy_type(normalized))?;
        let name=match node {
            SemanticType::Scalar(scalar) if matches!(scalar.name.as_str(),"bool"|"unit"|"text")=>{
                if scalar.bits.is_some()||scalar.scale.is_some()||scalar.overflow.is_some()||scalar.text_index.is_some()||scalar.rounding.is_some()||scalar.nan_policy.is_some()||scalar.encoding.is_some()||scalar.clock_ref.is_some() {
                    self.at_need(source,"NeedsRustScalarAttributes","Explicit scalar attributes need their exact native representation contract")?;return Ok(None);
                }
                self.budget.copy(match scalar.name.as_str(){"bool"=>"bool","unit"=>"()",_=>"::std::string::String"})?
            },
            SemanticType::Record {fields,open,row} if open!=Some(true)&&row.is_none()&&fields.values().all(|field|field.optional!=Some(true)&&field.mutable!=Some(true))=>{
                for index in 0..self.records.len() {
                    let prior=self.records[index].ty;
                    match self.solve(|solver|solver.probe(|solver|solver.unify(normalized,prior,source))) {
                        Ok(Relation::Equal)=>{let name=self.budget.copy(&self.records[index].name)?;self.budget.charge(192)?;self.type_names.insert(ty,self.budget.copy(&name)?);self.type_names.insert(normalized,self.budget.copy(&name)?);return Ok(Some(name));},
                        Ok(Relation::Needs)=>{self.at_need(source,"NeedsRustStructuralTypeEquality","The native record layout cannot be unified without unresolved type semantics")?;return Ok(None);},
                        Err(error) if error.code=="TypeMismatch"=>{},Err(error)=>return Err(error),
                    }
                }
                let name=self.fresh("record")?;let mut native_fields=Vec::new();let mut occupied=BTreeSet::new();
                for (field,value) in fields {
                    let chosen=match self.parameters.fields.get(&field){Some(value)=>self.budget.copy(value)?,None=>self.budget.copy(&field)?};
                    let occurrence=self.report.types.source(source);let locator=self.budget.copy(&self.report.input().locators()[occurrence.module.index()])?;let path=self.budget.copy(&occurrence.expanded_path)?;
                    let Some(native)=self.identifier(&chosen,&locator,&path)? else{return Ok(None);};
                    if occupied.contains(&native.key){self.problem(&locator,&path,"RustFieldNameCollision","Two author fields map to the same native field")?;return Ok(None);}
                    self.budget.charge(native.key.len()+128)?;occupied.insert(native.key);
                    let Some(field_type)=self.type_name(value.ty,source)? else{return Ok(None);};
                    self.budget.charge(192)?;self.field_names.insert(self.budget.copy(&field)?,self.budget.copy(&native.spelling)?);
                    native_fields.push((native.spelling,field_type));
                }
                self.budget.charge(192)?;self.records.push(RecordLayout {ty:normalized,source,name:self.budget.copy(&name)?,fields:native_fields});name
            },
            SemanticType::Declaration {..}|SemanticType::Opaque {..}=>{self.at_need(source,"NeedsRustNominalRepresentation","Nominal identity requires a qualified native representation; it cannot become a structural record")?;return Ok(None);},
            _=>{self.at_need(source,"NeedsRustTypeRepresentation","This installed source Method has no qualified representation for this semantic type")?;return Ok(None);},
        };
        self.budget.charge(192)?;self.type_names.insert(ty,self.budget.copy(&name)?);self.type_names.insert(normalized,self.budget.copy(&name)?);Ok(Some(name))
    }
    fn plan(&mut self)->Result<()> {
        self.budget.charge(self.required.len()*32)?;let required=self.required.iter().copied().collect::<Vec<_>>();
        for declaration in required {
            let entry=self.index.get(declaration).unwrap();let (ty,source,body)=(entry.signature,entry.source,entry.body);
            let header=self.report.headers.iter().find(|header|header.declaration==declaration).unwrap();
            if matches!(&header.kind,HeaderKind::Function {parameters,..} if parameters.iter().any(|parameter|parameter.mode.as_deref().is_some_and(|mode|mode!="in"))) {
                self.at_need(source,"NeedsRustParameterPassingMode","Borrow/move/out parameter contracts need their own qualified lowering")?;
            }
            let ty=self.solve(|solver|solver.normalize(ty,source))?;
            let node=self.solve(|solver|solver.copy_type(ty))?;
            let SemanticType::Function(function)=node else{self.at_need(source,"NeedsRustFunctionSignature","Callable signature is not a formed function")?;continue;};
            if !function.binders.is_empty(){self.at_need(source,"NeedsRustGenericRepresentation","This source Method needs a monomorphic instantiated signature")?;continue;}
            for argument in &function.parameters {
                if let SemanticArgument::Type(ty)=argument{self.type_name(*ty,source)?;}else{self.at_need(source,"NeedsRustSemanticArgument","Runtime parameter expansion is not lowered")?;}
            }
            self.type_name(function.returns,source)?;
            let name=self.fresh("function")?;self.budget.charge(96)?;self.function_names.insert(declaration,name);
            self.budget.charge(32)?;let mut queue=vec![body];let mut visited=BTreeSet::new();
            while let Some(index)=queue.pop() {
                self.budget.work(1)?;if visited.contains(&index){continue;}self.budget.charge(64)?;visited.insert(index);
                let summary=&self.report.bodies.expressions[index];let source=summary.source;let normal=summary.normal;
                let declaration_value=matches!(summary.value,ValueRelation::Declaration(_));
                self.budget.charge(summary.children.len()*32)?;queue.extend(summary.children.iter().copied());
                if !declaration_value {
                    if let NormalResult::Value(ty)=normal{self.type_name(ty,source)?;}
                    else{self.at_need(source,"NeedsRustControlExitLowering","Nonlocal/pending normal exits are outside this source Method")?;}
                }
            }
            let seed=&self.report.names.declarations[declaration.index()];let module=seed.module.index();
            let entry=self.index.get(declaration).unwrap();self.budget.charge(entry.direct_calls.len()*32+256)?;
            self.result.dependencies.push(RustDeclarationDependency {source_module:module,declaration:declaration.index(),source_revision:self.budget.copy(&self.report.names.modules[module].source_revision)?,callees:entry.direct_calls.iter().map(|id|id.index()).collect()});
        }
        for name in self.parameters.fields.keys() {
            self.budget.work(1)?;
            if !self.field_names.contains_key(name) {self.blocked=true;issue(&mut self.budget,&mut self.result.needs,"","/parameters/fieldNameMappings","NeedsRustFieldMappingTarget","A field mapping has no supported structural field occurrence")?;}
        }
        Ok(())
    }
    fn source_map(&mut self,declaration:DeclarationId,start_line:usize,end_line:usize)->Result<()> {
        let entry=self.index.get(declaration).unwrap();let source=self.report.types.source(entry.source);let seed=&self.report.names.declarations[declaration.index()];
        let pointer=source.origin.as_ref().map(|origin|origin.pointer.as_str()).unwrap_or(&source.expanded_path);
        self.budget.charge(256)?;
        self.result.source_map.push(RustSourceMapping {source_module:source.module.index(),declaration:declaration.index(),definition:self.budget.copy(&seed.name)?,
            source_pointer:self.budget.copy(pointer)?,source_revision:self.budget.copy(&self.report.names.modules[source.module.index()].source_revision)?,
            artifact:self.budget.copy("lib.rs")?,start_line,end_line});Ok(())
    }
    fn source(&mut self)->Result<()> {
        let Some(context)=self.result.context.as_ref() else{return Ok(());};
        let crate_literal=crate::rust_syntax::text_literal(&context.crate_name,&mut self.budget)?;
        let mut output=formatted(&mut self.budget,format_args!("#![crate_name = {crate_literal}]\n#![crate_type = \"lib\"]\n#![forbid(unsafe_code)]\n\n"))?;
        let mut line=output.bytes().filter(|byte|*byte==b'\n').count()+1;
        for index in 0..self.records.len() {
            let record=&self.records[index];let source=record.source;
            let mut fields=Vec::new();for (name,ty) in &record.fields{fields.push(formatted(&mut self.budget,format_args!("pub {name}: {ty}"))?);}
            let fields=joined(&mut self.budget,&fields,", ")?;
            let value=formatted(&mut self.budget,format_args!("#[derive(Clone)]\npub struct {} {{ {fields} }}\n\n",record.name))?;
            let start=line;line+=value.bytes().filter(|byte|*byte==b'\n').count();append(&mut self.budget,&mut output,&value)?;
            if let Some(owner)=self.report.types.source(source).owner{self.source_map(owner,start,line-1)?;}
        }
        self.budget.charge(self.required.len()*32)?;let declarations=self.required.iter().copied().collect::<Vec<_>>();
        for declaration in declarations {
            let header=self.report.headers.iter().find(|header|header.declaration==declaration).unwrap();let HeaderKind::Function {parameters,..}=&header.kind else{unreachable!()};
            self.budget.charge(parameters.len()*64)?;let parameter_data=parameters.iter().map(|parameter|(parameter.binding,parameter.ty)).collect::<Vec<_>>();
            let entry=self.index.get(declaration).unwrap();let (signature,body)=(entry.signature,entry.body);
            let SemanticType::Function(function)=self.report.types.get(signature) else{unreachable!()};
            let returns=self.budget.copy(self.type_names.get(&function.returns).expect("Planned return type"))?;
            let mut parameters=Vec::new();
            for (binding,ty) in parameter_data {parameters.push(formatted(&mut self.budget,format_args!("__gift_b_{}: {}",binding.index(),self.type_names[&ty]))?);}
            let parameters=joined(&mut self.budget,&parameters,", ")?;
            let body={let mut emitter=ExpressionEmitter {report:&self.report,types:&self.type_names,fields:&self.field_names,functions:&self.function_names,budget:&mut self.budget};emitter.expression(body)};
            let body=match body {Ok(body)=>body,Err(error) if error.code=="ResourceLimit"=>return Err(error),Err(error)=>{
                self.at_need(self.index.get(declaration).unwrap().source,&error.code,&error.message)?;continue;
            }};
            let start=line;
            let value=formatted(&mut self.budget,format_args!("fn {}({parameters}) -> {returns} {{ {body} }}\n\n",self.function_names[&declaration]))?;
            line+=value.bytes().filter(|byte|*byte==b'\n').count();append(&mut self.budget,&mut output,&value)?;self.source_map(declaration,start,line-1)?;
        }
        for index in 0..self.roots.len() {
            let root=&self.roots[index];let declaration=root.declaration;let header=self.report.headers.iter().find(|header|header.declaration==declaration).unwrap();
            let HeaderKind::Function {parameters,..}=&header.kind else{unreachable!()};let mut arguments=Vec::new();let mut signature=Vec::new();
            for (position,parameter) in parameters.iter().enumerate() {
                let name=formatted(&mut self.budget,format_args!("__gift_argument_{position}"))?;
                signature.push(formatted(&mut self.budget,format_args!("{name}: {}",self.type_names[&parameter.ty]))?);arguments.push(name);
            }
            let entry=self.index.get(declaration).unwrap();let SemanticType::Function(function)=self.report.types.get(entry.signature) else{unreachable!()};
            let arguments=joined(&mut self.budget,&arguments,", ")?;let signature=joined(&mut self.budget,&signature,", ")?;
            let start=line;
            let value=formatted(&mut self.budget,format_args!("pub fn {}({signature}) -> {} {{ {}({arguments}) }}\n\n",root.spelling,self.type_names[&function.returns],self.function_names[&declaration]))?;
            line+=value.bytes().filter(|byte|*byte==b'\n').count();append(&mut self.budget,&mut output,&value)?;
            self.budget.charge(root.route.iter().map(|hop|hop.export.len()*6+hop.via_import.as_ref().map_or(0,|alias|alias.len()*6)+192).sum::<usize>()+256)?;
            self.result.exports.push(RustExport {root_id:self.budget.copy(&root.root_id)?,export:self.budget.copy(&root.name)?,
                rust_name:self.budget.copy(root.spelling.strip_prefix("r#").unwrap())?,root_module:root.module,declaration:declaration.index(),route:root.route.clone()});
            self.source_map(declaration,start,line-1)?;
        }
        if !self.blocked {self.budget.charge(128)?;self.result.artifacts.push(Artifact {path:self.budget.copy("lib.rs")?,content:output});self.result.members_complete=true;}
        else{self.result.source_map.clear();self.result.exports.clear();}
        Ok(())
    }
    fn finish(mut self)->RustGenerationSession {
        self.result.state=if !self.result.problems.is_empty(){RustGenerationState::Rejected}else if self.result.members_complete&&self.result.needs.is_empty(){RustGenerationState::Complete}else{RustGenerationState::Needs};
        RustGenerationSession {resolution:self.report,result:self.result,budget:self.budget}
    }
}
fn append(budget:&mut Budget,output:&mut String,value:&str)->Result<()> {budget.work(value.len()/16+1)?;budget.charge(value.len().saturating_mul(2)+64)?;output.push_str(value);Ok(())}

struct ExpressionEmitter<'a> {
    report:&'a SignatureResolution,types:&'a BTreeMap<TypeId,String>,fields:&'a BTreeMap<String,String>,functions:&'a BTreeMap<DeclarationId,String>,budget:&'a mut Budget,
}
impl ExpressionEmitter<'_> {
    fn expression(&mut self,index:usize)->Result<String> {
        self.budget.work(1)?;let report=self.report;let summary=&report.bodies.expressions[index];let source=report.types.source(summary.source);
        let unsupported=||fail("NeedsRustExpressionLowering",&source.expanded_path,"This checked expression has no lowering in the installed Rust source Method");
        match &summary.value {
            ValueRelation::Binding(binding)=>formatted(self.budget,format_args!("__gift_b_{}.clone()",binding.index())),
            ValueRelation::Let {binding,initializer,continuation}=>{
                let initializer=self.expression(*initializer)?;let continuation=self.expression(*continuation)?;
                formatted(self.budget,format_args!("{{ let __gift_b_{} = {initializer}; {continuation} }}",binding.index()))
            },
            ValueRelation::Choose(branches) if source.syntax.get("op").or_else(||source.syntax.get("tag")).and_then(Node::as_str)==Some("if")&&branches.len()==2&&summary.children.len()==3=>{
                let condition=self.expression(summary.children[0])?;let yes=self.expression(branches[0])?;let no=self.expression(branches[1])?;
                formatted(self.budget,format_args!("{{ let __gift_condition_{index} = {condition}; if __gift_condition_{index} {{ {yes} }} else {{ {no} }} }}"))
            },
            ValueRelation::Record(fields)=>{
                let NormalResult::Value(ty)=summary.normal else{return Err(unsupported());};let mut statements=String::new();let mut members=Vec::new();
                for (position,(name,expression)) in fields.iter().enumerate() {
                    let value=self.expression(*expression)?;let statement=formatted(self.budget,format_args!("let __gift_member_{index}_{position} = {value}; "))?;append(self.budget,&mut statements,&statement)?;
                    members.push(formatted(self.budget,format_args!("{}: __gift_member_{index}_{position}",self.fields[name]))?);
                }
                let members=joined(self.budget,&members,", ")?;formatted(self.budget,format_args!("{{ {statements} {} {{ {members} }} }}",self.types[&ty]))
            },
            ValueRelation::Field {receiver,name}=>{
                let value=self.expression(*receiver)?;formatted(self.budget,format_args!("{{ let __gift_receiver_{index} = {value}; __gift_receiver_{index}.{}.clone() }}",self.fields[name]))
            },
            ValueRelation::Call(call)=>{
                let call=&report.bodies.calls[*call];let Some(declaration)=call.callee else{return Err(unsupported());};
                self.budget.charge(call.arguments.len()*64+64)?;let mut formal=vec![String::new();call.arguments.len()];let mut statements=String::new();
                for (source_order,argument) in call.arguments.iter().enumerate() {
                    let value=self.expression(*argument)?;let name=formatted(self.budget,format_args!("__gift_call_{index}_{source_order}"))?;
                    let statement=formatted(self.budget,format_args!("let {name} = {value}; "))?;append(self.budget,&mut statements,&statement)?;
                    let slot=call.source_to_formal[source_order];if slot>=formal.len()||!formal[slot].is_empty(){return Err(fail("RustLoweringInvariant",&source.expanded_path,"CallFact is not a formal permutation"));}formal[slot]=name;
                }
                if formal.iter().any(String::is_empty){return Err(fail("RustLoweringInvariant",&source.expanded_path,"Missing formal slot"));}
                let arguments=joined(self.budget,&formal,", ")?;formatted(self.budget,format_args!("{{ {statements} {}({arguments}) }}",self.functions[&declaration]))
            },
            ValueRelation::Sequence {steps,result}=>{
                let mut statements=String::new();
                for step in steps {
                    if Some(*step)==*result{continue;}
                    let value=if let ValueRelation::Initialize {binding,initializer}=&report.bodies.expressions[*step].value {
                        let initializer=self.expression(*initializer)?;formatted(self.budget,format_args!("let __gift_b_{} = {initializer}; ",binding.index()))?
                    }else{let value=self.expression(*step)?;formatted(self.budget,format_args!("let _ = {value}; "))?};append(self.budget,&mut statements,&value)?;
                }
                let result=match result {Some(result)=>self.expression(*result)?,None=>self.budget.copy("()")?};formatted(self.budget,format_args!("{{ {statements} {result} }}"))
            },
            ValueRelation::Data=>{
                let NormalResult::Value(ty)=summary.normal else{return Err(unsupported());};let spelling=self.types.get(&ty).ok_or_else(unsupported)?;
                match spelling.as_str() {
                    "()" if summary.children.is_empty()=>self.budget.copy("()"),
                    "bool"=>match source.syntax.get("value").and_then(Node::as_bool){Some(value)=>self.budget.copy(if value{"true"}else{"false"}),None=>Err(unsupported())},
                    "::std::string::String"=>{let Some(value)=source.syntax.get("value").and_then(Node::as_str) else{return Err(unsupported());};let literal=crate::rust_syntax::text_literal(value,self.budget)?;formatted(self.budget,format_args!("::std::string::String::from({literal})"))},
                    _=>Err(unsupported()),
                }
            },
            _=>Err(unsupported()),
        }
    }
}

/// Actual compiled Method export. Captured manifests select this function's
/// address; they cannot assert that it, Callable or a target toolchain is ready.
pub fn emit(analysis:CallableAnalysis)->Result<RustGenerationSession> {
    let mut binding=RustLibraryBinding::new(analysis)?;binding.bind()?;binding.collect()?;
    if !binding.blocked {binding.plan()?;}
    if !binding.blocked {binding.source()?;}
    Ok(binding.finish())
}
