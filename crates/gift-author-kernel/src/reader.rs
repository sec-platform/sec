//! Complete selected structural Reader. Binding, interpretation and target qualification are later owners.
use std::{collections::BTreeMap, sync::{Arc, Mutex, OnceLock}};
use serde::Serialize;
use serde_json::{Value,json};
use crate::{expansion::Expansion, grammar, model::{Diagnostic,fail}, source::{self,Kind,Node,Origin,SourceJson}};

struct NoRetrieval;
impl jsonschema::Retrieve for NoRetrieval {
    fn retrieve(&self, uri:&jsonschema::Uri<String>)->Result<Value,Box<dyn std::error::Error+Send+Sync>> {
        Err(format!("Grammar reference outside the fixed embedded capture: {uri}").into())
    }
}

pub struct Reader {
    graph:BTreeMap<String,Value>,
    registry:jsonschema::Registry<'static>,
    validators:Mutex<BTreeMap<String,Arc<jsonschema::Validator<SourceJson>>>>,
}
impl Reader {
    pub fn graph(&self)->&BTreeMap<String,Value> { &self.graph }
    pub fn new()->Result<Self,Diagnostic> {
        let graph=grammar::rebuild(grammar::CAPTURE)?;
        for (resource,schema) in &graph { grammar::qualify_numeric_constraints(resource,schema)?; }
        let registry=jsonschema::Registry::new().draft(jsonschema::Draft::Draft202012).retriever(NoRetrieval)
            .extend(graph.iter().map(|(k,v)|(k.clone(),v.clone())))
            .and_then(|b|b.prepare()).map_err(|e|fail("GrammarDrift","",e.to_string()))?;
        Ok(Self { graph,registry,validators:Mutex::new(BTreeMap::new()) })
    }
    pub fn validator(&self,schema:&str)->Result<Arc<jsonschema::Validator<SourceJson>>,Diagnostic> {
        let mut validators=self.validators.lock().map_err(|_|fail("ReaderInvariant","","Validator cache poisoned"))?;
        if let Some(v)=validators.get(schema) { return Ok(v.clone()); }
        let validator=jsonschema::options_for::<SourceJson>().with_draft(jsonschema::Draft::Draft202012)
            .with_registry(&self.registry).with_retriever(NoRetrieval)
            .with_pattern_options(jsonschema::PatternOptions::fancy_regex().backtrack_limit(100_000))
            .build(&json!({"$ref":schema})).map_err(|e|fail("GrammarDrift","",e.to_string()))?;
        let validator=Arc::new(validator); validators.insert(schema.into(),validator.clone()); Ok(validator)
    }
    pub fn read(&self,bytes:&[u8])->Result<DecodedSource,Diagnostic> {
        let source=source::decode(bytes)?;
        let marker=source.get("schema").and_then(Node::as_str).ok_or_else(||fail("InvalidAuthorSource","/schema","Expected an exact author format marker"))?.to_owned();
        let (schema,expanded)=match marker.as_str() {
            "gift.author-module/design-converged" => (grammar::MODULE,Expansion::new(&self.graph,None)?.expand("module_value",&source)?),
            "gift.project/design-converged" => (grammar::PROJECT,source.clone()),
            _=>return Err(fail("UnsupportedAuthorSchema","/schema","This Reader requires the exact design-converged module or project marker")),
        };
        let validator=self.validator(schema)?;
        if !validator.is_valid(&expanded) {
            // Large shared expansions stay shared even on failure. Diagnostic materialization
            // in the external engine may copy a tree, so only request it within a finite bound.
            let mut memo=BTreeMap::new();
            let detail=if expanded_weight(&expanded,&mut memo)<=200_000 {
                validator.iter_errors(&expanded).next().map(|e|(e.instance_path().to_string(),e.schema_path().to_string()))
            } else { None };
            let (path,message)=match detail {
                Some((path,rule))=>{
                    let origin=locate(&expanded,&path).and_then(Node::origin);
                    (origin.map(|o|o.pointer.clone()).unwrap_or_default(),format!("Complete structure rejected at expanded pointer {path}; Schema rule {rule}"))
                },
                None=>(source.origin().map(|o|o.pointer.clone()).unwrap_or_default(),"Complete structure rejected; detailed tree materialization exceeds the diagnostic budget".into()),
            };
            return Err(fail("InvalidAuthorSource",&path,message));
        }
        Ok(DecodedSource { bytes:Arc::from(bytes), source, expanded, source_format:marker, grammar_revision:grammar::revision() })
    }
}

fn expanded_weight(node:&Node,memo:&mut BTreeMap<usize,usize>)->usize {
    if let Some(w)=memo.get(&node.identity()) { return *w; }
    let own=match node.kind() { Kind::String(s)=>s.len()+1,Kind::Number(n)=>n.to_string().len()+1,_=>1 };
    let mut weight=own;
    match node.kind() {
        Kind::Array(a)=>for n in a { weight=weight.saturating_add(expanded_weight(n,memo)); },
        Kind::Object(o)=>for (k,n) in o { weight=weight.saturating_add(k.len()).saturating_add(expanded_weight(n,memo)); },
        _=>(),
    }
    memo.insert(node.identity(),weight);weight
}

fn locate<'a>(mut node:&'a Node,pointer:&str)->Option<&'a Node> {
    if pointer.is_empty() { return Some(node); }
    for token in pointer.strip_prefix('/')?.split('/') {
        let key=token.replace("~1","/").replace("~0","~");
        node=match node.kind() { Kind::Object(o)=>o.get(&key)?,Kind::Array(a)=>a.get(key.parse::<usize>().ok()?)?,_=>return None };
    }
    Some(node)
}

