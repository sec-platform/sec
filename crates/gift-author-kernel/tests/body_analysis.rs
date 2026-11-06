use gift_author_kernel::{reader,signature_resolution::{self,SignatureResolution,SignatureState},
    body_analysis::{NormalResult,BodyState,ExitKind,Coverage,EffectTerm},semantic_types::*};
use serde_json::{json,Value};

fn scalar(name:&str)->Value {json!({"tag":"scalar","name":name})}
fn literal(name:&str,value:Value)->Value {json!({"op":"literal","type":scalar(name),"value":value})}
fn integer(value:&str)->Value {literal("int",json!(value))}
fn boolean(value:bool)->Value {literal("bool",json!(value))}
fn variable(name:&str)->Value {json!({"op":"var","name":name})}
fn block(statements:Value,result:Option<Value>)->Value {
    let mut block=json!({"op":"exec:block","statements":statements});
    if let Some(result)=result {block["result"]=result;}block
}
fn function(parameters:Value,returns:Option<Value>,body:Value)->Value {
    let mut definition=json!({"kind":"core:function","body":{"parameters":parameters,"body":body}});
    if let Some(returns)=returns {definition["body"]["returns"]=returns;}definition
}
fn definition(ty:Value)->Value {json!({"kind":"core:type","body":{"type":ty}})}
fn constant(value:Value)->Value {json!({"kind":"core:constant","body":{"value":value}})}
fn parameter(name:&str,ty:Value)->Value {json!({"name":name,"type":ty})}
fn module(definitions:Value)->Vec<u8> {serde_json::to_vec(&json!({"schema":"gift.author-module/design-converged","moduleId":"body:test","definitions":definitions})).unwrap()}
fn analyze(definitions:Value)->SignatureResolution {
    let bytes=module(definitions);reader::read(&bytes).expect("The independent grammar accepts this source");
    signature_resolution::resolve(&bytes).unwrap()
}
fn shared(expression:Value)->Value {json!({"kind":"req:composite","body":{"parameters":{},"typeParams":[],
    "terms":[{"require":{"definitionId":"Rule"},"fields":{"value":{"expression":expression}}}]}})}
fn shared_literal(ty:&str,value:Value)->Value {json!({"tag":"literal","type":ty,"value":value})}
fn signature<'a>(analysis:&'a SignatureResolution,name:&str)->&'a signature_resolution::Signature {
    let declaration=analysis.names.declarations.iter().find(|decl|decl.name==name).unwrap().id;
    analysis.signatures.iter().find(|signature|signature.declaration==declaration).unwrap()
}
fn is_result(analysis:&SignatureResolution,name:&str,expected:&str)->bool {
    let ty=analysis.types.resolved(signature(analysis,name).ty.unwrap());
    let ty=match analysis.types.get(ty){SemanticType::Function(function)=>analysis.types.resolved(function.returns),_=>ty};
    matches!(analysis.types.get(ty),SemanticType::Scalar(scalar) if scalar.name==expected)
}

#[test]
fn all_return_bodies_infer_without_a_fictitious_normal_unit_and_check_unreachable_code() {
    let returns=block(json!([{"op":"if","condition":variable("condition"),
        "then":block(json!([{"op":"return","value":integer("1")}]),None),
        "else":block(json!([{"op":"return","value":integer("2")}]),None)}]),None);
    let analysis=analyze(json!({"F":function(json!([parameter("condition",scalar("bool"))]),None,returns),
        "Bad":function(json!([]),Some(scalar("int")),block(json!([
            {"op":"return","value":integer("1")},
            {"op":"eval","value":{"op":"call","callee":boolean(true),"arguments":[]}}
        ]),None))}));
    assert!(is_result(&analysis,"F","int"));
    assert_eq!(signature(&analysis,"F").state,SignatureState::TypeReady);
    let declaration=signature(&analysis,"F").declaration;
    let summary=&analysis.bodies.expressions[analysis.bodies.declarations[&declaration].expression];
    assert_eq!(summary.normal,NormalResult::NoNormal);
    assert!(summary.exits.iter().all(|exit|exit.kind==ExitKind::Return&&exit.target.is_some()));
    assert_eq!(signature(&analysis,"Bad").state,SignatureState::Rejected);
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="NotCallableType"));
}

