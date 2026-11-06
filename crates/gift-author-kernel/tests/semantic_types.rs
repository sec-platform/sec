use gift_author_kernel::{binding::{self, ImportBinding, Resolution}, header_seeds::{self, EffectRequest, HeaderCollection, HeaderKind, Representation, TypeRequest},
    reader, semantic_types::{Capture, ConstructorTerm, EffectAtom, SemanticArgument, SemanticKind, SemanticType, SubjectRole}};
use serde_json::{Value,json};

fn module(definitions: Value)->Value {json!({"schema":"gift.author-module/design-converged","moduleId":"types:test","definitions":definitions})}
fn collect(definitions: Value)->HeaderCollection {header_seeds::collect(&serde_json::to_vec(&module(definitions)).unwrap()).unwrap()}
fn scalar(name:&str)->Value {json!({"tag":"scalar","name":name})}
fn definition(ty:Value)->Value {json!({"kind":"core:type","body":{"type":ty}})}
fn literal()->Value {json!({"op":"literal","type":scalar("int"),"value":"1"})}
fn ty<'a>(collection:&'a HeaderCollection,path:&str)->&'a SemanticType {
    collection.types.get(collection.types.at(collection.names.root,path).unwrap_or_else(||panic!("Missing type {path}")))
}
fn header<'a>(collection:&'a HeaderCollection,name:&str)->&'a HeaderKind {
    &collection.headers.iter().find(|header|collection.names.declarations[header.declaration.index()].name==name).unwrap().kind
}
fn design(type_params:Value,parameters:Value)->Value {
    json!({"kind":"req:composite","body":{"typeParams":type_params,"parameters":parameters,"terms":[]}})
}

#[test]
fn both_codecs_form_the_same_exact_scalar_model_with_separate_sources() {
    let input=module(json!({"Int":definition(scalar("int")),"Bool":definition(scalar("bool")),
        "Design":design(json!([]),json!({"n":{"role":"value","type":{"core":"Int"}},"b":{"role":"value","type":{"core":"Bool"}}}))}));
    let bytes=serde_json::to_vec(&input).unwrap();
    let result=header_seeds::collect(&bytes).unwrap();
    let candidate=result.types.at(result.names.root,"/definitions/Int/body/type").unwrap();
    let common=result.types.at(result.names.root,"/definitions/Design/body/parameters/n/type").unwrap();
    assert_eq!(candidate,common);
    assert!(matches!(result.types.get(candidate),SemanticType::Scalar(scalar) if scalar.name=="int" && scalar.bits.is_none()));
    let sources:Vec<_>=result.types.occurrences.iter().filter(|item|item.ty==candidate).map(|item|&result.types.source(item.source).expanded_path).collect();
    assert!(sources.contains(&&"/definitions/Int/body/type".to_owned()));
    assert!(sources.contains(&&"/definitions/Design/body/parameters/n/type".to_owned()));
    assert_eq!(serde_json::to_value(&result.names).unwrap(),serde_json::to_value(binding::analyze(&bytes).unwrap()).unwrap());
    assert!(matches!(header(&result,"Design"),HeaderKind::Uninterpreted{need:"NeedsProfessionalHeaderInterpretation",..}));
}

