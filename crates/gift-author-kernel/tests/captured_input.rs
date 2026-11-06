use std::collections::BTreeSet;

use gift_author_kernel::{
    binding::{ImportBinding, Resolution},
    captured_input::{BindingLocation, BindingSlot, FixedContext, ModuleCapture, PreparedInput},
    signature_resolution::{self, SignatureResolution, SignatureState},
};
use serde_json::{json, Value};

fn context(project: &str, domain: &str) -> FixedContext {
    FixedContext::new(project, domain).unwrap()
}

fn module(id: &str, definitions: Value) -> Value {
    json!({"schema": "gift.author-module/design-converged", "moduleId": id, "definitions": definitions})
}

fn bytes(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).unwrap()
}

fn library() -> Vec<u8> {
    let mut value = module("Lib", json!({"R": {"kind": "core:type", "body": {
        "type": {"tag": "record", "fields": {"value": {"type": {"tag": "scalar", "name": "int"}}}}
    }}}));
    value["exports"] = json!({"record": {"definitionId": "R"}});
    bytes(value)
}

fn importer() -> Vec<u8> {
    let reference = |alias: &str| json!({"kind": "core:type", "body": {"type": {
        "tag": "nominal", "ref": {"space": "import", "alias": alias, "export": "record"}
    }}});
    let mut value = module("Root", json!({"Left": reference("left"), "Right": reference("right")}));
    value["imports"] = json!({"left": {"mode": "workspace", "moduleId": "Lib"},
        "right": {"mode": "workspace", "moduleId": "Lib"}});
    bytes(value)
}

fn target<'a>(analysis: &'a SignatureResolution, name: &str) -> &'a str {
    let path = format!("/definitions/{name}/body/type/ref");
    let reference = analysis.names.references.iter().find(|reference| reference.expanded_path == path).unwrap();
    let Resolution::Resolved {declaration, ..} = reference.resolution else {panic!("{:?}", reference.resolution)};
    let declaration = analysis.names.declarations.iter().find(|candidate| candidate.id == declaration).unwrap();
    &analysis.input().module_uses()[declaration.module.index()].resolution_domain
}

#[test]
fn the_owned_capture_survives_caller_buffer_replacement_and_release() {
    let original = br#"{
      "schema":"gift.author-module/design-converged", "moduleId":"Lifetime",
      "definitions":{"F":{"kind":"core:function","body":{
        "parameters":[],"returns":{"tag":"scalar","name":"int"},
        "body":{"op":"literal","type":{"tag":"scalar","name":"int"},
                "value":"900719925474099312345678901234567890"}
      }}}
    }"#.to_vec();
    let mut caller_buffer = original.clone();
    let capture = ModuleCapture::read(&caller_buffer, "unit.module.json", &context("project", "domain")).unwrap();
    caller_buffer.fill(b'!');
    drop(caller_buffer);
    let input = PreparedInput::from_modules(vec![capture], vec![], 0).unwrap();
    let analysis = signature_resolution::resolve_input(input).unwrap();
    assert_eq!(analysis.input().sources()[0].bytes(), original.as_slice());
    assert_eq!(analysis.input().locators()[0], "unit.module.json");
    let signature = analysis.signatures.iter().find(|signature| {
        analysis.names.declarations.iter().any(|declaration| declaration.id == signature.declaration && declaration.name == "F")
    }).unwrap();
    assert_eq!(signature.state, SignatureState::TypeReady);
    assert!(signature.body_type_checked);
    assert!(analysis.types.sources.iter().filter_map(|source| source.origin.as_ref())
        .all(|origin| origin.end <= original.len()));
}

