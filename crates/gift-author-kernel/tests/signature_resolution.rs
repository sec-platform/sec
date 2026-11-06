use std::collections::BTreeSet;
use gift_author_kernel::{header_seeds, reader, semantic_types::*, signature_resolution::{self,SignatureResolution,SignatureState},
    type_constraints::{ConstraintMachine,Relation}};
use serde_json::{Value,json};

fn scalar(name:&str)->Value {json!({"tag":"scalar","name":name})}
fn literal(name:&str,value:Value)->Value {json!({"op":"literal","type":scalar(name),"value":value})}
fn variable(name:&str)->Value {json!({"op":"var","name":name})}
fn symbol(name:&str)->Value {json!({"op":"symbol","ref":format!("local:{name}")})}
fn call(name:&str,args:Value)->Value {json!({"op":"call","callee":symbol(name),"arguments":args})}
fn function(parameters:Value,returns:Option<Value>,body:Value)->Value {
    let mut result=json!({"kind":"core:function","body":{"parameters":parameters,"body":body}});
    if let Some(returns)=returns {result["body"]["returns"]=returns;}result
}
fn constant(value:Value)->Value {json!({"kind":"core:constant","body":{"value":value}})}
fn definition(ty:Value)->Value {json!({"kind":"core:type","body":{"type":ty}})}
fn reference(name:&str)->Value {json!({"tag":"nominal","ref":format!("local:{name}")})}
fn bytes(definitions:Value)->Vec<u8> {serde_json::to_vec(&json!({"schema":"gift.author-module/design-converged","moduleId":"signature:test","definitions":definitions})).unwrap()}
fn resolve(definitions:Value)->SignatureResolution {
    let source=bytes(definitions);
    reader::read(&source).expect("Independent oracle first proves this is a selected-grammar input");
    signature_resolution::resolve(&source).unwrap()
}
fn signature<'a>(result:&'a SignatureResolution,name:&str)->&'a signature_resolution::Signature {
    let id=result.names.declarations.iter().find(|d|d.name==name).unwrap().id;
    result.signatures.iter().find(|s|s.declaration==id).unwrap()
}
fn result_type<'a>(result:&'a SignatureResolution,name:&str)->&'a SemanticType {
    let ty=result.types.resolved(signature(result,name).ty.unwrap());
    let ty=match result.types.get(ty){SemanticType::Function(f)=>result.types.resolved(f.returns),_=>ty};
    result.types.get(ty)
}
fn is_scalar(ty:&SemanticType,name:&str)->bool {matches!(ty,SemanticType::Scalar(s) if s.name==name)}
fn parameter(name:&str,ty:Value)->Value {json!({"name":name,"type":ty})}
fn function_type(parameters:Vec<TypeId>,returns:TypeId)->SemanticType {
    SemanticType::Function(FunctionType {binders:vec![],parameters:parameters.into_iter().map(SemanticArgument::Type).collect(),returns,
        effects:None,pending_effects:false,pending_captures:false,call_mode:None,parameter_contracts:None,captures:None})
}

#[test]
fn inference_uses_real_bindings_and_publishes_retained_solutions() {
    let result=resolve(json!({
        "Use":function(json!([]),None,call("Producer",json!([]))),
        "Producer":function(json!([]),None,literal("int",json!("9007199254740993"))),
        "Choice":function(json!([]),None,json!({"op":"let","name":"x","value":literal("bool",json!(true)),
            "body":{"op":"if","condition":variable("x"),"then":literal("text",json!("yes")),"otherwise":literal("text",json!("no"))}}))
    }));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert!(is_scalar(result_type(&result,"Use"),"int"));
    assert!(is_scalar(result_type(&result,"Choice"),"text"));
    assert_eq!(signature(&result,"Use").state,SignatureState::TypeReady);
    assert!(result.needs.iter().any(|n|n.code=="NeedsEffectClosure"));
    assert!(!result.types.inference_variables.is_empty());
    // A later constraint consumer sees the same solutions, with no MetaId reset.
    let mut arena=result.types;
    let mut solver=ConstraintMachine::new(&mut arena,10000,1_000_000);
    let source=solver.arena().sources[0].id;
    let fresh=solver.fresh(SemanticKind::Type,BTreeSet::new()).unwrap();
    assert!(solver.unresolved(fresh).unwrap());
    assert!(solver.arena().source(source).origin.is_some());
}