#[test]
fn loop_try_exits_keep_lexical_targets_and_lambda_cannot_capture_a_loop() {
    let analysis=analyze(json!({"F":function(json!([]),Some(scalar("int")),block(json!([
        {"op":"while","condition":boolean(true),"body":block(json!([
            {"op":"eval","value":{"op":"try","errorName":"error",
                "body":block(json!([{"op":"return","value":integer("7")}]),None),
                "onError":block(json!([{"op":"break"}]),None)}}
        ]),None)}]),Some(integer("0")))),
        "Bad":function(json!([]),Some(scalar("unit")),block(json!([
            {"op":"while","condition":boolean(true),"body":block(json!([
                {"op":"eval","value":{"op":"lambda","params":[],"body":block(json!([{"op":"break"}]),None)}}
            ]),None)}]),None))}));
    let f=signature(&analysis,"F").declaration;
    let summary=&analysis.bodies.expressions[analysis.bodies.declarations[&f].expression];
    let returns=summary.exits.iter().filter(|exit|exit.kind==ExitKind::Return).collect::<Vec<_>>();
    assert!(!returns.is_empty());
    for exit in returns {assert_eq!(analysis.names.lexical.scopes[exit.target.unwrap().index()].kind,"function");}
    for expression in &analysis.bodies.expressions {
        for exit in &expression.exits {
            if exit.kind==ExitKind::Break&&analysis.types.source(exit.source).expanded_path.starts_with("/definitions/F/") {
                assert_eq!(analysis.names.lexical.scopes[exit.target.unwrap().index()].kind,"loop");
            }
        }
    }
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsManagedErrorProfile"));
    assert_eq!(signature(&analysis,"Bad").state,SignatureState::Rejected);
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="InvalidControlTarget"));
}

#[test]
fn mutable_bindings_use_old_initializer_environment_and_one_fixed_type() {
    let body=block(json!([{"op":"var","name":"x","value":variable("x")},
        {"op":"set","name":"x","value":integer("2")}]),Some(variable("x")));
    let analysis=analyze(json!({"F":function(json!([parameter("x",scalar("int"))]),None,body),
        "Bad":function(json!([]),None,block(json!([{"op":"var","name":"x","value":integer("1")},
            {"op":"set","name":"x","value":boolean(false)}]),Some(variable("x"))))}));
    assert!(is_result(&analysis,"F","int"));
    let uses=&analysis.names.lexical.uses;
    let initializer=uses.iter().find(|usage|analysis.names.lexical.occurrences[usage.occurrence.index()].expanded_path=="/definitions/F/body/body/statements/0/value").unwrap();
    let result=uses.iter().find(|usage|analysis.names.lexical.occurrences[usage.occurrence.index()].expanded_path=="/definitions/F/body/body/result").unwrap();
    let gift_author_kernel::lexical::LocalResolution::Resolved {binding:outer}=initializer.resolution else{panic!()};
    let gift_author_kernel::lexical::LocalResolution::Resolved {binding:inner}=result.resolution else{panic!()};
    assert_ne!(outer,inner);
    assert!(analysis.bodies.effects.iter().any(|effect|matches!(effect.term,EffectTerm::Write(binding) if binding==inner)));
    assert!(analysis.bodies.effects.iter().any(|effect|matches!(effect.term,EffectTerm::Read(binding) if binding==inner)));
    assert_eq!(signature(&analysis,"Bad").state,SignatureState::Rejected);
}

#[test]
fn missing_error_profile_is_real_pending_and_does_not_hide_payload_errors() {
    let analysis=analyze(json!({"Throw":function(json!([]),Some(scalar("bool")),json!({"op":"throw","error":integer("1")})),
        "Try":function(json!([]),Some(scalar("bool")),json!({"op":"try","body":boolean(true),"errorName":"e","onError":boolean(false)})),
        "Bad":function(json!([]),Some(scalar("bool")),json!({"op":"throw","error":{"op":"call","callee":integer("1"),"arguments":[]}}))}));
    let declaration=signature(&analysis,"Throw").declaration;
    let summary=&analysis.bodies.expressions[analysis.bodies.declarations[&declaration].expression];
    assert_eq!(summary.normal,NormalResult::Pending);
    assert_eq!(summary.state,BodyState::Pending);
    assert!(!signature(&analysis,"Throw").body_type_checked);
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsManagedErrorProfile"));
    assert!(analysis.bodies.effects.iter().any(|effect|matches!(effect.term,EffectTerm::Unqualified {code:"NeedsManagedErrorProfile",..})));
    assert!(analysis.bodies.effects.iter().any(|effect|matches!(effect.term,EffectTerm::Try {..})));
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="NotCallableType"));
    assert_eq!(signature(&analysis,"Bad").state,SignatureState::Rejected);
}

