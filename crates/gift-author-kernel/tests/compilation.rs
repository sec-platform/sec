use gift_author_kernel::{Compilation, LoweredDefinition, TermKind, affected_exports, compile};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const SOURCE: &[u8] = include_bytes!("../fixtures/shared-views.module.json");
const HUGE_POSITIVE: &str = "922337203685477580812345678901234567890";
const HUGE_NEGATIVE: &str = "-922337203685477580812345678901234567890";

fn source() -> Value { serde_json::from_slice(SOURCE).unwrap() }

#[test]
fn callable_exports_require_a_real_native_value_bridge() {
    reject(|module| {
        module["exports"]["predicate"] = json!({"definitionId":"MeetsThreshold"});
    }, "NeedsTargetBridge");
    reject(|module| {
        module["exports"]["predicate"] = json!({"definitionId":"AcceptedInherited"});
    }, "NeedsTargetBridge");
}

fn changed(mutate: impl FnOnce(&mut Value)) -> Compilation {
    let mut value = source();
    mutate(&mut value);
    compile(&serde_json::to_vec(&value).unwrap()).unwrap()
}

fn reject(mutate: impl FnOnce(&mut Value), code: &str) {
    let mut value = source();
    mutate(&mut value);
    let error = compile(&serde_json::to_vec(&value).unwrap()).unwrap_err();
    assert_eq!(error.code, code, "{}: {}", error.path, error.message);
    assert!(!error.path.is_empty(), "A semantic rejection must locate its author input");
}

#[test]
fn lower_preserves_exact_values_order_occurrences_and_boolean_fields() {
    let compiled = compile(SOURCE).unwrap();
    assert_eq!(compiled.module_id, "module:shared_ordered_views");
    assert_eq!(compiled.method, "gift:finite-ordered-records/2");
    assert_eq!(compiled.program.exports.len(), 2);
    assert_eq!(compiled.program.exports["inherited"], "InheritedView");
    assert_eq!(compiled.program.exports["fixed"], "FixedView");
    let LoweredDefinition::Constant { value, .. } = &compiled.program.definitions["Rows"] else { panic!("Rows must remain a typed constant"); };
    let TermKind::Sequence(rows) = &value.kind else { panic!("Rows must retain sequence semantics"); };
    let mut scores = Vec::new();
    let mut labels = Vec::new();
    let mut enabled = Vec::new();
    for row in rows {
        let TermKind::Record(fields) = &row.kind else { panic!("Expected a record occurrence"); };
        assert_eq!(fields.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>(), ["score", "label", "enabled"]);
        let TermKind::Int(score) = &fields[0].1.kind else { panic!("Expected exact Int"); };
        let TermKind::Text(label) = &fields[1].1.kind else { panic!("Expected Text"); };
        let TermKind::Bool(flag) = &fields[2].1.kind else { panic!("Expected Bool"); };
        scores.push(score.as_str()); labels.push(label.as_str()); enabled.push(*flag);
    }
    assert_eq!(scores, ["9", "5", "8", "5", HUGE_NEGATIVE, HUGE_POSITIVE]);
    assert_eq!(enabled, [true, true, false, true, true, true]);
    assert_eq!(labels[1], "repeated-five");
    assert_eq!(labels[3], "repeated-five");
}

#[test]
fn shared_definition_calls_have_distinct_source_occurrences_and_named_roles() {
    let compiled = compile(SOURCE).unwrap();
    let calls: Vec<_> = compiled.bindings.iter().filter(|binding| binding.definition == "MeetsThreshold").collect();
    assert_eq!(calls.len(), 2);
    assert_ne!(calls[0].occurrence, calls[1].occurrence);
    let occurrences: BTreeSet<_> = calls.iter().map(|call| call.occurrence.as_str()).collect();
    assert_eq!(occurrences, BTreeSet::from([
        "/definitions/KeepFixed/body/body/then",
        "/definitions/KeepInherited/body/body/then",
    ]));
    for call in calls {
        assert_eq!(call.roles.keys().map(String::as_str).collect::<Vec<_>>(), ["left", "right"]);
        assert!(call.roles["left"].ends_with("/arguments/0"));
        assert!(call.roles["right"].ends_with("/arguments/1"));
    }
    assert!(compiled.dependencies["KeepInherited"].contains("DefaultThreshold"));
    assert!(!compiled.dependencies["KeepFixed"].contains("DefaultThreshold"));
    assert!(compiled.dependencies["AcceptedInherited"].contains("KeepInherited"));
}

#[test]
fn shared_default_reference_and_same_fixed_literal_have_distinct_impact() {
    let before = compile(SOURCE).unwrap();
    let after = changed(|v| v["definitions"]["DefaultThreshold"]["body"]["value"]["value"] = json!("8"));
    assert_eq!(affected_exports(&before, &after), ["inherited"]);
    assert_ne!(before.source_revision, after.source_revision);
    assert_ne!(before.semantic_revision, after.semantic_revision);
}

#[test]
fn changing_shared_comparison_policy_reaches_both_views_but_unrelated_edits_do_not() {
    let before = compile(SOURCE).unwrap();
    let strict = changed(|v| v["definitions"]["MeetsThreshold"]["body"]["body"]["cases"][1]["body"]["value"] = json!(false));
    assert_eq!(affected_exports(&before, &strict), ["fixed", "inherited"]);
    let unrelated = changed(|v| v["definitions"]["Unrelated"]["body"]["value"]["value"] = json!(false));
    assert!(affected_exports(&before, &unrelated).is_empty());
}

