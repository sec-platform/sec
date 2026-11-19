use gift_author_kernel::{binding::DeclarationId,callable_analysis::CallableAnalysis,effect_analysis::EffectLimits,
    reader,semantic_types::SemanticType,signature_resolution};
use serde_json::{json,Value};

fn scalar(name:&str)->Value {json!({"tag":"scalar","name":name})}
fn var(name:&str)->Value {json!({"op":"var","name":name})}
fn symbol(name:&str)->Value {json!({"op":"symbol","ref":format!("local:{name}")})}
fn call(name:&str,args:Value)->Value {json!({"op":"call","callee":symbol(name),"arguments":args})}
fn function(parameters:Value,returns:Value,body:Value)->Value {
    json!({"kind":"core:function","body":{"parameters":parameters,"returns":returns,"body":body}})
}
fn boolean(value:bool)->Value {json!({"op":"literal","type":scalar("bool"),"value":value})}
fn source(definitions:Value)->Vec<u8> {
    serde_json::to_vec(&json!({"schema":"gift.author-module/design-converged","moduleId":"callable:test","definitions":definitions})).unwrap()
}
fn freeze(definitions:Value)->CallableAnalysis {
    let bytes=source(definitions);reader::read(&bytes).expect("Selected Reader grammar, before semantic assertions");
    signature_resolution::prepare_analysis(&bytes).unwrap().close_analysis(EffectLimits::default()).unwrap().freeze_callables().unwrap()
}
fn id(analysis:&CallableAnalysis,name:&str)->DeclarationId {
    analysis.resolution().names.declarations.iter().find(|d|d.name==name).unwrap().id
}

#[test]
fn direct_functions_and_runtime_recursion_close_without_a_totality_claim() {
    let analysis=freeze(json!({
        "Identity":function(json!([{"name":"x","type":scalar("bool")}]),scalar("bool"),var("x")),
        "Use":function(json!([]),scalar("bool"),call("Identity",json!([boolean(true)]))),
        "Left":function(json!([]),scalar("bool"),call("Right",json!([]))),
        "Right":function(json!([]),scalar("bool"),call("Left",json!([])))
    }));
    for name in ["Identity","Use","Left","Right"] {
        assert!(analysis.callables().get(id(&analysis,name)).is_some(),"{name}: {:?}",analysis.needs());
    }
    assert!(analysis.callables().get(id(&analysis,"Left")).unwrap().direct_calls.contains(&id(&analysis,"Right")));
    assert!(!analysis.resolution().needs.iter().any(|need|need.code=="NeedsCaptureAndCallableQualification"));
}

#[test]
fn unsupported_callees_do_not_become_callable_because_their_effects_are_empty() {
    let mut contracted=function(json!([]),scalar("bool"),boolean(true));contracted["body"]["contract"]=json!({});
    let analysis=freeze(json!({
        "Contracted":contracted,
        "Caller":function(json!([]),scalar("bool"),call("Contracted",json!([]))),
        "Static": {"kind":"core:constant","body":{"value":boolean(true)}},
        "ReadStatic":function(json!([]),scalar("bool"),symbol("Static")),
        "ViaValue":function(json!([{"name":"f","type":{"tag":"function","params":[],"returns":scalar("bool"),"effects":[]}}]),scalar("bool"),
            json!({"op":"call","callee":var("f"),"arguments":[]})),
        "CapturedLambda":function(json!([]),scalar("bool"),json!({"op":"let","name":"x","value":boolean(true),"body":{
            "op":"call","callee":{"op":"lambda","params":[],"body":var("x")},"arguments":[]}})),
        "Good":function(json!([]),scalar("bool"),boolean(true))
    }));
    assert!(analysis.callables().get(id(&analysis,"Good")).is_some());
    for name in ["Contracted","Caller","Static","ReadStatic","ViaValue","CapturedLambda"] {
        assert!(analysis.callables().get(id(&analysis,name)).is_none(),"{name}");
    }
    assert!(analysis.resolution().needs.iter().any(|need|need.code=="NeedsContractQualification"));
    assert!(analysis.resolution().needs.iter().any(|need|need.code=="NeedsStaticConstructionQualification"));
    for name in ["Contracted","Caller","ReadStatic","ViaValue","CapturedLambda"] {
        let declaration=id(&analysis,name);
        assert!(analysis.resolution().needs.iter().any(|need|need.code=="NeedsCaptureAndCallableQualification"&&analysis.resolution().types.source(need.source).owner==Some(declaration)));
    }
}

