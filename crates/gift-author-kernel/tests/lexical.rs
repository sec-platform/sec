use gift_author_kernel::{binding::{self, NameAnalysis}, lexical::{ControlResolution, LocalResolution}};
use serde_json::{Value, json};

fn module(definitions: Value) -> Value {
    json!({"schema":"gift.author-module/design-converged","moduleId":"lexical:test","definitions":definitions})
}
fn analyze(definitions: Value) -> NameAnalysis {
    binding::analyze(&serde_json::to_vec(&module(definitions)).unwrap()).unwrap()
}
fn int() -> Value { json!({"tag":"scalar","name":"int"}) }
fn literal() -> Value { json!({"op":"literal","type":int(),"value":"1"}) }
fn var(name: &str) -> Value { json!({"op":"var","name":name}) }
fn function(parameters: Value, body: Value) -> Value {
    json!({"kind":"core:function","body":{"parameters":parameters,"body":body}})
}
fn local_use<'a>(analysis: &'a NameAnalysis, path: &str) -> &'a gift_author_kernel::lexical::LocalUse {
    analysis.lexical.uses.iter().find(|item| analysis.lexical.occurrences[item.occurrence.index()].expanded_path == path)
        .unwrap_or_else(|| panic!("Missing use at {path}: {:?}",analysis.lexical.uses))
}
fn resolved(analysis: &NameAnalysis, path: &str) -> usize {
    match local_use(analysis,path).resolution {
        LocalResolution::Resolved { binding } => binding.index(),
        ref other => panic!("Expected resolved {path}: {other:?}"),
    }
}
fn shared_ref(key: &str) -> Value { json!({"tag":"reference","ref":{"binding":key}}) }
fn shared_literal() -> Value { json!({"tag":"literal","type":"Int","value":"1"}) }
fn design(expression: Value, type_params: Value) -> Value {
    json!({"kind":"req:composite","body":{"parameters":{},"typeParams":type_params,
        "terms":[{"require":{"definitionId":"Rule"},"fields":{"value":{"expression":expression}}}]}})
}
const DESIGN: &str = "/definitions/Design/body/terms/0/fields/value/expression";

#[test]
fn ordered_initialization_shadowing_and_capture_use_real_binding_ids() {
    let analysis = analyze(json!({"Compose":function(json!([{"name":"x","type":int()}]),json!({"op":"exec:block","statements":[
        {"op":"let","name":"y","value":var("x")},
        {"op":"eval","value":{"op":"lambda","typeParams":[],"params":[{"name":"z","type":int()}],"body":{
            "op":"exec:block","statements":[{"op":"return","value":var("y")}]}}},
        {"op":"scope","body":{"op":"exec:block","statements":[{"op":"let","name":"y","value":var("y")}],"result":var("y")}}
    ],"result":var("y")}))}));
    assert_eq!(analysis.schema,"gift.author-names/2");
    let outer = resolved(&analysis,"/definitions/Compose/body/body/result");
    let initial = resolved(&analysis,"/definitions/Compose/body/body/statements/2/body/statements/0/value");
    let inner = resolved(&analysis,"/definitions/Compose/body/body/statements/2/body/result");
    assert_eq!(outer,initial);
    assert_ne!(outer,inner);
    assert!(analysis.lexical.captures.iter().any(|edge| edge.binding.index() == outer));
    let returned = &analysis.lexical.exits[0];
    assert!(matches!(returned.target,ControlResolution::Resolved{scope} if analysis.lexical.scopes[scope.index()].kind == "lambda"));
    let occurrence = &analysis.lexical.occurrences[local_use(&analysis,"/definitions/Compose/body/body/result").occurrence.index()];
    assert_eq!(occurrence.origin.as_ref().unwrap().pointer,"/definitions/Compose/body/body/result");
    assert!(analysis.lexical.problems.is_empty());
}

