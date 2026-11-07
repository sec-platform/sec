use std::collections::{BTreeMap, BTreeSet};

use gift_author_kernel::{
    binding::Resolution,
    captured_input::{BindingLocation, FixedContext},
    grammar,
    model::Diagnostic,
    project_input::{
        CaptureKind, CaptureObservation, CaptureOutcome, CaptureRequest, DirectoryEntry, EntryKind,
        Preparation, PreparationLimits, PreparationState, PreparationStatus,
    },
    reader,
    signature_resolution::{self, SignatureState},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn module(module_id: &str, definitions: Value) -> Value {
    json!({"schema": "gift.author-module/design-converged", "moduleId": module_id,
        "definitions": definitions})
}

fn integer_function(value: &str) -> Value {
    json!({"kind": "core:function", "body": {"parameters": [],
        "returns": {"tag": "scalar", "name": "int"}, "body": {
            "op": "literal", "type": {"tag": "scalar", "name": "int"}, "value": value
        }}})
}

fn imported_call(alias: &str, export: &str) -> Value {
    json!({"kind": "core:function", "body": {"parameters": [],
        "returns": {"tag": "scalar", "name": "int"}, "body": {
            "op": "call", "callee": {"op": "symbol", "ref": {
                "space": "import", "alias": alias, "export": export
            }}, "arguments": []
        }}})
}

fn scope(root: &str) -> Value {
    json!({"root": root, "kind": "semantic", "editSource": {"mode": "file"}})
}

fn project(scopes: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema": "gift.project/design-converged",
        "projectId": "project:test", "sourceScopes": scopes})).unwrap()
}

fn context() -> FixedContext {
    FixedContext::new("project:test:instance", "resolution:test").unwrap()
}

fn file(path: &str, bytes: &[u8]) -> CaptureObservation {
    CaptureObservation::File {path: path.into(), outcome: CaptureOutcome::Found, bytes: bytes.into()}
}

fn directory(path: &str, outcome: CaptureOutcome, entries: Vec<DirectoryEntry>) -> CaptureObservation {
    CaptureObservation::Directory {path: path.into(), outcome, entries}
}

fn entry(name: &str, kind: EntryKind, byte_length: usize) -> DirectoryEntry {
    DirectoryEntry {name: name.into(), kind, byte_length: byte_length as u64}
}

/// A fixed finite observation provider, without a pattern or module resolver.
/// Expected selection is independently stated by each test.
#[derive(Default)]
struct Fixture {
    files: BTreeMap<String, Vec<u8>>,
    directories: BTreeMap<String, Vec<(&'static str, bool)>>,
    requests: Vec<String>,
}

impl Fixture {
    fn answer(&mut self, request: &CaptureRequest) -> CaptureObservation {
        assert!(!request.path.starts_with('/'));
        assert!(!request.path.split('/').any(|segment| segment == ".."));
        if request.scope_root != "." && !request.scope_root.is_empty() {
            assert!(request.path == request.scope_root
                || request.path.strip_prefix(&request.scope_root).is_some_and(|tail| tail.starts_with('/')),
                "A capture request cannot escape its retained project root");
        }
        self.requests.push(request.path.clone());
        match &request.kind {
            CaptureKind::File => file(&request.path, self.files.get(&request.path)
                .unwrap_or_else(|| panic!("Unexpected file acquisition {}", request.path))),
            CaptureKind::Directory => {
                let entries = self.directories.get(&request.path)
                    .unwrap_or_else(|| panic!("Unexpected directory acquisition {}", request.path))
                    .iter().map(|(name, is_directory)| {
                        let path = if request.path == "." {(*name).to_owned()}
                            else {format!("{}/{name}", request.path)};
                        if *is_directory {entry(name, EntryKind::Directory, 0)}
                        else {entry(name, EntryKind::File, self.files[&path].len())}
                    }).collect();
                directory(&request.path, CaptureOutcome::Complete, entries)
            }
        }
    }

    fn complete(&mut self, preparation: &mut Preparation) -> PreparationStatus {
        self.complete_result(preparation).unwrap()
    }

    fn complete_result(&mut self, preparation: &mut Preparation) -> Result<PreparationStatus, Diagnostic> {
        let mut status = preparation.advance(&[])?;
        for _ in 0..32 {
            if status.requests.is_empty() || matches!(status.state,
                PreparationState::Conflict | PreparationState::Stopped) {
                return Ok(status);
            }
            let observations = status.requests.iter().map(|request| self.answer(request)).collect::<Vec<_>>();
            status = preparation.advance(&observations)?;
        }
        panic!("A fixed small fixture must converge without repeating acquisition requests");
    }

    fn acquired_files(&self) -> BTreeSet<&str> {
        self.requests.iter().filter(|path| self.files.contains_key(*path)).map(String::as_str).collect()
    }

