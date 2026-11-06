use std::{collections::BTreeMap, path::PathBuf, process::Command, sync::OnceLock};
use gift_author_kernel::{expansion::Expansion, grammar, reader::{self,Reader}, source::{self,Node,SourceJson}};
use serde_json::{json,Value};

fn root()->PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }
fn engine()->&'static Reader { static R:OnceLock<Reader>=OnceLock::new(); R.get_or_init(||Reader::new().unwrap()) }
fn vectors(name:&str)->Value { serde_json::from_slice(&std::fs::read(root().join("examples/第一层作者/names-and-roots").join(name)).unwrap()).unwrap() }

#[test]
fn graph_matches_original_independent_producer() {
    let code=r#"import json,pathlib,sys
sys.path.insert(0,'tools/documentation')
from codec_parameters import build_graph,MANIFEST
p=pathlib.Path(MANIFEST)
m=json.loads(p.read_bytes())
paths=[MANIFEST]+[x['path'] for x in m['resources']+m['externals']]
print(json.dumps(build_graph({p:pathlib.Path(p).read_bytes() for p in paths}),ensure_ascii=True))
"#;
    let output=Command::new("python").args(["-B","-c",code]).current_dir(root()).output().unwrap();
    assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
    let expected:BTreeMap<String,Value>=serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(engine().graph(),&expected);
}

#[test]
fn existing_independent_short_equations_and_complete_shape_expectations() {
    let expander=Expansion::new(engine().graph(),None).unwrap();
    let mut accepted=0;let mut rejected=0;
    for case in vectors("codec-cases.json")["cases"].as_array().unwrap() {
        let input=Node::from_value(&case["input"]);
        let actual=expander.expand(case["slot"].as_str().unwrap(),&input);
        if case["expectedExpansionError"]==true { assert!(actual.is_err(),"{}",case["name"]);rejected+=1;continue; }
        let actual=actual.unwrap_or_else(|e|panic!("{}: {e:?}",case["name"]));
        assert_eq!(actual.to_value(),case["expectedExpanded"],"{}",case["name"]);
        assert_eq!(engine().validator(case["schema"].as_str().unwrap()).unwrap().is_valid(&actual),case["expectedValid"].as_bool().unwrap(),"{}",case["name"]);
        assert_eq!(input.to_value(),case["input"]);accepted+=1;
    }
    assert!(accepted>0&&rejected>0);eprintln!("independent codec equations: {accepted} structural cases, {rejected} expansion rejections");
}

#[test]
fn complete_candidate_and_project_boundaries_use_original_vectors() {
    let mut selected=0;let mut outside=0;let mut full=0;
    for file in ["complete-base-cases.json","schema-cases.json","developer-surface-cases.json"] {
        for case in vectors(file)["cases"].as_array().unwrap() {
            let schema=case["schema"].as_str().unwrap();
            if !engine().graph().contains_key(schema.split('#').next().unwrap()) { outside+=1;continue; }
            let value=Node::from_value(&case["value"]);
            let expected=case["expected"].as_bool().unwrap();
            assert_eq!(engine().validator(schema).unwrap().is_valid(&value),expected,"{file}: {}",case["name"]);
            if [grammar::MODULE,grammar::PROJECT].contains(&schema) {
                assert_eq!(engine().read(&serde_json::to_vec(&case["value"]).unwrap()).is_ok(),expected,"Reader {file}: {}",case["name"]);full+=1;
            }
            selected+=1;
        }
    }
    assert!(selected>0&&full>0);eprintln!("complete candidate vectors: {selected}, full Reader cases: {full}, outside selected grammar: {outside}");
}

#[test]
fn original_lexical_contracts_are_qualified_without_guessing_moved_pointers() {
    let resources:BTreeMap<String,Value>=grammar::CAPTURE.iter().filter(|(p,_)|*p!=grammar::MANIFEST).map(|(_,bytes)| {
        let v:Value=serde_json::from_slice(bytes).unwrap();(v["$id"].as_str().unwrap().to_owned(),v)
    }).collect();
    let registry=jsonschema::Registry::new().extend(resources.iter().map(|(k,v)|(k,v.clone()))).unwrap().prepare().unwrap();
    let mut checked=0;
    for family in vectors("lexical-boundary-cases.json")["families"].as_array().unwrap() {
        for contract in family["contracts"].as_array().unwrap() {
            let (base,fragment)=contract.as_str().unwrap().split_once('#').unwrap_or((contract.as_str().unwrap(),""));
            if !resources.contains_key(base) { continue; }
            let schema=if fragment.is_empty() { base.to_owned() } else { format!("{base}#{fragment}") };
            let validator=jsonschema::options_for::<SourceJson>().with_registry(&registry).build(&json!({"$ref":schema})).unwrap();
            for (values,expected) in [(&family["valid"],true),(&family["invalid"],false)] {
                for value in values.as_array().unwrap() {
                    assert_eq!(validator.is_valid(&Node::from_value(value)),expected,"{} {schema}: {value}",family["name"]);checked+=1;
                }
            }
        }
    }
    assert!(checked>0);eprintln!("exact lexical contract cases: {checked}");
}

