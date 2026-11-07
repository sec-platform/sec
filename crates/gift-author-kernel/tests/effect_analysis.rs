use std::collections::BTreeSet;

use gift_author_kernel::{
    binding::DeclarationId,
    effect_analysis::{CodeIdentity, EffectLimits, EffectState, EffectSummary},
    reader,
    signature_resolution::{self, SignatureResolution},
};
use serde_json::{json, Value};

fn scalar(name: &str) -> Value {
    json!({"tag": "scalar", "name": name})
}

fn integer(value: &str) -> Value {
    json!({"op": "literal", "type": scalar("int"), "value": value})
}

fn boolean(value: bool) -> Value {
    json!({"op": "literal", "type": scalar("bool"), "value": value})
}

fn variable(name: &str) -> Value {
    json!({"op": "var", "name": name})
}

fn symbol(name: &str) -> Value {
    json!({"op": "symbol", "ref": format!("local:{name}")})
}

fn call(callee: Value, arguments: Value) -> Value {
    json!({"op": "call", "callee": callee, "arguments": arguments})
}

fn block(statements: Value) -> Value {
    json!({"op": "exec:block", "statements": statements})
}

fn unit_function(parameters: Value, body: Value) -> Value {
    json!({"kind": "core:function", "body": {
        "parameters": parameters, "returns": scalar("unit"), "body": body
    }})
}

fn bounded(mut definition: Value, effects: Value) -> Value {
    definition["body"]["effects"] = effects;
    definition
}

fn parameter(name: &str, ty: Value) -> Value {
    json!({"name": name, "type": ty})
}

fn callback_type(effects: Value) -> Value {
    json!({"tag": "function", "params": [], "returns": scalar("unit"), "effects": effects})
}

fn lambda(body: Value) -> Value {
    json!({"op": "lambda", "params": [], "body": body})
}

fn constant(value: Value) -> Value {
    json!({"kind": "core:constant", "body": {"value": value}})
}

fn bytes(definitions: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "schema": "gift.author-module/design-converged",
        "moduleId": "effects:test",
        "definitions": definitions
    }))
    .unwrap()
}

fn analyze(definitions: Value) -> SignatureResolution {
    let source = bytes(definitions);
    reader::read(&source).expect("The independent Reader accepts the intended semantic test input");
    signature_resolution::resolve(&source).unwrap()
}

fn declaration(analysis: &SignatureResolution, name: &str) -> DeclarationId {
    analysis
        .names
        .declarations
        .iter()
        .find(|declaration| declaration.name == name)
        .unwrap()
        .id
}

fn summary<'a>(analysis: &'a SignatureResolution, name: &str) -> &'a EffectSummary {
    &analysis.effects.declarations[&declaration(analysis, name)]
}

fn classes(summary: &EffectSummary) -> BTreeSet<&str> {
    summary.may.iter().map(|effect| effect.class.as_str()).collect()
}

fn assert_empty_body_effects(summary: &EffectSummary) {
    assert_eq!(summary.state, EffectState::BodyDerived, "{summary:?}");
    assert!(summary.may.is_empty(), "{summary:?}");
    assert!(summary.internal.is_empty(), "{summary:?}");
}

fn local_state(statements_after_access: Value) -> Value {
    let mut statements = vec![
        json!({"op": "var", "name": "cell", "value": integer("0")}),
        json!({"op": "set", "name": "cell", "value": integer("1")}),
        json!({"op": "eval", "value": variable("cell")}),
    ];
    statements.extend(statements_after_access.as_array().unwrap().iter().cloned());
    block(json!(statements))
}

#[test]
fn recursive_empty_equations_close_without_becoming_a_termination_proof() {
    let analysis = analyze(json!({
        "F": unit_function(json!([]), call(symbol("G"), json!([]))),
        "G": unit_function(json!([]), call(symbol("F"), json!([])))
    }));
    for name in ["F", "G"] {
        assert_empty_body_effects(summary(&analysis, name));
    }
    let f = declaration(&analysis, "F");
    let g = declaration(&analysis, "G");
    assert_eq!(analysis.dependencies[&f], BTreeSet::from([g]));
    assert_eq!(analysis.dependencies[&g], BTreeSet::from([f]));
    assert_eq!(analysis.bodies.calls.len(), 2);
    // Effect closure is only one input to the existing callable qualification.
    assert!(analysis.needs.iter().any(|need| {
        need.code == "NeedsCaptureAndCallableQualification"
    }));
}

#[test]
fn real_storage_seeds_propagate_through_a_cycle_and_disappear_after_source_deletion() {
    let analysis = analyze(json!({
        "F": unit_function(json!([]), call(symbol("G"), json!([]))),
        "G": unit_function(json!([]), local_state(json!([
            {"op": "eval", "value": call(symbol("F"), json!([]))}
        ])))
    }));
    let cell = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "cell" && occurrence.expanded_path.starts_with("/definitions/G/")
    }).unwrap().id;
    for name in ["F", "G"] {
        let effects = summary(&analysis, name);
        assert!(effects.internal.iter().any(|access| access.binding == cell && access.write));
        assert!(effects.internal.iter().any(|access| access.binding == cell && !access.write));
        assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
    }

    // The call cycle remains. Only the actual read/write sources are removed.
    let deleted = analyze(json!({
        "F": unit_function(json!([]), call(symbol("G"), json!([]))),
        "G": unit_function(json!([]), block(json!([
            {"op": "var", "name": "cell", "value": integer("0")},
            {"op": "eval", "value": call(symbol("F"), json!([]))}
        ])))
    }));
    for name in ["F", "G"] {
        assert_empty_body_effects(summary(&deleted, name));
    }
}

#[test]
fn explicit_bounds_are_checked_against_bodies_and_universal_callback_contracts() {
    let io = json!([{"class": "io"}]);
    let wide_callback = callback_type(io.clone());
    let analysis = analyze(json!({
        "Pure": bounded(unit_function(json!([]), block(json!([]))), io.clone()),
        "Caller": unit_function(json!([]), call(symbol("Pure"), json!([]))),
        "Use": bounded(unit_function(json!([parameter("k", wide_callback.clone())]),
            call(variable("k"), json!([]))), io),
        "Bad": bounded(unit_function(json!([parameter("k", wide_callback)]),
            call(variable("k"), json!([]))), json!([]))
    }));
    assert_empty_body_effects(summary(&analysis, "Pure"));
    assert_empty_body_effects(summary(&analysis, "Caller"));
    assert_eq!(summary(&analysis, "Use").state, EffectState::ConservativeBound);
    assert_eq!(classes(summary(&analysis, "Use")), BTreeSet::from(["io"]));
    assert_eq!(summary(&analysis, "Bad").state, EffectState::Rejected);
    assert!(analysis.effects.problems.iter().any(|problem| {
        problem.diagnostic.code == "EffectUpperBoundExceeded"
            && analysis.types.source(problem.source).expanded_path.starts_with("/definitions/Bad/")
    }));
}