#[test]
fn two_routes_share_one_real_use_but_competing_bytes_for_it_conflict() {
    let root = importer();
    let lib = library();
    let fixed = context("project", "domain");
    let input = PreparedInput::from_modules(vec![
        ModuleCapture::read(&root, "root.json", &fixed).unwrap(),
        ModuleCapture::read(&lib, "lib.json", &fixed).unwrap(),
    ], vec![
        ImportBinding {from: 0, alias: "left".into(), target: 1},
        ImportBinding {from: 0, alias: "right".into(), target: 1},
    ], 0).unwrap();
    let analysis = signature_resolution::resolve_input(input).unwrap();
    assert_eq!(analysis.names.modules.len(), 2);
    let declarations = ["Left", "Right"].into_iter().map(|name| {
        let path = format!("/definitions/{name}/body/type/ref");
        let reference = analysis.names.references.iter().find(|reference| reference.expanded_path == path).unwrap();
        let Resolution::Resolved {declaration, ..} = reference.resolution else {panic!("{:?}", reference.resolution)};
        declaration
    }).collect::<BTreeSet<_>>();
    assert_eq!(declarations.len(), 1);

    let conflicting = bytes(module("Lib", json!({"Changed": {"kind": "core:type", "body": {
        "type": {"tag": "scalar", "name": "bool"}
    }}})));
    let conflict_root = bytes(module("ConflictRoot", json!({"Independent": {
        "kind": "core:type", "body": {"type": {"tag": "scalar", "name": "bool"}}
    }})));
    PreparedInput::from_modules(vec![
        ModuleCapture::read(&conflict_root, "root.json", &fixed).unwrap(),
        ModuleCapture::read(&lib, "lib.json", &fixed).unwrap(),
    ], vec![], 0).unwrap();
    assert!(PreparedInput::from_modules(vec![
        ModuleCapture::read(&conflict_root, "root.json", &fixed).unwrap(),
        ModuleCapture::read(&lib, "lib.json", &fixed).unwrap(),
        ModuleCapture::read(&conflicting, "lib.json", &fixed).unwrap(),
    ], vec![], 0).is_err());
}

#[test]
fn identical_module_bytes_in_two_domains_keep_identity_and_actual_edge_evidence() {
    let root = importer();
    let lib = library();
    let analyze = |left_target, right_target| {
        let input = PreparedInput::from_modules(vec![
            ModuleCapture::read(&root, "root.json", &context("project", "root")).unwrap(),
            ModuleCapture::read(&lib, "left/lib.json", &context("project", "left-domain")).unwrap(),
            ModuleCapture::read(&lib, "right/lib.json", &context("project", "right-domain")).unwrap(),
        ], vec![
            ImportBinding {from: 0, alias: "left".into(), target: left_target},
            ImportBinding {from: 0, alias: "right".into(), target: right_target},
        ], 0).unwrap();
        signature_resolution::resolve_input(input).unwrap()
    };
    let first = analyze(1, 2);
    let swapped = analyze(2, 1);
    assert_eq!(first.input().module_uses().len(), 3);
    assert_eq!(target(&first, "Left"), "left-domain");
    assert_eq!(target(&first, "Right"), "right-domain");
    assert_eq!(target(&swapped, "Left"), "right-domain");
    assert_eq!(target(&swapped, "Right"), "left-domain");
    assert_ne!(first.input().basis(), swapped.input().basis(),
        "Identical captures cannot hide a changed actual import edge");
    assert_ne!(first.input().qualified_module_use(first.names.root.index()),
        swapped.input().qualified_module_use(swapped.names.root.index()));
}