#[test]
fn loops_bind_condition_exits_but_lambdas_reset_loop_targets() {
    let analysis = analyze(json!({"F":function(json!([]),json!({"op":"exec:block","statements":[
        {"op":"while","condition":{"op":"try","errorName":"e","body":{"op":"exec:block","statements":[{"op":"break"}]},"onError":literal()},
         "body":{"op":"exec:block","statements":[{"op":"eval","value":{"op":"lambda","typeParams":[],"params":[],"body":{
             "op":"exec:block","statements":[{"op":"break"},{"op":"return"}]}}},{"op":"continue"}]}},
        {"op":"break"}
    ]}))}));
    let exits = &analysis.lexical.exits;
    assert!(matches!(exits[0].target,ControlResolution::Resolved{scope} if analysis.lexical.scopes[scope.index()].kind == "loop"));
    assert!(matches!(exits[1].target,ControlResolution::Rejected{code:"InvalidControlTarget"}));
    assert!(matches!(exits[2].target,ControlResolution::Resolved{scope} if analysis.lexical.scopes[scope.index()].kind == "lambda"));
    assert!(matches!(exits[3].target,ControlResolution::Resolved{scope} if analysis.lexical.scopes[scope.index()].kind == "loop"));
    assert!(matches!(exits[4].target,ControlResolution::Rejected{code:"InvalidControlTarget"}));
}

#[test]
fn handler_uses_outer_environment_and_cannot_leak_body_locals() {
    let analysis = analyze(json!({"F":function(json!([{"name":"x","type":int()}]),json!({"op":"try","errorName":"e",
        "body":{"op":"exec:block","statements":[{"op":"let","name":"hidden","value":literal()}],"result":var("e")},
        "onError":{"op":"record","fields":[{"name":"outer","value":var("x")},{"name":"error","value":var("e")},{"name":"bad","value":var("hidden")}]}}))}));
    assert!(matches!(local_use(&analysis,"/definitions/F/body/body/body/result").resolution,LocalResolution::Rejected{code:"MissingLocalBinding"}));
    assert!(matches!(local_use(&analysis,"/definitions/F/body/body/onError/fields/2/value").resolution,LocalResolution::Rejected{code:"MissingLocalBinding"}));
    let id = resolved(&analysis,"/definitions/F/body/body/onError/fields/1/value");
    assert_eq!(analysis.lexical.bindings[id].kind,"handler");
}

#[test]
fn immutable_assignment_and_same_block_duplicates_are_rejected() {
    let analysis = analyze(json!({"F":function(json!([]),json!({"op":"exec:block","statements":[
        {"op":"let","name":"a","value":literal()}, {"op":"set","name":"a","value":literal()},
        {"op":"let","name":"a","value":literal()}, {"op":"var","name":"b","value":literal()},
        {"op":"set","name":"b","value":literal()}
    ]}))}));
    assert!(analysis.lexical.problems.iter().any(|problem| problem.code == "DuplicateBindingName"));
    assert!(matches!(local_use(&analysis,"/definitions/F/body/body/statements/1").resolution,LocalResolution::Rejected{code:"ImmutableBindingWrite"}));
    let id = resolved(&analysis,"/definitions/F/body/body/statements/4");
    assert!(analysis.lexical.bindings[id].mutable);
}

#[test]
fn shared_keys_cannot_bypass_shadowing_or_sequential_initialization() {
    let expression = json!({"tag":"region","bindings":[{"binding":{"key":"outer","name":"x"},"initializer":shared_literal()}],
        "expression":{"tag":"region","bindings":[{"binding":{"key":"inner","name":"x"},"initializer":shared_ref("inner")}],
            "expression":{"tag":"record","fields":[{"name":"bad","value":shared_ref("outer")},{"name":"ok","value":shared_ref("inner")}]}}});
    let analysis = analyze(json!({"Design":design(expression,json!([]))}));
    assert!(matches!(local_use(&analysis,&format!("{DESIGN}/expression/bindings/0/initializer")).resolution,LocalResolution::Rejected{code:"BindingNotVisible"}));
    assert!(matches!(local_use(&analysis,&format!("{DESIGN}/expression/expression/fields/0/value")).resolution,LocalResolution::Rejected{code:"ShadowedBinding"}));
    let id = resolved(&analysis,&format!("{DESIGN}/expression/expression/fields/1/value"));
    assert_eq!(analysis.lexical.bindings[id].source_key.as_deref(),Some("inner"));
}

