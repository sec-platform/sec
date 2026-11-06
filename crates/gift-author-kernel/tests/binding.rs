use gift_author_kernel::{binding::{self, ImportBinding, NameAnalysis, Resolution}, reader};
use serde_json::{Value, json};

fn source(value: Value) -> reader::DecodedSource { reader::read(&serde_json::to_vec(&value).unwrap()).unwrap() }
fn module(id: &str, definitions: Value) -> Value {
    json!({"schema":"gift.author-module/design-converged","moduleId":id,"definitions":definitions})
}
fn scalar() -> Value { json!({"kind":"core:type","body":{"type":{"tag":"scalar","name":"bool"}}}) }
fn alias(reference: Value) -> Value { json!({"kind":"core:type","body":{"type":{"tag":"nominal","ref":reference}}}) }
fn resolved(resolution: &Resolution) -> usize {
    match resolution { Resolution::Resolved { declaration, .. } => declaration.index(), other => panic!("Expected resolved name, got {other:?}") }
}
fn target<'a>(analysis: &'a NameAnalysis, path: &str) -> &'a str {
    let reference = analysis.references.iter().find(|r| r.expanded_path == path).unwrap();
    &analysis.declarations[resolved(&reference.resolution)].name
}

#[test]
fn all_declarations_and_recursive_names_share_one_analysis() {
    let mut value = module("m", json!({"T":scalar(),"Alias":alias(json!({"space":"local","definition":"T"})),
        "K":{"kind":"core:constant","body":{"type":{"tag":"scalar","name":"bool"},"value":{"op":"literal","type":{"tag":"scalar","name":"bool"},"value":true}}},
        "f":{"kind":"core:function","body":{"parameters":[],"returns":{"tag":"nominal","ref":"local:T"},"effects":[],
            "body":{"op":"call","callee":{"op":"symbol","ref":"local:g"},"arguments":[]}}},
        "g":{"kind":"core:function","body":{"parameters":[],"returns":{"tag":"nominal","ref":"local:T"},"effects":[],
            "body":{"op":"call","callee":{"op":"symbol","ref":{"space":"local","definition":"f"}},"arguments":[]}}}}));
    value["annotations"] = json!({"object":{"space":"local","definition":"Missing"},"string":"local:Missing"});
    let analysis = binding::analyze_sources(&[source(value)], &[], 0).unwrap();
    assert_eq!(analysis.stage, "names");
    assert_eq!(analysis.identity_scope, "capture-local");
    assert_eq!(analysis.declarations.len(), 5);
    assert_eq!(analysis.references.len(), 5);
    assert_eq!(target(&analysis, "/definitions/Alias/body/type/ref"), "T");
    assert_eq!(target(&analysis, "/definitions/f/body/body/callee/ref"), "g");
    assert_eq!(target(&analysis, "/definitions/g/body/body/callee/ref"), "f");
    assert!(analysis.problems.is_empty());
    assert!(analysis.unchecked.contains(&"types"));
}

#[test]
fn exact_names_and_original_short_source_locations() {
    let value = module("names", json!({"":{"req:enum-value":{}},"S":{"req:subject":{"roles":{}}},
        "Enum":{"req:value-type":{"enumMembers":[{"definitionId":""}]}},
        "中文/~:":scalar(), "é":scalar(), "é":scalar(), "__proto__":scalar(),
        "A":alias(json!({"space":"local","definition":"中文/~:"})),
        "B":alias(json!({"space":"local","definition":"é"}))}));
    let analysis = binding::analyze_sources(&[source(value)], &[], 0).unwrap();
    assert_eq!(analysis.declarations.len(), 9);
    assert_eq!(target(&analysis, "/definitions/A/body/type/ref"), "中文/~:");
    assert_eq!(target(&analysis, "/definitions/B/body/type/ref"), "é");
    let reference = analysis.references.iter().find(|r| r.domain == "declaration-selector").unwrap();
    assert_eq!(analysis.declarations[resolved(&reference.resolution)].name, "");
    assert_eq!(reference.origin.as_ref().unwrap().pointer, "/definitions/Enum/req:value-type/enumMembers/0");
}