#[test]
fn shared_named_calls_keep_source_order_and_exact_formal_slots() {
    let callee=json!({"tag":"reference","ref":{"definitionId":"F"}});
    let arguments=json!([{"label":"right","value":shared_literal("Int",json!("2"))},
        {"label":"left","value":shared_literal("Int",json!("1"))}]);
    let analysis=analyze(json!({"F":function(json!([parameter("left",scalar("int")),parameter("right",scalar("int"))]),Some(scalar("int")),variable("left")),
        "Design":shared(json!({"tag":"call","callee":callee,"arguments":arguments}))}));
    let call=analysis.bodies.calls.iter().find(|call|analysis.types.source(call.source).expanded_path.starts_with("/definitions/Design/")).unwrap();
    assert_eq!(call.source_to_formal,vec![1,0]);
    assert_eq!(call.callee,Some(signature(&analysis,"F").declaration));
    assert!(!analysis.bodies.regions.is_empty());
    for (arguments,code) in [
        (json!([{"label":"left","value":shared_literal("Int",json!("1"))},{"label":"left","value":shared_literal("Int",json!("2"))}]),"DuplicateNamedArgument"),
        (json!([{"label":"left","value":shared_literal("Int",json!("1"))}]),"CallArity"),
        (json!([{"label":"other","value":shared_literal("Int",json!("1"))},{"label":"right","value":shared_literal("Int",json!("2"))}]),"UnknownNamedArgument"),
        (json!([{"label":"right","value":shared_literal("Int",json!("2"))},{"value":shared_literal("Int",json!("1"))}]),"PositionalAfterNamedArgument"),
    ] {
        let analysis=analyze(json!({"F":function(json!([parameter("left",scalar("int")),parameter("right",scalar("int"))]),Some(scalar("int")),variable("left")),
            "Design":shared(json!({"tag":"call","callee":callee,"arguments":arguments}))}));
        assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code==code),"{code} {:?}",analysis.bodies.problems);
    }
    let value_call=json!({"tag":"call","callee":{"tag":"lambda","params":[{"key":"x","name":"x","type":{"core":"Int"}}],
        "expression":{"tag":"reference","ref":{"binding":"x"}}},"arguments":[{"label":"x","value":shared_literal("Int",json!("1"))}]});
    let analysis=analyze(json!({"Design":shared(value_call)}));
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="NamedArgumentsRequireDeclaration"));
}

fn choice()->Value {definition(json!({"tag":"variant","cases":{"A":scalar("bool"),"B":scalar("bool")}}))}
fn constructor_pattern(name:&str,payload:Value)->Value {json!({"tag":"constructor","constructor":{
    "type":{"decl":{"definitionId":"Choice"}},"name":name},"patterns":[payload]})}
fn pattern_expression(arms:Value,ty:Value)->Value {json!({"tag":"lambda","params":[{"key":"choice-value","name":"x","type":ty}],
    "expression":{"tag":"match","subject":{"tag":"reference","ref":{"binding":"choice-value"}},"arms":arms}})}