#[test]
fn open_effect_tails_preserve_known_members_without_becoming_empty_or_closed() {
    let mut definition = unit_function(
        json!([parameter("k", callback_type(json!({
            "members": [{"class": "io"}], "tail": {"parameter": "Fx"}
        })))]),
        call(variable("k"), json!([])),
    );
    definition["body"]["typeParams"] = json!([{"name": "Fx", "kind": "EffectRow"}]);
    let analysis = analyze(json!({"Open": definition}));
    let effects = summary(&analysis, "Open");
    assert_eq!(effects.state, EffectState::Unknown);
    assert!(classes(effects).contains("io"), "{effects:?}");
    assert!(!effects.needs.is_empty(), "{effects:?}");
    assert!(!analysis.effects.problems.iter().any(|problem| {
        problem.diagnostic.code == "EffectUpperBoundExceeded"
    }));
}

#[test]
fn lambda_values_keep_distinct_latent_bodies_through_constants_let_and_return() {
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Stateful": constant(lambda(local_state(json!([])))),
        "RunQuiet": unit_function(json!([]), call(symbol("Quiet"), json!([]))),
        "RunStateful": unit_function(json!([]), call(symbol("Stateful"), json!([]))),
        "RunLet": unit_function(json!([]), json!({"op": "let", "name": "callback",
            "value": symbol("Stateful"), "body": call(variable("callback"), json!([]))})),
        "Get": {"kind": "core:function", "body": {"parameters": [], "body": symbol("Stateful")}},
        "RunReturned": unit_function(json!([]), call(call(symbol("Get"), json!([])), json!([])))
    }));
    assert_empty_body_effects(summary(&analysis, "RunQuiet"));
    assert_empty_body_effects(summary(&analysis, "Get"));
    let cell = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "cell" && occurrence.expanded_path.starts_with("/definitions/Stateful/")
    }).unwrap().id;
    for name in ["RunStateful", "RunLet", "RunReturned"] {
        let effects = summary(&analysis, name);
        assert!(effects.internal.iter().any(|access| access.binding == cell && access.write), "{name}: {effects:?}");
        assert!(effects.internal.iter().any(|access| access.binding == cell && !access.write), "{name}: {effects:?}");
    }
    let mut found = BTreeSet::new();
    for closure in &analysis.effects.closures {
        if let CodeIdentity::Lambda(source) = &closure.code {
            match analysis.types.source(*source).expanded_path.as_str() {
                "/definitions/Quiet/body/value" => {
                    assert_empty_body_effects(&closure.latent);
                    found.insert("quiet");
                }
                "/definitions/Stateful/body/value" => {
                    assert!(closure.latent.internal.iter().any(|access| access.binding == cell && access.write));
                    found.insert("stateful");
                }
                _ => {}
            }
        }
    }
    assert_eq!(found, BTreeSet::from(["quiet", "stateful"]));
    for path in ["/definitions/Quiet/body/value", "/definitions/Stateful/body/value"] {
        let occurrences = analysis.effects.expressions.iter().filter(|((_, source), _)| {
            analysis.types.source(*source).expanded_path == path
        }).collect::<Vec<_>>();
        assert!(!occurrences.is_empty(), "No immediate creation summary for {path}");
        for (_, immediate) in occurrences {
            assert!(immediate.may.is_empty(), "{path}: {immediate:?}");
            assert!(immediate.internal.is_empty(), "{path}: {immediate:?}");
        }
        assert!(analysis.effects.values.iter().any(|((_, source), closures)| {
            analysis.types.source(*source).expanded_path == path
                && closures.iter().any(|id| matches!(
                    &analysis.effects.closures[id.0].code,
                    CodeIdentity::Lambda(source) if analysis.types.source(*source).expanded_path == path
                ))
        }), "No actual function value points to the lambda at {path}");
    }
}

#[test]
fn shared_function_type_omission_is_a_closed_empty_callback_bound() {
    // The professional Rule interpretation remains unresolved. The explicitly
    // typed common lambda and its callback still have their own effect facts.
    let expression = json!({"tag": "lambda", "params": [{
        "key": "callback", "name": "callback",
        "type": {"function": {"parameters": [], "returns": {"core": "Unit"}}}
    }], "expression": {"tag": "call",
        "callee": {"tag": "reference", "ref": {"binding": "callback"}}, "arguments": []}});
    let analysis = analyze(json!({"Design": {"kind": "req:composite", "body": {
        "parameters": {}, "terms": [{"require": {"definitionId": "UnresolvedRule"},
            "fields": {"value": {"expression": expression}}}]
    }}}));
    let path = "/definitions/Design/body/terms/0/fields/value/expression";
    let closures = analysis.effects.closures.iter().filter(|closure| {
        matches!(&closure.code, CodeIdentity::Lambda(source)
            if analysis.types.source(*source).expanded_path == path)
    }).collect::<Vec<_>>();
    assert!(!closures.is_empty());
    for closure in closures {
        assert!(closure.latent.may.is_empty(), "{:?}", closure.latent);
        assert!(closure.latent.internal.is_empty(), "{:?}", closure.latent);
        assert!(matches!(closure.latent.state,
            EffectState::BodyDerived | EffectState::ConservativeBound));
    }
    assert!(analysis.needs.iter().any(|need| need.code == "NeedsProfessionalBodyQualification"));
}

#[test]
fn a_real_pure_capture_is_more_precise_than_a_wide_universal_parameter() {
    let wide = callback_type(json!([{"class": "io"}]));
    let mut pure = lambda(block(json!([])));
    pure["effects"] = json!([]);
    let invoke_capture = call(lambda(call(variable("k"), json!([]))), json!([]));
    let analysis = analyze(json!({
        "Closed": bounded(unit_function(json!([]), block(json!([
            {"op": "let", "name": "k", "type": wide.clone(), "value": pure},
            {"op": "eval", "value": invoke_capture.clone()}
        ]))), json!([])),
        "Universal": bounded(unit_function(json!([parameter("k", wide)]), invoke_capture), json!([]))
    }));
    let closed = summary(&analysis, "Closed");
    assert!(closed.may.is_empty(), "{closed:?}");
    assert!(closed.internal.is_empty(), "{closed:?}");
    assert!(matches!(closed.state, EffectState::BodyDerived | EffectState::ConservativeBound), "{closed:?}");
    assert_eq!(summary(&analysis, "Universal").state, EffectState::Rejected);
    assert!(analysis.effects.problems.iter().any(|problem| {
        problem.diagnostic.code == "EffectUpperBoundExceeded"
            && analysis.types.source(problem.source).expanded_path.starts_with("/definitions/Universal/")
    }));
    let captured_k = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "k" && occurrence.expanded_path == "/definitions/Closed/body/body/statements/0"
    }).unwrap().id;
    assert!(analysis.effects.closures.iter().any(|closure| {
        matches!(&closure.code, CodeIdentity::Lambda(source)
            if analysis.types.source(*source).expanded_path == "/definitions/Closed/body/body/statements/1/value/callee")
            && closure.environment.iter().any(|(binding, _)| *binding == captured_k)
            && closure.latent.may.is_empty()
            && closure.latent.state != EffectState::Unknown
            && closure.latent.state != EffectState::Rejected
    }));
}