#[test]
fn scalar_attributes_and_equivalent_safe_integer_control_tokens_are_lossless() {
    for token in ["8","8.0","8e0","9007199254740991.0"] {
        let raw=r#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"T":{"kind":"core:type","body":{"type":{"tag":"scalar","name":"int","bits":TOKEN,"scale":0e0,"overflow":"checked"}}}}}"#.replace("TOKEN",token);
        let result=header_seeds::collect(raw.as_bytes()).unwrap();
        let expected=if token.starts_with('9'){9_007_199_254_740_991}else{8};
        assert!(matches!(ty(&result,"/definitions/T/body/type"),SemanticType::Scalar(value) if value.bits==Some(expected)&&value.scale==Some(0)&&value.overflow.as_deref()==Some("checked")));
        let source=result.types.sources.iter().find(|source|source.expanded_path=="/definitions/T/body/type").unwrap();
        let origin=source.syntax.get("bits").unwrap().origin().unwrap();
        assert_eq!(&raw[origin.start..origin.end],token);
    }
    for token in ["8.00000000000000000001","9007199254740992","9007199254740991.000000000000000001"] {
        let raw=r#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"T":{"kind":"core:type","body":{"type":{"tag":"scalar","name":"int","bits":TOKEN}}}}}"#.replace("TOKEN",token);
        assert_eq!(header_seeds::collect(raw.as_bytes()).unwrap_err().code,"InvalidAuthorSource");
    }
    let result=collect(json!({"Text":definition(json!({"tag":"scalar","name":"text","textIndex":"grapheme"})),
        "Float":definition(json!({"tag":"scalar","name":"float","bits":64,"rounding":"ties-even","nanPolicy":"preserve-payload"})),
        "Bytes":definition(json!({"tag":"scalar","name":"bytes","encoding":"base64"})),
        "Time":definition(json!({"tag":"scalar","name":"timestamp","clockRef":"clock:monotonic"}))}));
    assert!(matches!(ty(&result,"/definitions/Text/body/type"),SemanticType::Scalar(value) if value.text_index.as_deref()==Some("grapheme")));
    assert!(matches!(ty(&result,"/definitions/Float/body/type"),SemanticType::Scalar(value) if value.bits==Some(64)&&value.rounding.as_deref()==Some("ties-even")&&value.nan_policy.as_deref()==Some("preserve-payload")));
    assert!(matches!(ty(&result,"/definitions/Bytes/body/type"),SemanticType::Scalar(value) if value.encoding.as_deref()==Some("base64")));
    assert!(matches!(ty(&result,"/definitions/Time/body/type"),SemanticType::Scalar(value) if value.clock_ref.as_deref()==Some("clock:monotonic")));
}

#[test]
fn declaration_seeds_distinguish_alias_nominal_record_variant_and_hidden_representation() {
    let result=collect(json!({"Record":{"kind":"core:type","body":{"type":{"tag":"record","fields":{"next":{"type":{"tag":"option","inner":{"tag":"nominal","ref":"local:Record"}}}}},"opaque":true}},
        "Variant":definition(json!({"tag":"variant","cases":{"A":scalar("unit"),"B":scalar("bool")}})),
        "Alias":definition(json!({"tag":"nominal","ref":"local:Record"})),
        "CycleA":definition(json!({"tag":"nominal","ref":"local:CycleB"})),"CycleB":definition(json!({"tag":"nominal","ref":"local:CycleA"})),
        "OpaqueType":definition(json!({"tag":"opaque","interfaceRef":"local:Alias"}))}));
    assert!(matches!(header(&result,"Record"),HeaderKind::Type{representation:Representation::NominalRecord,opaque:Some(true),..}));
    assert!(matches!(header(&result,"Variant"),HeaderKind::Type{representation:Representation::NominalVariant,..}));
    assert!(matches!(header(&result,"Alias"),HeaderKind::Type{representation:Representation::Alias,..}));
    assert!(matches!(ty(&result,"/definitions/OpaqueType/body/type"),SemanticType::Opaque{..}));
    let SemanticType::Declaration{target,..}=ty(&result,"/definitions/Alias/body/type") else {panic!()};
    assert_eq!(result.names.declarations[target.declaration.unwrap().index()].name,"Record");
    assert!(matches!(result.names.references[target.reference.index()].resolution,Resolution::Resolved{..}));
    assert!(result.types.nodes.len()<20);
    assert_eq!(result.headers.len(),6);
}

#[test]
fn records_rows_flags_and_collection_families_keep_their_full_shape() {
    let result=collect(json!({"R":{"kind":"core:type","body":{"typeParams":[{"name":"Row"}],"type":{"tag":"record","fields":{
        "field":{"type":scalar("text"),"optional":true,"mutable":true}},"open":true,"rowType":{"tag":"param","name":"Row"}}}},
        "Tuple":definition(json!({"tag":"tuple","items":[scalar("bool"),{"tag":"option","inner":scalar("int")},{"tag":"result","ok":scalar("text"),"error":scalar("unit")}]})),
        "Seq":definition(json!({"tag":"sequence","item":scalar("int")})),
        "Set":definition(json!({"tag":"set","item":scalar("int"),"equalityRef":"local:Eq"})),
        "Bag":definition(json!({"tag":"bag","item":scalar("int"),"equalityRef":"local:Eq"})),
        "Map":definition(json!({"tag":"map","key":scalar("text"),"value":scalar("int"),"keyEqualityRef":"local:Eq"})),
        "Design":design(json!([]),json!({"record":{"role":"value","type":{"record":[{"name":"f","type":{"core":"Int"},"optional":false,"mutable":false}]}},
            "list":{"role":"value","type":{"core":"List","arguments":[{"core":"Int"}]}}}))}));
    let SemanticType::Record{fields,open,row}=ty(&result,"/definitions/R/body/type") else {panic!()};
    assert_eq!(*open,Some(true)); assert!(row.is_some());
    assert_eq!(fields["field"].optional,Some(true)); assert_eq!(fields["field"].mutable,Some(true));
    let SemanticType::Parameter(usage)=result.types.get(row.unwrap()) else {panic!()};
    assert_eq!(result.names.lexical.bindings[usage.binder.unwrap().index()].name,"Row");
    assert!(matches!(ty(&result,"/definitions/Tuple/body/type"),SemanticType::Tuple(items) if items.len()==3));
    assert!(matches!(ty(&result,"/definitions/Seq/body/type"),SemanticType::Sequence{ordered:true,..}));
    assert!(matches!(ty(&result,"/definitions/Set/body/type"),SemanticType::Set{equality:Some(_),..}));
    assert!(matches!(ty(&result,"/definitions/Bag/body/type"),SemanticType::Bag{equality:Some(_),..}));
    assert!(matches!(ty(&result,"/definitions/Map/body/type"),SemanticType::Map{equality:Some(_),..}));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/list/type"),SemanticType::List(_)));
}

