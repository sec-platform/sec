use gift_author_kernel::{captured_input::{BindingLocation,BindingSlot,FixedContext,ModuleCapture,PreparedInput,current_interpretation},
    grammar,project_input::{Preparation,PreparationState,CaptureObservation,CaptureOutcome,CaptureKind,DirectoryEntry,EntryKind},reader};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};

fn bytes(value:&Value)->Vec<u8> {serde_json::to_vec(value).unwrap()}
fn digest(value:&[u8])->String {format!("{:x}",Sha256::digest(value))}
fn context(physical:&str)->FixedContext {FixedContext::new(physical,"resolver:target").unwrap()}
fn file(path:&str,value:&[u8])->CaptureObservation {CaptureObservation::File {path:path.into(),outcome:CaptureOutcome::Found,bytes:value.into()}}
fn profile()->Value {json!({"schema":"gift.target-profile-manifest/design-converged","profile":{"id":"rust.source","revision":"1"},
    "publisher":"test:publisher","accepts":["core:function"],"representation":{"language":"rust","textIndexUnit":"unicode-scalar",
        "integerMode":"other-qualified","exceptionModel":"panic","moduleMode":"library"},
    "loweringRefs":[{"moduleId":"gift:rust-method","export":"source"}],"toolchainRequirements":[{"id":"rustc","revision":"source-only"}],
    "members":[{"role":"source","required":true,"pathPattern":"src/lib.rs"}],"host":{"effects":[],"runtimeRequirements":[]},
    "compatibility":{"policy":"exact","migrationRequired":false},"evidenceObligations":["source-preservation"]})}
struct Fixture {project:Value,module:Vec<u8>,profile:Vec<u8>,lock:Value}
impl Fixture {
    fn new(reference:Value)->Self {
        let module=bytes(&json!({"schema":"gift.author-module/design-converged","moduleId":"Main","definitions":{
            "F":{"kind":"core:function","body":{"parameters":[],"returns":{"tag":"scalar","name":"bool"},
                "body":{"op":"literal","type":{"tag":"scalar","name":"bool"},"value":true}}}},"exports":{}}));
        let project=json!({"schema":"gift.project/design-converged","projectId":"logical:target","sourceScopes":[{
            "root":"src","kind":"semantic","editSource":{"mode":"file"}}],"defaultTarget":"rust","targets":{"rust":{
                "profileRef":reference,"outputRoots":[{"rootId":"main","moduleId":"Main","export":""}],"parameters":{"opaque":"value"}}}});
        let profile=bytes(&profile());
        // An independent persistent coordinate, not an encode/decode oracle.
        // There is deliberately no module_id, locator, digest or host label.
        let key=format!("{{\"project_scope\":\"logical:target\",\"resolution_domain\":\"resolver:target\",\"interpretation\":{},\"slot\":{{\"role\":\"target_profile\",\"target\":\"rust\"}}}}",serde_json::to_string(current_interpretation()).unwrap());
        let mut lock=json!({"schema":"gift.binding-lock/1","projectId":"logical:target","resolutionInputs":{
            "resolver":serde_json::to_value(context("physical:original").resolver_binding()).unwrap(),"grammarRevision":grammar::revision(),"requests":{}},
            "bindings":{},"nodes":{"selected-profile":{"kind":"target-profile","subjectId":"rust.source","revision":"1",
                "dependencies":[],"locationHint":"profiles/source.json","content":{"algorithm":"sha256","digest":digest(&profile),"byteLength":profile.len(),
                    "format":"gift.target-profile-manifest/design-converged"}}}});
        lock["resolutionInputs"]["requests"].as_object_mut().unwrap().insert(key.clone(),project["targets"]["rust"]["profileRef"].clone());
        lock["bindings"].as_object_mut().unwrap().insert(key,json!("selected-profile"));
        Self {project,module,profile,lock}
    }
    fn prefix(prefix:&str,path:&str)->String {if prefix.is_empty(){path.into()}else{format!("{prefix}/{path}")}}
    fn preparation(&self,prefix:&str,physical:&str,selected:Option<Option<&str>>)->Preparation {
        let root=bytes(&self.project);reader::read(&root).unwrap();
        let mut preparation=Preparation::new(&root,&Self::prefix(prefix,"gift.project.json"),context(physical)).unwrap();
        if let Some(target)=selected {preparation.select_target(target).unwrap();}
        preparation
    }
    fn source_facts(&self,prefix:&str)->Vec<CaptureObservation> {vec![
        CaptureObservation::Directory {path:Self::prefix(prefix,"src"),outcome:CaptureOutcome::Complete,
            entries:vec![DirectoryEntry {name:"main.json".into(),kind:EntryKind::File,byte_length:self.module.len() as u64}]},
        file(&Self::prefix(prefix,"src/main.json"),&self.module),
    ]}
    fn all_facts(&self,prefix:&str)->Vec<CaptureObservation> {
        let mut facts=self.source_facts(prefix);facts.push(file(&Self::prefix(prefix,"gift.lock.json"),&bytes(&self.lock)));
        facts.push(file(&Self::prefix(prefix,"profiles/source.json"),&self.profile));facts
    }
    fn rehash_profile(&mut self) {self.lock["nodes"]["selected-profile"]["content"]["digest"]=json!(digest(&self.profile));
        self.lock["nodes"]["selected-profile"]["content"]["byteLength"]=json!(self.profile.len());}
}