    fn relocated(self, prefix: &str) -> Self {
        Self {
            files: self.files.into_iter().map(|(path, bytes)| (format!("{prefix}{path}"), bytes)).collect(),
            directories: self.directories.into_iter().map(|(path, entries)| (format!("{prefix}{path}"), entries)).collect(),
            requests: Vec::new(),
        }
    }
}

fn facade_fixture() -> Fixture {
    let mut a = module("A", json!({"Leaf": integer_function("9"),
        "Via": imported_call("via", "relay"), "Same": imported_call("same", "relay")}));
    a["imports"] = json!({"via": {"mode": "workspace", "moduleId": "B"},
        "same": {"mode": "workspace", "moduleId": "B"}});
    a["exports"] = json!({"leaf": {"definitionId": "Leaf"}});
    let mut b = module("B", json!({}));
    b["imports"] = json!({"base": {"mode": "workspace", "moduleId": "A"}});
    b["exports"] = json!({"relay": {"import": "base", "export": "leaf"}});
    Fixture {
        files: BTreeMap::from([
            ("src/a.module.json".into(), serde_json::to_vec(&a).unwrap()),
            ("src/b.module.json".into(), serde_json::to_vec(&b).unwrap()),
        ]),
        directories: BTreeMap::from([("src".into(), vec![("a.module.json", false), ("b.module.json", false)])]),
        requests: Vec::new(),
    }
}

#[test]
fn a_real_project_reuses_workspace_uses_through_both_facade_routes() {
    let root = project(json!([scope("src")]));
    reader::read(&root).unwrap();
    for reverse_entries in [false, true] {
        let mut fixture = facade_fixture();
        if reverse_entries {fixture.directories.get_mut("src").unwrap().reverse();}
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        let status = fixture.complete(&mut preparation);
        assert!(!matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{:?}", status.needs);
        assert!(status.requests.is_empty());
        assert_eq!(status.module_uses.len(), 2);
        assert_eq!(status.module_uses.iter().map(|use_| use_.module_id.as_str()).collect::<BTreeSet<_>>(),
            BTreeSet::from(["A", "B"]));
        let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
        assert_eq!(analysis.names.modules.len(), 2);
        let leaf = analysis.names.declarations.iter().find(|declaration| declaration.name == "Leaf").unwrap().id;
        for path in ["/definitions/Via/body/body/callee/ref", "/definitions/Same/body/body/callee/ref"] {
            let reference = analysis.names.references.iter().find(|reference| reference.expanded_path == path).unwrap();
            assert!(matches!(&reference.resolution, Resolution::Resolved {declaration, route}
                if *declaration == leaf && route.iter().any(|hop| hop.export == "relay")));
        }
        for name in ["Leaf", "Via", "Same"] {
            let declaration = analysis.names.declarations.iter().find(|declaration| declaration.name == name).unwrap().id;
            let signature = analysis.signatures.iter().find(|signature| signature.declaration == declaration).unwrap();
            assert_eq!(signature.state, SignatureState::TypeReady);
            assert!(signature.body_type_checked);
            assert!(analysis.effects.declarations[&declaration].may.is_empty());
        }
    }
}

fn pattern_fixture() -> Fixture {
    let members = [
        "src/a.json", "src/b.json", "src/甲.json", "src/😀.json", "src/e\u{301}.json",
        "src/[ab].json", "src/{a,b}.json", "src/deep/b.json", "src/deep/more/c.json",
    ];
    let files = members.into_iter().enumerate().map(|(index, path)| {
        (path.into(), serde_json::to_vec(&module(&format!("M{index}"), json!({"F": integer_function("1")}))).unwrap())
    }).collect();
    Fixture {files, directories: BTreeMap::from([
        ("src".into(), vec![("a.json", false), ("b.json", false), ("甲.json", false), ("😀.json", false),
            ("e\u{301}.json", false), ("[ab].json", false), ("{a,b}.json", false), ("deep", true)]),
        ("src/deep".into(), vec![("b.json", false), ("more", true)]),
        ("src/deep/more".into(), vec![("c.json", false)]),
    ]), requests: Vec::new()}
}

#[test]
fn source_scope_members_follow_the_original_scalar_and_segment_pattern_rules() {
    let all = ["src/a.json", "src/b.json", "src/甲.json", "src/😀.json", "src/e\u{301}.json",
        "src/[ab].json", "src/{a,b}.json", "src/deep/b.json", "src/deep/more/c.json"];
    let cases = [
        (None, None, all.to_vec()),
        (Some(json!([])), None, vec![]),
        (Some(json!(["**/*.json"])), Some(json!(["deep/**"])),
            vec!["src/a.json", "src/b.json", "src/甲.json", "src/😀.json", "src/e\u{301}.json", "src/[ab].json", "src/{a,b}.json"]),
        (Some(json!(["?.json"])), None, vec!["src/a.json", "src/b.json", "src/甲.json", "src/😀.json"]),
        (Some(json!(["[ab].json", "{a,b}.json"])), None, vec!["src/[ab].json", "src/{a,b}.json"]),
        (Some(json!(["deep/*.json"])), None, vec!["src/deep/b.json"]),
    ];
    for (include, exclude, expected) in cases {
        let mut source_scope = scope("src");
        if let Some(include) = include {source_scope["include"] = include;}
        if let Some(exclude) = exclude {source_scope["exclude"] = exclude;}
        let mut preparation = Preparation::new(&project(json!([source_scope])), "gift.project.json", context()).unwrap();
        let mut fixture = pattern_fixture();
        let status = fixture.complete(&mut preparation);
        assert!(!matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{:?}", status.needs);
        assert_eq!(fixture.acquired_files(), expected.into_iter().collect::<BTreeSet<_>>());
        assert_eq!(status.module_uses.len(), fixture.acquired_files().len());
    }
}

#[test]
fn partial_coverage_can_gain_facts_but_repeated_observations_do_not_advance() {
    let root = project(json!([scope("src")]));
    let fixture = facade_fixture();
    let a = &fixture.files["src/a.module.json"];
    let b = &fixture.files["src/b.module.json"];
    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let initial = preparation.advance(&[]).unwrap();
    let partial = directory("src", CaptureOutcome::Partial,
        vec![entry("a.module.json", EntryKind::File, a.len())]);
    let announced = preparation.advance(&[partial]).unwrap();
    assert!(announced.requests.iter().any(|request| {
        matches!(&request.kind, CaptureKind::File) && request.path == "src/a.module.json"
    }));
    let observed = preparation.advance(&[file("src/a.module.json", a)]).unwrap();
    assert_eq!(observed.basis, initial.basis);
    assert!(!observed.needs.is_empty());
    let repeated = preparation.advance(&[]).unwrap();
    assert!(matches!(repeated.state, PreparationState::Waiting));
    assert_eq!(repeated.basis, initial.basis);
    let completed_directory = preparation.advance(&[directory("src", CaptureOutcome::Complete, vec![
        entry("b.module.json", EntryKind::File, b.len()), entry("a.module.json", EntryKind::File, a.len())])]).unwrap();
    assert!(completed_directory.requests.iter().any(|request| {
        matches!(&request.kind, CaptureKind::File) && request.path == "src/b.module.json"
    }));
    let completed = preparation.advance(&[file("src/b.module.json", b)]).unwrap();
    assert_eq!(completed.basis, initial.basis);
    assert_eq!(completed.module_uses.len(), 2);
    assert!(!matches!(completed.state, PreparationState::Conflict | PreparationState::Stopped));
    let no_progress = preparation.advance(&[file("src/b.module.json", b)]).unwrap();
    assert!(matches!(no_progress.state, PreparationState::Prepared));
    let unchanged = preparation.advance(&[]).unwrap();
    assert!(matches!(unchanged.state, PreparationState::Prepared));
    assert!(unchanged.requests.is_empty());
    let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
    assert!(analysis.names.references.iter().any(|reference| matches!(reference.resolution, Resolution::Resolved {..})));
}

#[test]
fn review_dot_source_root_keeps_the_actual_top_or_nested_project_directory() {
    let mut source_scope = scope(".");
    source_scope["exclude"] = json!(["gift.project.json"]);
    let root = project(json!([source_scope]));
    let selected = serde_json::to_vec(&module("Selected", json!({"F": integer_function("1")}))).unwrap();
    for prefix in ["", "nested/"] {
        let expected = format!("{prefix}selected.module.json");
        let directory_root = if prefix.is_empty() {"."} else {"nested"};
        let mut fixture = Fixture {
            files: BTreeMap::from([(expected.clone(), selected.clone())]),
            directories: BTreeMap::from([(directory_root.into(), vec![("selected.module.json", false)])]),
            requests: Vec::new(),
        };
        let mut preparation = Preparation::new(&root, &format!("{prefix}gift.project.json"), context()).unwrap();
        let status = fixture.complete(&mut preparation);
        assert!(matches!(status.state, PreparationState::Prepared), "{:?}", status.needs);
        assert_eq!(fixture.acquired_files(), BTreeSet::from([expected.as_str()]));
        let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
        assert_eq!(analysis.input().locators(), &[expected]);
        assert_eq!(analysis.input().sources()[0].bytes(), selected.as_slice());
    }
}

#[test]
fn review_partial_directory_member_order_and_known_subsets_do_not_create_progress() {
    let root = project(json!([scope("src")]));
    let a = serde_json::to_vec(&module("A", json!({"F": integer_function("1")}))).unwrap();
    let b = serde_json::to_vec(&module("B", json!({"F": integer_function("2")}))).unwrap();
    for members in [vec![entry("b.json", EntryKind::File, b.len()), entry("a.json", EntryKind::File, a.len())],
        vec![entry("a.json", EntryKind::File, a.len()), entry("b.json", EntryKind::File, b.len())],
        vec![entry("a.json", EntryKind::File, a.len())]] {
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        preparation.advance(&[]).unwrap();
        let first = preparation.advance(&[directory("src", CaptureOutcome::Partial, vec![
            entry("b.json", EntryKind::File, b.len()), entry("a.json", EntryKind::File, a.len())])]).unwrap();
        assert_eq!(first.requests.iter().filter(|request| matches!(request.kind, CaptureKind::File)).count(), 2);
        assert_eq!(first.sources.len(), 1, "Neither requested file has been observed yet");
        let repeated = preparation.advance(&[directory("src", CaptureOutcome::Partial, members)]).unwrap();
        assert!(matches!(repeated.state, PreparationState::Waiting));
        assert_eq!(repeated.basis, first.basis);
        assert!(repeated.requests.is_empty(), "A reordered or subset observation adds no capture fact");
        assert_eq!(repeated.sources.iter().map(|source| (&source.locator, &source.revision)).collect::<BTreeSet<_>>(),
            first.sources.iter().map(|source| (&source.locator, &source.revision)).collect::<BTreeSet<_>>());
        let progressed = preparation.advance(&[file("src/a.json", &a), file("src/b.json", &b)]).unwrap();
        assert_eq!(progressed.basis, first.basis);
        assert_eq!(progressed.module_uses.iter().map(|use_| use_.module_id.as_str()).collect::<BTreeSet<_>>(),
            BTreeSet::from(["A", "B"]));
        assert_eq!(progressed.sources.len(), 3);
    }
}

#[test]
fn incompatible_same_basis_content_is_a_conflict_without_replacing_old_facts() {
    let root = project(json!([scope("src")]));
    let mut fixture = facade_fixture();
    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let captured = fixture.complete(&mut preparation);
    let old = captured.sources.iter().find(|source| source.locator == "src/a.module.json").unwrap();
    let revision = old.revision.clone();
    let changed = serde_json::to_vec(&module("A", json!({"Different": integer_function("2")}))).unwrap();
    let conflict = preparation.advance(&[file("src/a.module.json", &changed)]).unwrap();
    assert!(matches!(conflict.state, PreparationState::Conflict));
    assert_eq!(conflict.basis, captured.basis);
    assert_eq!(conflict.sources.iter().find(|source| source.locator == "src/a.module.json").unwrap().revision, revision);
}

#[test]
fn exact_absence_denial_and_unknown_coverage_are_not_interchangeable() {
    let root = project(json!([scope("src")]));
    let fixture = facade_fixture();
    let a = &fixture.files["src/a.module.json"];
    let mut reasons = BTreeSet::new();
    for outcome in [CaptureOutcome::Absent, CaptureOutcome::Denied, CaptureOutcome::Unavailable, CaptureOutcome::Failed] {
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        preparation.advance(&[]).unwrap();
        preparation.advance(&[directory("src", CaptureOutcome::Complete,
            vec![entry("a.module.json", EntryKind::File, a.len())])]).unwrap();
        let status = preparation.advance(&[CaptureObservation::File {
            path: "src/a.module.json".into(), outcome, bytes: Vec::new()
        }]).unwrap();
        assert!(!status.needs.is_empty());
        reasons.insert(status.needs.iter().map(|need| format!("{}: {}", need.code, need.message)).collect::<Vec<_>>());
    }
    assert_eq!(reasons.len(), 4, "Each observation category must preserve its own reason");

    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    preparation.advance(&[]).unwrap();
    preparation.advance(&[directory("src", CaptureOutcome::Complete,
        vec![entry("a.module.json", EntryKind::File, a.len())])]).unwrap();
    let absent = preparation.advance(&[CaptureObservation::File {
        path: "src/a.module.json".into(), outcome: CaptureOutcome::Absent, bytes: Vec::new()
    }]).unwrap();
    let contradicted = preparation.advance(&[file("src/a.module.json", a)]).unwrap();
    assert!(matches!(contradicted.state, PreparationState::Conflict));
    assert_eq!(absent.basis, contradicted.basis);
}

#[test]
fn preparation_budget_remains_exhausted_across_successor_calls() {
    let root = project(json!([scope("src")]));
    let mut fixture = facade_fixture();
    let total = root.len() + fixture.files.values().map(Vec::len).sum::<usize>();
    let limits = PreparationLimits {entries: 128, bytes: (total - 1) as u64, work: usize::MAX};
    let mut preparation = Preparation::with_limits(&root, "gift.project.json", context(), limits).unwrap();
    let stopped = fixture.complete(&mut preparation);
    assert!(matches!(stopped.state, PreparationState::Stopped));
    let again = preparation.advance(&[]).unwrap();
    assert!(matches!(again.state, PreparationState::Stopped));
    assert_eq!(again.basis, stopped.basis);
}

#[test]
fn review_finite_work_budget_bounds_real_directory_observations_across_successors() {
    let root = project(json!([scope("src")]));
    let limits = PreparationLimits {entries: 4096, bytes: 48 * 1024 * 1024, work: 20_000};
    let mut preparation = Preparation::with_limits(&root, "gift.project.json", context(), limits).unwrap();
    let initial = preparation.advance(&[]).unwrap();
    assert!(!matches!(initial.state, PreparationState::Stopped | PreparationState::Conflict));
    assert!(initial.requests.iter().any(|request| request.path == "src" && matches!(request.kind, CaptureKind::Directory)));
    let mut exhausted = false;
    for count in 1..=256 {
        let members = (0..count).rev().map(|index| DirectoryEntry {
            name: format!("directory-{index:04}-with-an-independent-member-key"),
            kind: EntryKind::Directory, byte_length: 0,
        }).collect();
        match preparation.advance(&[directory("src", CaptureOutcome::Partial, members)]) {
            Err(diagnostic) => {
                assert_eq!(diagnostic.code, "ResourceLimit");
                exhausted = true;
                break;
            }
            Ok(status) => {
                assert_eq!(status.basis, initial.basis);
                if matches!(status.state, PreparationState::Stopped) {
                    assert!(!status.needs.is_empty());
                    exhausted = true;
                    assert!(matches!(preparation.advance(&[]).unwrap().state, PreparationState::Stopped));
                    break;
                }
                assert!(!matches!(status.state, PreparationState::Conflict));
            }
        }
    }
    assert!(exhausted, "Growing real observations must consume the retained finite work budget");
    // This checks observable exhaustion only. Indexed merge cost and complete
    // accounting of comparisons require the separate static owner review.
}

#[test]
fn native_budget_boundaries_preserve_a_faithful_terminal_record_or_return_resource_limit() {
    let root = project(json!([scope("src")]));
    let mut fixture = facade_fixture();
    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let prepared = fixture.complete(&mut preparation);
    let observations = vec![
        directory("src", CaptureOutcome::Complete, vec![
            entry("a.module.json", EntryKind::File, fixture.files["src/a.module.json"].len()),
            entry("b.module.json", EntryKind::File, fixture.files["src/b.module.json"].len()),
        ]),
        file("src/a.module.json", &fixture.files["src/a.module.json"]),
        file("src/b.module.json", &fixture.files["src/b.module.json"]),
    ];
    let mut expected_sources = fixture.files.iter().map(|(locator, bytes)| {
        (locator.clone(), format!("sha256:{:x}", Sha256::digest(bytes)), bytes.len() as u64)
    }).collect::<BTreeSet<_>>();
    expected_sources.insert(("gift.project.json".into(),
        format!("sha256:{:x}", Sha256::digest(&root)), root.len() as u64));
    let analyze = |work: u64, allocation_bytes: u64| {
        let request = json!({"schema": "gift.author-analysis-request/1", "purpose": "analyze",
            "root": {"locator": "gift.project.json", "bytes": root},
            "context": {"project_instance": "project:test:instance", "resolution_domain": "resolution:test"},
            "observations": observations, "budget": {"work": work, "allocation_bytes": allocation_bytes}});
        gift_author_kernel::project_input::analyze_request(&serde_json::to_vec(&request).unwrap())
    };
    let assert_faithful = |wire: &Value, work: u64, allocation_bytes: u64| {
        assert_eq!(wire["schema"], "gift.author-analysis/1");
        assert_eq!(wire["basis"], prepared.basis);
        let actual_sources = wire["sources"].as_array().unwrap().iter().map(|source| {
            assert_eq!(source["layer"], "captured");
            (source["locator"].as_str().unwrap().to_owned(),
                source["revision"].as_str().unwrap().to_owned(), source["byte_length"].as_u64().unwrap())
        }).collect::<BTreeSet<_>>();
        assert_eq!(actual_sources, expected_sources);
        assert_eq!(wire["modules"].as_array().unwrap().len(), wire["module_uses"].as_array().unwrap().len());
        if matches!(wire["state"].as_str(), Some("stopped" | "conflict")) {
            assert!(wire["analysis"].is_null());
            for field in ["requests", "modules", "module_uses"] {
                assert!(wire[field].as_array().unwrap().is_empty(), "Terminal field {field}");
            }
        }
        for (field, requested) in [("work", work), ("allocation_bytes", allocation_bytes)] {
            assert_eq!(wire["budget"]["requested"][field].as_u64().unwrap(), requested);
            assert_eq!(wire["budget"]["remaining"][field].as_u64().unwrap()
                + wire["budget"]["consumed"][field].as_u64().unwrap(), requested);
        }
    };
    let full_work = 8_000_000;
    let full_bytes = 48 * 1024 * 1024;
    let control: Value = serde_json::from_slice(&analyze(full_work, full_bytes).unwrap()).unwrap();
    assert_faithful(&control, full_work, full_bytes);
    assert_eq!(control["modules"].as_array().unwrap().len(), 2);
    assert!(!control["analysis"].is_null());
    let consumed_work = control["budget"]["consumed"]["work"].as_u64().unwrap();
    let consumed_bytes = control["budget"]["consumed"]["allocation_bytes"].as_u64().unwrap();
    assert!(consumed_work > 0 && consumed_bytes > 0);
    let raw_bytes = root.len() + fixture.files.values().map(Vec::len).sum::<usize>();
    for (work, allocation_bytes) in [(0, 0), (full_work, root.len() as u64 - 1),
        (full_work, raw_bytes as u64 - 1), (consumed_work - 1, full_bytes), (full_work, consumed_bytes - 1)] {
        match analyze(work, allocation_bytes) {
            Ok(bytes) => assert_faithful(&serde_json::from_slice(&bytes).unwrap(), work, allocation_bytes),
            Err(diagnostic) => assert_eq!(diagnostic.code, "ResourceLimit"),
        }
    }
}

#[test]
fn ordinary_scope_scanning_does_not_acquire_repository_or_recovery_contents() {
    let mut source_scope = scope(".");
    source_scope["exclude"] = json!(["gift.project.json"]);
    let root = project(json!([source_scope]));
    let visible = serde_json::to_vec(&module("Visible", json!({"F": integer_function("1")}))).unwrap();
    let mut fixture = Fixture {
        files: BTreeMap::from([
            ("gift.project.json".into(), root.clone()), ("src/visible.json".into(), visible),
            (".git/objects/private.json".into(), b"not author JSON".to_vec()),
            (".gift/cache/cache.json".into(), b"not author JSON".to_vec()),
            (".gift/state/journal.json".into(), b"not author JSON".to_vec()),
        ]),
        directories: BTreeMap::from([
            (".".into(), vec![("gift.project.json", false), ("src", true), (".git", true), (".gift", true)]),
            ("src".into(), vec![("visible.json", false)]),
            (".git".into(), vec![("objects", true)]),
            (".git/objects".into(), vec![("private.json", false)]),
            (".gift".into(), vec![("cache", true), ("state", true)]),
            (".gift/cache".into(), vec![("cache.json", false)]),
            (".gift/state".into(), vec![("journal.json", false)]),
        ]),
        requests: Vec::new(),
    };
    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let status = fixture.complete(&mut preparation);
    assert!(!matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{:?}", status.needs);
    assert_eq!(fixture.acquired_files(), BTreeSet::from(["src/visible.json"]));
    assert!(!fixture.requests.iter().any(|path| path.starts_with(".git/") || path == ".git"
        || path.starts_with(".gift/cache") || path.starts_with(".gift/state")));
}

fn locked_fixture(changed_body: bool, lock_change: impl FnOnce(&mut Value)) -> Fixture {
    let fixed = context();
    let request = json!({"mode": "locked", "moduleId": "Lib", "constraint": "1"});
    // The stable Project key uses the authored projectId, not the host's
    // physical context label. This expectation is independent of preparation.
    let stable_project = FixedContext::new("project:test", "resolution:test").unwrap();
    let key = BindingLocation::for_import(&stable_project, "LockedRoot", "lib").encode().unwrap();
    let mut root_module = module("LockedRoot", json!({"F": imported_call("lib", "leaf")}));
    root_module["imports"] = json!({"lib": request.clone()});
    if changed_body {
        let original_call = root_module["definitions"]["F"]["body"]["body"].clone();
        root_module["definitions"]["F"]["body"]["body"] = json!({"op": "do", "steps": [], "result": original_call});
    }
    let mut library = module("Lib", json!({"Leaf": integer_function("7"), "Private": integer_function("8")}));
    library["exports"] = json!({"leaf": {"definitionId": "Leaf"}});
    let library = serde_json::to_vec(&library).unwrap();
    let mut lock = json!({"schema": "gift.binding-lock/1", "projectId": "project:test",
        "resolutionInputs": {"resolver": serde_json::to_value(fixed.resolver_binding()).unwrap(),
            "grammarRevision": grammar::revision(), "requests": {}},
        "bindings": {}, "nodes": {"pinned-library": {
            "kind": "module", "subjectId": "Lib", "revision": "1", "dependencies": [],
            "locationHint": "libs/pinned.module.json", "content": {"algorithm": "sha256",
                "digest": format!("{:x}", Sha256::digest(&library)), "byteLength": library.len(),
                "format": "gift.author-module/design-converged"}
        }} });
    lock["resolutionInputs"]["requests"].as_object_mut().unwrap().insert(key.clone(), request);
    lock["bindings"].as_object_mut().unwrap().insert(key, json!("pinned-library"));
    lock_change(&mut lock);
    Fixture {
        files: BTreeMap::from([
            ("src/root.module.json".into(), serde_json::to_vec(&root_module).unwrap()),
            ("gift.lock.json".into(), serde_json::to_vec(&lock).unwrap()),
            ("libs/pinned.module.json".into(), library),
        ]),
        directories: BTreeMap::from([("src".into(), vec![("root.module.json", false)])]),
        requests: Vec::new(),
    }
}

#[test]
fn fixed_lock_selection_survives_body_edits_without_mixing_candidate_evidence() {
    let project = project(json!([scope("src")]));
    let mut analyses = Vec::new();
    let mut importer_bytes = Vec::new();
    for (changed_body, prefix) in [(false, ""), (true, ""), (true, "moved/")] {
        let mut fixture = locked_fixture(changed_body, |_| {}).relocated(prefix);
        let importer_path = format!("{prefix}src/root.module.json");
        let library_path = format!("{prefix}libs/pinned.module.json");
        let expected_importer = fixture.files[&importer_path].clone();
        let expected_library = fixture.files[&library_path].clone();
        let locator = format!("{prefix}gift.project.json");
        let physical_context = if prefix.is_empty() {context()}
            else {FixedContext::new("relocated-physical-context", "resolution:test").unwrap()};
        let mut preparation = Preparation::new(&project, &locator, physical_context).unwrap();
        let status = fixture.complete(&mut preparation);
        assert!(!matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{:?}", status.needs);
        assert!(status.requests.is_empty());
        let actual_location = preparation.binding_location("LockedRoot", "lib").unwrap();
        assert_eq!(actual_location.project_scope, "project:test");
        let expected_location = BindingLocation::for_import(
            &FixedContext::new("project:test", "resolution:test").unwrap(), "LockedRoot", "lib");
        assert_eq!(actual_location, expected_location);
        let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
        let root = analysis.names.modules.iter().find(|module| module.module_id == "LockedRoot").unwrap().id;
        let library = analysis.names.modules.iter().find(|module| module.module_id == "Lib").unwrap().id;
        assert_eq!(analysis.input().sources()[root.index()].bytes(), expected_importer.as_slice());
        assert_eq!(analysis.input().sources()[library.index()].bytes(), expected_library.as_slice());
        assert_eq!(analysis.input().locators()[root.index()], importer_path);
        assert_eq!(analysis.input().locators()[library.index()], library_path);
        for (index, module_use) in analysis.input().module_uses().iter().enumerate() {
            let instances = analysis.input().project_instances().iter()
                .filter(|instance| instance.local_ref == module_use.project_instance).collect::<Vec<_>>();
            assert_eq!(instances.len(), 1, "Each local project reference has one retained owner");
            let instance = instances[0];
            assert_eq!(instance.logical_project_id.as_deref(), Some("project:test"));
            assert_eq!(instance.root_locator.as_deref(), Some(locator.as_str()));
            assert_eq!(instance.candidate_basis, analysis.input().basis());
            assert!(instance.modules.contains(&index));
            assert_eq!(instance.modules.iter().copied().collect::<BTreeSet<_>>(),
                BTreeSet::from([root.index(), library.index()]));
            assert_eq!(instance.modules.len(), 2);
            for member in &instance.modules {
                assert_eq!(analysis.input().module_uses()[*member].project_instance, instance.local_ref);
            }
        }
        let leaf = analysis.names.declarations.iter().find(|declaration| declaration.module == library && declaration.name == "Leaf").unwrap().id;
        let reference = analysis.names.references.iter().find(|reference| {
            reference.module == root && reference.expanded_path.ends_with("/callee/ref")
        }).unwrap();
        assert!(matches!(reference.resolution, Resolution::Resolved {declaration, ..} if declaration == leaf));
        assert!(!analysis.names.pending_regions.iter().any(|region| region.code == "NeedsLockQualification"));
        importer_bytes.push(expected_importer);
        analyses.push(analysis);
    }
    assert_ne!(importer_bytes[0], importer_bytes[1]);
    assert_eq!(importer_bytes[1], importer_bytes[2]);
    for pair in analyses.windows(2) {
        assert_ne!(pair[0].input().basis(), pair[1].input().basis());
        assert_ne!(pair[0].input().qualified_module_use(pair[0].names.root.index()),
            pair[1].input().qualified_module_use(pair[1].names.root.index()));
    }
    let fixed = FixedContext::new("project:test", "resolution:test").unwrap();
    let key = BindingLocation::for_import(&fixed, "LockedRoot", "lib").encode().unwrap();
    let first_lock: Value = serde_json::from_slice(&locked_fixture(false, |_| {}).files["gift.lock.json"]).unwrap();
    let second_lock: Value = serde_json::from_slice(&locked_fixture(true, |_| {}).files["gift.lock.json"]).unwrap();
    assert_eq!(first_lock, second_lock);
    assert_eq!(first_lock["bindings"][&key], "pinned-library");
    assert_eq!(first_lock["nodes"]["pinned-library"]["subjectId"], "Lib");
}

#[test]
fn unsupported_or_inconsistent_locks_never_qualify_the_import() {
    let root = project(json!([scope("src")]));
    let changes: [fn(&mut Value); 5] = [
        |lock| lock["resolutionInputs"]["resolver"]["id"] = json!("unsupported:resolver"),
        |lock| lock["projectId"] = json!("a-different-project"),
        |lock| lock["nodes"]["pinned-library"]["subjectId"] = json!("NotLib"),
        |lock| lock["nodes"]["pinned-library"]["dependencies"] = json!(["missing-node"]),
        |lock| lock["nodes"]["pinned-library"]["content"]["digest"] = json!("0".repeat(64)),
    ];
    for (index, change) in changes.into_iter().enumerate() {
        let mut fixture = locked_fixture(false, change);
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        let outcome = fixture.complete_result(&mut preparation);
        if index == 0 {
            assert!(!outcome.as_ref().unwrap().needs.is_empty(), "An unavailable resolver protocol remains an explicit need");
        } else {
            match outcome {
                Ok(status) => assert!(!status.needs.is_empty()),
                Err(diagnostic) => assert!(!diagnostic.code.is_empty()),
            }
        }
        if let Ok(input) = preparation.finish() {
            let analysis = signature_resolution::resolve_input(input).unwrap();
            assert!(!analysis.names.references.iter().any(|reference| {
                reference.expanded_path.ends_with("/callee/ref") && matches!(reference.resolution, Resolution::Resolved {..})
            }));
        }
    }
}

#[test]
fn a_valid_locked_module_does_not_make_its_private_definition_public() {
    let root = project(json!([scope("src")]));
    let mut fixture = locked_fixture(false, |_| {});
    let mut importer: Value = serde_json::from_slice(&fixture.files["src/root.module.json"]).unwrap();
    importer["definitions"]["F"]["body"]["body"]["callee"]["ref"]["export"] = json!("Private");
    fixture.files.insert("src/root.module.json".into(), serde_json::to_vec(&importer).unwrap());
    let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let status = fixture.complete(&mut preparation);
    assert!(!matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{:?}", status.needs);
    let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
    assert!(analysis.names.modules.iter().any(|module| module.module_id == "Lib"));
    let reference = analysis.names.references.iter().find(|reference| {
        reference.expanded_path == "/definitions/F/body/body/callee/ref"
    }).unwrap();
    assert!(matches!(reference.resolution, Resolution::Rejected {..}));
    assert!(!analysis.names.pending_regions.iter().any(|region| region.code == "NeedsLockQualification"));
}

#[test]
fn review_known_lock_dependency_outcomes_preserve_needs_without_reacquisition() {
    let root = project(json!([scope("src")]));
    let dependency = serde_json::to_vec(&module("Dependency", json!({"F": integer_function("3")}))).unwrap();
    let make_fixture = || {
        let mut fixture = locked_fixture(false, |lock| {
            lock["nodes"]["pinned-library"]["dependencies"] = json!(["dependency"]);
            lock["nodes"]["dependency"] = json!({"kind": "module", "subjectId": "Dependency", "revision": "1",
                "dependencies": [], "locationHint": "libs/dependency.module.json", "content": {
                    "algorithm": "sha256", "digest": format!("{:x}", Sha256::digest(&dependency)),
                    "byteLength": dependency.len(), "format": "gift.author-module/design-converged"}});
        });
        fixture.files.insert("libs/dependency.module.json".into(), dependency.clone());
        fixture
    };
    let mut found_fixture = make_fixture();
    let mut found = Preparation::new(&root, "gift.project.json", context()).unwrap();
    let complete = found_fixture.complete(&mut found);
    assert!(matches!(complete.state, PreparationState::Prepared), "{:?}", complete.needs);
    assert!(found_fixture.acquired_files().contains("libs/dependency.module.json"));
    let analysis = signature_resolution::resolve_input(found.finish().unwrap()).unwrap();
    assert!(analysis.names.references.iter().any(|reference| {
        reference.expanded_path.ends_with("/callee/ref") && matches!(reference.resolution, Resolution::Resolved {..})
    }));

    let mut reasons = BTreeSet::new();
    for outcome in [None, Some(CaptureOutcome::Absent), Some(CaptureOutcome::Denied),
        Some(CaptureOutcome::Unavailable), Some(CaptureOutcome::Failed)] {
        let mut fixture = make_fixture();
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        let mut status = preparation.advance(&[]).unwrap();
        for _ in 0..16 {
            if status.requests.iter().any(|request| request.path == "libs/dependency.module.json") {break;}
            assert!(!status.requests.is_empty(), "The actual pinned dependency must request capture");
            let facts = status.requests.iter().map(|request| fixture.answer(request)).collect::<Vec<_>>();
            status = preparation.advance(&facts).unwrap();
        }
        assert!(status.requests.iter().any(|request| request.path == "libs/dependency.module.json"));
        if let Some(outcome) = outcome {
            let status = preparation.advance(&[CaptureObservation::File {
                path: "libs/dependency.module.json".into(), outcome, bytes: Vec::new(),
            }]).unwrap();
            assert!(!status.needs.is_empty());
            assert!(!status.requests.iter().any(|request| request.path == "libs/dependency.module.json"));
            reasons.insert(status.needs.iter().map(|need| format!("{}: {}", need.code, need.message)).collect::<Vec<_>>());
            let repeated = preparation.advance(&[]).unwrap();
            assert!(!repeated.requests.iter().any(|request| request.path == "libs/dependency.module.json"));
        } else {
            assert!(!status.needs.is_empty(), "An unobserved dependency remains missing capture input");
        }
    }
    assert_eq!(reasons.len(), 4);
}

#[test]
fn review_nested_project_filename_does_not_invent_a_child_owner_or_hide_selected_modules() {
    let root = project(json!([scope("src")]));
    let selected = serde_json::to_vec(&module("Selected", json!({"F": integer_function("1")}))).unwrap();
    for is_directory in [false, true] {
        let selected_path = if is_directory {"src/gift.project.json/x.module.json"} else {"src/gift.project.json"};
        let mut fixture = Fixture {
            files: BTreeMap::from([(selected_path.into(), selected.clone())]),
            directories: BTreeMap::from([("src".into(), vec![("gift.project.json", is_directory)])]),
            requests: Vec::new(),
        };
        if is_directory {
            fixture.directories.insert("src/gift.project.json".into(), vec![("x.module.json", false)]);
        }
        let mut preparation = Preparation::new(&root, "gift.project.json", context()).unwrap();
        let status = fixture.complete(&mut preparation);
        assert!(matches!(status.state, PreparationState::Prepared), "{:?}", status.needs);
        assert!(fixture.acquired_files().contains(selected_path));
        assert_eq!(status.module_uses.iter().map(|use_| use_.module_id.as_str()).collect::<Vec<_>>(), vec!["Selected"]);
    }
    let mut child_project: Value = serde_json::from_slice(&project(json!([scope(".")]))).unwrap();
    child_project["projectId"] = json!("project:child");
    let child_project = serde_json::to_vec(&child_project).unwrap();
    let known = serde_json::to_vec(&module("Known", json!({"F": integer_function("2")}))).unwrap();
    let mut fixture = Fixture {
        files: BTreeMap::from([("src/gift.project.json".into(), child_project.clone()),
            ("src/x.module.json".into(), selected), ("outer/known.module.json".into(), known)]),
        directories: BTreeMap::from([("src".into(), vec![("gift.project.json", false), ("x.module.json", false)]),
            ("outer".into(), vec![("known.module.json", false)])]),
        requests: Vec::new(),
    };
    let outer = project(json!([scope("src"), scope("outer")]));
    let mut preparation = Preparation::new(&outer, "gift.project.json", context()).unwrap();
    let status = fixture.complete(&mut preparation);
    assert!(fixture.acquired_files().contains("src/gift.project.json"));
    assert!(!matches!(status.state, PreparationState::Prepared));
    assert!(status.needs.iter().any(|need| need.code == "NeedsNestedSourceOwner"),
        "Parsed child Project bytes do not manufacture an adopted owner");
    assert!(!status.module_uses.iter().any(|use_| use_.module_id == "Selected"));
    assert!(status.module_uses.iter().any(|use_| use_.module_id == "Known"));
    let analysis = signature_resolution::resolve_input(preparation.finish().unwrap()).unwrap();
    assert!(analysis.input().observations().iter().any(|observation| matches!(observation,
        CaptureObservation::File {path, outcome: CaptureOutcome::Found, bytes}
            if path == "src/gift.project.json" && bytes == &child_project)));
    let declaration = analysis.names.declarations.iter().find(|declaration| declaration.name == "F").unwrap();
    assert_eq!(analysis.names.modules[declaration.module.index()].module_id, "Known");
    assert!(analysis.signatures.iter().any(|signature| signature.declaration == declaration.id && signature.body_type_checked));
}

#[test]
fn invalid_scope_roots_never_create_an_acquisition_outside_the_project() {
    for invalid in ["../outside", "/outside", "C:/outside", "src//nested", "src/./nested", "src/../nested", ""] {
        let bytes = project(json!([scope(invalid)]));
        match Preparation::new(&bytes, "gift.project.json", context()) {
            Err(diagnostic) => assert!(!diagnostic.code.is_empty()),
            Ok(mut preparation) => {
                let status = preparation.advance(&[]).unwrap();
                assert!(matches!(status.state, PreparationState::Conflict | PreparationState::Stopped), "{invalid}");
                assert!(status.requests.is_empty(), "Invalid root {invalid} must not become a host read request");
                assert!(!status.needs.is_empty());
            }
        }
    }
}

#[test]
fn competing_writable_source_roles_do_not_select_an_owner_by_scope_order() {
    for reverse in [false, true] {
        let semantic = scope("src");
        let mut native = scope("src");
        native["kind"] = json!("native");
        let scopes = if reverse {json!([native, semantic])} else {json!([semantic, native])};
        let mut preparation = Preparation::new(&project(scopes), "gift.project.json", context()).unwrap();
        let mut fixture = facade_fixture();
        match fixture.complete_result(&mut preparation) {
            Err(diagnostic) => assert!(!diagnostic.code.is_empty()),
            Ok(status) => {
                assert!(matches!(status.state, PreparationState::Conflict | PreparationState::Stopped));
                assert!(!status.needs.is_empty());
            }
        }
    }
}