#[test]
fn strict_function_value_cycles_do_not_inherit_the_pure_recursive_function_result() {
    let ty = callback_type(json!([]));
    let analysis = analyze(json!({
        "A": {"kind": "core:constant", "body": {"type": ty.clone(), "value": symbol("B")}},
        "B": {"kind": "core:constant", "body": {"type": ty, "value": symbol("A")}}
    }));
    for name in ["A", "B"] {
        assert!(matches!(summary(&analysis, name).state, EffectState::Unknown | EffectState::Rejected));
    }
    assert!(analysis.effects.closures.iter().all(|closure| !closure.ready));
    assert!(!analysis.effects.needs.is_empty() || !analysis.effects.problems.is_empty());
}

#[test]
fn missing_error_qualification_preserves_handler_storage_and_each_outside_call() {
    let analysis = analyze(json!({
        "G": unit_function(json!([]), json!({"op": "throw", "error": integer("1")})),
        "F": unit_function(json!([]), block(json!([
            {"op": "eval", "value": {"op": "try", "body": call(symbol("G"), json!([])),
                "errorName": "error", "onError": local_state(json!([]))}},
            {"op": "eval", "value": call(symbol("G"), json!([]))}
        ]))),
        "Good": unit_function(json!([]), block(json!([])))
    }));
    assert_eq!(summary(&analysis, "G").state, EffectState::Unknown);
    assert_eq!(summary(&analysis, "F").state, EffectState::Unknown);
    assert_empty_body_effects(summary(&analysis, "Good"));
    let handler_cell = analysis.names.lexical.bindings.iter().find(|binding| binding.name == "cell").unwrap().id;
    assert!(summary(&analysis, "F").internal.iter().any(|access| access.binding == handler_cell && access.write));
    assert!(analysis.effects.needs.iter().any(|need| need.code == "NeedsManagedErrorProfile"));
    let g = declaration(&analysis, "G");
    let calls = analysis.bodies.calls.iter().filter(|call| call.callee == Some(g)).collect::<Vec<_>>();
    assert_eq!(calls.len(), 2);
    let paths = calls.iter().map(|call| analysis.types.source(call.source).expanded_path.as_str()).collect::<BTreeSet<_>>();
    assert_eq!(paths, BTreeSet::from([
        "/definitions/F/body/body/statements/0/value/body",
        "/definitions/F/body/body/statements/1/value",
    ]));
}

#[test]
fn rejected_bodies_do_not_erase_an_independent_effect_summary_or_become_pure() {
    let analysis = analyze(json!({
        "Good": unit_function(json!([]), block(json!([]))),
        "Bad": unit_function(json!([]), call(boolean(true), json!([]))),
        "Depends": unit_function(json!([]), call(symbol("Bad"), json!([])))
    }));
    assert_empty_body_effects(summary(&analysis, "Good"));
    assert_eq!(summary(&analysis, "Bad").state, EffectState::Rejected);
    assert!(matches!(summary(&analysis, "Depends").state, EffectState::Unknown | EffectState::Rejected));
    assert!(analysis.problems.iter().any(|problem| problem.diagnostic.code == "NotCallableType"));
}

#[test]
fn phase_limits_fail_after_the_real_reader_and_body_analysis_have_succeeded() {
    let source = bytes(json!({
        "F": unit_function(json!([]), call(symbol("G"), json!([]))),
        "G": unit_function(json!([]), block(json!([])))
    }));
    reader::read(&source).unwrap();
    for limits in [
        EffectLimits {work: 0, bytes: usize::MAX},
        EffectLimits {work: usize::MAX, bytes: 0},
    ] {
        let prepared = signature_resolution::prepare_analysis(&source).unwrap();
        let view = prepared.body_view();
        assert_eq!(view.bodies.calls.len(), 1);
        assert!(view.signatures.iter().all(|signature| signature.body_type_checked));
        let error = prepared.close_effects(limits).unwrap_err();
        assert_eq!(error.code, "ResourceLimit");
    }
    let prepared = signature_resolution::prepare_analysis(&source).unwrap();
    let analysis = prepared.close_effects(EffectLimits::default()).unwrap();
    assert_empty_body_effects(summary(&analysis, "F"));
}

#[test]
fn one_factory_lambda_keeps_distinct_actual_capture_environments() {
    let wide = callback_type(json!([{"class": "io"}]));
    let mut pure = lambda(block(json!([])));
    pure["effects"] = json!([]);
    let invoke_factory = |argument: Value| {
        call(call(symbol("Make"), json!([argument])), json!([]))
    };
    let analysis = analyze(json!({
        "Make": {"kind": "core:function", "body": {
            "parameters": [parameter("k", wide.clone())], "returns": wide.clone(),
            "body": lambda(call(variable("k"), json!([])))
        }},
        "Quiet": constant(pure),
        "RunPure": unit_function(json!([]), invoke_factory(symbol("Quiet"))),
        "RunWide": unit_function(json!([parameter("k", wide)]), invoke_factory(variable("k")))
    }));
    let pure_effects = summary(&analysis, "RunPure");
    assert!(matches!(pure_effects.state, EffectState::BodyDerived | EffectState::ConservativeBound));
    assert!(pure_effects.may.is_empty());
    assert!(pure_effects.internal.is_empty());
    assert_eq!(summary(&analysis, "RunWide").state, EffectState::ConservativeBound);
    assert_eq!(classes(summary(&analysis, "RunWide")), BTreeSet::from(["io"]));

    let captured_k = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        occurrence.expanded_path == "/definitions/Make/body/parameters/0"
    }).unwrap().id;
    let mut pure_environments = BTreeSet::new();
    let mut wide_environments = BTreeSet::new();
    for closure in &analysis.effects.closures {
        if !matches!(&closure.code, CodeIdentity::Lambda(source)
            if analysis.types.source(*source).expanded_path == "/definitions/Make/body/body") {
            continue;
        }
        let value = closure.environment.iter().find(|(binding, _)| *binding == captured_k)
            .expect("The factory lambda retains its actual k value").1.0;
        if matches!(closure.latent.state, EffectState::BodyDerived | EffectState::ConservativeBound) {
            if closure.latent.may.is_empty() && closure.latent.internal.is_empty() {
                pure_environments.insert(value);
            }
            if classes(&closure.latent) == BTreeSet::from(["io"]) {
                wide_environments.insert(value);
            }
        }
    }
    assert!(!pure_environments.is_empty());
    assert!(!wide_environments.is_empty());
    assert!(pure_environments.is_disjoint(&wide_environments),
        "One captured value identity cannot stand for both actual callbacks");
}