#[test]
fn public_routes_preserve_terminal_and_capture_instance() {
    let mut a = module("A", json!({"X":alias(json!({"space":"import","alias":"b","export":"y"})),
        "Y":alias(json!({"space":"import","alias":"same","export":"z"})),
        "Z":alias(json!({"space":"import","alias":"other","export":"z"}))}));
    a["imports"] = json!({"b":{"mode":"workspace","moduleId":"B"},"same":{"mode":"workspace","moduleId":"C"},"other":{"mode":"workspace","moduleId":"C"}});
    let mut b = module("B", json!({}));
    b["imports"] = json!({"c":{"mode":"locked","moduleId":"C","constraint":"exact"}});
    b["exports"] = json!({"y":{"import":"c","export":"z"}});
    let mut c = module("C", json!({"T":scalar()}));
    c["exports"] = json!({"z":{"definitionId":"T"},"second":{"definitionId":"T"}});
    let sources = [source(a), source(b), source(c.clone()), source(c)];
    let edges = [ImportBinding { from:0,alias:"b".into(),target:1 }, ImportBinding { from:1,alias:"c".into(),target:2 },
        ImportBinding { from:0,alias:"same".into(),target:2 }, ImportBinding { from:0,alias:"other".into(),target:3 }];
    let analysis = binding::analyze_sources(&sources, &edges, 0).unwrap();
    let refs:Vec<_> = analysis.references.iter().filter(|r| r.module.index() == 0).collect();
    assert_eq!(resolved(&refs[0].resolution), resolved(&refs[1].resolution));
    assert_ne!(resolved(&refs[0].resolution), resolved(&refs[2].resolution));
    if let Resolution::Resolved { route, .. } = &refs[0].resolution {
        assert_eq!(route.iter().map(|h| (h.module.index(), h.export.as_str())).collect::<Vec<_>>(), vec![(1,"y"),(2,"z")]);
        assert_eq!(route[0].qualification, "pending-lock-and-module-use");
    }
    assert!(analysis.pending_regions.iter().any(|n| n.code == "NeedsLockQualification"));
    let mut changed = edges.to_vec(); changed[3].target = 2;
    let revised = binding::analyze_sources(&sources, &changed, 0).unwrap();
    assert_ne!(analysis.input_revision, revised.input_revision);
    assert_eq!(analysis.source_revision, revised.source_revision);
}

#[test]
fn missing_capture_missing_export_and_invalid_input_are_distinct() {
    let mut a = module("A", json!({"X":alias(json!({"space":"import","alias":"b","export":"Private"}))}));
    a["imports"] = json!({"b":{"mode":"workspace","moduleId":"B"}});
    let b = module("B", json!({"Private":scalar()}));
    let sources = [source(a),source(b)];
    let missing = binding::analyze_sources(&sources, &[], 0).unwrap();
    assert!(matches!(&missing.references[0].resolution, Resolution::Needs { code:"NeedsModuleCapture", .. }));
    let edge = ImportBinding { from:0,alias:"b".into(),target:1 };
    let captured = binding::analyze_sources(&sources, &[edge.clone()], 0).unwrap();
    assert!(matches!(&captured.references[0].resolution, Resolution::Rejected { code:"MissingPublicExport", .. }));
    assert!(captured.reads.iter().any(|r| r.module.index() == 1 && r.domain == "public-export" && r.name == "Private"));
    assert_eq!(binding::analyze_sources(&sources, &[edge.clone(),edge], 0).unwrap_err().code, "AmbiguousImportBinding");
    assert_eq!(binding::analyze_sources(&sources, &[ImportBinding { from:0,alias:"b".into(),target:0 }], 0).unwrap_err().code, "ImportModuleMismatch");
    assert_eq!(binding::analyze_sources(&sources, &[ImportBinding { from:0,alias:"b".into(),target:9 }], 0).unwrap_err().code, "InvalidNameInput");
    assert_eq!(binding::analyze_sources(&sources, &[ImportBinding { from:0,alias:"absent".into(),target:1 }], 0).unwrap_err().code, "InvalidNameInput");
}