#[test]
fn custom_representation_obeys_library_conformance_contract() {
    let root=Node::from_value(&jsonschema::json::conformance::document());
    jsonschema::json::conformance::assert_conformance::<SourceJson>(&&root);
}

#[test]
fn raw_source_preserves_occurrences_unicode_numbers_and_absence() {
    let bytes=" {\"空/~\": [1.2300e+02, 90071992547409931234567890123456789, null], \"é\":{},\"é\":{},\"\":true}\r\n".as_bytes();
    let document=source::decode(bytes).unwrap();
    let a=document.get("空/~").unwrap().as_array().unwrap();
    for (node,expected) in a.iter().zip(["1.2300e+02","90071992547409931234567890123456789","null"]) {
        let origin=node.origin().unwrap();assert_eq!(&bytes[origin.start..origin.end],expected.as_bytes());
    }
    assert_eq!(a[0].origin().unwrap().pointer,"/空~1~0/0");
    assert!(document.get("missing").is_none());assert!(document.get("").is_some());
    assert_ne!(document.get("é").unwrap().identity(),document.get("é").unwrap().identity());
    for invalid in [br#"{"a":1,"\u0061":2}"#.as_slice(),br#"{"x":"\ud800"}"#,br#"{"\udfff":0}"#,b"[NaN]",b"[1,]",b"{} {}",b"\xff"] {
        assert!(source::decode(invalid).is_err(),"{invalid:?}");
    }
}

#[test]
fn exact_numbers_do_not_narrow_through_f64() {
    for (bound,below,equal,above) in [("9007199254740991","9007199254740990.9999","9007199254740991.0","9007199254740991.0001"),("-9007199254740991","-9007199254740991.0001","-9007199254740991.0","-9007199254740990.9999"),("0","-1e-400","0.0","1e-400")] {
        for (keyword,expected) in [("minimum",[false,true,true]),("maximum",[true,true,false]),("exclusiveMinimum",[false,false,true]),("exclusiveMaximum",[true,false,false])] {
            let schema:Value=serde_json::from_str(&format!("{{\"type\":\"number\",\"{keyword}\":{bound}}}")).unwrap();
            grammar::qualify_numeric_constraints("test:qualified",&schema).unwrap();
            let validator=jsonschema::options_for::<SourceJson>().build(&schema).unwrap();
            for (number,expected) in [below,equal,above].into_iter().zip(expected) {
                assert_eq!(validator.is_valid(&source::decode(number.as_bytes()).unwrap()),expected,"{keyword} {bound} {number}");
            }
        }
    }
}