#[test]
fn function_types_and_callable_seeds_keep_binders_effect_atoms_captures_and_inference_requests() {
    let function_type=json!({"tag":"function","typeParams":[{"name":"r","kind":"Region"}],"params":[scalar("int")],"returns":scalar("bool"),
        "effects":{"members":[{"class":"raise","errorType":scalar("text"),"portRef":"local:Port","resourceRef":"local:Resource","scopeRef":"operation:scope"}],"tail":{"parameter":"Fx"}},
        "captures":[{"region":{"parameter":"r"}}],"callMode":"consume","parameterContracts":[{"position":0.0,"retention":"noescape"}]});
    let result=collect(json!({"F":{"kind":"core:type","body":{"typeParams":[{"name":"Fx","kind":"EffectRow"}],"type":function_type}},
        "Explicit":{"kind":"core:function","body":{"parameters":[{"name":"x","type":scalar("int"),"mode":"borrow"}],"returns":scalar("int"),"effects":[],"contract":{"ensures":["local:P"]},"body":{"op":"var","name":"x"}}},
        "Infer":{"kind":"core:function","body":{"parameters":[],"body":literal()}},
        "K":{"kind":"core:constant","body":{"value":literal()}},
        "Design":design(json!([]),json!({"callback":{"role":"value","type":{"function":{"parameters":[],"returns":{"core":"Unit"}}}}}))}));
    let SemanticType::Function(function)=ty(&result,"/definitions/F/body/type") else {panic!()};
    assert_eq!(function.binders.len(),1); assert_eq!(function.call_mode.as_deref(),Some("consume"));
    assert_eq!(function.parameter_contracts.as_ref().unwrap()[0].position,0);
    assert!(matches!(&function.captures.as_ref().unwrap()[0],Capture::Region(usage) if usage.binder.is_some()));
    let effects=function.effects.as_ref().unwrap(); assert!(effects.tail.as_ref().unwrap().binder.is_some());
    assert!(matches!(&effects.members[0],EffectAtom::Structured{class,error:Some(_),port:Some(_),resource:Some(_),scope_ref:Some(scope)} if class=="raise"&&scope=="operation:scope"));
    assert!(matches!(header(&result,"Explicit"),HeaderKind::Function{returns:TypeRequest::Explicit(_),effects:EffectRequest::Explicit(_),contract:Some(_),parameters,..} if parameters[0].mode.as_deref()==Some("borrow")));
    assert!(matches!(header(&result,"Infer"),HeaderKind::Function{returns:TypeRequest::InferFromBody(_),effects:EffectRequest::InferFromBody(_),..}));
    assert!(matches!(header(&result,"K"),HeaderKind::Constant{expected:TypeRequest::InferFromInitializer(_),..}));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/callback/type"),SemanticType::Function(function) if function.effects.is_none()));
}