#[test]
fn runtime_recursion_and_inferred_signature_cycles_have_different_outcomes() {
    for (a,b,cycle) in [(true,true,false),(true,false,false),(false,true,false),(false,false,true)] {
        let params=json!([parameter("x",scalar("int"))]);
        let result=resolve(json!({"A":function(params.clone(),a.then(||scalar("int")),call("B",json!([variable("x")]))),
            "B":function(params,b.then(||scalar("int")),call("A",json!([variable("x")])))}));
        assert!(result.problems.is_empty(),"{:?}",result.problems);
        assert_eq!(!result.annotation_cycles.is_empty(),cycle);
        if !cycle {for name in ["A","B"] {assert!(is_scalar(result_type(&result,name),"int"));assert!(signature(&result,name).body_type_checked);}}
        else {assert!(result.needs.iter().any(|n|n.code=="AnnotationRequiredSignatureCycle"));}
    }
}

#[test]
fn polymorphic_declarations_are_rigid_and_calls_have_fresh_instances() {
    let mut identity=function(json!([parameter("x",json!({"tag":"param","name":"T"}))]),Some(json!({"tag":"param","name":"T"})),variable("x"));
    identity["body"]["typeParams"]=json!([{"name":"T"}]);
    let result=resolve(json!({"Id":identity.clone(),"I":constant(call("Id",json!([literal("int",json!("1"))]))),
        "B":constant(call("Id",json!([literal("bool",json!(true))])))}));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert!(is_scalar(result_type(&result,"I"),"int"));assert!(is_scalar(result_type(&result,"B"),"bool"));
    identity["body"]["body"]=literal("int",json!("1"));
    let invalid=resolve(json!({"Fake":identity}));
    assert!(invalid.problems.iter().any(|p|p.diagnostic.code=="TypeMismatch"));
}

#[test]
fn aliases_expand_but_distinct_nominal_records_keep_identity() {
    let record=json!({"tag":"record","fields":{"x":{"type":scalar("int")}}});
    let result=resolve(json!({"A":definition(record.clone()),"B":definition(record),"Alias":definition(reference("A")),
        "Good":function(json!([parameter("x",reference("Alias"))]),Some(reference("A")),variable("x")),
        "Bad":function(json!([parameter("x",reference("A"))]),Some(reference("B")),variable("x")),
        "Node":definition(json!({"tag":"record","fields":{"next":{"type":{"tag":"option","inner":reference("Node")}}}})),
        "CycleA":definition(reference("CycleB")),"CycleB":definition(reference("CycleA"))}));
    assert!(signature(&result,"Good").body_type_checked);
    assert_eq!(signature(&result,"Bad").state,SignatureState::Rejected);
    let names:Vec<_>=result.problems.iter().map(|p|(&result.names.declarations[p.declaration.index()].name,p.diagnostic.code.as_str())).collect();
    assert!(names.iter().any(|(name,code)|name.as_str()=="CycleA"&&*code=="TypeAliasCycle"));
    assert!(!names.iter().any(|(name,_)|name.as_str()=="Node"));
}

#[test]
fn errors_in_unrelated_declarations_remain_visible_with_exact_source_paths() {
    let result=resolve(json!({"Good":constant(literal("bool",json!(true))),
        "Bad":function(json!([]),Some(scalar("bool")),literal("int",json!("1")))}));
    assert!(is_scalar(result_type(&result,"Good"),"bool"));
    let error=&result.problems[0].diagnostic;
    assert_eq!(error.code,"TypeMismatch");assert_eq!(error.path,"/definitions/Bad/body/body");
}

#[test]
fn literal_inhabitance_is_checked_or_retains_a_specific_qualification() {
    let result=resolve(json!({"BoolAlias":definition(scalar("bool")),"IntAlias":definition(scalar("int")),
        "Invalid":constant(json!({"op":"literal","type":reference("BoolAlias"),"value":"true"})),
        "InvalidInt":constant(json!({"op":"literal","type":reference("IntAlias"),"value":"01"})),
        "Bytes":constant(json!({"op":"literal","type":{"tag":"scalar","name":"bytes","encoding":"base64"},"value":"AA=="}))}));
    assert_eq!(result.problems.iter().filter(|p|p.diagnostic.code=="InvalidLiteralValue").count(),2);
    assert!(result.needs.iter().any(|n|n.code=="NeedsLiteralValueQualification"));
    assert_ne!(signature(&result,"Bytes").state,SignatureState::TypeReady);
}

