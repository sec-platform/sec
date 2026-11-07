//! Production consumer of the existing bounded grammar transformation contract.
//! Inputs are embedded by Cargo from its sole manifest. No runtime source or URL reads.
use std::collections::{BTreeMap, BTreeSet};
use serde_json::Value;
use sha2::{Digest, Sha256};
use crate::model::{Diagnostic, fail};

include!(concat!(env!("OUT_DIR"), "/grammar_capture.rs"));
pub const MANIFEST: &str = "schema/author/first-layer/codec-parameters.json";
pub const MODULE: &str = "urn:gift:design-schema:universal-author-module-2-converged-base";
pub const PROJECT: &str = "urn:gift:design-schema:project-converged";
const MAPS: &[&str] = &["$defs", "definitions", "properties", "patternProperties", "dependentSchemas"];
const SINGLES: &[&str] = &["additionalProperties", "unevaluatedProperties", "propertyNames", "items", "contains", "unevaluatedItems", "not", "if", "then", "else"];
const ARRAYS: &[&str] = &["allOf", "anyOf", "oneOf", "prefixItems"];
type Result<T> = std::result::Result<T, Diagnostic>;

fn drift(message: impl Into<String>) -> Diagnostic { fail("GrammarDrift", "", message) }
fn object(v: &Value) -> Result<&serde_json::Map<String,Value>> { v.as_object().ok_or_else(|| drift("Expected object in grammar parameters")) }
fn array(v: &Value) -> Result<&Vec<Value>> { v.as_array().ok_or_else(|| drift("Expected array in grammar parameters")) }
fn string(v: &Value) -> Result<&str> { v.as_str().ok_or_else(|| drift("Expected string in grammar parameters")) }
fn keys(v: &Value, expected: &[&str]) -> Result<()> {
    let o = object(v)?;
    if o.len() != expected.len() || expected.iter().any(|k| !o.contains_key(*k)) { return Err(drift("Unexpected/missing grammar parameter fields")); }
    Ok(())
}
fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn parse(bytes: &[u8]) -> Result<Value> { crate::source::decode(bytes).map(|node|node.to_value()).map_err(|e|drift(format!("{} at {}: {}",e.code,e.path,e.message))) }

/// The original parameter contract binds sorted, compact, ASCII-escaped JSON.
fn node_digest(value: &Value) -> Result<String> {
    let json = serde_json::to_string(value).map_err(|e| drift(e.to_string()))?;
    let mut ascii = String::new();
    for ch in json.chars() {
        if ch <= '\u{007e}' { ascii.push(ch); }
        else { for unit in ch.encode_utf16(&mut [0;2]) { ascii.push_str(&format!("\\u{unit:04x}")); } }
    }
    Ok(sha(ascii.as_bytes()))
}

fn tokens(pointer: &str) -> Result<Vec<String>> {
    if !pointer.starts_with('/') { return Err(drift("Expected a non-root JSON Pointer")); }
    pointer[1..].split('/').map(|part| {
        let mut chars = part.chars(); let mut result = String::new();
        while let Some(c) = chars.next() {
            if c != '~' { result.push(c); continue; }
            result.push(match chars.next() { Some('0') => '~', Some('1') => '/', _ => return Err(drift("Invalid JSON Pointer escape")) });
        }
        Ok(result)
    }).collect()
}

fn locate<'a>(mut node: &'a Value, parts: &[String]) -> Result<&'a Value> {
    for part in parts {
        node = if let Some(array) = node.as_array() {
            let i = part.parse::<usize>().ok().filter(|i| i.to_string() == *part).ok_or_else(|| drift("Non-canonical array index"))?;
            array.get(i)
        } else { node.as_object().and_then(|v| v.get(part)) }.ok_or_else(|| drift("Grammar pointer target absent"))?;
    }
    Ok(node)
}

fn pointer(parts: &[String]) -> String { parts.iter().fold(String::new(), |p,k| crate::source::pointer(&p,k)) }

fn nodes(node: &Value, path: &mut Vec<String>, result: &mut BTreeSet<Vec<String>>) -> Result<()> {
    if !node.is_object() && !node.is_boolean() { return Err(drift("Schema node must be object or boolean")); }
    result.insert(path.clone());
    if node.is_boolean() { return Ok(()); }
    for key in MAPS {
        if let Some(map) = node.get(*key) {
            for (name,value) in object(map)? { path.extend([(*key).into(), name.clone()]); nodes(value,path,result)?; path.truncate(path.len()-2); }
        }
    }
    for key in SINGLES {
        if let Some(value) = node.get(*key) { path.push((*key).into()); nodes(value,path,result)?; path.pop(); }
    }
    for key in ARRAYS {
        if let Some(values) = node.get(*key) {
            for (i,value) in array(values)?.iter().enumerate() { path.extend([(*key).into(),i.to_string()]); nodes(value,path,result)?; path.truncate(path.len()-2); }
        }
    }
    Ok(())
}
fn addresses(value: &Value) -> Result<BTreeSet<Vec<String>>> { let mut result=BTreeSet::new(); nodes(value,&mut Vec::new(),&mut result)?; Ok(result) }