#[test]
fn constructor_kinds_packs_exists_and_static_arguments_remain_typed_and_pending() {
    let result=collect(json!({"Base":definition(scalar("int")),"Generic":{"kind":"core:type","body":{"typeParams":[
        {"name":"T","constraintRefs":["local:Base"],"traitBounds":[{"traitRef":"local:Base","selfType":{"tag":"param","name":"T"},"associatedTypes":{"Item":scalar("bool")}}]},
        {"name":"N","kind":{"value":{"tag":"param","name":"T"}}},{"name":"r","kind":"Region"},{"name":"s","kind":"Scope"},{"name":"Fx","kind":"EffectRow"},
        {"name":"F","kind":{"constructor":{"parameters":["Type"],"result":"Type"}}},{"name":"Ts","kind":{"pack":"Type"}}
    ],"type":{"tag":"function","typeParams":[],"params":[
        {"tag":"apply","constructor":{"parameter":"F"},"arguments":[{"tag":"param","name":"T"},{"value":{"op":"var","name":"N"}},
            {"region":{"parameter":"r"}},{"scope":{"parameter":"s"}},{"effectRow":{"members":[],"tail":{"parameter":"Fx"}}},
            {"typeConstructor":{"apply":{"constructor":{"parameter":"F"},"arguments":[scalar("bool")]}}},
            {"pack":{"concat":[[{"tag":"param","name":"T"}],{"parameter":"Ts"}]}},
            {"packElement":{"pack":{"parameter":"Ts"},"index":literal()}}]},
        {"packElement":{"pack":{"parameter":"Ts"},"index":literal()}},
        {"expand":{"parameter":"Ts"}},
        {"tag":"exists","parameters":[{"name":"hidden","kind":"Scope","binding":"fresh"}],"type":{"tag":"apply","constructor":{"decl":"local:Base"},"arguments":[{"scope":{"parameter":"hidden"}}]}}
    ],"returns":scalar("int"),"effects":[]}}}}));
    let SemanticType::Function(function)=ty(&result,"/definitions/Generic/body/type") else {panic!()};
    let items=&function.parameters;
    assert!(matches!(&items[2],SemanticArgument::Expand(_)));
    let SemanticType::Apply{constructor,arguments}=ty(&result,"/definitions/Generic/body/type/params/0") else {panic!()};
    assert!(matches!(constructor,ConstructorTerm::Parameter(usage) if usage.binder.is_some()));
    assert_eq!(arguments.len(),8);
    let SemanticArgument::Value(expression)=&arguments[1] else {panic!()};
    let source=result.types.source(expression.source);
    assert_eq!(source.expanded_path,"/definitions/Generic/body/type/params/0/arguments/1/value");
    assert_eq!(source.syntax.get("op").unwrap().as_str(),Some("var"));
    assert!(result.types.needs.iter().any(|need|need.source==expression.source&&need.code=="NeedsStaticValue"));
    assert!(result.types.binders.iter().any(|binder|matches!(binder.kind,SemanticKind::Value(_))));
    assert!(result.types.binders.iter().any(|binder|matches!(binder.kind,SemanticKind::Constructor(_))));
    assert!(result.types.binders.iter().any(|binder|matches!(binder.kind,SemanticKind::Pack(_))));
    assert!(matches!(ty(&result,"/definitions/Generic/body/type/params/3"),SemanticType::Exists{binders,..} if binders.len()==1));
    let bounded=result.types.binders.iter().find(|binder|result.names.lexical.bindings[binder.binding.unwrap().index()].name=="T").unwrap();
    assert_eq!(bounded.constraints.len(),1); assert_eq!(bounded.trait_bounds.len(),1);
    assert!(bounded.trait_bounds[0].associated.contains_key("Item"));
}