pub struct DecodedSource {
    bytes:Arc<[u8]>,
    source:Node,
    expanded:Node,
    source_format:String,
    grammar_revision:String,
}

#[derive(Serialize)]
#[serde(tag="kind",content="value",rename_all="snake_case")]
pub enum WireValue { Null,Bool(bool),Number(String),String(String),Array(Vec<usize>),Object(BTreeMap<String,usize>) }
#[derive(Serialize)]
pub struct WireNode { pub origin:Option<Origin>, #[serde(flatten)] pub value:WireValue }
#[derive(Serialize)]
pub struct ReadOutput {
    pub schema:&'static str,
    pub stage:&'static str,
    pub source_format:String,
    pub source_revision:String,
    pub grammar_revision:String,
    pub source_root:usize,
    pub expanded_root:usize,
    pub nodes:Vec<WireNode>,
}

pub const MAX_OUTPUT_BYTES:usize=64*1024*1024;
struct OutputBudget(usize);
impl OutputBudget {
    fn charge(&mut self,bytes:usize)->Result<(),Diagnostic> {
        self.0=self.0.checked_sub(bytes).ok_or_else(||fail("ResourceLimit","","Reader output allocation exceeds the transport budget"))?;Ok(())
    }
    fn string(&mut self,value:&str)->Result<(),Diagnostic> {
        // JSON's worst-case escaping is six bytes per UTF-8 byte. This conservative
        // allocation bound covers both the owned string and its serialized form.
        self.charge(value.len().saturating_mul(6).saturating_add(2))
    }
    fn node(&mut self,node:&Node)->Result<(),Diagnostic> {
        // Covers node fields, tags, origin offsets, punctuation and container headers.
        self.charge(256)?;
        if let Some(origin)=node.origin() { self.string(&origin.pointer)?; }
        match node.kind() {
            Kind::String(v)=>self.string(v)?,
            Kind::Number(v)=>self.string(&v.to_string())?,
            Kind::Array(a)=>self.charge(a.len().saturating_mul(24))?,
            Kind::Object(o)=>for key in o.keys() { self.string(key)?;self.charge(24)?; },
            _=>(),
        }
        Ok(())
    }
}
impl DecodedSource {
    pub fn bytes(&self)->&[u8] { &self.bytes }
    pub fn source(&self)->&Node { &self.source }
    pub fn expanded(&self)->&Node { &self.expanded }
    pub fn output(&self)->Result<ReadOutput,Diagnostic> {
        fn visit(node:&Node,bytes:&[u8],ids:&mut BTreeMap<usize,usize>,nodes:&mut Vec<WireNode>,budget:&mut OutputBudget)->Result<usize,Diagnostic> {
            if let Some(id)=ids.get(&node.identity()) { return Ok(*id); }
            budget.node(node)?;
            if let Kind::Number(_)=node.kind() {
                // Original numeric spelling can be longer than Number::to_string().
                if let Some(origin)=node.origin() { budget.charge((origin.end-origin.start).saturating_mul(6))?; }
            }
            let value=match node.kind() {
                Kind::Null=>WireValue::Null,Kind::Bool(v)=>WireValue::Bool(*v),
                Kind::Number(v)=>WireValue::Number(node.origin().and_then(|o|std::str::from_utf8(&bytes[o.start..o.end]).ok()).map(str::to_owned).unwrap_or_else(||v.to_string())),Kind::String(v)=>WireValue::String(v.clone()),
                Kind::Array(a)=>WireValue::Array(a.iter().map(|n|visit(n,bytes,ids,nodes,budget)).collect::<Result<_,_>>()?),
                Kind::Object(o)=>WireValue::Object(o.iter().map(|(k,v)|Ok((k.clone(),visit(v,bytes,ids,nodes,budget)?))).collect::<Result<_,Diagnostic>>()?),
            };
            let id=nodes.len(); nodes.push(WireNode { origin:node.origin().cloned(),value }); ids.insert(node.identity(),id);Ok(id)
        }
        let mut nodes=Vec::new();let mut ids=BTreeMap::new();
        let mut budget=OutputBudget(MAX_OUTPUT_BYTES);budget.charge(1024)?;budget.string(&self.source_format)?;budget.string(&self.grammar_revision)?;
        let source_root=visit(&self.source,&self.bytes,&mut ids,&mut nodes,&mut budget)?;let expanded_root=visit(&self.expanded,&self.bytes,&mut ids,&mut nodes,&mut budget)?;
        Ok(ReadOutput { schema:"gift.author-read/1",stage:"structural",source_format:self.source_format.clone(),source_revision:crate::digest(&self.bytes),grammar_revision:self.grammar_revision.clone(),source_root,expanded_root,nodes })
    }
}

#[cfg(test)]
mod resource_tests {
    use super::*;
    #[test]
    fn shared_origins_are_bounded_before_wire_copies() {
        let original=Node::boolean(true).with_origin(Some(Origin { pointer:"a".repeat(1024*1024),start:0,end:4 }));
        let derived:Vec<_>=(0..128).map(|_|Node::boolean(true).from_source(&original)).collect();
        assert!(derived.iter().all(|n|std::ptr::eq(n.origin().unwrap(),original.origin().unwrap())));
        let source=DecodedSource { bytes:Arc::from(b"true".as_slice()),source:original,expanded:Node::array(derived),source_format:"gift.author-module/design-converged".into(),grammar_revision:"test".into() };
        assert_eq!(source.output().err().unwrap().code,"ResourceLimit");
    }
}

pub fn read(bytes:&[u8])->Result<DecodedSource,Diagnostic> {
    static READER:OnceLock<Result<Reader,Diagnostic>>=OnceLock::new();
    READER.get_or_init(Reader::new).as_ref().map_err(Clone::clone)?.read(bytes)
}