#[test]
fn pure_export_alias_cycles_do_not_become_declarations() {
    let mut a = module("A", json!({"T":scalar()}));
    a["imports"] = json!({"b":{"mode":"workspace","moduleId":"B"}});
    a["exports"] = json!({"x":{"import":"b","export":"y"}});
    let mut b = module("B", json!({"T":scalar()}));
    b["imports"] = json!({"a":{"mode":"workspace","moduleId":"A"}});
    b["exports"] = json!({"y":{"import":"a","export":"x"}});
    let analysis = binding::analyze_sources(&[source(a),source(b)], &[
        ImportBinding { from:0,alias:"b".into(),target:1 },ImportBinding { from:1,alias:"a".into(),target:0 }],0).unwrap();
    for export in &analysis.exports {
        assert!(matches!(&export.resolution, Resolution::Rejected { code:"ExportAliasCycle", route, .. } if route.len() == 2));
    }
}

fn pattern(selector: Value) -> Value {
    json!({"kind":"semantic:pattern","body":{"roles":{"input":{"typeRef":{"space":"local","definition":"T"},"multiplicity":"one"}},"meaningImports":[],"sharedClaims":[
        {"id":"c","modality":"achieve","meaningRef":selector,"bindings":{"input":"input"},"scope":"selected-snapshot"}],
        "variationPoints":[],"observationBoundary":{"scope":"snapshot","worldOrModel":"abstract-contract-only","authority":"design-only"}}})
}
#[test]
fn professional_strings_and_payloads_keep_their_own_resolvers() {
    let mut value = module("p", json!({"T":scalar(),"Old":pattern(json!("local:T")),
        "New":pattern(json!({"space":"local","definition":"T"})),
        "Model":{"extension:definition":{"dialectRef":"sem","bodySchemaRef":"urn:gift:design-schema:semantic-convergence",
            "payload":{"ref":"local:Missing","space":"local","definition":"Missing"},"bindingRef":"sem:Interpret"}}}));
    value["dialects"] = json!({"sem":{"languageId":"gift.semantic-convergence","constraint":"design-semantic-boundaries"}});
    let analysis = binding::analyze_sources(&[source(value)],&[],0).unwrap();
    assert_eq!(analysis.references.len(), 5);
    assert_eq!(target(&analysis,"/definitions/New/body/sharedClaims/0/meaningRef"),"T");
    assert!(analysis.references.iter().any(|r| matches!(&r.resolution,Resolution::Needs { code:"NeedsProfileNameResolution",selector,.. } if selector == "local:T")));
    assert!(analysis.references.iter().any(|r| matches!(&r.resolution,Resolution::Needs { code:"NeedsDialectInterpretation",.. })));
    assert!(analysis.pending_regions.iter().any(|n| n.code == "NeedsProfessionalInterpretation"));
}

#[test]
fn dialect_is_not_a_type_namespace() {
    let mut value = module("m",json!({"T":alias(json!({"space":"dialect","alias":"sem","consumer":"Interpret"}))}));
    value["dialects"] = json!({"sem":{"languageId":"gift.semantic-convergence","constraint":"design-semantic-boundaries"}});
    let analysis = binding::analyze_sources(&[source(value)],&[],0).unwrap();
    assert!(matches!(&analysis.references[0].resolution,Resolution::Rejected { code:"InvalidReferenceNamespace",.. }));
}

#[test]
fn exact_input_revision_and_reference_equivalence() {
    let legacy = module("m",json!({"T":scalar(),"A":alias(json!("local:T"))}));
    let mut structured = legacy.clone();
    structured["definitions"]["A"]["body"]["type"]["ref"] = json!({"space":"local","definition":"T"});
    let a = binding::analyze_sources(&[source(legacy)],&[],0).unwrap();
    let b = binding::analyze_sources(&[source(structured)],&[],0).unwrap();
    assert_ne!(a.input_revision,b.input_revision);
    assert_eq!(target(&a,"/definitions/A/body/type/ref"),target(&b,"/definitions/A/body/type/ref"));
    assert_eq!(a.references.len(),b.references.len());
}