#[test]
fn remaining_families_and_shared_definition_reference_keep_real_declaration_links() {
    let result=collect(json!({"Base":definition(scalar("int")),
        "Handle":definition(json!({"tag":"handle","resourceRef":"local:Base","lifetime":"owned"})),
        "Future":definition(json!({"tag":"future","result":scalar("bool")})),
        "Stream":definition(json!({"tag":"stream","item":scalar("int"),"order":"per-key"})),
        "Quantity":definition(json!({"tag":"quantity","scalar":scalar("decimal"),"unitRef":"unit:kg"})),
        "Refined":definition(json!({"tag":"refinement","base":scalar("int"),"predicateRef":"local:Base"})),
        "Rational":definition(json!({"tag":"rational"})),
        "Wire":definition(json!({"tag":"wire-variant","known":{"a":scalar("bool")},"unknown":"preserve-raw-frame","encoding":"tagged-json-frame","duplicates":"reject-known-preserve-unknown"})),
        "Associated":definition(json!({"tag":"associated","traitRef":"local:Base","selfType":scalar("int"),"traitArguments":[scalar("bool")],"member":"Item"})),
        "Design":design(json!([]),json!({"predicate":{"role":"value","type":{"definition-reference":{"role":"predicate","contractRef":{"definitionId":"Base"},"typeArguments":[{"core":"Int"}]}}},
            "hole":{"role":"value","type":{"hole":{"expected":"type","rawText":"unfinished"}}}}))}));
    assert!(matches!(ty(&result,"/definitions/Handle/body/type"),SemanticType::Handle{lifetime,..} if lifetime=="owned"));
    assert!(matches!(ty(&result,"/definitions/Future/body/type"),SemanticType::Future(_)));
    assert!(matches!(ty(&result,"/definitions/Stream/body/type"),SemanticType::Stream{order,..} if order=="per-key"));
    assert!(matches!(ty(&result,"/definitions/Quantity/body/type"),SemanticType::Quantity{unit_ref,..} if unit_ref=="unit:kg"));
    assert!(matches!(ty(&result,"/definitions/Refined/body/type"),SemanticType::Refinement{..}));
    assert!(matches!(ty(&result,"/definitions/Rational/body/type"),SemanticType::Rational));
    assert!(matches!(ty(&result,"/definitions/Wire/body/type"),SemanticType::WireVariant{known,duplicates,..} if known.len()==1&&duplicates=="reject-known-preserve-unknown"));
    assert!(matches!(ty(&result,"/definitions/Associated/body/type"),SemanticType::Associated{member,arguments,..} if member=="Item"&&arguments.len()==1));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/predicate/type"),SemanticType::DefinitionReference{role,contract,arguments} if role=="predicate"&&contract.declaration.is_some()&&arguments.len()==1));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/hole/type"),SemanticType::Hole{raw_text:Some(text),..} if text=="unfinished"));
}

#[test]
fn subject_schema_roles_use_actual_slots_and_generic_role_obligations() {
    let subject=|name:&str|json!({"decl":{"definitionId":name}});
    let result=collect(json!({"S":{"req:subject":{"roles":{}}},
        "Queue":{"req:subject":{"typeParams":[{"key":"T","name":"T"}],"roles":{"item":{"type":{"parameter":"T"}}}}},
        "Role":{"req:subject":{"roles":{"item":{"type":subject("S")}}}},
        "Rule":{"req:rule":{"strength":"require","semantics":{"source":"independent-test","section":"subject-role","scope":"design"},"fields":{"direct":{"required":true,"meaning":"subject","type":{"kind":"subject","subjectKinds":[subject("S")]}},
            "nested":{"required":true,"meaning":"set subject","type":{"kind":"set","element":{"kind":"set","element":{"kind":"subject","subjectKinds":[subject("S")]}}}},
            "generic":{"required":true,"meaning":"queue","type":{"kind":"subject","subjectKinds":[{"decl":{"definitionId":"Queue"},"arguments":[subject("S")]}]}}},"implementation":"unbound"}},
        "Design":design(json!([]),json!({"subject":{"role":"subject","type":subject("S")},
            "subjects":{"role":"value","type":{"core":"List","arguments":[subject("S")]}}})),
        "Bad":{"kind":"core:function","body":{"parameters":[{"name":"value","type":{"tag":"record","fields":{"subject":{"type":{"tag":"nominal","ref":"local:S"}}}}},
            {"name":"list","type":{"tag":"sequence","item":{"tag":"nominal","ref":"local:S"}}}],"body":literal()}}}));
    assert!(matches!(ty(&result,"/definitions/Rule/body/fields/direct/type/subjectKinds/0"),SemanticType::SubjectSchema{role:SubjectRole::LogicalParameter,..}));
    assert!(matches!(ty(&result,"/definitions/Rule/body/fields/nested/type/element/element/subjectKinds/0"),SemanticType::SubjectSchema{role:SubjectRole::LogicalParameter,..}));
    assert!(matches!(ty(&result,"/definitions/Role/body/roles/item/type"),SemanticType::SubjectSchema{role:SubjectRole::LogicalParameter,..}));
    assert!(matches!(ty(&result,"/definitions/Rule/body/fields/generic/type/subjectKinds/0/arguments/0"),SemanticType::SubjectSchema{role:SubjectRole::DependentArgument,..}));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/subject/type"),SemanticType::SubjectSchema{role:SubjectRole::LogicalParameter,..}));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/subjects/type/arguments/0"),SemanticType::SubjectSchema{role:SubjectRole::FiniteDesignList,..}));
    assert!(result.types.needs.iter().any(|need|need.code=="NeedsSubjectRoleQualification"));
    let rejected:Vec<_>=result.types.problems.iter().filter(|problem|problem.code=="SubjectSchemaOutsideLogicalRole").collect();
    assert_eq!(rejected.len(),2);
    assert!(rejected.iter().all(|problem|result.types.source(problem.source).expanded_path.starts_with("/definitions/Bad/")));
}