/// Qualification of this exact external engine, not an author-value restriction.
/// jsonschema-value 0.60.2 numeric::exact_ordering has a known rounded-limit bug
/// outside exact safe-integer bounds. Keep that reproducer and reject unsupported
/// grammar before provider construction; do not round a threshold or author value.
pub fn qualify_numeric_constraints(resource: &str, schema: &Value) -> Result<()> {
    for parts in addresses(schema)? {
        let node=locate(schema,&parts)?;
        for keyword in ["minimum","maximum","exclusiveMinimum","exclusiveMaximum","multipleOf"] {
            if let Some(value)=node.get(keyword) {
                let supported=keyword!="multipleOf"&&value.as_i64().is_some_and(|n|(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&n));
                if !supported { return Err(fail("GrammarCapabilityUnsupported",&crate::source::pointer(&pointer(&parts),keyword),
                    format!("{resource}: jsonschema 0.60.2 is qualified only for safe-integer numeric bounds, without multipleOf; the schema requires a newly qualified engine"))); }
            }
        }
    }
    Ok(())
}

pub fn resolve<'a>(graph: &'a BTreeMap<String,Value>, mut node: &'a Value, resource: &str) -> Result<(&'a Value,String)> {
    let mut resource = resource.to_owned(); let mut seen=BTreeSet::new();
    while let Some(reference) = node.get("$ref") {
        let reference=string(reference)?; let (base,fragment)=reference.split_once('#').unwrap_or((reference,""));
        if !base.is_empty() { resource=base.to_owned(); }
        if !seen.insert((resource.clone(),fragment.to_owned())) { return Err(drift("Cyclic Schema alias")); }
        node=graph.get(&resource).ok_or_else(|| drift("Undeclared Schema resource"))?;
        if !fragment.is_empty() {
            let decoded=percent_encoding::percent_decode_str(fragment).decode_utf8().map_err(|e| drift(e.to_string()))?;
            node=locate(node,&tokens(&decoded)?)?;
        }
    }
    Ok((node,resource))
}