fn callback_record(name: &str) -> Value {
    json!({"op": "record", "fields": [{"name": "callback", "value": symbol(name)}]})
}

fn call_record_field(record: Value) -> Value {
    call(json!({"op": "field", "record": record, "name": "callback"}), json!([]))
}

fn shared_definition(expression: Value) -> Value {
    json!({"kind": "req:composite", "body": {"parameters": {}, "terms": [{
        "require": {"definitionId": "UnresolvedRule"},
        "fields": {"value": {"expression": expression}}
    }]}})
}

#[test]
fn aggregate_updates_and_mutable_branch_flow_preserve_the_selected_callback() {
    let shared_record = json!({"tag": "record", "fields": [{"name": "callback",
        "value": {"tag": "reference", "ref": {"definitionId": "Stateful"}}}]});
    let updated = json!({"tag": "record-update", "receiver": shared_record.clone(),
        "fields": [{"name": "callback", "value": {
            "tag": "reference", "ref": {"definitionId": "Quiet"}
        }}]});
    let shared_call = |receiver: Value| json!({"tag": "call", "callee": {
        "tag": "field", "receiver": receiver, "name": "callback"
    }, "arguments": []});
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Stateful": constant(lambda(local_state(json!([])))),
        "Updated": shared_definition(shared_call(updated)),
        "Kept": shared_definition(shared_call(shared_record)),
        "Replaced": unit_function(json!([]), block(json!([
            {"op": "var", "name": "holder", "value": callback_record("Stateful")},
            {"op": "set", "name": "holder", "value": callback_record("Quiet")},
            {"op": "eval", "value": call_record_field(variable("holder"))}
        ]))),
        "Branched": unit_function(json!([parameter("condition", scalar("bool"))]), block(json!([
            {"op": "var", "name": "holder", "value": callback_record("Quiet")},
            {"op": "if", "condition": variable("condition"),
                "then": block(json!([{"op": "set", "name": "holder", "value": callback_record("Stateful")} ])),
                "else": block(json!([]))},
            {"op": "eval", "value": call_record_field(variable("holder"))}
        ])))
    }));
    let cell = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "cell" && occurrence.expanded_path.starts_with("/definitions/Stateful/")
    }).unwrap().id;
    assert!(!summary(&analysis, "Replaced").internal.iter().any(|access| access.binding == cell));
    let branched = declaration(&analysis, "Branched");
    let branched_root = analysis.bodies.declarations.get(&branched)
        .map(|declaration| &analysis.bodies.expressions[declaration.expression]);
    let branched_problems = analysis.bodies.problems.iter().filter(|problem| {
        analysis.types.source(problem.source).expanded_path.starts_with("/definitions/Branched")
    }).collect::<Vec<_>>();
    let branched_signature = analysis.signatures.iter().find(|signature| signature.declaration == branched);
    let branched_needs = analysis.needs.iter().filter(|need| {
        analysis.types.source(need.source).expanded_path.starts_with("/definitions/Branched")
    }).collect::<Vec<_>>();
    assert!(summary(&analysis, "Branched").internal.iter().any(|access| access.binding == cell && access.write),
        "effects={:?}; body root={branched_root:?}; body problems={branched_problems:?}; signature={branched_signature:?}; needs={branched_needs:?}",
        summary(&analysis, "Branched"));
    let holder = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "holder" && occurrence.expanded_path.starts_with("/definitions/Replaced/")
    }).unwrap().id;
    assert!(summary(&analysis, "Replaced").internal.iter().any(|access| access.binding == holder && access.write));
    assert!(summary(&analysis, "Replaced").internal.iter().any(|access| access.binding == holder && !access.write));
    for (name, retains_stateful) in [("Updated", false), ("Kept", true)] {
        let path = format!("/definitions/{name}/body/terms/0/fields/value/expression");
        let roots = analysis.effects.expressions.iter().filter(|((_, source), _)| {
            analysis.types.source(*source).expanded_path == path
        }).collect::<Vec<_>>();
        assert!(!roots.is_empty(), "Missing actual shared expression {path}");
        for (_, effect) in roots {
            assert_eq!(effect.internal.iter().any(|access| access.binding == cell && access.write), retains_stateful,
                "{name}: {effect:?}");
        }
    }
}