#[test]
fn logical_value_parameters_accept_finite_nested_lists_and_original_short_forms() {
    let subject=json!({"decl":{"definitionId":"S"}});
    let result=collect(json!({"S":{"req:subject":{"roles":{}}},
        "Queue":{"req:subject":{"typeParams":[{"key":"T","name":"T"}],"roles":{"item":{"type":{"parameter":"T"}}}}},
        "Design":design(json!([]),json!({
            "nested":{"role":"value","type":{"core":"List","arguments":[{"core":"List","arguments":[subject.clone()]}]}},
            "short":{"role":"value","type":{"list":{"ref":{"definitionId":"S"}}}},
            "mixed":{"role":"value","type":{"list":{"core":"List","arguments":[subject.clone()]}}},
            "generic":{"role":"value","type":{"core":"List","arguments":[{"core":"List","arguments":[{"decl":{"definitionId":"Queue"},"arguments":[subject]}]}]}}
        }))}));
    for path in ["/definitions/Design/body/parameters/nested/type/arguments/0/arguments/0",
        "/definitions/Design/body/parameters/short/type/list",
        "/definitions/Design/body/parameters/mixed/type/list/arguments/0",
        "/definitions/Design/body/parameters/generic/type/arguments/0/arguments/0"] {
        assert!(matches!(ty(&result,path),SemanticType::SubjectSchema{role:SubjectRole::FiniteDesignList,..}),"{path}");
    }
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/generic/type/arguments/0/arguments/0/arguments/0"),
        SemanticType::SubjectSchema{role:SubjectRole::DependentArgument,..}));
    assert!(result.types.problems.is_empty());
    assert!(result.types.needs.iter().any(|issue|issue.code=="NeedsSubjectRoleQualification"));
}

#[test]
fn logical_value_parameters_accept_original_short_list_forms() {
    let result=collect(json!({"S":{"req:subject":{"roles":{}}},"Design":design(json!([]),json!({
        "short":{"role":"value","type":{"list":{"ref":{"definitionId":"S"}}}},
        "nested":{"role":"value","type":{"list":{"list":{"ref":{"definitionId":"S"}}}}}
    }))}));
    for path in ["/definitions/Design/body/parameters/short/type/list","/definitions/Design/body/parameters/nested/type/list/list"] {
        assert!(matches!(ty(&result,path),SemanticType::SubjectSchema{role:SubjectRole::FiniteDesignList,..}),"{path}");
    }
    assert!(result.types.problems.is_empty());
}

#[test]
fn logical_list_permission_does_not_enter_non_list_or_runtime_type_combinations() {
    let subject=json!({"decl":{"definitionId":"S"}});
    let result=collect(json!({"S":{"req:subject":{"roles":{}}},
        "Design":design(json!([]),json!({
            "record":{"role":"value","type":{"record":[{"name":"x","type":{"core":"List","arguments":[subject.clone()]}}]}},
            "option":{"role":"value","type":{"core":"List","arguments":[{"core":"Option","arguments":[subject.clone()]}]}},
            "callback":{"role":"value","type":{"function":{"parameters":[{"core":"List","arguments":[subject.clone()]}],"returns":{"core":"Unit"}}}},
            "result":{"role":"value","type":{"core":"Result","arguments":[{"core":"List","arguments":[subject]},{"core":"Unit"}]}}
        })),
        "Runtime":{"kind":"core:function","body":{"parameters":[{"name":"rows","type":{"tag":"sequence","item":{"tag":"nominal","ref":"local:S"}}}],"body":literal()}}
    }));
    let rejected:Vec<_>=result.types.problems.iter().filter(|problem|problem.code=="SubjectSchemaOutsideLogicalRole").collect();
    assert_eq!(rejected.len(),5);
    for path in ["/definitions/Design/body/parameters/record/type/record/0/type/arguments/0",
        "/definitions/Design/body/parameters/option/type/arguments/0/arguments/0",
        "/definitions/Design/body/parameters/callback/type/function/parameters/0/arguments/0",
        "/definitions/Design/body/parameters/result/type/arguments/0/arguments/0",
        "/definitions/Runtime/body/parameters/0/type/item"] {
        assert!(matches!(ty(&result,path),SemanticType::SubjectSchema{role:SubjectRole::Unqualified,..}),"{path}");
    }
}