#[test]
fn unsafe_numeric_schema_is_refused_before_known_upstream_defect() {
    let schema:Value=serde_json::from_str(r#"{"type":"integer","minimum":9007199254740993,"maximum":9007199254740993}"#).unwrap();
    assert_eq!(grammar::qualify_numeric_constraints("test:unqualified",&schema).unwrap_err().code,"GrammarCapabilityUnsupported");
    // Retained upstream reproducer: this mathematically equal input SHOULD pass,
    // but the pinned engine fails; the production grammar never receives this capability.
    let unchecked=jsonschema::options_for::<SourceJson>().build(&schema).unwrap();
    assert!(!unchecked.is_valid(&source::decode(b"9007199254740993.0").unwrap()));
    for schema in [json!({"multipleOf":2}),json!({"minimum":0.5}),json!({"maximum":-9007199254740993i64})] {
        assert_eq!(grammar::qualify_numeric_constraints("test:unqualified",&schema).unwrap_err().code,"GrammarCapabilityUnsupported");
    }
    grammar::qualify_numeric_constraints("test:data",&json!({"const":{"minimum":9007199254740993u64}})).unwrap();
    for raw in [b"1e999999999".as_slice(),b"1e-999999999",b"1e9999999999999999999999"] {
        assert_eq!(source::decode(raw).unwrap_err().code,"ResourceLimit");
    }
}

#[test]
fn exact_numeric_equality_and_unique_items_remain_qualified() {
    for keyword in ["const","enum"] {
        let constant:Value=serde_json::from_str("9007199254740993").unwrap();
        let schema=if keyword=="const" { json!({"const":constant}) } else { json!({"enum":[constant]}) };
        let validator=jsonschema::options_for::<SourceJson>().build(&schema).unwrap();
        assert!(validator.is_valid(&source::decode(b"9007199254740993.0").unwrap()));
        assert!(!validator.is_valid(&source::decode(b"9007199254740992").unwrap()));
    }
    let validator=jsonschema::options_for::<SourceJson>().build(&json!({"uniqueItems":true})).unwrap();
    for padding in ["",",0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"] {
        assert!(!validator.is_valid(&source::decode(format!("[9007199254740993,9007199254740993.0{padding}]").as_bytes()).unwrap()));
        assert!(validator.is_valid(&source::decode(format!("[9007199254740992,9007199254740993.0{padding}]").as_bytes()).unwrap()));
    }
}

#[test]
fn iff_reuses_original_operands_without_merging_distinct_occurrences() {
    let source=source::decode(br#"{"iff":[{"all":[]},{"all":[]}]}"#).unwrap();
    let expanded=Expansion::new(engine().graph(),None).unwrap().expand("formula",&source).unwrap();
    let items=expanded.get("items").unwrap().as_array().unwrap();
    let left=items[0].get("if").unwrap();let right=items[0].get("then").unwrap();
    assert_eq!(left.identity(),items[1].get("then").unwrap().identity());
    assert_eq!(right.identity(),items[1].get("if").unwrap().identity());
    assert_ne!(left.identity(),right.identity());
    assert_ne!(left.origin(),right.origin());
}

#[test]
fn actual_reader_preserves_source_and_distinguishes_stage_and_formats() {
    let value=json!({"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"":{"req:enum-value":{},"name":"展示"}},"exports":[""]});
    let bytes=serde_json::to_vec(&value).unwrap();let decoded=reader::read(&bytes).unwrap();
    assert_eq!(decoded.bytes(),bytes);assert_eq!(decoded.source().to_value(),value);
    let output=decoded.output().unwrap();assert_eq!(output.stage,"structural");assert_eq!(output.schema,"gift.author-read/1");
    assert!(output.nodes.len()>0);assert!(output.source_root<output.nodes.len()&&output.expanded_root<output.nodes.len());
    for marker in ["gift.author-module/2","gift.author-module/compact-design-draft","gift.project/2"] {
        let mut old=value.clone();old["schema"]=json!(marker);
        assert_eq!(reader::read(&serde_json::to_vec(&old).unwrap()).err().unwrap().code,"UnsupportedAuthorSchema");
    }
}

#[test]
fn long_legal_annotation_keys_cannot_amplify_retained_source_paths() {
    let mut annotations=serde_json::Map::new();
    annotations.insert("a".repeat(1_048_576),json!(vec![true;10_000]));
    let value=json!({"schema":"gift.author-module/design-converged","moduleId":"m","definitions":{"C":{"req:enum-value":{}}},"annotations":annotations});
    let bytes=serde_json::to_vec(&value).unwrap();
    assert!(bytes.len()<gift_author_kernel::MAX_SOURCE_BYTES);
    assert_eq!(source::decode(&bytes).unwrap_err().code,"ResourceLimit");
    // A short key preserves the same legal annotation values and normal pointers.
    let mut small=value;small["annotations"]=json!({"/~空":[true,false]});
    let decoded=reader::read(&serde_json::to_vec(&small).unwrap()).unwrap();
    assert_eq!(decoded.source().get("annotations").unwrap().get("/~空").unwrap().as_array().unwrap()[1].origin().unwrap().pointer,"/annotations/~1~0空/1");
    assert!(decoded.output().is_ok());
}

#[test]
fn grammar_drift_and_external_retrieval_are_rejected() {
    let mut captured:Vec<(&str,&[u8])>=grammar::CAPTURE.to_vec();
    captured.retain(|(path,_)|*path!="schema/source/project-converged.schema.json");
    assert_eq!(grammar::rebuild(&captured).unwrap_err().code,"GrammarDrift");
    assert!(engine().validator("https://example.invalid/unbound.json").is_err());
    assert!(engine().validator("file:///outside-capture.json").is_err());
}