#[test]
fn explicit_or_default_selection_retains_actual_locked_profile_without_qualification() {
    for (reference,selection) in [(json!({"id":"rust.source","revision":"1"}),Some("rust")),
        (json!("opaque:profiles/not-a-file.json"),None)] {
        let fixture=Fixture::new(reference);let mut preparation=fixture.preparation("","physical:original",Some(selection));
        let expected=fixture.lock["bindings"].as_object().unwrap().keys().next().unwrap();
        assert_eq!(preparation.target_profile_binding_location("rust").unwrap().encode().unwrap(),*expected);
        let status=preparation.advance(&fixture.all_facts("")).unwrap();assert_eq!(status.state,PreparationState::Prepared,"{:?}",status.needs);
        assert!(status.sources.iter().any(|source|source.locator=="profiles/source.json"&&source.revision==format!("sha256:{}",digest(&fixture.profile))));
        let input=preparation.finish().unwrap();let captured=input.capture();let selected=captured.selected_target().unwrap();
        assert_eq!(selected.name(),"rust");assert_eq!(selected.source_pointer(),"/targets/rust");
        assert_eq!(selected.candidate_basis(),captured.basis());assert_eq!(selected.project_id(),"logical:target");
        assert_eq!(selected.target().to_value(),fixture.project["targets"]["rust"]);
        assert_eq!(selected.target().get("outputRoots").unwrap().to_value(),fixture.project["targets"]["rust"]["outputRoots"]);
        assert_eq!(selected.target().get("outputRoots").unwrap().as_array().unwrap()[0].get("export").unwrap().as_str(),Some(""));
        let profile=captured.target_profile().unwrap();assert_eq!(profile.bytes(),fixture.profile);
        assert_eq!(profile.manifest().to_value(),serde_json::from_slice::<Value>(&fixture.profile).unwrap());
        assert_eq!(profile.node_id(),"selected-profile");assert_eq!(profile.selected_node().get("subjectId").unwrap().as_str(),Some("rust.source"));
        assert_eq!(profile.lock_revision(),format!("sha256:{}",digest(&bytes(&fixture.lock))));
        assert!(captured.observations().iter().any(|fact|matches!(fact,CaptureObservation::File {path,bytes,..} if path==profile.locator()&&bytes==profile.bytes())));
    }
}