#[test]
fn unannotated_identity_is_monomorphic_and_can_be_constrained_locally() {
    let identity=json!({"op":"lambda","params":[{"name":"x"}],"body":variable("x")});
    let result=resolve(json!({"Needs":constant(identity.clone()),"Solved":constant(json!({"op":"let","name":"id","value":identity,
        "body":{"op":"call","callee":variable("id"),"arguments":[literal("bool",json!(true))]}}))}));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert_eq!(signature(&result,"Needs").state,SignatureState::NeedsAnnotation);
    assert!(is_scalar(result_type(&result,"Solved"),"bool"));
}

#[test]
fn a_real_identity_probe_rolls_back_partial_substitution_and_obligations() {
    let result=resolve(json!({"Identity":constant(json!({"op":"lambda","params":[{"name":"x"}],"body":variable("x")})),
        "Int":definition(scalar("int")),"Bool":definition(scalar("bool")),"Text":definition(scalar("text"))}));
    let identity=signature(&result,"Identity").ty.unwrap();
    let source=result.headers[0].source;
    let int=result.types.at(result.names.root,"/definitions/Int/body/type").unwrap();
    let boolean=result.types.at(result.names.root,"/definitions/Bool/body/type").unwrap();
    let text=result.types.at(result.names.root,"/definitions/Text/body/type").unwrap();
    let mut arena=result.types;
    let mut solver=ConstraintMachine::new(&mut arena,10000,2_000_000);
    let identity=solver.resolve(identity).unwrap();
    let bad=solver.insert(function_type(vec![int],text)).unwrap();
    let good=solver.insert(function_type(vec![boolean],boolean)).unwrap();
    assert_eq!(solver.probe(|s|s.unify(identity,bad,source)).unwrap_err().code,"TypeMismatch");
    assert!(solver.needs().is_empty());
    // Pending effects/captures remain explicit, but alpha is now free to be Bool.
    assert_eq!(solver.unify(identity,good,source).unwrap(),Relation::Needs);
    let SemanticType::Function(f)=solver.arena().get(identity) else {panic!()};
    assert!(is_scalar(solver.arena().get(solver.arena().resolved(f.returns)),"bool"));
}

#[test]
fn kind_occurs_and_rigid_scope_are_separate_failures() {
    let mut collection=header_seeds::collect(&bytes(json!({
        "T":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"param","name":"T"}}},
        "R":{"kind":"core:type","body":{"typeParams":[{"name":"r","kind":"Region"}],"type":{"tag":"param","name":"r"}}}
    }))).unwrap();
    let source=collection.headers[0].source;
    let t=collection.types.at(collection.names.root,"/definitions/T/body/type").unwrap();
    let region=collection.types.binders.iter().find(|b|b.kind==SemanticKind::Region).unwrap().id;
    let mut solver=ConstraintMachine::new(&mut collection.types,10000,2_000_000);
    let r=solver.insert(SemanticType::Parameter(BinderUse {lexical_use:None,binder:None,semantic:Some(region)})).unwrap();
    let alpha=solver.fresh(SemanticKind::Type,BTreeSet::new()).unwrap();
    assert_eq!(solver.probe(|s|s.unify(alpha,r,source)).unwrap_err().code,"TypeKindMismatch");
    assert_eq!(solver.probe(|s|s.unify(alpha,t,source)).unwrap_err().code,"TypeScopeEscape");
    let list=solver.insert(SemanticType::List(alpha)).unwrap();
    assert_eq!(solver.probe(|s|s.unify(alpha,list,source)).unwrap_err().code,"TypeOccurs");
    assert!(solver.unresolved(alpha).unwrap());
}