#[test]
fn declaration_reordering_and_explicit_renaming_preserve_name_relations() {
    let bytes = br#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"T":{"core:type":{"type":"bool"}},"A":{"core:type":{"type":{"tag":"nominal","ref":"local:T"}}}}}"#;
    let reordered = br#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"A":{"core:type":{"type":{"tag":"nominal","ref":"local:T"}}},"T":{"core:type":{"type":"bool"}}}}"#;
    let a = binding::analyze(bytes).unwrap();
    let b = binding::analyze(reordered).unwrap();
    assert_ne!(a.input_revision,b.input_revision);
    assert_eq!(resolved(&a.references[0].resolution),resolved(&b.references[0].resolution));
    let renamed = module("m",json!({"New":scalar(),"A":alias(json!("local:New"))}));
    let c = binding::analyze_sources(&[source(renamed)],&[],0).unwrap();
    assert_eq!(target(&c,"/definitions/A/body/type/ref"),"New");
    assert_eq!(c.references.len(),a.references.len());
}

#[test]
fn shared_expanded_nodes_keep_each_semantic_occurrence() {
    let goal = json!({
        "roles":{"x":{"typeRef":{"space":"local","definition":"T"},"cardinality":"one"}},
        "clauses":{"c":{"achieve":{"iff":[{"local:P":{"x":"x"}},{"local:Q":{"x":"x"}}]}}}
    });
    let value = module("shared",json!({"T":scalar(),"G":{"intent:goal":goal}}));
    let analysis = binding::analyze_sources(&[source(value)],&[],0).unwrap();
    let occurrences:Vec<_> = analysis.references.iter().filter(|r| r.expanded_path.contains("/formula/")).collect();
    assert_eq!(occurrences.len(),4);
    let paths:std::collections::BTreeSet<_> = occurrences.iter().map(|r| &r.expanded_path).collect();
    assert_eq!(paths.len(),4);
    let mut origins = std::collections::BTreeMap::new();
    for occurrence in occurrences { *origins.entry(&occurrence.origin.as_ref().unwrap().pointer).or_insert(0) += 1; }
    assert_eq!(origins.values().copied().collect::<Vec<_>>(),vec![2,2]);
}

#[test]
fn namespace_conflicts_cannot_issue_a_resolved_name() {
    let mut a = module("A",json!({"T":alias(json!({"space":"import","alias":"both","export":"t"}))}));
    a["imports"] = json!({"both":{"mode":"workspace","moduleId":"B"}});
    a["dialects"] = json!({"both":{"languageId":"language","constraint":"exact"}});
    let mut b = module("B",json!({"T":scalar()})); b["exports"] = json!({"t":{"definitionId":"T"}});
    let analysis = binding::analyze_sources(&[source(a),source(b)],&[ImportBinding { from:0,alias:"both".into(),target:1 }],0).unwrap();
    assert!(analysis.problems.iter().any(|p| p.code == "ConflictingNamespaceAlias"));
    assert!(matches!(analysis.references[0].resolution,Resolution::Rejected { code:"ConflictingNamespaceAlias",.. }));
}

#[test]
fn analysis_budgets_long_occurrence_paths_before_copying_results() {
    let mut fields = serde_json::Map::new();
    for i in 0..500 { fields.insert(format!("f{i}"),json!({"type":{"tag":"nominal","ref":"local:T"}})); }
    let mut definitions = serde_json::Map::new();
    definitions.insert("T".into(),scalar());
    definitions.insert("a".repeat(4000),json!({"kind":"core:type","body":{"type":{"tag":"record","fields":fields}}}));
    // Reader success is independent: this is a valid source, refused by this
    // analysis's smaller retained-path/work budget, not by the author grammar.
    let capture = source(module("budget",Value::Object(definitions)));
    assert_eq!(binding::analyze_sources(&[capture],&[],0).unwrap_err().code,"ResourceLimit");
}