#[test]
fn semantic_value_is_one_binder_in_two_domains_and_keys_are_definition_wide() {
    let expression = json!({"tag":"record","fields":[{"name":"static","value":shared_ref("N")},
        {"name":"one","value":{"tag":"lambda","typeParams":[],"params":[{"key":"p","name":"a"}],"expression":shared_literal()}},
        {"name":"two","value":{"tag":"lambda","typeParams":[],"params":[{"key":"p","name":"b"}],"expression":shared_literal()}}]});
    let analysis = analyze(json!({"Design":design(expression,json!([
        {"key":"T","name":"T"}, {"key":"N","name":"N","kind":{"value":{"core":"Int"}}}
    ]))}));
    let id = resolved(&analysis,&format!("{DESIGN}/fields/0/value"));
    assert_eq!(analysis.lexical.bindings[id].domains,vec!["semantic","value"]);
    assert_eq!(analysis.lexical.bindings[id].kind,"Value");
    assert!(analysis.lexical.problems.iter().any(|problem| problem.code == "DuplicateBindingKey"));
    assert_eq!(analysis.lexical.bindings.iter().filter(|binding| binding.source_key.as_deref() == Some("N")).count(),1);
}

#[test]
fn semantic_kind_phase_and_omitted_lambda_boundaries_remain_distinct() {
    let analysis = analyze(json!({"F":{"kind":"core:function","body":{"parameters":[],"typeParams":[
        {"name":"T"},{"name":"N","kind":{"value":int()}},{"name":"R","kind":"Region"}],"body":{"op":"record","fields":[
        {"name":"badKind","value":{"op":"lambda","typeParams":[{"name":"T","kind":"Region"}],"params":[{"name":"x","type":{"tag":"param","name":"T"}}],"body":literal()}},
        {"name":"unknown","value":{"op":"lambda","params":[{"name":"x","type":{"tag":"param","name":"T"}}],"body":var("N")}},
        {"name":"phase","value":{"op":"lambda","typeParams":[],"params":[{"name":"N","type":int()}],"body":{
            "op":"call","callee":{"op":"symbol","ref":"local:F"},"arguments":[],"semanticArguments":[{"value":var("N")}]}}}
    ]}}}}));
    assert!(analysis.lexical.problems.iter().any(|problem| problem.code == "BindingKindMismatch"));
    assert!(analysis.lexical.problems.iter().any(|problem| problem.code == "BindingPhaseMismatch"));
    assert!(analysis.lexical.pending_regions.iter().any(|problem| problem.code == "NeedsExpectedLambdaSignature"));
    let id = resolved(&analysis,"/definitions/F/body/body/fields/1/value/body");
    assert_eq!(analysis.lexical.bindings[id].kind,"Value");
    let annotation = local_use(&analysis,"/definitions/F/body/body/fields/1/value/params/0/type");
    assert!(matches!(annotation.resolution,LocalResolution::Needs{code:"NeedsExpectedLambdaSignature"}));
}

#[test]
fn shared_patterns_bind_each_arm_and_preserve_partial_unknown_outer() {
    let expression = json!({"tag":"match","subject":shared_ref("external"),"arms":[
        {"pattern":{"tag":"cons","head":{"key":"h","name":"x"},"tail":{"key":"t","name":"rest"}},"expression":shared_ref("h")},
        {"pattern":{"tag":"bind","binding":{"key":"other","name":"other"}},"expression":shared_ref("h")}
    ]});
    let analysis = analyze(json!({"Design":design(expression,json!([]))}));
    let id = resolved(&analysis,&format!("{DESIGN}/arms/0/expression"));
    assert_eq!(analysis.lexical.bindings[id].kind,"pattern");
    assert!(matches!(local_use(&analysis,&format!("{DESIGN}/subject")).resolution,LocalResolution::Needs{code:"NeedsOuterBindingEnvironment"}));
    assert!(matches!(local_use(&analysis,&format!("{DESIGN}/arms/1/expression")).resolution,LocalResolution::Rejected{code:"BindingNotVisible"}));
}

#[test]
fn data_stops_and_capture_slots_do_not_become_value_variables() {
    let analysis = analyze(json!({"F":function(json!([]),json!({"op":"literal","type":{"tag":"scalar","name":"text"},"value":"binding"})),
        "D":{"req:composite":{"parameters":{},"terms":[{"require":{"definitionId":"Rule"},"fields":{"v":{"typed":{
            "type":{"core":"Text"},"value":{"tag":"reference","ref":{"binding":"missing"}}}}}}]}}}));
    assert!(analysis.lexical.uses.is_empty());
    assert!(analysis.lexical.problems.is_empty());
    for scope in &analysis.lexical.scopes { assert!(scope.parent.is_none_or(|parent| parent.index() < scope.id.index())); }
}