#[test]
fn actual_function_defaults_and_record_flags_compare_without_erasing_scalar_attributes() {
    let mut collection=header_seeds::collect(&bytes(json!({
        "F":definition(json!({"tag":"function","params":[scalar("bool")],"returns":scalar("bool"),"effects":[]})),
        "G":definition(json!({"tag":"function","params":[scalar("bool")],"returns":scalar("bool"),"effects":[],"captures":[],"callMode":"shared","parameterContracts":[{"position":0,"retention":"may-retain"}]})),
        "D":{"kind":"req:composite","body":{"parameters":{"callback":{"role":"value","type":{"function":{"parameters":[{"core":"Bool"}],"returns":{"core":"Bool"}}}}},"terms":[]}},
        "R":definition(json!({"tag":"record","fields":{"x":{"type":scalar("bool")}}})),
        "S":definition(json!({"tag":"record","open":false,"fields":{"x":{"type":scalar("bool"),"optional":false,"mutable":false}}})),
        "Int":definition(scalar("int")),"Checked":definition(json!({"tag":"scalar","name":"int","overflow":"checked"}))}))).unwrap();
    let root=collection.names.root;let source=collection.headers[0].source;
    let ids:Vec<_>=["F","G","R","S","Int","Checked"].into_iter().map(|n|collection.types.at(root,&format!("/definitions/{n}/body/type")).unwrap()).collect();
    let shared=collection.types.at(root,"/definitions/D/body/parameters/callback/type").unwrap();
    let mut solver=ConstraintMachine::new(&mut collection.types,10000,2_000_000);
    assert_eq!(solver.unify(ids[0],ids[1],source).unwrap(),Relation::Equal);
    assert_eq!(solver.unify(ids[0],shared,source).unwrap(),Relation::Equal);
    assert_eq!(solver.unify(ids[2],ids[3],source).unwrap(),Relation::Equal);
    assert_eq!(solver.unify(ids[4],ids[5],source).unwrap(),Relation::Needs);
    assert!(solver.needs().iter().any(|n|n.code=="NeedsScalarAttributeSemantics"));
}

#[test]
fn sequence_and_shared_list_use_one_selected_value_profile() {
    let mut collection=header_seeds::collect(&bytes(json!({
        "Sequence":definition(json!({"tag":"sequence","item":scalar("bool")})),
        "Design":{"kind":"req:composite","body":{"parameters":{"xs":{"role":"value","type":{"core":"List","arguments":[{"core":"Bool"}]}}},"terms":[]}},
        "Wrong":definition(json!({"tag":"sequence","item":scalar("text")}))}))).unwrap();
    let root=collection.names.root;let source=collection.headers[0].source;
    let seq=collection.types.at(root,"/definitions/Sequence/body/type").unwrap();
    let list=collection.types.at(root,"/definitions/Design/body/parameters/xs/type").unwrap();
    let wrong=collection.types.at(root,"/definitions/Wrong/body/type").unwrap();
    let mut solver=ConstraintMachine::new(&mut collection.types,10000,1_000_000);
    assert_eq!(solver.unify(seq,list,source).unwrap(),Relation::Equal);
    assert_eq!(solver.probe(|s|s.unify(wrong,list,source)).unwrap_err().code,"TypeMismatch");
}

#[test]
fn probe_work_is_not_refunded_and_empty_facade_is_an_actual_names_result() {
    let mut collection=header_seeds::collect(&bytes(json!({"B":definition(scalar("bool"))}))).unwrap();
    let source=collection.headers[0].source;let boolean=collection.types.at(collection.names.root,"/definitions/B/body/type").unwrap();
    let mut solver=ConstraintMachine::new(&mut collection.types,1000,1_000_000);
    let mut exhausted=false;
    let mut completed=0;
    for _ in 0..100 {if let Err(error)=solver.probe(|s|s.unify(boolean,boolean,source)){assert_eq!(error.code,"ResourceLimit");exhausted=true;break;}else{completed+=1;}}
    assert!(completed>0);
    assert!(exhausted);
    let facade=json!({"schema":"gift.author-module/design-converged","moduleId":"facade","definitions":{},
        "imports":{"remote":{"mode":"locked","moduleId":"remote","constraint":"1"}},"exports":{"x":{"import":"remote","export":"x"}}});
    let source=serde_json::to_vec(&facade).unwrap();reader::read(&source).unwrap();
    let result=signature_resolution::resolve(&source).unwrap();
    assert!(result.signatures.is_empty());assert!(!result.names.pending_regions.is_empty()||!result.names.exports.is_empty());
}