#[test]
fn recursive_pattern_matrix_distinguishes_nested_gaps_complete_coverage_and_unknown() {
    let arm=|pattern:Value|json!({"pattern":pattern,"expression":shared_literal("Int",json!("1"))});
    let a_true=arm(constructor_pattern("A",shared_literal("Bool",json!(true))));
    let a_false=arm(constructor_pattern("A",shared_literal("Bool",json!(false))));
    let b=arm(constructor_pattern("B",json!({"tag":"wildcard"})));
    let ty=json!({"decl":{"definitionId":"Choice"}});
    for (arms,complete) in [(json!([a_true,b]),false),(json!([a_true,a_false,b]),true)] {
        let analysis=analyze(json!({"Choice":choice(),"Design":shared(pattern_expression(arms,ty.clone()))}));
        assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
        let coverage=&analysis.bodies.coverage[0].result;
        if complete {assert_eq!(*coverage,Coverage::Exhaustive);}
        else {assert!(matches!(coverage,Coverage::Missing(patterns) if patterns.iter().any(|pattern|pattern=="A(false)")),"{coverage:?}");}
    }
    let analysis=analyze(json!({"Choice":choice(),"Design":shared(pattern_expression(json!([a_true,a_false,b,a_true]),ty))}));
    assert_eq!(analysis.bodies.coverage[0].redundant_arms,vec![3]);
    let bad=json!({"pattern":{"tag":"wildcard"},"expression":{"tag":"call","callee":shared_literal("Bool",json!(true)),"arguments":[]}});
    let analysis=analyze(json!({"Choice":choice(),"Design":shared(pattern_expression(json!([a_true,a_false,b,bad]),json!({"decl":{"definitionId":"Choice"}})))}));
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="NotCallableType"));
    let analysis=analyze(json!({"Choice":choice(),"Design":shared(pattern_expression(json!([a_true]),json!({"hole":{"expected":"type"}})))}));
    assert_eq!(analysis.bodies.coverage[0].result,Coverage::Unknown);
}

#[test]
fn list_patterns_use_the_same_recursive_constructor_algorithm() {
    let expression=pattern_expression(json!([
        {"pattern":{"tag":"empty-list"},"expression":shared_literal("Int",json!("0"))},
        {"pattern":{"tag":"cons","head":{"key":"head","name":"head"},"tail":{"key":"tail","name":"tail"}},
            "expression":shared_literal("Int",json!("1"))}
    ]),json!({"core":"List","arguments":[{"core":"Bool"}]}));
    let analysis=analyze(json!({"Design":shared(expression)}));
    assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
    assert_eq!(analysis.bodies.coverage[0].result,Coverage::Exhaustive);
}

#[test]
fn ordinary_and_nominal_records_share_field_and_update_constraints() {
    let region=json!({"tag":"region","bindings":[{"binding":{"key":"record","name":"record"},"initializer":{
        "tag":"record","fields":[{"name":"n","value":shared_literal("Int",json!("1"))}]}}],
        "expression":{"tag":"field","name":"n","receiver":{"tag":"record-update",
            "receiver":{"tag":"reference","ref":{"binding":"record"}},
            "fields":[{"name":"n","value":shared_literal("Int",json!("2"))}]}}});
    let analysis=analyze(json!({"R":definition(json!({"tag":"record","fields":{"n":{"type":scalar("int")}}})),
        "F":function(json!([parameter("r",json!({"tag":"nominal","ref":"local:R"}))]),None,json!({"op":"field","record":variable("r"),"name":"n"})),
        "Make":function(json!([]),Some(json!({"tag":"nominal","ref":"local:R"})),json!({"op":"record","fields":[{"name":"n","value":integer("3")}]})),
        "Design":shared(region)}));
    assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
    assert!(is_result(&analysis,"F","int"));
    assert!(signature(&analysis,"Make").body_type_checked);
    let root=*analysis.bodies.regions.last().unwrap();
    let NormalResult::Value(ty)=analysis.bodies.expressions[root].normal else{panic!("{:?}",analysis.bodies.expressions[root])};
    assert!(matches!(analysis.types.get(analysis.types.resolved(ty)),SemanticType::Scalar(scalar) if scalar.name=="int"));
}

fn contains_call(analysis:&SignatureResolution,effect:gift_author_kernel::body_analysis::EffectId)->bool {
    match &analysis.bodies.effects[effect.0].term {
        EffectTerm::Call(_)=>true,EffectTerm::Sequence(children)|EffectTerm::Unqualified {children,..}=>children.iter().any(|child|contains_call(analysis,*child)),
        EffectTerm::Conditional {condition,branches}=>contains_call(analysis,*condition)||branches.iter().any(|child|contains_call(analysis,*child)),
        EffectTerm::Try {body,handler,..}=>contains_call(analysis,*body)||contains_call(analysis,*handler),
        EffectTerm::Loop {condition,body,..}=>contains_call(analysis,*condition)||contains_call(analysis,*body),_=>false,
    }
}