#[test]
fn imports_consume_existing_resolution_and_payload_data_stays_outside_type_formation() {
    let mut a=module(json!({"A":definition(json!({"tag":"nominal","ref":{"space":"import","alias":"b","export":"Public"}})),
        "Data":{"kind":"core:constant","body":{"value":{"op":"literal","type":scalar("text"),"value":"type"}}}}));
    a["imports"]=json!({"b":{"mode":"workspace","moduleId":"module:B"}});
    a["annotations"]=json!({"fake":{"tag":"scalar","name":"bool"}});
    let b=json!({"schema":"gift.author-module/design-converged","moduleId":"module:B","definitions":{"Hidden":definition(scalar("bool"))},"exports":{"Public":{"definitionId":"Hidden"}}});
    let sources=[reader::read(&serde_json::to_vec(&a).unwrap()).unwrap(),reader::read(&serde_json::to_vec(&b).unwrap()).unwrap()];
    let result=header_seeds::collect_sources(&sources,&[ImportBinding{from:0,alias:"b".into(),target:1}],0).unwrap();
    let SemanticType::Declaration{target,..}=ty(&result,"/definitions/A/body/type") else {panic!()};
    let target=&result.names.declarations[target.declaration.unwrap().index()];
    assert_eq!(target.name,"Hidden");assert_eq!(target.module.index(),1);
    assert!(result.types.sources.iter().all(|source|!source.expanded_path.starts_with("/annotations")));
    assert_eq!(result.headers.len(),3);
}

#[test]
fn formation_uses_the_existing_budget_and_keeps_missing_capture_as_typed_need() {
    let mut value=module(json!({"T":definition(json!({"tag":"nominal","ref":{"space":"import","alias":"unknown","export":"T"}}))}));
    value["imports"]=json!({"unknown":{"mode":"workspace","moduleId":"uncaptured"}});
    let result=header_seeds::collect(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(result.types.needs.iter().any(|need|need.code=="NeedsModuleCapture"));
    let mut fields=serde_json::Map::new();
    for index in 0..180 {fields.insert(format!("f{index}"),json!({"type":scalar("int")}));}
    let mut declarations=serde_json::Map::new();
    declarations.insert("x".repeat(2000),definition(json!({"tag":"record","fields":fields})));
    let bytes=serde_json::to_vec(&module(Value::Object(declarations))).unwrap();
    let sources=[reader::read(&bytes).unwrap()];
    binding::analyze_sources(&sources,&[],0).expect("The original names stage fits its existing budget");
    let error=header_seeds::collect_sources(&sources,&[],0).err().expect("Formation must spend the remaining shared budget");
    assert_eq!(error.code,"ResourceLimit");
}

#[test]
fn shared_generic_types_kinds_arguments_and_function_defaults_reuse_lexical_ids() {
    let result=collect(json!({"Base":definition(scalar("int")),"Design":design(json!([
        {"key":"t","name":"T"},{"key":"n","name":"N","kind":{"value":{"parameter":"t"}}},
        {"key":"r","name":"r","kind":"Region"},{"key":"fx","name":"Fx","kind":"EffectRow"},
        {"key":"f","name":"F","kind":{"constructor":{"parameters":["Type"],"result":"Type"}}},{"key":"ts","name":"Ts","kind":{"pack":"Type"}}
    ]),json!({"callback":{"role":"value","type":{"function":{
        "typeParams":[{"key":"local-s","name":"s","kind":"Scope"}],
        "parameters":[{"apply":{"constructor":{"parameter":"f"},"arguments":[{"parameter":"t"},{"value":{"tag":"reference","ref":{"binding":"n"}}},
            {"region":{"parameter":"r"}},{"scope":{"parameter":"local-s"}},{"effectRow":{"members":[{"definitionId":"Base"}],"tail":{"parameter":"fx"}}},
            {"typeConstructor":{"decl":{"definitionId":"Base"}}},{"pack":{"concat":[[{"core":"Bool"}],{"parameter":"ts"}]}}]}},
            {"expand":{"parameter":"ts"}}],
        "returns":{"exists":{"parameters":[{"key":"hidden","name":"hidden","kind":"Region","binding":"fresh"}],"type":{"decl":{"definitionId":"Base"},"arguments":[{"region":{"parameter":"hidden"}}]}}},
        "effects":{"members":[],"tail":{"parameter":"fx"}},"captures":[{"scope":{"parameter":"local-s"}}],
        "callMode":"exclusive","parameterContracts":[{"position":0,"retention":"may-retain"}]
    }}},"element":{"role":"value","type":{"packElement":{"pack":{"parameter":"ts"},"index":{"tag":"literal","type":"Int","value":"0"}}}},
        "option":{"role":"value","type":{"core":"Option","arguments":[{"core":"Int"}]}},
        "result":{"role":"value","type":{"core":"Result","arguments":[{"core":"Bool"},{"core":"Text"}]}}}))}));
    let SemanticType::Function(function)=ty(&result,"/definitions/Design/body/parameters/callback/type") else {panic!()};
    assert_eq!(function.call_mode.as_deref(),Some("exclusive"));
    let local=result.types.binders[function.binders[0].index()].binding.unwrap();
    assert_eq!(result.names.lexical.bindings[local.index()].source_key.as_deref(),Some("local-s"));
    assert!(matches!(function.parameters[1],SemanticArgument::Expand(_)));
    assert!(matches!(result.types.get(function.returns),SemanticType::Exists{binders,..} if result.names.lexical.bindings[result.types.binders[binders[0].index()].binding.unwrap().index()].source_key.as_deref()==Some("hidden")));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/element/type"),SemanticType::PackElement{..}));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/option/type"),SemanticType::Option(_)));
    assert!(matches!(ty(&result,"/definitions/Design/body/parameters/result/type"),SemanticType::Result{..}));
    assert!(result.types.needs.iter().any(|need|need.code=="NeedsStaticValue"));
}