#[test]
fn expected_lambda_binders_are_hygienic_semantic_identities_without_author_locators() {
    for name in ["r","renamed"] {
        let callback=json!({"tag":"function","typeParams":[{"name":name,"kind":"Region"}],
            "params":[scalar("bool")],"returns":scalar("bool"),"effects":[],"captures":[{"region":{"parameter":name}}]});
        let source=bytes(json!({"K":{"kind":"core:constant","body":{"type":callback,
            "value":{"op":"lambda","params":[{"name":"x"}],"body":variable("x")}}}}));
        let before=gift_author_kernel::binding::analyze(&source).unwrap();
        let result=signature_resolution::resolve(&source).unwrap();
        assert!(result.problems.is_empty(),"{:?}",result.problems);
        assert!(signature(&result,"K").body_type_checked);
        assert_eq!(serde_json::to_value(before).unwrap(),serde_json::to_value(&result.names).unwrap());
        let authored:Vec<_>=result.types.binders.iter().filter(|b|b.binding.is_some()).collect();
        let derived:Vec<_>=result.types.binders.iter().filter(|b|matches!(b.provenance,BinderProvenance::Derived {..})).collect();
        assert_eq!(authored.len(),1);assert_eq!(derived.len(),1);
        assert_ne!(authored[0].id,derived[0].id);assert!(derived[0].binding.is_none());
        assert_eq!(derived[0].kind,SemanticKind::Region);
        assert!(result.types.nodes.iter().any(|n|matches!(n,SemanticType::Function(f) if f.binders==vec![derived[0].id])));
        assert!(result.needs.iter().any(|n|n.code=="NeedsLambdaCaptureAndEffectAnalysis"));
    }
}

#[test]
fn explicit_empty_lambda_binders_do_not_inherit_expected_quantifiers() {
    let callback=json!({"tag":"function","typeParams":[{"name":"r","kind":"Region"}],
        "params":[scalar("bool")],"returns":scalar("bool"),"effects":[]});
    let result=resolve(json!({"K":{"kind":"core:constant","body":{"type":callback,
        "value":{"op":"lambda","typeParams":[],"params":[{"name":"x"}],"body":variable("x")}}}}));
    assert!(!signature(&result,"K").body_type_checked);
    assert!(result.needs.iter().any(|n|n.code=="NeedsSubstitutionCompatibility"));
    assert!(result.types.binders.iter().all(|b|b.binding.is_some()));
}