#[test]
fn callable_expectations_are_checked_at_arguments_returns_and_typed_initializers() {
    let io = json!([{"class": "io"}]);
    let wide_callback = callback_type(io.clone());
    let narrow = json!({"tag": "function", "params": [wide_callback.clone()],
        "returns": scalar("unit"), "effects": []});
    let analysis = analyze(json!({
        "Universal": bounded(unit_function(json!([parameter("k", wide_callback.clone())]),
            call(variable("k"), json!([]))), io),
        "Pure": bounded(unit_function(json!([parameter("k", wide_callback.clone())]), block(json!([]))), json!([])),
        "Accept": unit_function(json!([parameter("f", narrow.clone()), parameter("k", wide_callback.clone())]),
            call(variable("f"), json!([variable("k")]))),
        "BadArgument": unit_function(json!([parameter("k", wide_callback.clone())]),
            call(symbol("Accept"), json!([symbol("Universal"), variable("k")]))),
        "BadReturn": {"kind": "core:function", "body": {"parameters": [],
            "returns": narrow.clone(), "body": symbol("Universal")}},
        "BadLocal": unit_function(json!([]), block(json!([
            {"op": "let", "name": "callback", "type": narrow.clone(), "value": symbol("Universal")}
        ]))),
        "BadConstant": {"kind": "core:constant", "body": {"type": narrow.clone(), "value": symbol("Universal")}},
        "OnlyPure": bounded(unit_function(json!([parameter("c", callback_type(json!([])))]),
            call(variable("c"), json!([]))), json!([])),
        "Nested": {"kind": "core:constant", "body": {"type": narrow.clone(), "value": symbol("OnlyPure")}},
        "GoodArgument": unit_function(json!([parameter("k", wide_callback)]),
            call(symbol("Accept"), json!([symbol("Pure"), variable("k")]))),
        "GoodConstant": {"kind": "core:constant", "body": {"type": narrow, "value": symbol("Pure")}}
    }));
    for (name, path) in [
        ("BadArgument", "/definitions/BadArgument/body/body/arguments/0"),
        ("BadReturn", "/definitions/BadReturn/body/body"),
        ("BadLocal", "/definitions/BadLocal/body/body/statements/0/value"),
        ("BadConstant", "/definitions/BadConstant/body/value"),
    ] {
        assert_eq!(summary(&analysis, name).state, EffectState::Rejected, "{name}");
        assert!(analysis.effects.problems.iter().any(|problem| {
            problem.diagnostic.code == "EffectUpperBoundExceeded"
                && analysis.types.source(problem.source).expanded_path == path
        }), "No effect error at the actual expected-value occurrence {path}");
    }
    let good_argument = summary(&analysis, "GoodArgument");
    assert!(matches!(good_argument.state, EffectState::BodyDerived | EffectState::ConservativeBound));
    assert!(good_argument.may.is_empty());
    assert!(good_argument.internal.is_empty());
    assert!(!analysis.effects.problems.iter().any(|problem| {
        analysis.types.source(problem.source).expanded_path.starts_with("/definitions/GoodConstant/")
    }));
    assert!(analysis.effects.values.iter().any(|((_, source), closures)| {
        analysis.types.source(*source).expanded_path == "/definitions/GoodConstant/body/value"
            && closures.iter().any(|id| matches!(&analysis.effects.closures[id.0].code,
                CodeIdentity::Declaration(id) if *id == declaration(&analysis, "Pure")))
    }));
    // Both outer functions are pure. Their callback parameter contracts still
    // differ, so checking only the outer latent sets would falsely accept this.
    assert!(matches!(summary(&analysis, "Nested").state,
        EffectState::Unknown | EffectState::Rejected));
    let at_nested_relation = |source| {
        let path = analysis.types.source(source).expanded_path.as_str();
        path == "/definitions/Nested/body/value" || path.starts_with("/definitions/Nested/body/type/")
    };
    assert!(analysis.effects.problems.iter().any(|problem| at_nested_relation(problem.source))
        || analysis.effects.needs.iter().any(|need| at_nested_relation(need.source))
        || analysis.needs.iter().any(|need| at_nested_relation(need.source)),
        "The nested parameter relation must remain explicitly unqualified or rejected");
}

#[test]
fn source_effect_duplicates_differ_from_repeated_calls_and_reordered_bounds() {
    let members = json!([{"class": "io"}, {"class": "time"}]);
    let reversed = json!([{"class": "time"}, {"class": "io"}]);
    let twice = block(json!([
        {"op": "eval", "value": call(variable("k"), json!([]))},
        {"op": "eval", "value": call(variable("k"), json!([]))}
    ]));
    let source = bytes(json!({
        "Duplicate": bounded(unit_function(json!([]), block(json!([]))),
            json!([{"class": "io"}, {"class": "io"}])),
        "Ordered": bounded(unit_function(json!([parameter("k", callback_type(members.clone()))]), twice.clone()), members),
        "Reordered": bounded(unit_function(json!([parameter("k", callback_type(reversed.clone()))]), twice), reversed)
    }));
    reader::read(&source).expect("Complete Effect[] is structurally valid before semantic duplicate checking");
    let analysis = signature_resolution::resolve(&source).unwrap();
    assert_eq!(summary(&analysis, "Duplicate").state, EffectState::Rejected);
    assert!(analysis.effects.problems.iter().any(|problem| {
        problem.diagnostic.code == "DuplicateEffectAtom"
            && analysis.types.source(problem.source).expanded_path.starts_with("/definitions/Duplicate/")
    }));
    for name in ["Ordered", "Reordered"] {
        let effects = summary(&analysis, name);
        assert_eq!(effects.state, EffectState::ConservativeBound);
        assert_eq!(classes(effects), BTreeSet::from(["io", "time"]));
        assert_eq!(effects.may.len(), 2);
        let prefix = format!("/definitions/{name}/");
        let calls = analysis.bodies.calls.iter().filter(|call| {
            analysis.types.source(call.source).expanded_path.starts_with(&prefix)
        }).collect::<Vec<_>>();
        assert_eq!(calls.len(), 2);
        assert_ne!(calls[0].source, calls[1].source);
        assert!(!analysis.effects.problems.iter().any(|problem| {
            analysis.types.source(problem.source).expanded_path.starts_with(&prefix)
        }));
    }
}

#[test]
fn constructor_values_preserve_callbacks_through_variant_payload_matching() {
    let wide = callback_type(json!([{"class": "io"}]));
    let constructor = json!({"type": {"decl": {"definitionId": "Choice"}}, "name": "Wrap"});
    let wrapper = json!({"tag": "lambda", "params": [{
        "key": "callback", "name": "callback", "type": {"decl": {"definitionId": "Callback"}}
    }], "expression": {"tag": "match", "subject": {
        "tag": "call", "callee": {"tag": "reference", "ref": {"constructor": constructor.clone()}},
        "arguments": [{"value": {"tag": "reference", "ref": {"binding": "callback"}}}]
    }, "arms": [{"pattern": {"tag": "constructor", "constructor": constructor,
        "patterns": [{"tag": "bind", "binding": {"key": "payload", "name": "payload"}}]},
        "expression": {"tag": "call", "callee": {"tag": "reference", "ref": {"binding": "payload"}},
            "arguments": []}}]}});
    let invoke = |callback: Value| json!({"tag": "call", "callee": wrapper.clone(),
        "arguments": [{"value": callback}]});
    let mut quiet = lambda(block(json!([])));
    quiet["effects"] = json!([]);
    let analysis = analyze(json!({
        "Callback": {"kind": "core:type", "body": {"type": wide.clone()}},
        "Choice": {"kind": "core:type", "body": {"type": {"tag": "variant", "cases": {"Wrap": wide}}}},
        "Quiet": constant(quiet),
        "PurePayload": shared_definition(invoke(json!({"tag": "reference", "ref": {"definitionId": "Quiet"}}))),
        "WidePayload": shared_definition(json!({"tag": "lambda", "params": [{
            "key": "k", "name": "k", "type": {"decl": {"definitionId": "Callback"}}
        }], "expression": invoke(json!({"tag": "reference", "ref": {"binding": "k"}}))}))
    }));
    let root_path = "/definitions/PurePayload/body/terms/0/fields/value/expression";
    let roots = analysis.effects.expressions.iter().filter(|((_, source), _)| {
        analysis.types.source(*source).expanded_path == root_path
    }).collect::<Vec<_>>();
    assert!(!roots.is_empty());
    for (_, effect) in roots {
        assert!(matches!(effect.state, EffectState::BodyDerived | EffectState::ConservativeBound));
        assert!(effect.may.is_empty(), "{effect:?}");
        assert!(effect.internal.is_empty(), "{effect:?}");
    }
    let payload_call_path = format!("{root_path}/callee/expression/arms/0/expression/callee");
    assert!(analysis.effects.values.iter().any(|((_, source), values)| {
        analysis.types.source(*source).expanded_path == payload_call_path
            && values.iter().any(|id| matches!(&analysis.effects.closures[id.0].code,
                CodeIdentity::Lambda(source)
                    if analysis.types.source(*source).expanded_path == "/definitions/Quiet/body/value"))
    }), "The matched payload must still be the actual Quiet callback");
    let constructor_path = format!("{root_path}/callee/expression/subject/callee");
    assert!(analysis.effects.closures.iter().any(|closure| {
        matches!(&closure.code, CodeIdentity::Constructor(source)
            if analysis.types.source(*source).expanded_path == constructor_path)
            && closure.environment.is_empty()
    }));
    let wide_path = "/definitions/WidePayload/body/terms/0/fields/value/expression";
    assert!(analysis.effects.closures.iter().any(|closure| {
        matches!(&closure.code, CodeIdentity::Lambda(source)
            if analysis.types.source(*source).expanded_path == wide_path)
            && closure.latent.state == EffectState::ConservativeBound
            && classes(&closure.latent) == BTreeSet::from(["io"])
    }));
}