#[test]
fn analysis_does_not_implicitly_select_a_target_or_read_a_profile_ref_as_path() {
    let fixture=Fixture::new(json!("profiles/not-a-file.json"));
    let mut analysis=fixture.preparation("","physical:original",None);
    let status=analysis.advance(&fixture.source_facts("")).unwrap();assert_eq!(status.state,PreparationState::Prepared);
    assert!(analysis.finish().unwrap().capture().selected_target().is_none());
    let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
    let status=preparation.advance(&fixture.source_facts("")).unwrap();
    assert_eq!(status.state,PreparationState::Waiting);
    assert_eq!(status.requests.iter().map(|request|request.path.as_str()).collect::<Vec<_>>(),["gift.lock.json"]);
    assert!(status.requests.iter().all(|request|request.kind==CaptureKind::File));
    let input=preparation.finish().unwrap();assert!(input.capture().selected_target().is_some());assert!(input.capture().target_profile().is_none());
    let capture=ModuleCapture::read(&fixture.module,"main.json",&context("short")).unwrap();
    assert!(PreparedInput::from_modules(vec![capture],vec![],0).unwrap().capture().selected_target().is_none());
}

#[test]
fn target_role_codec_preserves_import_bytes_and_rejects_mixed_owners() {
    let fixed=context("physical");let location=BindingLocation::for_target_profile(&fixed,"logical:target","a:/~目标");
    let key=location.encode().unwrap();let decoded=BindingLocation::decode(&key).unwrap();
    assert_eq!(decoded,location);assert_eq!(decoded.module_id,None);
    assert!(matches!(decoded.slot,BindingSlot::TargetProfile {ref target} if target=="a:/~目标"));
    for forged in [json!({"project_scope":"p","module_id":"fake","resolution_domain":"d","interpretation":"i","slot":{"role":"target_profile","target":"t"}}),
        json!({"project_scope":"p","resolution_domain":"d","interpretation":"i","slot":{"role":"import","alias":"a"}})] {
        assert!(BindingLocation::decode(&forged.to_string()).is_err());
    }
    let import=BindingLocation::for_import(&fixed,"Main","lib").encode().unwrap();
    let expected=format!("{{\"project_scope\":\"physical\",\"module_id\":\"Main\",\"resolution_domain\":\"resolver:target\",\"interpretation\":{},\"slot\":{{\"role\":\"import\",\"alias\":\"lib\"}}}}",serde_json::to_string(current_interpretation()).unwrap());
    assert_eq!(import,expected);
}

#[test]
fn negative_capture_outcomes_wait_without_repeat_and_retryable_outcomes_can_progress() {
    for (outcome,code) in [(CaptureOutcome::Absent,"SourceAbsent"),(CaptureOutcome::Denied,"SourceDenied"),
        (CaptureOutcome::Unavailable,"SourceUnavailable"),(CaptureOutcome::Failed,"SourceCaptureFailed")] {
        let fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));
        let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
        let mut facts=fixture.source_facts("");facts.push(file("gift.lock.json",&bytes(&fixture.lock)));
        let status=preparation.advance(&facts).unwrap();assert!(status.requests.iter().any(|request|request.path=="profiles/source.json"));
        let negative=CaptureObservation::File {path:"profiles/source.json".into(),outcome,bytes:vec![]};
        let status=preparation.advance(&[negative.clone()]).unwrap();assert_eq!(status.state,PreparationState::Waiting);
        assert!(status.needs.iter().any(|need|need.code==code),"{:?}",status.needs);assert!(status.requests.is_empty());
        assert!(preparation.advance(&[negative]).unwrap().requests.is_empty());
        let status=preparation.advance(&[file("profiles/source.json",&fixture.profile)]).unwrap();
        assert_eq!(status.state,if outcome==CaptureOutcome::Absent{PreparationState::Conflict}else{PreparationState::Prepared});
    }
}