#[test]
fn declaration_order_and_deferred_dependencies_have_the_same_signature_results() {
    let caller=function(json!([]),None,call("Z",json!([])));
    let producer=function(json!([]),None,literal("bool",json!(true)));
    let a=format!(r#"{{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{{"A":{caller},"Z":{producer}}}}}"#);
    let b=format!(r#"{{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{{"Z":{producer},"A":{caller}}}}}"#);
    for source in [a,b] {
        reader::read(source.as_bytes()).unwrap();let result=signature_resolution::resolve(source.as_bytes()).unwrap();
        assert!(result.problems.is_empty(),"{:?}",result.problems);
        assert!(is_scalar(result_type(&result,"A"),"bool"));assert!(signature(&result,"A").body_type_checked);
        let id=signature(&result,"A").declaration;assert_eq!(result.dependencies[&id].len(),1);
    }
}

#[test]
fn holes_and_compatibility_obligations_are_not_false_type_success_or_errors() {
    let result=resolve(json!({"Unknown":function(json!([]),Some(reference("Missing")),literal("bool",json!(true))),
        "F":function(json!([parameter("x",json!({"tag":"record","fields":{"value":{"type":scalar("bool")}}}))]),
            Some(json!({"tag":"record","fields":{"value":{"type":scalar("bool"),"optional":true}}})),variable("x"))}));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert_ne!(signature(&result,"Unknown").state,SignatureState::TypeReady);
    assert!(!signature(&result,"F").body_type_checked);
    assert!(result.needs.iter().any(|n|n.code=="NeedsSubstitutionCompatibility"));
    let mut collection=header_seeds::collect(&bytes(json!({"D":{"kind":"req:composite","body":{"parameters":{
        "x":{"role":"value","type":{"hole":{"expected":"type"}}}},"terms":[]}}}))).unwrap();
    let ty=collection.types.at(collection.names.root,"/definitions/D/body/parameters/x/type").unwrap();
    let source=collection.headers[0].source;
    let mut solver=ConstraintMachine::new(&mut collection.types,1000,1_000_000);
    assert!(solver.unresolved(ty).unwrap());
    assert_eq!(solver.unify(ty,ty,source).unwrap(),Relation::Needs);
}

#[test]
fn review_parameter_sequence_expansion_preserves_pack_kind_and_pending_arity() {
    let function_type=|params:Value|json!({"tag":"function","params":params,"returns":scalar("bool"),"effects":[]});
    let result=resolve(json!({"Generic":{"kind":"core:type","body":{
        "typeParams":[{"name":"Ts","kind":{"pack":"Type"}}],
        "type":function_type(json!([{"expand":{"parameter":"Ts"}}]))
    }},"Plain":definition(function_type(json!([scalar("bool"),scalar("bool")]))),
        "Tuple":definition(json!({"tag":"tuple","items":[scalar("bool"),scalar("text")]}))}));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert_ne!(signature(&result,"Generic").state,SignatureState::Rejected);
    assert!(result.needs.iter().any(|need|need.code=="NeedsPackExpansion"));
    assert_ne!(signature(&result,"Tuple").state,SignatureState::Rejected);
    let expanded=result.types.at(result.names.root,"/definitions/Generic/body/type").unwrap();
    let plain=result.types.at(result.names.root,"/definitions/Plain/body/type").unwrap();
    let tuple=result.types.at(result.names.root,"/definitions/Tuple/body/type").unwrap();
    let source=result.headers[0].source;
    let mut arena=result.types;
    let mut solver=ConstraintMachine::new(&mut arena,100_000,4_000_000);
    assert_eq!(solver.validate_type(tuple,source).unwrap(),Relation::Equal);
    assert_eq!(solver.unify(expanded,plain,source).unwrap(),Relation::Needs,
        "One unexpanded item does not prove a different runtime arity from two concrete parameters");
    for (kind,pack,valid) in [
        (json!({"pack":"Type"}),json!({"concat":[[scalar("bool")],{"parameter":"Ts"}]}),true),
        (json!({"pack":"Region"}),json!({"parameter":"Ts"}),false),
        (json!("Type"),json!({"parameter":"Ts"}),false),
        (json!({"pack":"Region"}),json!({"concat":[[scalar("bool")],{"parameter":"Ts"}]}),false),
    ] {
        let result=resolve(json!({"Generic":{"kind":"core:type","body":{
            "typeParams":[{"name":"Ts","kind":kind}],"type":function_type(json!([{"expand":pack}]))}}}));
        if valid {
            assert!(result.problems.is_empty(),"{:?}",result.problems);
            assert!(result.needs.iter().any(|need|need.code=="NeedsPackExpansion"));
        }else {
            assert!(result.problems.iter().any(|problem|problem.diagnostic.code=="TypeKindMismatch")||
                result.types.problems.iter().any(|problem|problem.code=="BindingKindMismatch"),
                "{:?} {:?}",result.problems,result.types.problems);
            assert_ne!(signature(&result,"Generic").state,SignatureState::TypeReady);
        }
    }
    for invalid in [function_type(json!([{"pack":[scalar("bool")]}])),
        json!({"tag":"tuple","items":[{"expand":[scalar("bool")]}]})] {
        assert!(reader::read(&bytes(json!({"Invalid":definition(invalid)}))).is_err(),
            "Sequence checking must preserve the grammar's single-argument and Tuple boundaries");
    }
}

#[test]
fn review_shared_semantic_argument_splicing_keeps_arity_pending_before_comparison() {
    let input=bytes(json!({"Base":{"kind":"core:type","body":{"typeParams":[{"name":"T"},{"name":"U"}],
        "type":{"tag":"record","fields":{}}}},"Design":{"kind":"req:composite","body":{
        "typeParams":[{"key":"ts","name":"Ts","kind":{"pack":"Type"}}],"terms":[],"parameters":{
            "a":{"role":"value","type":{"decl":{"definitionId":"Base"},"arguments":[{"expand":{"parameter":"ts"}}]}},
            "b":{"role":"value","type":{"decl":{"definitionId":"Base"},"arguments":[{"core":"Bool"},{"core":"Text"}]}}
        }}}}));
    reader::read(&input).unwrap();
    let collection=header_seeds::collect(&input).unwrap();
    assert!(collection.types.problems.is_empty(),"{:?}",collection.types.problems);
    let expanded=collection.types.at(collection.names.root,"/definitions/Design/body/parameters/a/type").unwrap();
    let concrete=collection.types.at(collection.names.root,"/definitions/Design/body/parameters/b/type").unwrap();
    let source=collection.headers[0].source;
    let mut arena=collection.types;
    let mut solver=ConstraintMachine::new(&mut arena,100_000,4_000_000);
    assert_eq!(solver.unify(expanded,concrete,source).unwrap(),Relation::Needs);
    assert!(solver.needs().iter().any(|need|need.code=="NeedsSemanticArgumentArity"));
}

#[test]
fn review_unused_signature_types_are_validated_as_a_complete_header_closure() {
    let missing=reference("Generic");
    for invalid in [missing.clone(),json!({"tag":"sequence","item":missing}),
        json!({"tag":"function","params":[reference("Generic")],"returns":scalar("bool"),"effects":[]})] {
        let result=resolve(json!({"Generic":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"param","name":"T"}}},
            "Good":definition(scalar("bool")),"GoodAlias":definition(reference("Good")),
            "G":function(json!([parameter("unused",reference("GoodAlias"))]),Some(scalar("bool")),literal("bool",json!(true))),
            "F":function(json!([parameter("unused",invalid)]),Some(scalar("bool")),literal("bool",json!(true)))}));
        assert!(result.problems.iter().any(|p|p.diagnostic.code=="TypeArity"&&p.diagnostic.path.contains("/parameters/0")),"{:?}",result.problems);
        assert_eq!(signature(&result,"F").state,SignatureState::Rejected);
        assert_eq!(signature(&result,"G").state,SignatureState::TypeReady);
        assert!(signature(&result,"G").body_type_checked);
    }
    let result=resolve(json!({"Generic":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"param","name":"T"}}},
        "F":function(json!([]),Some(reference("Generic")),literal("bool",json!(true)))}));
    assert!(result.problems.iter().any(|p|p.diagnostic.code=="TypeArity"));
    assert_eq!(signature(&result,"F").state,SignatureState::Rejected);
    let result=resolve(json!({"D":{"kind":"req:composite","body":{"parameters":{},"terms":[]}},
        "F":function(json!([parameter("unused",reference("D"))]),Some(scalar("bool")),literal("bool",json!(true)))}));
    assert_ne!(signature(&result,"F").state,SignatureState::TypeReady);
    assert!(!signature(&result,"F").body_type_checked);
    assert!(result.needs.iter().any(|n|n.code=="NeedsProfessionalTypeQualification"));
    for invalid in [json!({"tag":"param","name":"r"}),json!({"tag":"nominal","ref":"local:Generic","args":[{"tag":"param","name":"r"}]})] {
        let mut f=function(json!([parameter("unused",invalid)]),Some(scalar("bool")),literal("bool",json!(true)));
        f["body"]["typeParams"]=json!([{"name":"r","kind":"Region"}]);
        let result=resolve(json!({"Generic":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"param","name":"T"}}},"F":f}));
        assert!(result.problems.iter().any(|p|p.diagnostic.code=="TypeKindMismatch"),"{:?}",result.problems);
    }
}

