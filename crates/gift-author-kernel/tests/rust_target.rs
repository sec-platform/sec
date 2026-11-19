use gift_author_kernel::{captured_input::{BindingLocation,FixedContext},effect_analysis::EffectLimits,
    grammar,project_input::{Preparation,CaptureObservation,CaptureOutcome,DirectoryEntry,EntryKind,PreparationState},
    reader,rust_target::{self,RustGenerationSession,RustGenerationState},signature_resolution};
use serde_json::{json,Value};use sha2::{Digest,Sha256};
fn scalar(name:&str)->Value {json!({"tag":"scalar","name":name})}
fn var(name:&str)->Value {json!({"op":"var","name":name})}
fn literal(name:&str,value:Value)->Value {json!({"op":"literal","type":scalar(name),"value":value})}
fn symbol(name:&str)->Value {json!({"op":"symbol","ref":format!("local:{name}")})}
fn call(name:&str,args:Value)->Value {json!({"op":"call","callee":symbol(name),"arguments":args})}
fn function(parameters:Value,returns:Value,body:Value)->Value {json!({"kind":"core:function","body":{"parameters":parameters,"returns":returns,"body":body}})}
fn module(id:&str,definitions:Value,exports:Value)->Value {json!({"schema":"gift.author-module/design-converged","moduleId":id,"definitions":definitions,"exports":exports})}
fn bytes(value:&Value)->Vec<u8> {serde_json::to_vec(value).unwrap()}
fn digest(value:&[u8])->String {format!("{:x}",Sha256::digest(value))}
fn file(path:&str,value:&[u8])->CaptureObservation {CaptureObservation::File {path:path.into(),outcome:CaptureOutcome::Found,bytes:value.into()}}
struct Fixture {modules:Vec<Value>,project:Value,profile:Value,lock:Option<Value>,extra:Vec<CaptureObservation>}
impl Fixture {
    fn new(module:Value)->Self {
        Self {modules:vec![module],project:json!({"schema":"gift.project/design-converged","projectId":"project:rust","sourceScopes":[{
            "root":"src","kind":"semantic","editSource":{"mode":"file"}}],"defaultTarget":"rust","targets":{"rust":{
                "profileRef":{"id":"rust.source","revision":"1"},"outputRoots":[{"rootId":"main","moduleId":"Main","export":"run"}],
                "parameters":{"edition":"2024","crateName":"gift_generated","stdProfile":"std","crateShape":"library","emit":"source"}}}}),
            profile:json!({"schema":"gift.target-profile-manifest/design-converged","profile":{"id":"rust.source","revision":"1"},"publisher":"test",
                "accepts":["core:function"],"representation":{"language":"rust","textIndexUnit":"unicode-scalar","integerMode":"other-qualified","exceptionModel":"panic","moduleMode":"library"},
                "loweringRefs":[{"moduleId":"gift:rust-source-library","export":"emit"}],"toolchainRequirements":[{"id":"rustc","revision":"declared-not-materialized"}],
                "members":[{"role":"source","required":true,"pathPattern":"lib.rs"}],"host":{"effects":[],"runtimeRequirements":["std"]},
                "compatibility":{"policy":"exact","migrationRequired":false},"evidenceObligations":["source-preservation","source-map"]}),lock:None,extra:Vec::new()}
    }
    fn boolean()->Self {Self::new(module("Main",json!({"F":function(json!([{"name":"x","type":scalar("bool")}]),scalar("bool"),var("x"))}),json!({"run":{"definitionId":"F"}})))}
    fn fixed()->FixedContext {FixedContext::new("physical:rust","resolver:rust").unwrap()}
    fn default_lock(&self)->Value {
        let key=BindingLocation::for_target_profile(&Self::fixed(),"project:rust","rust").encode().unwrap();let profile=bytes(&self.profile);
        let mut lock=json!({"schema":"gift.binding-lock/1","projectId":"project:rust","resolutionInputs":{"resolver":Self::fixed().resolver_binding(),"grammarRevision":grammar::revision(),"requests":{}},
            "bindings":{},"nodes":{"profile":{"kind":"target-profile","subjectId":"rust.source","revision":"1","dependencies":[],"locationHint":"profiles/rust.json",
                "content":{"algorithm":"sha256","digest":digest(&profile),"byteLength":profile.len(),"format":"gift.target-profile-manifest/design-converged"}}}});
        lock["resolutionInputs"]["requests"].as_object_mut().unwrap().insert(key.clone(),self.project["targets"]["rust"]["profileRef"].clone());lock["bindings"].as_object_mut().unwrap().insert(key,json!("profile"));lock
    }
    fn prepare(&self)->gift_author_kernel::captured_input::PreparedInput {
        let root=bytes(&self.project);reader::read(&root).expect("Actual selected Project grammar");
        let mut preparation=Preparation::new(&root,"gift.project.json",Self::fixed()).unwrap();preparation.select_target(None).unwrap();
        let mut facts=Vec::new();let mut entries=Vec::new();
        for (index,module) in self.modules.iter().enumerate() {
            let source=bytes(module);reader::read(&source).expect("Actual selected Module grammar");let name=format!("module-{index}.json");
            entries.push(DirectoryEntry {name:name.clone(),kind:EntryKind::File,byte_length:source.len() as u64});facts.push(file(&format!("src/{name}"),&source));
        }
        facts.push(CaptureObservation::Directory {path:"src".into(),outcome:CaptureOutcome::Complete,entries});
        facts.push(file("gift.lock.json",&bytes(&self.lock.clone().unwrap_or_else(||self.default_lock()))));facts.push(file("profiles/rust.json",&bytes(&self.profile)));facts.extend(self.extra.clone());
        let status=preparation.advance(&facts).unwrap();assert_eq!(status.state,PreparationState::Prepared,"{:?}",status.needs);preparation.finish().unwrap()
    }
    fn generate(&self)->RustGenerationSession {
        let prepared=signature_resolution::prepare_input(self.prepare()).unwrap();
        let callable=prepared.close_analysis(EffectLimits::default()).unwrap().freeze_callables().unwrap();
        rust_target::rust_library_method().generate(callable).unwrap()
    }
}
fn code(session:&RustGenerationSession)->&str {assert!(session.result().members_complete,"{:?}",session.result());assert_eq!(session.result().artifacts.len(),1);&session.result().artifacts[0].content}