#[test]
fn exact_request_resolver_selector_content_and_manifest_identities_are_independent_guards() {
    let changes:[fn(&mut Fixture);9]=[
        |fixture|fixture.project["targets"]["rust"]["profileRef"]["revision"]=json!("changed"),
        |fixture|fixture.lock["resolutionInputs"]["resolver"]["revision"]=json!("stale"),
        |fixture|fixture.lock["resolutionInputs"]["resolver"]["id"]=json!("another-resolver"),
        |fixture|fixture.lock["nodes"]["selected-profile"]["revision"]=json!("2"),
        |fixture|fixture.lock["nodes"]["selected-profile"]["content"]["digest"]=json!("0".repeat(64)),
        |fixture|fixture.lock["nodes"]["selected-profile"]["kind"]=json!("module"),
        |fixture|fixture.lock["nodes"]["selected-profile"]["subjectId"]=json!("another-profile"),
        |fixture|{let mut value=profile();value["profile"]["id"]=json!("other");fixture.profile=bytes(&value);fixture.rehash_profile();},
        |fixture|{let mut value=profile();value["profile"]["revision"]=json!("other");fixture.profile=bytes(&value);fixture.rehash_profile();},
    ];
    for (change,expected) in changes.into_iter().zip(["NeedsLockRequestBasis","NeedsLockInterpretation","NeedsLockInterpretation","NeedsLockedSelector","LockedContentMismatch","InvalidLockNode","InvalidLockNode","TargetProfileIdentityMismatch","TargetProfileIdentityMismatch"]) {
        let mut fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));change(&mut fixture);
        let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
        let status=preparation.advance(&fixture.all_facts("")).unwrap();
        assert_ne!(status.state,PreparationState::Prepared);
        assert!(status.needs.iter().any(|need|need.code==expected),"expected {expected}: {:?}",status.needs);
        assert!(status.sources.iter().any(|source|source.locator=="profiles/source.json"));
    }
}

#[test]
fn profile_uses_the_current_reader_graph_and_strict_source_decoder() {
    for (raw,code) in [(bytes(&{let mut value=profile();value["schema"]=json!("gift.target-profile-manifest/1");value}),"InvalidTargetProfile"),
        (br#"{"schema":"gift.target-profile-manifest/design-converged","profile":{},"profile":{}}"#.to_vec(),"InvalidAuthorSource")] {
        let mut fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));fixture.profile=raw;fixture.rehash_profile();
        let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
        let status=preparation.advance(&fixture.all_facts("")).unwrap();assert_eq!(status.state,PreparationState::Stopped);
        assert!(status.needs.iter().any(|need|need.code==code),"{:?}",status.needs);
    }
}

#[test]
fn persistent_target_key_survives_source_edits_and_relocation_but_capture_basis_does_not() {
    let fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));
    let mut changed=Fixture::new(json!({"id":"rust.source","revision":"1"}));
    let mut module:Value=serde_json::from_slice(&changed.module).unwrap();module["definitions"]["F"]["body"]["body"]["value"]=json!(false);changed.module=bytes(&module);
    let mut retained=Vec::new();
    for (fixture,prefix,physical) in [(&fixture,"","physical:original"),(&changed,"","physical:original"),(&fixture,"moved","physical:moved")] {
        let mut preparation=fixture.preparation(prefix,physical,Some(Some("rust")));
        assert_eq!(preparation.advance(&fixture.all_facts(prefix)).unwrap().state,PreparationState::Prepared);
        retained.push(preparation.finish().unwrap());
    }
    let first=retained[0].capture().selected_target().unwrap();
    for input in &retained[1..] {
        let next=input.capture().selected_target().unwrap();assert_eq!(first.binding_location(),next.binding_location());
        assert_ne!(first.candidate_basis(),next.candidate_basis());
        assert_eq!(first.profile().unwrap().selected_node().to_value(),next.profile().unwrap().selected_node().to_value());
        assert_eq!(next.candidate_basis(),input.capture().basis());
    }
}