#[test]
fn literal_inactive_branches_and_loops_do_not_replace_the_following_callback() {
    let body = |control: Value| block(json!([
        {"op": "var", "name": "holder", "value": callback_record("Quiet")},
        {"op": "set", "name": "holder", "value": callback_record("Quiet")},
        control,
        {"op": "eval", "value": call_record_field(variable("holder"))}
    ]));
    let replace = block(json!([
        {"op": "set", "name": "holder", "value": callback_record("Stateful")}
    ]));
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Stateful": constant(lambda(local_state(json!([])))),
        "InactiveIf": unit_function(json!([]), body(json!({"op": "if", "condition": boolean(false),
            "then": replace.clone(), "else": block(json!([]))}))),
        "InactiveLoop": unit_function(json!([]), body(json!({"op": "while", "condition": boolean(false),
            "body": replace.clone()}))),
        "ActiveIf": unit_function(json!([]), body(json!({"op": "if", "condition": boolean(true),
            "then": replace, "else": block(json!([]))})))
    }));
    let cell = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "cell" && occurrence.expanded_path.starts_with("/definitions/Stateful/")
    }).unwrap().id;
    for name in ["InactiveIf", "InactiveLoop"] {
        let effects = summary(&analysis, name);
        assert!(!effects.internal.iter().any(|access| access.binding == cell), "{name}: {effects:?}");
        let prefix = format!("/definitions/{name}/");
        let holder = analysis.names.lexical.bindings.iter().find(|binding| {
            let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
            binding.name == "holder" && occurrence.expanded_path.starts_with(&prefix)
        }).unwrap().id;
        assert!(effects.internal.iter().any(|access| access.binding == holder && access.write));
        assert!(effects.internal.iter().any(|access| access.binding == holder && !access.write));
        assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
    }
    assert!(summary(&analysis, "ActiveIf").internal.iter().any(|access| access.binding == cell && access.write));
}

#[test]
fn an_immediate_closure_updates_the_captured_cell_in_its_original_allocation() {
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Stateful": constant(lambda(local_state(json!([])))),
        "F": unit_function(json!([]), block(json!([
            {"op": "var", "name": "holder", "value": callback_record("Quiet")},
            {"op": "eval", "value": call(lambda(block(json!([
                {"op": "set", "name": "holder", "value": callback_record("Stateful")}
            ]))), json!([]))},
            {"op": "eval", "value": call_record_field(variable("holder"))}
        ])))
    }));
    let holder = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        occurrence.expanded_path == "/definitions/F/body/body/statements/0"
    }).unwrap().id;
    let cell = analysis.names.lexical.bindings.iter().find(|binding| {
        let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
        binding.name == "cell" && occurrence.expanded_path.starts_with("/definitions/Stateful/")
    }).unwrap().id;
    let effects = summary(&analysis, "F");
    assert!(effects.internal.iter().any(|access| access.binding == cell && access.write), "{effects:?}");
    assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));

    let allocation_instances = analysis.effects.expressions.keys().filter_map(|(instance, source)| {
        (analysis.types.source(*source).expanded_path == "/definitions/F/body/body/statements/0")
            .then_some(instance.0)
    }).collect::<BTreeSet<_>>();
    assert_eq!(allocation_instances.len(), 1);
    let write_instances = effects.internal.iter().filter(|access| access.binding == holder && access.write)
        .map(|access| access.instance.0).collect::<BTreeSet<_>>();
    let read_instances = effects.internal.iter().filter(|access| access.binding == holder && !access.write)
        .map(|access| access.instance.0).collect::<BTreeSet<_>>();
    assert_eq!(write_instances, allocation_instances,
        "The closure writes the captured F allocation rather than allocating a lambda-local cell");
    assert_eq!(read_instances, allocation_instances,
        "The subsequent outer read observes that same captured allocation");
    assert!(analysis.effects.closures.iter().any(|closure| {
        matches!(&closure.code, CodeIdentity::Lambda(source)
            if analysis.types.source(*source).expanded_path == "/definitions/F/body/body/statements/1/value/callee")
            && closure.environment.iter().any(|(binding, _)| *binding == holder)
    }));
}