pub fn rebuild(captured: &[(&str,&[u8])]) -> Result<BTreeMap<String,Value>> {
    let input: BTreeMap<_,_> = captured.iter().copied().collect();
    if input.len()!=captured.len() { return Err(drift("Duplicate captured path")); }
    let manifest=parse(input.get(MANIFEST).ok_or_else(|| drift("Missing parameter manifest"))?)?;
    keys(&manifest,&["schema","scope","resources","externals","extensions"])?;
    if manifest["schema"]!="gift.design-codec-parameters/2" || manifest["scope"]!="complete-candidate-structure-only" { return Err(drift("Unsupported parameter contract")); }
    let resources=array(&manifest["resources"])?; let externals=array(&manifest["externals"])?;
    if resources.is_empty() { return Err(drift("Grammar resource list is empty")); }
    let mut source=BTreeMap::new(); let mut mapping=BTreeMap::new(); let mut paths=BTreeSet::new();
    let mut transformed=BTreeSet::new();
    for (list,changed) in [(resources,true),(externals,false)] {
        for item in list {
            keys(item,if changed { &["path","id","sha256","candidateId","replacements"] } else { &["path","id","sha256"] })?;
            let path=string(&item["path"])?; let id=string(&item["id"])?;
            let target=if changed { string(&item["candidateId"])? } else { id };
            if !id.starts_with("urn:") || id.contains('#') || !target.starts_with("urn:") || target.contains('#') || (changed && target==id) { return Err(drift("Invalid grammar identity")); }
            if !paths.insert(path) || source.contains_key(id) { return Err(drift("Duplicate resource identity/path")); }
            let bytes=input.get(path).ok_or_else(|| drift(format!("Missing grammar input: {path}")))?;
            if sha(bytes)!=string(&item["sha256"])? { return Err(drift(format!("Content revision mismatch: {path}"))); }
            let value=parse(bytes)?;
            if value.get("$id").and_then(Value::as_str)!=Some(id) || value["$schema"]!="https://json-schema.org/draft/2020-12/schema" { return Err(drift("Grammar header mismatch")); }
            source.insert(id.to_owned(),value); mapping.insert(id.to_owned(),target.to_owned());
            if changed { transformed.insert(id.to_owned()); }
        }
    }
    let targets:BTreeSet<_>=mapping.values().collect();
    if targets.len()!=mapping.len() || mapping.iter().any(|(k,v)| k!=v&&source.contains_key(v)) { return Err(drift("Candidate identity collision")); }
    let extensions=array(&manifest["extensions"])?; let mut extension_keys=BTreeSet::new();
    for ext in extensions {
        keys(ext,&["resource","pointer","keyword","expectedSha256","append"])?;
        let id=string(&ext["resource"])?; let keyword=string(&ext["keyword"])?; let parts=tokens(string(&ext["pointer"])?)?;
        if !transformed.contains(id) || !["oneOf","allOf"].contains(&keyword) { return Err(drift("Invalid extension target")); }
        let base=&source[id];
        if !addresses(base)?.contains(&parts) || !extension_keys.insert((id.to_owned(),parts.clone(),keyword.to_owned())) { return Err(drift("Duplicate/non-Schema extension")); }
        let node=locate(base,&parts)?; array(&node[keyword])?;
        if node_digest(node)?!=string(&ext["expectedSha256"])? { return Err(drift("Extension preimage mismatch")); }
        let additions=array(&ext["append"])?;
        if additions.is_empty() { return Err(drift("Empty extension")); }
        for branch in additions { keys(branch,&["$ref"])?; string(&branch["$ref"])?; }
    }
    for item in resources {
        let id=string(&item["id"])?; let value=source.get_mut(id).unwrap(); let allowed=addresses(value)?; let mut seen:Vec<Vec<String>>=Vec::new();
        for replacement in array(&item["replacements"])? {
            keys(replacement,&["pointer","expected","replacement"])?;
            let parts=tokens(string(&replacement["pointer"])?)?;
            if !allowed.contains(&parts) || seen.iter().any(|p| p.starts_with(&parts)||parts.starts_with(p)) || extension_keys.iter().any(|(r,p,_)| r==id&&p.starts_with(&parts)) { return Err(drift("Overlapping/non-Schema replacement")); }
            if locate(value,&parts)? != &replacement["expected"] { return Err(drift("Replacement preimage mismatch")); }
            addresses(&replacement["replacement"])?;
            *value.pointer_mut(&pointer(&parts)).ok_or_else(|| drift("Replacement target disappeared"))?=replacement["replacement"].clone();
            seen.push(parts);
        }
    }
    for ext in extensions {
        let id=string(&ext["resource"])?; let keyword=string(&ext["keyword"])?;
        let node=source.get_mut(id).unwrap().pointer_mut(string(&ext["pointer"])?).ok_or_else(|| drift("Extension target disappeared"))?;
        node.get_mut(keyword).and_then(Value::as_array_mut).ok_or_else(|| drift("Extension combinator disappeared"))?.extend(array(&ext["append"])?.iter().cloned());
    }
    let locations:BTreeMap<_,_>=source.iter().map(|(k,v)| Ok((k.clone(),addresses(v)?))).collect::<Result<_>>()?;
    let mut output=BTreeMap::new();
    for (id,mut value) in source {
        for parts in &locations[&id] {
            let node=if parts.is_empty() { &mut value } else { value.pointer_mut(&pointer(parts)).ok_or_else(|| drift("Schema node disappeared"))? };
            let Some(o)=node.as_object_mut() else { continue; };
            if (!parts.is_empty()&&o.contains_key("$id")) || ["$dynamicRef","$dynamicAnchor","$anchor","$recursiveRef","dependencies","additionalItems"].iter().any(|k| o.contains_key(*k)) { return Err(drift("Unsupported resource scope/vocabulary")); }
            if let Some(reference)=o.get("$ref") {
                let reference=string(reference)?; let (base,fragment)=reference.split_once('#').map(|(b,f)|(b,Some(f))).unwrap_or((reference,None));
                let resolved=if base.is_empty() { &id } else { base };
                let target=mapping.get(resolved).ok_or_else(|| drift("Undeclared reference resource"))?;
                if let Some(fragment)=fragment.filter(|f| !f.is_empty()) {
                    let decoded=percent_encoding::percent_decode_str(fragment).decode_utf8().map_err(|e| drift(e.to_string()))?;
                    if !locations[resolved].contains(&tokens(&decoded)?) { return Err(drift("Reference does not target a Schema node")); }
                }
                let mut rewritten=if base.is_empty() { String::new() } else { target.clone() };
                if let Some(fragment)=fragment { rewritten.push('#'); rewritten.push_str(fragment); }
                o.insert("$ref".into(),Value::String(rewritten));
            }
        }
        let target=mapping[&id].clone(); value["$id"]=Value::String(target.clone()); output.insert(target,value);
    }
    Ok(output)
}

pub fn revision() -> String {
    capture_revision(CAPTURE)
}
pub fn rules_revision()->String {
    static REVISION:std::sync::OnceLock<String>=std::sync::OnceLock::new();
    REVISION.get_or_init(||capture_revision(RULE_CAPTURE)).clone()
}
fn capture_revision(capture:&[(&str,&[u8])])->String {
    let mut h=Sha256::new(); let inputs:BTreeMap<_,_>=capture.iter().copied().collect();
    for (path,bytes) in inputs { h.update((path.len() as u64).to_be_bytes());h.update(path.as_bytes());h.update((bytes.len() as u64).to_be_bytes());h.update(bytes); }
    format!("sha256:{:x}",h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_extension_hash_escapes_del_and_non_bmp_scalars() {
        let value=serde_json::json!({"x":"\u{007f}😀"});
        assert_eq!(node_digest(&value).unwrap(),sha(br#"{"x":"\u007f\ud83d\ude00"}"#));
    }
}