#[test]
fn actual_method_binds_profile_and_emits_a_complete_library_with_original_sources() {
    let fixture=Fixture::boolean();let session=fixture.generate();let result=session.result();assert_eq!(result.state,RustGenerationState::Complete,"{result:?}");
    assert_eq!(result.input_basis,session.resolution().input().basis());assert_eq!(result.method.module_id,"gift:rust-source-library");assert_eq!(result.method.export,"emit");
    assert_eq!(result.method.implementation_revision,grammar::rules_revision());assert_eq!(result.provenance.as_ref().unwrap().profile_source_revision,format!("sha256:{}",digest(&bytes(&fixture.profile))));
    assert_eq!(result.context.as_ref().unwrap().crate_name,"gift_generated");assert!(code(&session).contains("pub fn r#run("));assert!(code(&session).starts_with("#![crate_name = \"gift_generated\"]"));
    assert!(result.unrequested_checks.iter().any(|check|check=="toolchain-materialization"));
    for mapping in &result.source_map {assert_eq!(mapping.source_revision,session.resolution().names.modules[mapping.source_module].source_revision);assert_eq!(mapping.artifact,"lib.rs");assert!(mapping.start_line>0&&mapping.end_line>=mapping.start_line);}
}

#[test]
fn aliases_bool_control_and_runtime_recursion_use_the_original_semantic_session() {
    let mut fixture=Fixture::boolean();
    fixture.modules[0]["definitions"]=json!({
        "Alias":{"kind":"core:type","body":{"type":scalar("bool")}},
        "F":function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:Alias"}}]),scalar("bool"),json!({"op":"if","condition":var("x"),
            "then":call("G",json!([literal("bool",json!(false))])),"otherwise":literal("bool",json!(true))})),
        "G":function(json!([{"name":"x","type":scalar("bool")}]),scalar("bool"),call("F",json!([var("x")])))
    });
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Complete,"{:?}",session.result());
    assert!(code(&session).contains("if __gift_condition_"));assert_eq!(session.result().dependencies.len(),2);
    let ids=session.result().dependencies.iter().map(|entry|entry.declaration).collect::<Vec<_>>();
    assert!(session.result().dependencies.iter().all(|entry|entry.callees.iter().any(|callee|ids.contains(callee))));
}