#[test]
fn semantic_locators_cover_constructor_pack_effect_and_existential_scopes() {
    let analysis = analyze(json!({"Types":{"kind":"core:type","body":{"typeParams":[
        {"name":"T"},{"name":"R","kind":"Region"},{"name":"S","kind":"Scope"},{"name":"Fx","kind":"EffectRow"},
        {"name":"F","kind":{"constructor":{"parameters":["Type"],"result":"Type"}}},{"name":"Ts","kind":{"pack":"Type"}}
    ],"type":{"tag":"function","typeParams":[],"params":[
        {"tag":"apply","constructor":{"parameter":"F"},"arguments":[{"tag":"param","name":"T"}]},
        {"packElement":{"pack":{"parameter":"Ts"},"index":literal()}},
        {"tag":"apply","constructor":{"decl":"local:Nominal"},"arguments":[{"region":{"parameter":"R"}},{"scope":{"parameter":"S"}}]}
    ],"returns":{"tag":"exists","parameters":[{"name":"Inner","kind":"Region","binding":"fresh"}],
        "type":{"tag":"apply","constructor":{"decl":"local:Nominal"},"arguments":[{"region":{"parameter":"Inner"}}]}},
    "effects":{"members":[],"tail":{"parameter":"Fx"}}}}}}));
    for usage in &analysis.lexical.uses { assert!(matches!(usage.resolution,LocalResolution::Resolved{..}),"{usage:?}"); }
    assert_eq!(analysis.lexical.uses.len(),7);
    let kinds: std::collections::BTreeSet<_> = analysis.lexical.uses.iter().filter_map(|usage| usage.expected_kind.as_deref()).collect();
    assert_eq!(kinds,std::collections::BTreeSet::from(["Type","Region","Scope","EffectRow","constructor","pack"]));
    assert!(analysis.lexical.problems.is_empty());
}

#[test]
fn shared_value_key_collisions_do_not_merge_distinct_bindings_or_domains() {
    let expression = json!({"tag":"region","bindings":[
        {"binding":{"key":"same","name":"value"},"initializer":shared_literal()},
        {"binding":{"key":"N","name":"other"},"initializer":shared_literal()}],"expression":shared_literal()});
    let analysis = analyze(json!({"Design":design(expression,json!([
        {"key":"same","name":"T"},{"key":"N","name":"N","kind":{"value":{"core":"Int"}}}
    ]))}));
    let repeated:Vec<_> = analysis.lexical.bindings.iter().filter(|binding| binding.source_key.as_deref() == Some("same")).collect();
    assert_eq!(repeated.len(),2);
    assert_ne!(repeated[0].id,repeated[1].id);
    assert_eq!(analysis.lexical.problems.iter().filter(|problem| problem.code == "DuplicateBindingKey").count(),1);
}

#[test]
fn pattern_duplicate_names_and_foreign_function_locals_are_rejected() {
    let expression = json!({"tag":"match","subject":shared_literal(),"arms":[{"pattern":{"tag":"cons",
        "head":{"key":"h","name":"same"},"tail":{"key":"t","name":"same"}},"expression":shared_literal()}]});
    let analysis = analyze(json!({"Design":design(expression,json!([])),
        "F":function(json!([{"name":"x","type":int()}]),var("x")),
        "G":function(json!([]),var("x"))}));
    assert!(analysis.lexical.problems.iter().any(|problem| problem.code == "DuplicateBindingName"));
    assert!(matches!(local_use(&analysis,"/definitions/G/body/body").resolution,LocalResolution::Rejected{code:"MissingLocalBinding"}));
}