#[test]
fn review_field_errors_distinguish_known_invalid_nominal_projection_and_unknown_receiver() {
    let result=resolve(json!({"Bad":function(json!([parameter("x",scalar("bool"))]),None,json!({"op":"field","record":variable("x"),"name":"field"})),
        "R":definition(json!({"tag":"record","fields":{"field":{"type":scalar("bool")}}})),
        "Nominal":function(json!([parameter("x",reference("R"))]),None,json!({"op":"field","record":variable("x"),"name":"field"})),
        "Unknown":constant(json!({"op":"lambda","params":[{"name":"x"}],"body":{"op":"field","record":variable("x"),"name":"field"}}))}));
    assert!(result.problems.iter().any(|p|p.diagnostic.code=="InvalidFieldReceiver"&&p.diagnostic.path.starts_with("/definitions/Bad/")));
    assert!(result.needs.iter().any(|n|n.code=="NeedsNominalFieldProjection"));
    assert!(result.needs.iter().any(|n|n.code=="AnnotationRequiredField"));
}

#[test]
fn review_generic_declaration_values_are_single_monomorphic_instances() {
    let mut identity=function(json!([parameter("x",json!({"tag":"param","name":"T"}))]),Some(json!({"tag":"param","name":"T"})),variable("x"));
    identity["body"]["typeParams"]=json!([{"name":"T"}]);
    let result=resolve(json!({"Id":identity.clone(),"K":constant(symbol("Id")),
        "I":constant(call("K",json!([literal("int",json!("1"))]))),
        "B":constant(call("K",json!([literal("bool",json!(true))])))}));
    assert_eq!(signature(&result,"K").state,SignatureState::NeedsAnnotation);
    assert_ne!(signature(&result,"I").state,SignatureState::TypeReady);
    assert_ne!(signature(&result,"B").state,SignatureState::TypeReady);
    let annotated=json!({"kind":"core:constant","body":{"type":{"tag":"function","params":[scalar("bool")],"returns":scalar("bool"),"effects":[]},"value":symbol("Id")}});
    let result=resolve(json!({"Id":identity,"K":annotated,"B":constant(call("K",json!([literal("bool",json!(true))])))}));
    assert!(result.problems.is_empty(),"{:?}",result.problems);
    assert!(is_scalar(result_type(&result,"B"),"bool"));
}