#[test]
fn source_defaults_remain_explicit_without_claiming_structural_equality_is_semantic_equality() {
    let result=collect(json!({"A":definition(json!({"tag":"record","fields":{"x":{"type":scalar("int")}}})),
        "B":definition(json!({"tag":"record","fields":{"x":{"type":scalar("int"),"optional":false,"mutable":false}},"open":false})),
        "I":definition(scalar("int")),"Checked":definition(json!({"tag":"scalar","name":"int","overflow":"checked"})),
        "Text":definition(scalar("text")),"ScalarText":definition(json!({"tag":"scalar","name":"text","textIndex":"scalar"}))}));
    let SemanticType::Record{fields:a,open:ao,..}=ty(&result,"/definitions/A/body/type") else {panic!()};
    let SemanticType::Record{fields:b,open:bo,..}=ty(&result,"/definitions/B/body/type") else {panic!()};
    assert_eq!(*ao,None); assert_eq!(*bo,Some(false));
    assert_eq!(a["x"].optional,None);assert_eq!(b["x"].optional,Some(false));
    assert!(matches!(ty(&result,"/definitions/I/body/type"),SemanticType::Scalar(s) if s.bits.is_none()&&s.overflow.is_none()));
    assert!(matches!(ty(&result,"/definitions/Checked/body/type"),SemanticType::Scalar(s) if s.bits.is_none()&&s.overflow.as_deref()==Some("checked")));
    assert!(matches!(ty(&result,"/definitions/Text/body/type"),SemanticType::Scalar(s) if s.text_index.is_none()));
    assert!(matches!(ty(&result,"/definitions/ScalarText/body/type"),SemanticType::Scalar(s) if s.text_index.as_deref()==Some("scalar")));
    assert!(result.names.unchecked.contains(&"types"));
}

#[test]
fn parameter_contract_control_integers_use_the_same_exact_reader_admission() {
    for token in ["8.0","8e0","9007199254740991e0"] {
        let raw=r#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"T":{"kind":"core:type","body":{"type":{"tag":"function","params":[],"returns":{"tag":"scalar","name":"unit"},"effects":[],"parameterContracts":[{"position":TOKEN,"retention":"noescape"}]}}}}}"#.replace("TOKEN",token);
        let result=header_seeds::collect(raw.as_bytes()).unwrap();
        let SemanticType::Function(function)=ty(&result,"/definitions/T/body/type") else {panic!()};
        assert_eq!(function.parameter_contracts.as_ref().unwrap()[0].position,if token.starts_with('9'){9_007_199_254_740_991}else{8});
    }
    for token in ["8.00000000000000000001","9007199254740992e0"] {
        let raw=r#"{"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"T":{"kind":"core:type","body":{"type":{"tag":"function","params":[],"returns":{"tag":"scalar","name":"unit"},"effects":[],"parameterContracts":[{"position":TOKEN,"retention":"noescape"}]}}}}}"#.replace("TOKEN",token);
        assert_eq!(header_seeds::collect(raw.as_bytes()).unwrap_err().code,"InvalidAuthorSource");
    }
}