#[test]
fn structural_records_and_text_reuse_have_one_layout_and_preserve_lexical_shadowing() {
    let record=json!({"tag":"record","fields":{"first":{"type":scalar("text")},"second":{"type":scalar("text")}}});
    let fixture=Fixture::new(module("Main",json!({
        "Make":function(json!([{"name":"x","type":scalar("text")}]),record.clone(),json!({"op":"record","fields":[{"name":"first","value":var("x")},{"name":"second","value":var("x")}]})),
        "Pick":function(json!([{"name":"r","type":record}]),scalar("text"),json!({"op":"field","record":var("r"),"name":"first"})),
        "F":function(json!([{"name":"x","type":scalar("text")}]),scalar("text"),json!({"op":"let","name":"x","value":var("x"),"body":call("Pick",json!([call("Make",json!([var("x")]))]))}))
    }),json!({"run":{"definitionId":"F"}})));
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Complete,"{:?}",session.result());let code=code(&session);
    assert_eq!(code.matches("pub struct ").count(),1);assert!(code.contains("pub r#first: ::std::string::String"));assert!(code.contains(".r#first.clone()"));
    let bindings=session.resolution().names.lexical.bindings.iter().filter(|binding|binding.name=="x").collect::<Vec<_>>();assert!(bindings.len()>=3);
    let f=session.resolution().names.declarations.iter().find(|decl|decl.name=="F").unwrap();
    let own=bindings.iter().filter(|binding|session.resolution().names.lexical.occurrences[binding.occurrence.index()].owner==Some(f.id)).collect::<Vec<_>>();
    assert_eq!(own.len(),2);assert!(code.contains(&format!("let __gift_b_{} = __gift_b_{}.clone()",own[1].id.index(),own[0].id.index())));
    assert!(code.contains("let __gift_call_"));assert!(code.matches(".clone()").count()>=4);
}

#[test]
fn exact_empty_export_and_field_mappings_preserve_unicode_and_nul_text() {
    let record=json!({"tag":"record","fields":{"a/b":{"type":scalar("text")}}});
    let value="\0中文e\u{301}\"\\\n";
    let mut fixture=Fixture::new(module("Main",json!({"F":function(json!([]),record,json!({"op":"record","fields":[{"name":"a/b","value":literal("text",json!(value))}]}))}),json!({"":{"definitionId":"F"}})));
    fixture.project["targets"]["rust"]["outputRoots"][0]["export"]=json!("");
    fixture.project["targets"]["rust"]["parameters"]["publicNameMappings"]=json!([{"rootId":"main","export":"","rustName":"mapped"}]);
    fixture.project["targets"]["rust"]["parameters"]["fieldNameMappings"]=json!([{"field":"a/b","rustName":"value"}]);
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Complete,"{:?}",session.result());
    let code=code(&session);assert!(code.contains("pub fn r#mapped("));assert!(code.contains("r#value"));assert!(!code.contains('\0'));assert!(code.contains("\\0")||code.contains("\\u{0}"));
    assert_eq!(session.result().exports[0].export,"");assert_eq!(session.resolution().input().selected_target().unwrap().target().get("outputRoots").unwrap().as_array().unwrap()[0].get("export").unwrap().as_str(),Some(""));
}