#[test]
fn captured_reads_observe_executed_writes_but_closure_creation_does_not_apply_them() {
    let wide = callback_type(json!([{"class": "io"}]));
    let body = |execute_write: bool| {
        let mut statements = vec![
            json!({"op": "var", "name": "k", "value": symbol("Quiet")}),
            json!({"op": "let", "name": "read", "value": lambda(call(variable("k"), json!([])))}),
            json!({"op": "let", "name": "write", "value": lambda(block(json!([
                {"op": "set", "name": "k", "value": variable("wide")}
            ])))}),
        ];
        if execute_write {
            statements.push(json!({"op": "eval", "value": call(variable("write"), json!([]))}));
        }
        statements.push(json!({"op": "eval", "value": call(variable("read"), json!([]))}));
        block(json!(statements))
    };
    let mut inactive_body = body(false);
    inactive_body["statements"].as_array_mut().unwrap().insert(3, json!({
        "op": "if", "condition": boolean(false),
        "then": block(json!([{"op": "eval", "value": call(variable("write"), json!([]))}])),
        "else": block(json!([]))
    }));
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Mutate": unit_function(json!([parameter("wide", wide.clone())]), body(true)),
        "NoMutation": unit_function(json!([parameter("wide", wide.clone())]), body(false)),
        "InactiveMutation": unit_function(json!([parameter("wide", wide)]), inactive_body)
    }));
    assert!(classes(summary(&analysis, "Mutate")).contains("io"),
        "Calling write changes the callback subsequently observed by the earlier read closure");
    for name in ["NoMutation", "InactiveMutation"] {
        assert!(summary(&analysis, name).may.is_empty(),
            "Creating or statically checking an inactive write must not replace Quiet: {name}");
        let callee_path = format!("/definitions/{name}/body/body/statements/1/value/body/callee");
        assert!(analysis.effects.values.iter().any(|((_, source), values)| {
            analysis.types.source(*source).expanded_path == callee_path
                && values.iter().any(|id| matches!(&analysis.effects.closures[id.0].code,
                    CodeIdentity::Lambda(source)
                        if analysis.types.source(*source).expanded_path == "/definitions/Quiet/body/value"))
        }), "The read closure still calls actual Quiet after an inactive write: {name}");
    }
    for name in ["Mutate", "NoMutation", "InactiveMutation"] {
        let prefix = format!("/definitions/{name}/body/body");
        let declaration_path = format!("{prefix}/statements/0");
        let k = analysis.names.lexical.bindings.iter().find(|binding| {
            let occurrence = &analysis.names.lexical.occurrences[binding.occurrence.index()];
            occurrence.expanded_path == declaration_path
        }).unwrap().id;
        let allocation_instances = analysis.effects.expressions.keys().filter_map(|(instance, source)| {
            (analysis.types.source(*source).expanded_path == declaration_path).then_some(instance.0)
        }).collect::<BTreeSet<_>>();
        assert_eq!(allocation_instances.len(), 1);
        let effects = summary(&analysis, name);
        let read_instances = effects.internal.iter().filter(|access| access.binding == k && !access.write)
            .map(|access| access.instance.0).collect::<BTreeSet<_>>();
        assert_eq!(read_instances, allocation_instances);
        if name == "Mutate" {
            let write_instances = effects.internal.iter().filter(|access| access.binding == k && access.write)
                .map(|access| access.instance.0).collect::<BTreeSet<_>>();
            assert_eq!(write_instances, allocation_instances,
                "The write closure mutates the original captured allocation");
        }
        assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
        for statement in [1, 2] {
            let lambda_path = format!("{prefix}/statements/{statement}/value");
            assert!(analysis.effects.closures.iter().any(|closure| {
                matches!(&closure.code, CodeIdentity::Lambda(source)
                    if analysis.types.source(*source).expanded_path == lambda_path)
                    && closure.environment.iter().any(|(binding, _)| *binding == k)
            }), "The actual closure at {lambda_path} must retain the outer k binding");
        }
    }
}

#[test]
fn review_repair_list_projections_follow_empty_prefixes_and_consumed_prefix_tails() {
    let reference = |name: &str| json!({"tag": "reference", "ref": {"binding": name}});
    let quiet_call = json!({"tag": "call", "callee": {
        "tag": "reference", "ref": {"definitionId": "Quiet"}
    }, "arguments": []});
    let call_head = |subject: Value| json!({"tag": "match", "subject": subject, "arms": [
        {"pattern": {"tag": "empty-list"}, "expression": quiet_call.clone()},
        {"pattern": {"tag": "cons", "head": {"key": "head", "name": "head"},
            "tail": {"key": "rest", "name": "rest"}},
            "expression": {"tag": "call", "callee": reference("head"), "arguments": []}}
    ]});
    let tail = json!({"tag": "list", "items": [], "tail": {
        "tag": "list", "items": [reference("k")]
    }});
    let after_prefix = json!({"tag": "match", "subject": {
        "tag": "list", "items": [{"tag": "reference", "ref": {"definitionId": "Quiet"}}],
        "tail": tail.clone()
    }, "arms": [
        {"pattern": {"tag": "empty-list"}, "expression": quiet_call},
        {"pattern": {"tag": "cons", "head": {"key": "first", "name": "first"},
            "tail": {"key": "remaining", "name": "remaining"}},
            "expression": call_head(reference("remaining"))}
    ]});
    let wrap = |expression: Value| shared_definition(json!({"tag": "lambda", "params": [{
        "key": "k", "name": "k", "type": {"decl": {"definitionId": "Callback"}}
    }], "expression": expression}));
    let analysis = analyze(json!({
        "Callback": {"kind": "core:type", "body": {"type": callback_type(json!([{"class": "io"}]))}},
        "Quiet": constant(lambda(block(json!([])))),
        "EmptyPrefix": wrap(call_head(tail)),
        "ConsumedPrefix": wrap(after_prefix),
        "TypedTail": shared_definition(json!({"tag": "lambda", "params": [{
            "key": "xs", "name": "xs", "type": {"core": "List", "arguments": [{"decl": {"definitionId": "Callback"}}]}
        }], "expression": {"tag": "match", "subject": reference("xs"), "arms": [
            {"pattern": {"tag": "empty-list"}, "expression": quiet_call.clone()},
            {"pattern": {"tag": "cons", "head": {"key": "first", "name": "first"},
                "tail": {"key": "remaining", "name": "remaining"}},
                "expression": call_head(reference("remaining"))}
        ]}}))
    }));
    for name in ["EmptyPrefix", "ConsumedPrefix", "TypedTail"] {
        let path = format!("/definitions/{name}/body/terms/0/fields/value/expression");
        let closures = analysis.effects.closures.iter().filter(|closure| {
            matches!(&closure.code, CodeIdentity::Lambda(source)
                if analysis.types.source(*source).expanded_path == path)
        }).collect::<Vec<_>>();
        assert!(!closures.is_empty(), "Missing actual lambda at {path}");
        for closure in closures {
            assert_eq!(closure.latent.state, EffectState::ConservativeBound, "{name}: {:?}", closure.latent);
            assert_eq!(classes(&closure.latent), BTreeSet::from(["io"]));
            assert!(!closure.latent.needs.iter().any(|need| need.code == "NeedsFunctionValueOrigin"));
        }
    }
}