#[test]
fn lambda_creation_and_short_circuit_keep_distinct_effect_occurrences() {
    let expression=json!({"tag":"region","bindings":[{"binding":{"key":"callback","name":"callback"},"initializer":{
        "tag":"lambda","params":[],"expression":{"tag":"call","callee":{"tag":"reference","ref":{"definitionId":"G"}},"arguments":[]}}}],
        "expression":{"tag":"binary","operator":"&&","left":shared_literal("Bool",json!(false)),
            "right":{"tag":"call","callee":{"tag":"reference","ref":{"definitionId":"G"}},"arguments":[]}}});
    let analysis=analyze(json!({"G":function(json!([]),Some(scalar("bool")),boolean(true)),"Design":shared(expression)}));
    assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
    let lambda=analysis.bodies.expressions.iter().find(|summary|summary.latent.is_some()).unwrap();
    assert!(!contains_call(&analysis,lambda.immediate));
    assert!(contains_call(&analysis,lambda.latent.unwrap()));
    assert!(analysis.bodies.effects.iter().any(|effect|matches!(&effect.term,EffectTerm::Conditional {branches,..} if branches.iter().any(|branch|contains_call(&analysis,*branch)))));
    assert_eq!(analysis.bodies.calls.len(),2);
}

#[test]
fn declaration_summaries_reuse_successes_and_never_retain_rolled_back_type_ids() {
    let analysis=analyze(json!({"A":function(json!([]),None,json!({"op":"do","steps":[{"op":"record","fields":[{"name":"n","value":integer("1")}]}],
        "result":{"op":"call","callee":{"op":"symbol","ref":"local:B"},"arguments":[]}})),
        "B":function(json!([]),None,integer("2"))}));
    assert!(is_result(&analysis,"A","int"));
    assert_eq!(analysis.bodies.declarations.len(),2);
    for summary in &analysis.bodies.expressions {
        if let NormalResult::Value(ty)=summary.normal {assert!(ty.index()<analysis.types.nodes.len());}
        if let Some(expected)=summary.expected {assert!(expected.index()<analysis.types.nodes.len());}
        for exit in &summary.exits {if let Some(value)=exit.value {assert!(value.index()<analysis.types.nodes.len());}}
    }
    for call in &analysis.bodies.calls {assert!(call.function_type.index()<analysis.types.nodes.len());}
    for binding in &analysis.bodies.bindings {assert!(binding.ty.index()<analysis.types.nodes.len());}
    let b=signature(&analysis,"B").declaration;
    let source=analysis.bodies.expressions[analysis.bodies.declarations[&b].expression].source;
    assert_eq!(analysis.bodies.expressions.iter().filter(|summary|summary.source==source).count(),1);
    let good=analyze(json!({"K":{"kind":"core:constant","body":{"type":scalar("bool"),"value":boolean(true)}}}));
    let bad=analyze(json!({"K":{"kind":"core:constant","body":{"type":scalar("int"),"value":boolean(true)}}}));
    assert_eq!(signature(&good,"K").state,SignatureState::TypeReady);
    assert_eq!(signature(&bad,"K").state,SignatureState::Rejected);
}

#[test]
fn ordinary_variant_sequence_and_specialized_children_all_use_the_common_judgment() {
    let analysis=analyze(json!({"Choice":choice(),
        "Construct":function(json!([]),Some(json!({"tag":"nominal","ref":"local:Choice"})),
            json!({"op":"variant","constructor":"A","payload":boolean(true)})),
        "Match":function(json!([parameter("x",json!({"tag":"nominal","ref":"local:Choice"}))]),None,
            json!({"op":"match","value":variable("x"),"cases":[{"constructor":"A","binding":"a","body":integer("1")},{"constructor":"B","binding":"b","body":integer("2")}]})),
        "Sequence":constant(json!({"op":"sequence","items":[boolean(true),boolean(false)]})),
        "Await":function(json!([parameter("future",json!({"tag":"future","result":scalar("bool")}))]),None,json!({"op":"await","future":variable("future")})),
        "Perform":function(json!([]),None,json!({"op":"perform","portRef":"local:Missing","operation":"test","arguments":[
            {"op":"call","callee":boolean(false),"arguments":[]}]})),
        "Unary":shared(json!({"tag":"unary","operator":"-","operand":shared_literal("Int",json!("1"))})),
        "Unit":shared(json!({"tag":"literal","type":"Unit"})),
        "Hole":shared(json!({"tag":"hole","expected":"expression"})),
        "Post":shared(json!({"tag":"reference","ref":{"resultOf":"Match"}}))}));
    assert!(signature(&analysis,"Construct").body_type_checked);
    assert!(is_result(&analysis,"Match","int"));
    assert_eq!(signature(&analysis,"Sequence").state,SignatureState::TypeReady);
    assert!(is_result(&analysis,"Await","bool"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsAsyncResourceQualification"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsPortOperationSignature"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsExpressionHole"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsPostconditionEnvironment"));
    assert_eq!(signature(&analysis,"Perform").state,SignatureState::Rejected);
    assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="NotCallableType"));
    assert!(!analysis.needs.iter().any(|need|matches!(need.code,"NeedsExpressionTypeRule"|"NeedsExecBodyAnalysis")));
}