#[test]
fn review_canonical_capture_order_preserves_dense_meanings_root_and_reference_terminals() {
    let root_bytes = importer();
    let lib_bytes = library();
    let fixed = context("project", "domain");
    let analyze = |reverse| {
        let root = ModuleCapture::read(&root_bytes, "root.json", &fixed).unwrap();
        let lib = ModuleCapture::read(&lib_bytes, "lib.json", &fixed).unwrap();
        let (captures, root_index, target_index) = if reverse {(vec![lib, root], 1, 0)}
            else {(vec![root, lib], 0, 1)};
        let imports = ["left", "right"].into_iter().map(|alias| ImportBinding {
            from: root_index, alias: alias.into(), target: target_index,
        }).collect();
        signature_resolution::resolve_input(PreparedInput::from_modules(captures, imports, root_index).unwrap()).unwrap()
    };
    let first = analyze(false);
    let reversed = analyze(true);
    assert_eq!(first.input().basis(), reversed.input().basis());
    assert_eq!(first.input().module_uses(), reversed.input().module_uses());
    assert_eq!(first.names.root, reversed.names.root);
    assert_eq!(first.names.modules[first.names.root.index()].module_id, "Root");
    assert_eq!(first.names.declarations.iter().map(|declaration| (declaration.id, declaration.module, &declaration.name)).collect::<Vec<_>>(),
        reversed.names.declarations.iter().map(|declaration| (declaration.id, declaration.module, &declaration.name)).collect::<Vec<_>>());
    for name in ["Left", "Right"] {
        let path = format!("/definitions/{name}/body/type/ref");
        let terminal = |analysis: &SignatureResolution| {
            let reference = analysis.names.references.iter().find(|reference| reference.expanded_path == path).unwrap();
            let Resolution::Resolved {declaration, ..} = reference.resolution else {panic!("{:?}", reference.resolution)};
            declaration
        };
        assert_eq!(terminal(&first), terminal(&reversed));
        let declaration = &first.names.declarations[terminal(&first).index()];
        assert_eq!(declaration.name, "R");
        assert_eq!(first.names.modules[declaration.module.index()].module_id, "Lib");
    }
}

#[test]
fn the_resolver_location_codec_keeps_legal_names_and_domains_injective() {
    let fixed = context("project", "domain");
    let coordinates = [
        ("a:b", "c"), ("a", "b:c"), ("a/b", "c"), ("a", "b/c"),
        ("é", ""), ("e\u{301}", ""), ("中文/~:{}", "[]:{}"),
    ];
    let mut keys = BTreeSet::new();
    for (module_id, alias) in coordinates {
        let mut source = module(module_id, json!({"Independent": {
            "kind": "core:type", "body": {"type": {"tag": "scalar", "name": "bool"}}
        }}));
        source["imports"] = json!({});
        source["imports"].as_object_mut().unwrap().insert(alias.into(),
            json!({"mode": "locked", "moduleId": "Lib", "constraint": "1"}));
        let source = bytes(source);
        let capture = ModuleCapture::read(&source, "owner.json", &fixed).unwrap();
        let analysis = signature_resolution::resolve_input(
            PreparedInput::from_modules(vec![capture], vec![], 0).unwrap()).unwrap();
        let location = BindingLocation::for_import(&fixed, module_id, alias);
        let key = location.encode().unwrap();
        assert!(keys.insert(key.clone()));
        let decoded = BindingLocation::decode(&key).unwrap();
        assert_eq!(decoded, location);
        assert_eq!(decoded.project_scope, "project");
        assert_eq!(decoded.module_id, module_id);
        assert_eq!(decoded.resolution_domain, "domain");
        let BindingSlot::Import {alias: actual_alias} = &decoded.slot;
        assert_eq!(actual_alias, alias);
        let actual_use = analysis.input().module_uses().iter().find(|use_| use_.module_id == module_id).unwrap().clone();
        assert_eq!(BindingLocation::import(actual_use, alias).encode().unwrap(), key);
    }
    let other_domain = BindingLocation::for_import(&context("project", "other-domain"), "a:b", "c").encode().unwrap();
    assert!(!keys.contains(&other_domain));
    let other_project = BindingLocation::for_import(&context("another-project", "domain"), "a:b", "c").encode().unwrap();
    assert!(!keys.contains(&other_project));
    assert!(BindingLocation::decode("a:b:c").is_err(), "Legacy delimiter guesses are not this fixed protocol");
}