#[test]
fn review_nested_meta_keeps_rigids_bound_on_the_path_and_probe_restores_scope() {
    let mut collection=header_seeds::collect(&bytes(json!({"D":{"kind":"core:type","body":{"typeParams":[{"name":"T"}],"type":{"tag":"param","name":"T"}}}}))).unwrap();
    let source=collection.headers[0].source;
    let rigid=collection.types.binders[0].id;
    let t=collection.types.at(collection.names.root,"/definitions/D/body/type").unwrap();
    let mut solver=ConstraintMachine::new(&mut collection.types,10000,2_000_000);
    let beta=solver.fresh(SemanticKind::Type,BTreeSet::from([rigid])).unwrap();
    let alpha=solver.fresh(SemanticKind::Type,BTreeSet::new()).unwrap();
    let mut function=match function_type(vec![t],beta){SemanticType::Function(f)=>f,_=>unreachable!()};
    function.binders=vec![rigid];
    let quantified=solver.insert(SemanticType::Function(function)).unwrap();
    assert_eq!(solver.probe(|s|{
        s.unify(alpha,quantified,source)?;
        s.unify(beta,t,source)
    }).unwrap(),Relation::Equal);
    assert!(solver.unresolved(alpha).unwrap());
    assert!(solver.unresolved(beta).unwrap());
    assert_eq!(solver.unify(alpha,t,source).unwrap_err().code,"TypeScopeEscape");
    assert_eq!(solver.unify(alpha,quantified,source).unwrap(),Relation::Equal);
    assert_eq!(solver.unify(beta,t,source).unwrap(),Relation::Equal);
}

#[test]
fn review_owned_type_names_are_charged_before_each_instantiation_copy() {
    let key="k".repeat(16*1024);
    let mut fields=serde_json::Map::new();fields.insert(key,json!({"type":{"tag":"param","name":"T"}}));
    let maker=function(json!([]),Some(json!({"tag":"record","fields":fields})),json!({"op":"record","fields":[]}));
    let mut maker=maker;maker["body"]["typeParams"]=json!([{"name":"T"}]);
    let mut collection=header_seeds::collect(&bytes(json!({"Make":maker}))).unwrap();
    let header=&collection.headers[0];
    let (binders,returns)=match &header.kind {
        header_seeds::HeaderKind::Function{binders,returns:header_seeds::TypeRequest::Explicit(returns),..}=>(binders.clone(),*returns),_=>panic!(),
    };
    let mut function=match function_type(vec![],returns){SemanticType::Function(f)=>f,_=>unreachable!()};function.binders=binders;
    let mut solver=ConstraintMachine::new(&mut collection.types,1_000_000,64*1024);
    let mut exhausted=false;
    for _ in 0..5 {
        match solver.instantiate(function.clone(),BTreeSet::new(),header.source) {
            Err(error)=>{assert_eq!(error.code,"ResourceLimit");exhausted=true;break;},
            Ok(Some(_))=>{},Ok(None)=>panic!("This source uses only Type substitution"),
        }
    }
    assert!(exhausted,"Five retained 16 KiB record keys exceeded the 64 KiB allocation budget");
}