#[test]
fn loop_condition_exec_exits_and_unit_statement_rules_preserve_original_targets() {
    let analysis=analyze(json!({"F":function(json!([]),None,block(json!([
        {"op":"while","condition":{"op":"try","body":block(json!([{"op":"break"}]),None),
            "errorName":"error","onError":boolean(true)},"body":block(json!([{"op":"continue"}]),None)},
        {"op":"scope","body":block(json!([]),Some(integer("1")))},
        {"op":"eval","value":integer("2")}
    ]),None)),"Bad":function(json!([]),None,block(json!([
        {"op":"while","condition":boolean(false),"body":block(json!([]),Some(integer("1")))}
    ]),None))}));
    assert!(is_result(&analysis,"F","unit"));
    let exits=analysis.bodies.expressions.iter().flat_map(|summary|summary.exits.iter()).filter(|exit|
        analysis.types.source(exit.source).expanded_path.starts_with("/definitions/F/")&&matches!(exit.kind,ExitKind::Break|ExitKind::Continue)).collect::<Vec<_>>();
    assert!(!exits.is_empty());let target=exits[0].target;
    assert!(exits.iter().all(|exit|exit.target==target));
    assert_eq!(analysis.names.lexical.scopes[target.unwrap().index()].kind,"loop");
    let declaration=signature(&analysis,"F").declaration;
    let root=&analysis.bodies.expressions[analysis.bodies.declarations[&declaration].expression];
    assert!(root.exits.is_empty());
    assert_eq!(signature(&analysis,"Bad").state,SignatureState::Rejected);
}

#[test]
fn pending_substitution_is_preserved_separately_from_control_and_error_profile() {
    let record=|name:&str|json!({"op":"record","fields":[{"name":name,"value":boolean(true)}]});
    let analysis=analyze(json!({"F":function(json!([]),None,json!({"op":"try","body":record("x"),"errorName":"e","onError":record("y")}))}));
    assert!(analysis.problems.is_empty(),"{:?}",analysis.problems);
    assert!(!signature(&analysis,"F").body_type_checked);
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsSubstitutionCompatibility"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsManagedErrorProfile"));
    let declaration=signature(&analysis,"F").declaration;
    assert_eq!(analysis.bodies.expressions[analysis.bodies.declarations[&declaration].expression].normal,NormalResult::Pending);
}

#[test]
fn professional_semantic_values_supply_their_actual_types_without_default_runtime_environment() {
    let mut design=shared(json!({"tag":"unary","operator":"-","operand":{"tag":"reference","ref":{"binding":"n"}}}));
    design["body"]["typeParams"]=json!([{"key":"n","name":"n","kind":{"value":{"core":"Int"}}}]);
    let analysis=analyze(json!({"Design":design}));
    assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
    let root=analysis.bodies.regions[0];
    let NormalResult::Value(ty)=analysis.bodies.expressions[root].normal else{panic!("{:?}",analysis.bodies.expressions[root])};
    assert!(matches!(analysis.types.get(analysis.types.resolved(ty)),SemanticType::Scalar(scalar) if scalar.name=="int"));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsProfessionalBodyQualification"));
}