#[test]
fn target_defaults_and_dependency_frontiers_are_not_silently_filled() {
    let mut fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));fixture.project.as_object_mut().unwrap().remove("defaultTarget");
    let mut preparation=fixture.preparation("","physical:original",Some(None));
    assert!(preparation.advance(&fixture.source_facts("")).unwrap().needs.iter().any(|need|need.code=="NeedsTargetSelection"));
    assert_eq!(preparation.select_target(Some("rust")).unwrap_err().code,"InputConflict");
    fixture.lock["nodes"]["selected-profile"]["dependencies"]=json!(["method-input"]);
    let dependency=fixture.module.clone();fixture.lock["nodes"]["method-input"]=json!({"kind":"module","subjectId":"Main","revision":"1","dependencies":[],
        "locationHint":"methods/input.json","content":{"algorithm":"sha256","digest":digest(&dependency),"byteLength":dependency.len(),"format":"gift.author-module/design-converged"}});
    let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
    let status=preparation.advance(&fixture.all_facts("")).unwrap();assert_eq!(status.state,PreparationState::Waiting);
    assert!(status.requests.iter().any(|request|request.path=="methods/input.json"));
    let denied=CaptureObservation::File {path:"methods/input.json".into(),outcome:CaptureOutcome::Denied,bytes:vec![]};
    let status=preparation.advance(&[denied]).unwrap();assert!(status.requests.is_empty());assert!(status.needs.iter().any(|need|need.code=="SourceDenied"));
    let status=preparation.advance(&[file("methods/input.json",&dependency)]).unwrap();assert_eq!(status.state,PreparationState::Prepared);
    assert!(preparation.finish().unwrap().capture().target_profile().is_some());
}

#[test]
fn missing_binding_locator_and_content_interpretation_remain_typed_needs() {
    let changes:[fn(&mut Fixture);3]=[
        |fixture|{fixture.lock["bindings"].as_object_mut().unwrap().clear();},
        |fixture|{fixture.lock["nodes"]["selected-profile"].as_object_mut().unwrap().remove("locationHint");},
        |fixture|{fixture.lock["nodes"]["selected-profile"]["content"]["format"]=json!("unknown");},
    ];
    for (change,code) in changes.into_iter().zip(["NeedsLockBinding","NeedsLockedContent","NeedsLockedContentProfile"]) {
        let mut fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));change(&mut fixture);
        let mut preparation=fixture.preparation("","physical:original",Some(Some("rust")));
        let status=preparation.advance(&fixture.all_facts("")).unwrap();assert_eq!(status.state,PreparationState::Waiting);
        assert!(status.needs.iter().any(|need|need.code==code),"{:?}",status.needs);
        let input=preparation.finish().unwrap();assert!(input.capture().selected_target().is_some());assert!(input.capture().target_profile().is_none());
    }
}

#[test]
fn profile_capture_consumes_the_same_run_remaining_byte_budget() {
    use gift_author_kernel::project_input::PreparationLimits;
    let fixture=Fixture::new(json!({"id":"rust.source","revision":"1"}));let root=bytes(&fixture.project);
    let lock=bytes(&fixture.lock);let limit=root.len()+fixture.module.len()+lock.len()+fixture.profile.len()-1;
    let mut preparation=Preparation::with_limits(&root,"gift.project.json",context("physical:original"),PreparationLimits {bytes:limit as u64,..PreparationLimits::default()}).unwrap();
    preparation.select_target(Some("rust")).unwrap();
    let mut facts=fixture.source_facts("");facts.push(file("gift.lock.json",&lock));
    let status=preparation.advance(&facts).unwrap();assert_eq!(status.state,PreparationState::Waiting);
    assert!(status.requests.iter().any(|request|request.path=="profiles/source.json"));
    let profile=file("profiles/source.json",&fixture.profile);
    let status=preparation.advance(&[profile.clone()]).unwrap();assert_eq!(status.state,PreparationState::Stopped);
    assert!(status.needs.iter().any(|need|need.code=="ResourceLimit"));
    assert_eq!(preparation.advance(&[profile]).unwrap().state,PreparationState::Stopped);
}