#[test]
fn review_repair_a_later_write_cannot_change_an_earlier_captured_call() {
    let wide = callback_type(json!([{"class": "io"}]));
    let body = |write_first: bool| {
        let mut statements = vec![
            json!({"op": "var", "name": "k", "type": wide.clone(), "value": symbol("Quiet")}),
            json!({"op": "let", "name": "read", "value": lambda(call(variable("k"), json!([])))}),
        ];
        let write = json!({"op": "set", "name": "k", "value": variable("wide")});
        let read = json!({"op": "eval", "value": call(variable("read"), json!([]))});
        if write_first { statements.extend([write, read]); }
        else { statements.extend([read, write]); }
        block(json!(statements))
    };
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "ReadBeforeWrite": bounded(unit_function(json!([parameter("wide", wide.clone())]), body(false)), json!([])),
        "WriteBeforeRead": bounded(unit_function(json!([parameter("wide", wide.clone())]), body(true)), json!([]))
    }));
    let before = summary(&analysis, "ReadBeforeWrite");
    assert!(before.may.is_empty(), "A later assignment cannot invoke that callback retroactively: {before:?}");
    assert_ne!(before.state, EffectState::Rejected);
    assert!(before.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
    assert!(!analysis.effects.problems.iter().any(|problem| {
        problem.diagnostic.code == "EffectUpperBoundExceeded"
            && analysis.types.source(problem.source).expanded_path.starts_with("/definitions/ReadBeforeWrite/")
    }));
    let after = summary(&analysis, "WriteBeforeRead");
    assert_eq!(after.state, EffectState::Rejected);
    assert!(classes(after).contains("io"));
}

#[test]
fn review_repair_unknown_calls_only_invalidate_reachable_captured_positions() {
    let wide = callback_type(json!([{"class": "io"}]));
    let run_type = json!({"tag": "function", "params": [callback_type(json!([]))],
        "returns": scalar("unit"), "effects": []});
    let parameters = json!([parameter("run", run_type), parameter("wide", wide.clone())]);
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "Escapes": unit_function(parameters.clone(), block(json!([
            {"op": "var", "name": "k", "type": wide.clone(), "value": symbol("Quiet")},
            {"op": "let", "name": "write", "value": lambda(block(json!([
                {"op": "set", "name": "k", "value": variable("wide")}
            ])))},
            {"op": "eval", "value": call(variable("run"), json!([variable("write")]))},
            {"op": "eval", "value": call(variable("k"), json!([]))}
        ]))),
        "Unrelated": unit_function(parameters, block(json!([
            {"op": "var", "name": "k", "type": wide, "value": symbol("Quiet")},
            {"op": "eval", "value": call(variable("run"), json!([symbol("Quiet")]))},
            {"op": "eval", "value": call(variable("k"), json!([]))}
        ])))
    }));
    let escapes = summary(&analysis, "Escapes");
    assert_eq!(escapes.state, EffectState::Unknown, "{escapes:?}");
    assert!(escapes.needs.iter().any(|need| need.code == "NeedsCapturedPositionCallContract"),
        "A closed effect row does not prove how the unknown callee uses the captured writer: {escapes:?}");
    let unrelated = summary(&analysis, "Unrelated");
    assert!(unrelated.may.is_empty(), "{unrelated:?}");
    assert!(!unrelated.needs.iter().any(|need| need.code == "NeedsCapturedPositionCallContract"));
    assert!(analysis.effects.values.iter().any(|((_, source), values)| {
        analysis.types.source(*source).expanded_path == "/definitions/Unrelated/body/body/statements/2/value/callee"
            && values.iter().any(|id| matches!(&analysis.effects.closures[id.0].code,
                CodeIdentity::Lambda(source)
                    if analysis.types.source(*source).expanded_path == "/definitions/Quiet/body/value"))
    }), "Passing an unrelated closure does not expose the fresh local k position");
}

#[test]
fn review_repair_loop_false_exit_requires_a_normal_possibly_false_condition() {
    let wide = callback_type(json!([{"class": "io"}]));
    let parameters = json!([parameter("wide", wide.clone()), parameter("flag", scalar("bool"))]);
    let body = |condition: Value| block(json!([
        {"op": "var", "name": "k", "type": wide.clone(), "value": variable("wide")},
        {"op": "while", "condition": condition, "body": block(json!([
            {"op": "set", "name": "k", "value": symbol("Quiet")}, {"op": "break"}
        ]))},
        {"op": "eval", "value": call(variable("k"), json!([]))}
    ]));
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "TrueBreak": bounded(unit_function(parameters.clone(), body(boolean(true))), json!([])),
        "UnknownCondition": bounded(unit_function(parameters, body(variable("flag"))), json!([]))
    }));
    let effects = summary(&analysis, "TrueBreak");
    assert!(effects.may.is_empty(), "Only the actual break state can leave the true loop: {effects:?}");
    assert_ne!(effects.state, EffectState::Rejected, "{effects:?}");
    assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
    let unknown = summary(&analysis, "UnknownCondition");
    assert_eq!(unknown.state, EffectState::Rejected, "{unknown:?}");
    assert!(classes(unknown).contains("io"), "An unknown condition can skip the body");
}

#[test]
fn review_repair_continue_states_reenter_the_loop_instead_of_leaving_it() {
    let wide = callback_type(json!([{"class": "io"}]));
    let analysis = analyze(json!({
        "Quiet": constant(lambda(block(json!([])))),
        "ContinueOrBreak": bounded(unit_function(json!([
            parameter("wide", wide.clone()), parameter("flag", scalar("bool"))
        ]), block(json!([
            {"op": "var", "name": "k", "type": wide, "value": variable("wide")},
            {"op": "while", "condition": boolean(true), "body": block(json!([
                {"op": "if", "condition": variable("flag"),
                    "then": block(json!([
                        {"op": "set", "name": "k", "value": variable("wide")}, {"op": "continue"}
                    ])),
                    "else": block(json!([
                        {"op": "set", "name": "k", "value": symbol("Quiet")}, {"op": "break"}
                    ]))}
            ]))},
            {"op": "eval", "value": call(variable("k"), json!([]))}
        ]))), json!([]))
    }));
    let effects = summary(&analysis, "ContinueOrBreak");
    assert!(effects.may.is_empty(), "The only normal exit has replaced k with Quiet: {effects:?}");
    assert_ne!(effects.state, EffectState::Rejected);
    assert!(effects.needs.iter().any(|need| need.code == "NeedsLocalStateProjection"));
}

#[test]
fn review_repair_loops_without_normal_exits_do_not_activate_following_calls() {
    for exit in ["continue", "return"] {
        let analysis = analyze(json!({
            "F": bounded(unit_function(json!([parameter("wide", callback_type(json!([{"class": "io"}])))]),
                block(json!([
                    {"op": "while", "condition": boolean(true), "body": block(json!([{"op": exit}]))},
                    {"op": "eval", "value": call(variable("wide"), json!([]))}
                ]))), json!([]))
        }));
        assert_empty_body_effects(summary(&analysis, "F"));
        assert!(analysis.bodies.calls.iter().any(|call| analysis.types.source(call.source).expanded_path
            == "/definitions/F/body/body/statements/1/value"), "The unreachable source call is still checked");
    }
}