#[test]
fn roots_routes_collisions_and_empty_public_sets_do_not_guess_an_entry() {
    let mut fixture=Fixture::boolean();fixture.modules[0]["exports"]=json!({"one":{"definitionId":"F"},"two":{"definitionId":"F"}});
    fixture.project["targets"]["rust"]["outputRoots"]=json!([{"rootId":"left","moduleId":"Main","export":"one"},{"rootId":"right","moduleId":"Main","export":"two"}]);
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Complete);assert_eq!(session.result().exports.len(),2);assert_eq!(session.result().dependencies.len(),1);
    fixture.project["targets"]["rust"]["parameters"]["publicNameMappings"]=json!([{"rootId":"left","export":"one","rustName":"same"},{"rootId":"right","export":"two","rustName":"same"}]);
    let collision=fixture.generate();assert_eq!(collision.result().state,RustGenerationState::Rejected);assert!(collision.result().artifacts.is_empty());
    assert!(collision.result().problems.iter().any(|problem|problem.code=="RustPublicNameCollision"));
    let mut empty=Fixture::boolean();empty.modules[0]["exports"]=json!({});empty.project["targets"]["rust"]["outputRoots"][0].as_object_mut().unwrap().remove("export");
    let session=empty.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(session.result().artifacts.is_empty());
    assert!(session.result().needs.iter().any(|need|need.code=="NeedsRustOutputRootEntry"));
}

#[test]
fn cross_module_reexports_keep_exact_route_and_each_source_revision() {
    let library=module("Lib",json!({"F":function(json!([]),scalar("bool"),literal("bool",json!(true)))}),json!({"value":{"definitionId":"F"}}));
    let mut facade=module("Main",json!({}),json!({"run":{"import":"lib","export":"value"}}));facade["imports"]=json!({"lib":{"mode":"workspace","moduleId":"Lib"}});
    let mut fixture=Fixture::new(facade);fixture.modules.push(library);
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Complete,"{:?}",session.result());
    let export=&session.result().exports[0];assert!(export.route.len()>=2);
    let declaration=&session.resolution().names.declarations[export.declaration];assert_eq!(session.resolution().names.modules[declaration.module.index()].module_id,"Lib");
    assert_ne!(declaration.module.index(),export.root_module);
    assert!(session.result().source_map.iter().all(|mapping|mapping.source_module==declaration.module.index()&&mapping.source_revision==format!("sha256:{}",digest(&bytes(&fixture.modules[1])))));
}

#[test]
fn nominal_identity_unsupported_types_and_bad_modules_cannot_be_hidden_by_good_exports() {
    let mut fixture=Fixture::boolean();
    fixture.modules[0]["definitions"]["Node"]=json!({"kind":"core:type","body":{"type":{"tag":"record","fields":{"flag":{"type":scalar("bool")}}}}});
    fixture.modules[0]["definitions"]["F"]=function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:Node"}}]),json!({"tag":"nominal","ref":"local:Node"}),var("x"));
    fixture.modules[0]["exports"]["Node"]=json!({"definitionId":"Node"});
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(!session.result().members_complete);assert!(session.result().artifacts.is_empty());
    assert!(session.result().needs.iter().any(|need|need.code=="NeedsRustNominalRepresentation"));
    let mut bad=Fixture::boolean();bad.modules[0]["definitions"]["Bad"]=function(json!([]),scalar("bool"),json!({"op":"call","callee":literal("bool",json!(true)),"arguments":[]}));
    let session=bad.generate();assert_eq!(session.result().state,RustGenerationState::Rejected);assert!(session.result().artifacts.is_empty());assert!(!session.result().problems.is_empty());
    let mut unsupported=Fixture::boolean();unsupported.modules[0]["definitions"]["Other"]=function(json!([{"name":"x","type":scalar("int")}]),scalar("int"),var("x"));
    unsupported.modules[0]["exports"]["other"]=json!({"definitionId":"Other"});unsupported.project["targets"]["rust"]["outputRoots"][0].as_object_mut().unwrap().remove("export");
    let session=unsupported.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(session.result().artifacts.is_empty());assert!(!session.result().members_complete);
}