#[test]
fn common_callable_is_not_the_rust_representation_subset() {
    let analysis=freeze(json!({"Integer":function(json!([{"name":"x","type":scalar("int")}]),scalar("int"),var("x")),
        "Sequence":function(json!([{"name":"x","type":{"tag":"sequence","item":scalar("bool")}}]),
            json!({"tag":"sequence","item":scalar("bool")}),var("x"))}));
    assert!(analysis.callables().get(id(&analysis,"Integer")).is_some());
    assert!(analysis.callables().get(id(&analysis,"Sequence")).is_some());
}

#[test]
fn alias_normalization_survives_effect_closure_without_erasing_nominal_identity() {
    let analysis=freeze(json!({
        "BoolAlias":{"kind":"core:type","body":{"type":scalar("bool")}},
        "Node":{"kind":"core:type","body":{"type":{"tag":"record","fields":{"flag":{"type":scalar("bool")}}}}},
        "AliasIdentity":function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:BoolAlias"}}]),
            json!({"tag":"nominal","ref":"local:BoolAlias"}),var("x")),
        "NominalIdentity":function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:Node"}}]),
            json!({"tag":"nominal","ref":"local:Node"}),var("x"))
    }));
    let entry=analysis.callables().get(id(&analysis,"AliasIdentity")).expect("Retained alias state");
    let SemanticType::Function(function)=analysis.resolution().types.get(entry.signature) else{panic!()};
    // The arena preserves source aliases; the retained constraint interpreter
    // checked their complete closure to issue the entry. It did not replace
    // the author's nominal locator with a printer-specific structural type.
    assert!(matches!(analysis.resolution().types.get(function.returns),SemanticType::Declaration {target,..} if target.declaration==Some(id(&analysis,"BoolAlias"))));
    let entry=analysis.callables().get(id(&analysis,"NominalIdentity")).expect("Private ordinary nominal signature");
    let SemanticType::Function(function)=analysis.resolution().types.get(entry.signature) else{panic!()};
    assert!(matches!(analysis.resolution().types.get(function.returns),SemanticType::Declaration {target,..} if target.declaration==Some(id(&analysis,"Node"))));
}

#[test]
fn unrelated_bad_body_remains_in_the_original_report() {
    let analysis=freeze(json!({"Bad":function(json!([]),scalar("bool"),json!({"op":"call","callee":boolean(true),"arguments":[]})),
        "BadType":{"kind":"core:type","body":{"type":{"tag":"record","fields":{"value":{"type":{"tag":"param","name":"Missing"}}}}}},
        "UseBadType":function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:BadType"}}]),
            json!({"tag":"nominal","ref":"local:BadType"}),var("x")),
        "Good":function(json!([]),scalar("bool"),boolean(true))}));
    assert!(analysis.callables().get(id(&analysis,"Good")).is_some());
    assert!(analysis.callables().get(id(&analysis,"Bad")).is_none());
    assert!(analysis.callables().get(id(&analysis,"UseBadType")).is_none(),"Nominal identity is not a valid representation proof");
    assert!(analysis.resolution().problems.iter().any(|p|p.declaration==id(&analysis,"Bad")));
    let revision=analysis.resolution().names.input_revision.clone();
    assert_eq!(analysis.into_parts().names.input_revision,revision);
}

#[test]
fn public_nominal_closure_is_checked_without_making_private_implementation_public() {
    let mut value:Value=serde_json::from_slice(&source(json!({
        "Private":{"kind":"core:type","body":{"type":{"tag":"record","fields":{"flag":{"type":scalar("bool")}}}}},
        "Hidden":function(json!([{"name":"x","type":{"tag":"nominal","ref":"local:Private"}}]),
            json!({"tag":"nominal","ref":"local:Private"}),var("x")),
        "Plain":function(json!([]),scalar("bool"),boolean(true))
    }))).unwrap();
    value["exports"]=json!({"api":{"definitionId":"Hidden"},"ok":{"definitionId":"Plain"}});
    let bytes=serde_json::to_vec(&value).unwrap();reader::read(&bytes).unwrap();
    let analysis=signature_resolution::prepare_analysis(&bytes).unwrap().close_analysis(EffectLimits::default()).unwrap().freeze_callables().unwrap();
    assert!(analysis.callables().get(id(&analysis,"Hidden")).is_none());
    assert!(analysis.callables().get(id(&analysis,"Plain")).is_some());
    assert!(analysis.resolution().problems.iter().any(|problem|problem.diagnostic.code=="PrivateTypeInPublicSignature"));
}