#[test]
fn equivalent_definition_map_reordering_preserves_semantics_and_rebinds_source_maps() {
    let parsed = source();
    let definitions = parsed["definitions"].as_object().unwrap().iter().rev()
        .map(|(name, value)| format!("{}:{}", serde_json::to_string(name).unwrap(), serde_json::to_string(value).unwrap()))
        .collect::<Vec<_>>().join(",");
    let reordered = format!("{{\"schema\":\"gift.author-module/2\",\"moduleId\":\"module:shared_ordered_views\",\"definitions\":{{{definitions}}},\"exports\":{}}}", serde_json::to_string(&parsed["exports"]).unwrap());
    let before = compile(SOURCE).unwrap();
    let after = compile(reordered.as_bytes()).unwrap();
    assert_eq!(before.semantic_revision, after.semantic_revision);
    assert_ne!(before.source_revision, after.source_revision);
    assert!(affected_exports(&before, &after).is_empty());
    let expected_revision = format!("sha256:{:x}", Sha256::digest(reordered.as_bytes()));
    assert_eq!(after.source_revision, expected_revision);
    assert!(!after.source_map.is_empty());
    for mapping in &after.source_map {
        assert_eq!(mapping.source_revision, expected_revision);
        assert_eq!(mapping.source_pointer, format!("/definitions/{}", mapping.definition));
        let artifact = after.artifacts.iter().find(|artifact| artifact.path == mapping.artifact).expect("Source map must point to an emitted member");
        assert!(mapping.start_line > 0 && mapping.end_line >= mapping.start_line);
        assert!(mapping.end_line <= artifact.content.lines().count());
    }
}

#[test]
fn reader_rejects_duplicate_json_keys_before_maps_can_collapse_them() {
    for bytes in [
        br#"{"schema":"gift.author-module/2","schema":"gift.author-module/2","moduleId":"x","definitions":{}}"#.as_slice(),
        br#"{"schema":"gift.author-module/2","moduleId":"x","definitions":{"C":{"kind":"core:constant","body":{"type":{"tag":"scalar","name":"int","name":"int"},"value":{"op":"literal","type":{"tag":"scalar","name":"int"},"value":"5"}}}}}"#.as_slice(),
        br#"{"schema":"gift.author-module/2","moduleId":"x","definitions":{"C":{"kind":"core:constant","body":{"type":{"tag":"scalar","name":"int"},"value":{"op":"literal","type":{"tag":"scalar","name":"int"},"value":"5","\u0076alue":"6"}}}}}"#.as_slice(),
    ] {
        let error = compile(bytes).unwrap_err();
        assert_eq!(error.code, "InvalidAuthorSource");
        assert!(error.message.contains("Duplicate JSON object key"));
    }
}

#[test]
fn exact_integer_lexemes_cannot_silently_acquire_json_number_or_machine_integer_semantics() {
    for value in [json!("-0"), json!("01"), json!("+1"), json!(5)] {
        reject(|v| v["definitions"]["DefaultThreshold"]["body"]["value"]["value"] = value, "InvalidAuthorSource");
    }
    reject(|v| { v["definitions"]["DefaultThreshold"]["body"]["type"]["bits"] = json!(64); v["definitions"]["DefaultThreshold"]["body"]["type"]["overflow"] = json!("checked"); }, "NeedsSemanticBridge");
    reject(|v| { v["definitions"]["Rows"]["body"]["type"]["tag"] = json!("bag"); v["definitions"]["Rows"]["body"]["type"].as_object_mut().unwrap().remove("ordered"); }, "NeedsSemanticBridge");
}

#[test]
fn method_rejects_missing_bindings_wrong_signatures_and_incomplete_query_sources() {
    reject(|v| v["definitions"]["KeepFixed"]["body"]["body"]["then"]["callee"]["ref"] = json!("local:Missing"), "UnresolvedReference");
    reject(|v| v["definitions"]["KeepFixed"]["body"]["returns"] = json!({"tag":"scalar","name":"text"}), "TypeMismatch");
    reject(|v| v["definitions"]["AcceptedInherited"]["body"]["parameters"][0]["name"] = json!("differentRole"), "TypeMismatch");
    reject(|v| v["definitions"]["FixedView"]["body"]["inputRefs"] = json!([]), "InvalidQueryInputs");
    reject(|v| v["definitions"]["FixedView"]["body"]["algebra"]["predicateRef"] = json!("local:DefaultThreshold"), "TypeMismatch");
    reject(|v| { v["definitions"]["MeetsThreshold"]["body"]["body"]["cases"].as_array_mut().unwrap().remove(1); }, "InvalidMatch");
}

#[test]
fn unsupported_obligations_effects_and_recursive_totality_never_disappear_as_dead_code() {
    reject(|v| v["definitions"]["Unrelated"] = json!({"kind":"req:composite","body":{"parameters":{},"terms":[]}}), "NeedsMethod");
    reject(|v| v["definitions"]["Unrelated"] = json!({"kind":"not:a-definition","body":{}}), "InvalidAuthorSource");
    reject(|v| v["definitions"]["KeepFixed"]["body"]["captures"] = json!({}), "NeedsSemanticBridge");
    reject(|v| v["definitions"]["KeepFixed"]["body"]["effects"] = json!([{"class":"io"}]), "NeedsSemanticBridge");
    reject(|v| v["definitions"]["KeepFixed"]["body"]["body"] = json!({"op":"call","callee":{"op":"symbol","ref":"local:KeepFixed"},"arguments":[{"op":"var","name":"row"}]}), "NeedsMethod");
    reject(|v| v["imports"] = json!({"external":{"mode":"workspace","moduleId":"module:external"}}), "NeedsSemanticBridge");
    reject(|v| v["schema"] = json!("gift.author-module/design-converged"), "UnsupportedAuthorSchema");
}