#[test]
fn shared_expansion_nodes_have_distinct_occurrences_and_local_binders() {
    let formula = json!({"apply":{"meaningRef":"local:P","arguments":{"x":{"value":{
        "op":"lambda","typeParams":[],"params":[{"name":"x","type":int()}],"body":var("x")
    }}}}});
    let analysis = analyze(json!({"Goal":{"intent:goal":{"roles":{"x":{"typeRef":"local:T","cardinality":"one"}},"clauses":{"c":{"achieve":{"iff":[formula.clone(),formula]}}}}}}));
    let uses = &analysis.lexical.uses;
    assert_eq!(uses.len(),4);
    let identities: std::collections::BTreeSet<_> = uses.iter().map(|usage| usage.occurrence).collect();
    assert_eq!(identities.len(),4);
    let bindings: std::collections::BTreeSet<_> = uses.iter().map(|usage| match usage.resolution {
        LocalResolution::Resolved{binding} => binding,
        ref other => panic!("Expected each local parameter resolved: {other:?}"),
    }).collect();
    assert_eq!(bindings.len(),4);
    let mut origins = std::collections::BTreeMap::new();
    for usage in uses { *origins.entry(&analysis.lexical.occurrences[usage.occurrence.index()].origin.as_ref().unwrap().pointer).or_insert(0) += 1; }
    assert_eq!(origins.values().copied().collect::<Vec<_>>(),vec![2,2]);
}

#[test]
fn semantic_parameter_groups_collect_later_type_heads_before_kind_dependencies() {
    let analysis = analyze(json!({"F":{"kind":"core:function","body":{"parameters":[],"typeParams":[
        {"name":"N","kind":{"value":{"tag":"param","name":"T"}}},{"name":"T"}],"body":var("N")}},
        "Design":design(shared_ref("value"),json!([
            {"key":"value","name":"N","kind":{"value":{"parameter":"type"}}},{"key":"type","name":"T"}
        ]))}));
    let actual = resolved(&analysis,"/definitions/F/body/typeParams/0/kind/value");
    assert_eq!(analysis.lexical.bindings[actual].name,"T");
    let common = resolved(&analysis,"/definitions/Design/body/typeParams/0/kind/value");
    assert_eq!(analysis.lexical.bindings[common].source_key.as_deref(),Some("type"));
    assert!(analysis.lexical.problems.is_empty());
}

#[test]
fn pattern_selector_inputs_are_checked_before_any_arm_binding_is_introduced() {
    let expression = json!({"tag":"region","bindings":[{"binding":{"key":"outer","name":"x"},"initializer":shared_literal()}],
        "expression":{"tag":"match","subject":shared_literal(),"arms":[{
            "pattern":{"tag":"constructor","constructor":{"type":{"decl":{"definitionId":"Choice"}},"name":"Pair"},"patterns":[
                {"tag":"bind","binding":{"key":"inner","name":"x"}},
                {"tag":"constructor","constructor":{"type":{"decl":{"definitionId":"Nested"},"arguments":[{"value":shared_ref("outer")}]},"name":"Leaf"},"patterns":[]}
            ]},"expression":shared_ref("inner")
        }]}});
    let analysis = analyze(json!({"Design":design(expression,json!([]))}));
    let selector = resolved(&analysis,&format!("{DESIGN}/expression/arms/0/pattern/patterns/1/constructor/type/arguments/0/value"));
    let body = resolved(&analysis,&format!("{DESIGN}/expression/arms/0/expression"));
    assert_eq!(analysis.lexical.bindings[selector].source_key.as_deref(),Some("outer"));
    assert_eq!(analysis.lexical.bindings[body].source_key.as_deref(),Some("inner"));
    assert!(analysis.lexical.problems.is_empty());
}

#[test]
fn professional_unknown_outer_cannot_supply_a_loop_across_a_known_lambda() {
    let formula = json!({"apply":{"meaningRef":"local:P","arguments":{"x":{"value":{
        "op":"lambda","typeParams":[],"params":[],"body":{"op":"exec:block","statements":[{"op":"break"},{"op":"continue"}]}
    }}}}});
    let analysis = analyze(json!({"Goal":{"intent:goal":{"roles":{"x":{"typeRef":"local:T","cardinality":"one"}},"clauses":{"c":{"achieve":formula}}}}}));
    assert_eq!(analysis.lexical.exits.len(),2);
    for exit in &analysis.lexical.exits { assert!(matches!(exit.target,ControlResolution::Rejected{code:"InvalidControlTarget"})); }
}