#[test]
fn unknown_profile_and_parameters_are_not_ignored_while_checks_are_not_invented() {
    for change in [0,1,2,3] {
        let mut fixture=Fixture::boolean();match change {
            0=>fixture.profile["loweringRefs"].as_array_mut().unwrap().push(json!({"moduleId":"other","export":"method"})),
            1=>fixture.profile["host"]["effects"]=json!(["io"]),
            2=>fixture.project["targets"]["rust"]["parameters"]["unknown"]=json!(true),
            _=>{fixture.project["targets"]["rust"]["parameters"].as_object_mut().unwrap().remove("edition");},
        }
        let session=fixture.generate();assert_ne!(session.result().state,RustGenerationState::Complete);assert!(session.result().artifacts.is_empty());
    }
    let mut requested=Fixture::boolean();requested.profile["evidenceObligations"].as_array_mut().unwrap().push(json!("rustc-compilation"));
    let session=requested.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(session.result().members_complete);assert!(session.result().needs.iter().any(|need|need.code=="NeedsRustRequestedCheck"));
    assert!(!session.result().unrequested_checks.iter().any(|check|check=="rustc-compilation"));
}

#[test]
fn unicode_name_conformance_is_local_and_never_silently_normalizes_author_names() {
    let mut fixture=Fixture::boolean();fixture.modules[0]["exports"]=json!({"名字":{"definitionId":"F"}});
    fixture.project["targets"]["rust"]["outputRoots"][0]["export"]=json!("名字");
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(session.result().members_complete);assert!(code(&session).contains("pub fn r#名字("));
    assert!(session.result().needs.iter().any(|need|need.code=="NeedsRustUnicodeConformance"));
    fixture.modules[0]["exports"]=json!({"e\u{301}":{"definitionId":"F"}});fixture.project["targets"]["rust"]["outputRoots"][0]["export"]=json!("e\u{301}");
    let session=fixture.generate();assert_eq!(session.result().state,RustGenerationState::Needs);assert!(!session.result().members_complete);assert!(session.result().needs.iter().any(|need|need.code=="NeedsRustNameMapping"));
}

#[test]
fn required_module_typing_must_complete_without_requiring_unused_target_or_professional_qualifications() {
    use gift_author_kernel::{header_seeds::HeaderKind,signature_resolution::SignatureState};
    let mut pending=Fixture::boolean();
    pending.modules[0]["definitions"]["Bad"]=json!({"kind":"core:function","body":{"parameters":[],"body":{"op":"sequence","items":[]}}});
    let session=pending.generate();let bad=session.resolution().names.declarations.iter().find(|declaration|declaration.name=="Bad").unwrap().id;
    let signature=session.resolution().signatures.iter().find(|signature|signature.declaration==bad).unwrap();
    assert_eq!(signature.state,SignatureState::NeedsAnnotation);
    assert_eq!(session.result().state,RustGenerationState::Needs,"A selected module's pending typing is not an unused target representation: {:?}",session.result());
    assert!(session.result().artifacts.is_empty());assert!(!session.result().members_complete);
    let original=session.resolution().needs.iter().find(|need|need.code=="AnnotationRequired"&&session.resolution().types.source(need.source).owner==Some(bad)).unwrap();
    let source=session.resolution().types.source(original.source);
    assert!(session.result().needs.iter().any(|need|need.code==original.code&&need.path==source.expanded_path&&need.locator==session.resolution().input().locators()[source.module.index()]));

    let mut independent=Fixture::boolean();
    independent.modules[0]["definitions"]["UnusedInt"]=function(json!([{"name":"x","type":scalar("int")}]),scalar("int"),var("x"));
    independent.modules[0]["definitions"]["UnusedRequirement"]=json!({"kind":"req:composite","body":{"parameters":{},"terms":[]}});
    let session=independent.generate();assert_eq!(session.result().state,RustGenerationState::Complete,"{:?}",session.result());
    assert!(session.resolution().headers.iter().any(|header|matches!(&header.kind,HeaderKind::Uninterpreted {kind,..} if kind=="req:composite")));
    let int=session.resolution().names.declarations.iter().find(|declaration|declaration.name=="UnusedInt").unwrap().id;
    assert!(session.resolution().signatures.iter().any(|signature|signature.declaration==int&&signature.state==SignatureState::TypeReady&&signature.body_type_checked));
    assert!(!session.result().needs.iter().any(|need|need.code=="NeedsRustTypeRepresentation"));
}