#[test]
fn review_repair_region_owner_comes_from_the_actual_declaration() {
    let analysis=analyze(json!({"F":function(json!([]),Some(scalar("int")),integer("1")),
        "Design":shared(json!({"tag":"call","callee":{"tag":"reference","ref":{"definitionId":"F"}},"arguments":[]}))}));
    let design=analysis.names.declarations.iter().find(|declaration|declaration.name=="Design").unwrap().id;
    let f=signature(&analysis,"F").declaration;
    let root=analysis.bodies.regions[0];
    assert_eq!(analysis.types.source(analysis.bodies.expressions[root].source).owner,Some(design));
    assert_eq!(analysis.dependencies[&design],std::collections::BTreeSet::from([f]));
    assert!(!analysis.dependencies[&f].contains(&f));
    let call=&analysis.bodies.calls[0];assert_eq!(analysis.types.source(call.source).owner,Some(design));
}

#[test]
fn review_repair_professional_only_references_have_real_owners_without_panicking() {
    let analysis=analyze(json!({"Target":shared(shared_literal("Int",json!("1"))),
        "设计/~":shared(json!({"tag":"reference","ref":{"definitionId":"Target"}}))}));
    let caller=analysis.names.declarations.iter().find(|declaration|declaration.name=="设计/~").unwrap().id;
    let target=analysis.names.declarations.iter().find(|declaration|declaration.name=="Target").unwrap().id;
    assert_eq!(analysis.dependencies[&caller],std::collections::BTreeSet::from([target]));
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsProfessionalValueSignature"));
}

#[test]
fn review_repair_unit_literal_patterns_are_the_actual_unit_constructor() {
    let literal=json!({"tag":"literal","type":"Unit"});
    let arm=|pattern:Value|json!({"pattern":pattern,"expression":shared_literal("Int",json!("1"))});
    for patterns in [json!([arm(literal.clone())]),json!([arm(literal.clone()),arm(json!({"tag":"unit"}))])] {
        let repeated=patterns.as_array().unwrap().len()>1;
        let analysis=analyze(json!({"Design":shared(pattern_expression(patterns,json!({"core":"Unit"})))}));
        assert_eq!(analysis.bodies.coverage[0].result,Coverage::Exhaustive);
        assert!(analysis.bodies.problems.is_empty());
        if repeated {assert_eq!(analysis.bodies.coverage[0].redundant_arms,vec![1]);}
    }
    let analysis=analyze(json!({"Design":shared(pattern_expression(json!([arm(literal.clone()),arm(literal)]),json!({"core":"Unit"})))}));
    assert_eq!(analysis.bodies.coverage[0].redundant_arms,vec![1]);
    for (ty,value) in [("Int",json!("1")),("Text",json!("x"))] {
        let pattern=shared_literal(ty,value);
        let analysis=analyze(json!({"Design":shared(pattern_expression(json!([arm(pattern.clone())]),json!({"core":ty})))}));
        assert!(matches!(analysis.bodies.coverage[0].result,Coverage::Missing(_)));
        let analysis=analyze(json!({"Design":shared(pattern_expression(json!([arm(pattern),arm(json!({"tag":"wildcard"}))]),json!({"core":ty})))}));
        assert_eq!(analysis.bodies.coverage[0].result,Coverage::Exhaustive);
    }
}