#[test]
fn actual_imported_direct_calls_keep_the_captured_basis_and_module_revisions() {
    use gift_author_kernel::{binding::ImportBinding,captured_input::{FixedContext,ModuleCapture,PreparedInput}};
    let library=serde_json::to_vec(&json!({"schema":"gift.author-module/design-converged","moduleId":"Lib",
        "definitions":{"F":function(json!([]),scalar("bool"),boolean(true))},"exports":{"function":{"definitionId":"F"}}})).unwrap();
    let mut root:Value=serde_json::from_slice(&source(json!({"Use":function(json!([]),scalar("bool"),json!({"op":"call",
        "callee":{"op":"symbol","ref":{"space":"import","alias":"lib","export":"function"}},"arguments":[]}))}))).unwrap();
    root["imports"]=json!({"lib":{"mode":"workspace","moduleId":"Lib"}});
    let root=serde_json::to_vec(&root).unwrap();
    let context=FixedContext::new("project:callable","domain:callable").unwrap();
    let input=PreparedInput::from_modules(vec![ModuleCapture::read(&root,"root.json",&context).unwrap(),
        ModuleCapture::read(&library,"lib.json",&context).unwrap()],vec![ImportBinding {from:0,alias:"lib".into(),target:1}],0).unwrap();
    let basis=input.capture().basis().to_owned();let uses=input.capture().module_uses().to_vec();
    let prepared=signature_resolution::prepare_input(input).unwrap();
    let revisions=prepared.body_view().names.modules.iter().map(|module|module.source_revision.clone()).collect::<Vec<_>>();
    let analysis=prepared.close_analysis(EffectLimits::default()).unwrap().freeze_callables().unwrap();
    assert_eq!(analysis.resolution().input().basis(),basis);
    assert_eq!(analysis.resolution().input().module_uses(),uses);
    assert_eq!(analysis.resolution().names.modules.iter().map(|module|module.source_revision.clone()).collect::<Vec<_>>(),revisions);
    let caller=analysis.callables().get(id(&analysis,"Use")).expect("Fixed captured imported callee");
    let callee=analysis.callables().get(id(&analysis,"F")).expect("Library's same-generation body");
    assert!(caller.direct_calls.contains(&callee.declaration));
    assert_ne!(analysis.resolution().types.source(caller.source).module,analysis.resolution().types.source(callee.source).module);
}

#[test]
fn recursive_nominal_instances_use_semantic_arguments_not_allocated_type_ids() {
    let nominal=|name:&str,arguments:Vec<Value>|json!({"tag":"nominal","ref":format!("local:{name}"),"args":arguments});
    let node=|argument:Value|nominal("Node",vec![argument]);
    let function_value=json!({"tag":"function","params":[],"returns":scalar("bool"),"effects":[]});
    let analysis=freeze(json!({
        "Node":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"record","fields":{
            "next":{"type":{"tag":"option","inner":node(json!({"tag":"param","name":"T"}))}},
            "value":{"type":{"tag":"param","name":"T"}}}}}},
        "Plain":{"kind":"core:type","body":{"type":{"tag":"record","fields":{
            "next":{"type":{"tag":"option","inner":nominal("Plain",vec![])}}}}}},
        "Generic":function(json!([{"name":"x","type":node(scalar("bool"))}]),node(scalar("bool")),var("x")),
        "NonGeneric":function(json!([{"name":"x","type":nominal("Plain",vec![])}]),nominal("Plain",vec![]),var("x")),
        "TwoInstances":function(json!([{"name":"first","type":node(scalar("text"))},{"name":"second","type":node(scalar("bool"))}]),scalar("bool"),boolean(true)),
        // LIFO traversal checks Node<Bool> first. Deduplicating by declaration
        // alone would then hide the distinct function-valued payload contract.
        "DifferentObligation":function(json!([{"name":"first","type":node(function_value)},{"name":"second","type":node(scalar("bool"))}]),scalar("bool"),boolean(true))
    }));
    for name in ["Generic","NonGeneric","TwoInstances"] {
        assert!(analysis.callables().get(id(&analysis,name)).is_some(),"{name}: {:?}",analysis.needs());
    }
    let rejected=id(&analysis,"DifferentObligation");
    assert!(analysis.callables().get(rejected).is_none());
    assert!(analysis.needs().iter().any(|need|need.code=="NeedsFunctionValueCallableQualification"&&analysis.resolution().types.source(need.source).owner==Some(rejected)));
}