#[test]
fn review_repair_list_patterns_require_list_identity_not_closed_domain_or_case_names() {
    let cons=json!({"tag":"cons","head":{"key":"head","name":"head"},"tail":{"key":"tail","name":"tail"}});
    let arm=|pattern:Value|json!({"pattern":pattern,"expression":shared_literal("Int",json!("1"))});
    for ty in [json!({"core":"Int"}),json!({"core":"Text"}),json!({"decl":{"definitionId":"Fake"}})] {
        for pattern in [json!({"tag":"empty-list"}),cons.clone()] {
            let analysis=analyze(json!({"Fake":definition(json!({"tag":"variant","cases":{"Nil":scalar("unit"),"Cons":scalar("bool")}})),
                "Design":shared(pattern_expression(json!([arm(pattern),arm(json!({"tag":"wildcard"}))]),ty.clone()))}));
            assert!(analysis.bodies.problems.iter().any(|problem|problem.diagnostic.code=="InvalidPatternType"),"{:?}",analysis.bodies.problems);
        }
    }
    let analysis=analyze(json!({"ListAlias":definition(json!({"tag":"sequence","item":scalar("bool")})),
        "Design":shared(pattern_expression(json!([arm(json!({"tag":"empty-list"})),arm(cons)]),json!({"decl":{"definitionId":"ListAlias"}})))}));
    assert!(analysis.bodies.problems.is_empty(),"{:?}",analysis.bodies.problems);
    assert_eq!(analysis.bodies.coverage[0].result,Coverage::Exhaustive);
    for name in ["head","tail"] {
        let binding=analysis.names.lexical.bindings.iter().find(|binding|binding.name==name).unwrap().id;
        let fact=analysis.bodies.bindings.iter().find(|fact|fact.binding==binding).unwrap();
        let ty=analysis.types.get(analysis.types.resolved(fact.ty));
        if name=="head" {assert!(matches!(ty,SemanticType::Scalar(scalar) if scalar.name=="bool"));}
        else {assert!(matches!(ty,SemanticType::Declaration {..}|SemanticType::List(_)|SemanticType::Sequence {ordered:true,..}));}
    }
    let covered=analyze(json!({"Design":shared(pattern_expression(json!([arm(json!({"tag":"empty-list"})),arm(json!({"tag":"wildcard"}))]),
        json!({"hole":{"expected":"type"}})))}));
    assert!(covered.bodies.problems.is_empty());
    assert!(covered.needs.iter().any(|need|need.code=="NeedsListPatternType"));
    assert_eq!(covered.bodies.coverage[0].result,Coverage::Exhaustive);
    let analysis=analyze(json!({"Design":shared(pattern_expression(json!([arm(json!({"tag":"empty-list"}))]),
        json!({"hole":{"expected":"type"}})))}));
    assert!(analysis.bodies.problems.is_empty());
    assert!(analysis.needs.iter().any(|need|need.code=="NeedsListPatternType"));
    assert_eq!(analysis.bodies.coverage[0].result,Coverage::Unknown);
}

fn return_from_condition()->Value {json!({"op":"try","errorName":"e",
    "body":block(json!([{"op":"return","value":integer("1")}]),None),
    "onError":block(json!([{"op":"return","value":integer("2")}]),None)})}

#[test]
fn review_repair_no_normal_prefix_does_not_constrain_unreachable_results_to_outer_type() {
    let abrupt=return_from_condition();
    for body in [json!({"op":"if","condition":abrupt,"then":boolean(true),"otherwise":boolean(false)}),
        json!({"op":"match","value":abrupt,"cases":[{"constructor":"A","binding":"a","body":boolean(true)},{"constructor":"B","binding":"b","body":boolean(false)}]}),
        json!({"op":"let","name":"never_initialized","value":abrupt,"body":boolean(true)}),
        json!({"op":"do","steps":[abrupt],"result":boolean(true)})] {
        let analysis=analyze(json!({"F":function(json!([]),Some(scalar("int")),body)}));
        assert_eq!(signature(&analysis,"F").state,SignatureState::TypeReady,"{:?}",analysis.problems);
        assert!(signature(&analysis,"F").body_type_checked);
        let declaration=signature(&analysis,"F").declaration;
        assert_eq!(analysis.bodies.expressions[analysis.bodies.declarations[&declaration].expression].normal,NormalResult::NoNormal);
        assert!(analysis.needs.iter().any(|need|need.code=="NeedsManagedErrorProfile"));
    }
    let bad_call=json!({"op":"call","callee":boolean(true),"arguments":[]});
    for body in [json!({"op":"if","condition":abrupt,"then":bad_call,"otherwise":boolean(false)}),
        json!({"op":"if","condition":abrupt,"then":boolean(true),"otherwise":integer("3")}),
        block(json!([{"op":"return","value":integer("1")},{"op":"let","name":"x","type":scalar("int"),"value":boolean(true)}]),None),
        block(json!([{"op":"while","condition":abrupt,"body":block(json!([]),Some(boolean(true)))}]),None),
        json!({"op":"if","condition":abrupt,"then":{"op":"call","callee":{"op":"symbol","ref":"local:G"},"arguments":[boolean(true)]},"otherwise":integer("3")})] {
        let analysis=analyze(json!({"F":function(json!([]),Some(scalar("int")),body),
            "G":function(json!([parameter("x",scalar("int"))]),Some(scalar("int")),variable("x"))}));
        assert_eq!(signature(&analysis,"F").state,SignatureState::Rejected);
        assert!(analysis.bodies.problems.iter().any(|problem|matches!(problem.diagnostic.code.as_str(),"NotCallableType"|"TypeMismatch")));
    }
}
