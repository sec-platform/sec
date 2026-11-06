//! Immutable JSON occurrences. Serde owns syntax; Gift retains source identity and expansion sharing.
use std::{collections::BTreeMap, fmt, sync::Arc};
use serde::{Deserialize, Deserializer, Serialize, de::{MapAccess, Visitor}};
use serde_json::{Value, value::RawValue};
use crate::{MAX_SOURCE_BYTES, model::{Diagnostic, fail}};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Origin {
    pub pointer: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub enum Kind {
    Null, Bool(bool), Number(serde_json::Number), String(String),
    Array(Vec<Node>), Object(BTreeMap<String, Node>),
}

#[derive(Clone, Debug)]
pub struct Node(Arc<Data>);
#[derive(Debug)]
struct Data { kind: Kind, origin: Option<Arc<Origin>> }

impl Node {
    pub fn new(kind: Kind) -> Self { Self(Arc::new(Data { kind, origin: None })) }
    pub fn kind(&self) -> &Kind { &self.0.kind }
    pub fn origin(&self) -> Option<&Origin> { self.0.origin.as_deref() }
    pub fn with_origin(mut self, origin: Option<Origin>) -> Self {
        self.0 = Arc::new(Data { kind: self.0.kind.clone(), origin:origin.map(Arc::new) }); self
    }
    pub fn from_source(self, source: &Node) -> Self {
        Self(Arc::new(Data { kind:self.0.kind.clone(), origin:source.0.origin.clone() }))
    }
    pub fn object(value: BTreeMap<String, Node>) -> Self { Self::new(Kind::Object(value)) }
    pub fn array(value: Vec<Node>) -> Self { Self::new(Kind::Array(value)) }
    pub fn string(value: impl Into<String>) -> Self { Self::new(Kind::String(value.into())) }
    pub fn boolean(value: bool) -> Self { Self::new(Kind::Bool(value)) }
    pub fn as_object(&self) -> Option<&BTreeMap<String, Node>> { if let Kind::Object(v) = self.kind() { Some(v) } else { None } }
    pub fn as_array(&self) -> Option<&[Node]> { if let Kind::Array(v) = self.kind() { Some(v) } else { None } }
    pub fn as_str(&self) -> Option<&str> { if let Kind::String(v) = self.kind() { Some(v) } else { None } }
    pub fn as_bool(&self) -> Option<bool> { if let Kind::Bool(v) = self.kind() { Some(*v) } else { None } }
    pub fn get(&self, key: &str) -> Option<&Node> { self.as_object()?.get(key) }
    pub fn identity(&self) -> usize { Arc::as_ptr(&self.0) as usize }
    pub fn from_value(value: &Value) -> Self {
        Self::new(match value {
            Value::Null => Kind::Null, Value::Bool(v) => Kind::Bool(*v), Value::Number(v) => Kind::Number(v.clone()),
            Value::String(v) => Kind::String(v.clone()),
            Value::Array(v) => Kind::Array(v.iter().map(Self::from_value).collect()),
            Value::Object(v) => Kind::Object(v.iter().map(|(k,v)| (k.clone(), Self::from_value(v))).collect()),
        })
    }
    /// For bounded diagnostics/test comparisons; transport emits a shared graph instead.
    pub fn to_value(&self) -> Value {
        match self.kind() {
            Kind::Null => Value::Null, Kind::Bool(v) => Value::Bool(*v), Kind::Number(v) => Value::Number(v.clone()),
            Kind::String(v) => Value::String(v.clone()),
            Kind::Array(v) => Value::Array(v.iter().map(Self::to_value).collect()),
            Kind::Object(v) => Value::Object(v.iter().map(|(k,v)| (k.clone(), v.to_value())).collect()),
        }
    }
}

impl PartialEq for Node {
    fn eq(&self, other: &Self) -> bool {
        if Arc::ptr_eq(&self.0, &other.0) { return true; }
        match (self.kind(), other.kind()) {
            (Kind::Null, Kind::Null) => true, (Kind::Bool(a), Kind::Bool(b)) => a == b,
            (Kind::Number(a), Kind::Number(b)) => a == b, (Kind::String(a), Kind::String(b)) => a == b,
            (Kind::Array(a), Kind::Array(b)) => a == b, (Kind::Object(a), Kind::Object(b)) => a == b,
            _ => false,
        }
    }
}

pub fn pointer(parent: &str, key: &str) -> String { format!("{parent}/{}", key.replace('~', "~0").replace('/', "~1")) }

// Charge the exact escaped byte length before allocating a child path. The owned
// path is moved into its occurrence, and derived nodes share that immutable origin.
const MAX_ORIGIN_BYTES: usize = 16 * 1024 * 1024;
fn child_pointer(parent:&str,key:&str,remaining:&mut usize)->Result<String,Diagnostic> {
    let length=parent.len().checked_add(1).and_then(|n|n.checked_add(key.len()))
        .and_then(|n|n.checked_add(key.bytes().filter(|c|matches!(c,b'~'|b'/')).count()));
    let length=length.filter(|length|*length<=*remaining)
        .ok_or_else(||fail("ResourceLimit","","Retained source pointer bytes exceed the Reader budget"))?;
    *remaining-=length;
    let mut path=String::with_capacity(length);path.push_str(parent);path.push('/');
    for c in key.chars() { match c { '~'=>path.push_str("~0"),'/'=>path.push_str("~1"),_=>path.push(c) } }
    Ok(path)
}

struct RawObject<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for RawObject<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = RawObject<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a JSON object") }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry()? { entries.push(entry); }
                Ok(RawObject(entries))
            }
        }
        d.deserialize_map(ObjectVisitor)
    }
}

pub fn decode(bytes: &[u8]) -> Result<Node, Diagnostic> {
    if bytes.len() > MAX_SOURCE_BYTES { return Err(fail("ResourceLimit", "", "Author source exceeds the input budget")); }
    let text = std::str::from_utf8(bytes).map_err(|e| fail("InvalidAuthorSource", "", e.to_string()))?;
    let raw: &RawValue = serde_json::from_str(text).map_err(|e| fail("InvalidAuthorSource", "", e.to_string()))?;
    let mut remaining = 200_000usize;
    let mut numeric_work = 65_536usize;
    let mut origin_bytes = MAX_ORIGIN_BYTES;
    fn read(raw: &RawValue, text: &str, path: String, depth: usize, remaining: &mut usize, numeric_work: &mut usize, origin_bytes: &mut usize) -> Result<Node, Diagnostic> {
        if depth > 128 || *remaining == 0 { return Err(fail("ResourceLimit", &path, "Author JSON depth/node budget exceeded")); }
        *remaining -= 1;
        let invalid = |e: serde_json::Error| fail("InvalidAuthorSource", &path, e.to_string());
        let kind = match raw.get().as_bytes().first() {
            Some(b'{') => {
                let RawObject(entries) = serde_json::from_str(raw.get()).map_err(invalid)?;
                let mut object = BTreeMap::new();
                for (key, raw) in entries {
                    let child_path = child_pointer(&path, &key, origin_bytes)?;
                    if object.contains_key(&key) { return Err(fail("InvalidAuthorSource", &child_path, "Duplicate JSON object key after escape decoding")); }
                    object.insert(key, read(raw, text, child_path, depth + 1, remaining, numeric_work, origin_bytes)?);
                }
                Kind::Object(object)
            }
            Some(b'[') => {
                let array: Vec<&RawValue> = serde_json::from_str(raw.get()).map_err(invalid)?;
                Kind::Array(array.iter().enumerate().map(|(i,v)| {
                    let child_path=child_pointer(&path,&i.to_string(),origin_bytes)?;
                    read(v,text,child_path,depth+1,remaining,numeric_work,origin_bytes)
                }).collect::<Result<_,_>>()?)
            }
            _ => Node::from_value(&serde_json::from_str::<Value>(raw.get()).map_err(invalid)?).kind().clone(),
        };
        if matches!(kind,Kind::Number(_)) {
            // JSON syntax was already validated by serde. Bound potential exact-decimal
            // work before the external engine can allocate exponent-sized integers.
            let raw=raw.get();
            let exponent=raw.split_once(['e','E']).map(|(_,exponent)|exponent.parse::<i64>().ok().map(i64::unsigned_abs)).unwrap_or(Some(0));
            let cost=exponent.and_then(|n|usize::try_from(n).ok()).and_then(|n|n.checked_add(raw.len()));
            *numeric_work=cost.and_then(|cost|numeric_work.checked_sub(cost)).ok_or_else(||fail("ResourceLimit",&path,"Exact numeric comparison work exceeds the Reader budget; source is retained"))?;
        }
        let start = (raw.get().as_ptr() as usize).checked_sub(text.as_ptr() as usize)
            .filter(|start| start + raw.get().len() <= text.len())
            .ok_or_else(|| fail("ReaderInvariant", &path, "Raw JSON slice is outside captured source"))?;
        Ok(Node::new(kind).with_origin(Some(Origin { pointer:path, start, end:start+raw.get().len() })))
    }
    read(raw, text, String::new(), 0, &mut remaining, &mut numeric_work, &mut origin_bytes)
}

/// Narrow external-library interface: validation sees the same shared occurrences.
pub struct SourceJson;
impl Default for Node { fn default() -> Self { Self::new(Kind::Null) } }
impl jsonschema::json::Json for SourceJson {
    type Node<'a> = &'a Node;
    type PreparedKey = String;
    type StringBuffer = Node;
    fn prepare_key(key: &str) -> String { key.to_owned() }
    fn with_string_node<T>(buffer: &mut Node, string: &str, f: impl FnOnce(&Node) -> T) -> T {
        *buffer=Node::string(string); f(buffer)
    }
}
impl<'a> jsonschema::json::Node<'a,SourceJson> for &'a Node {
    type Object = &'a BTreeMap<String,Node>;
    type Array = &'a [Node];
    type Number = &'a serde_json::Number;
    fn as_object(&self) -> Option<Self::Object> { Node::as_object(self) }
    fn as_array(&self) -> Option<Self::Array> { Node::as_array(self) }
    fn as_string(&self) -> Option<std::borrow::Cow<'a,str>> { Node::as_str(self).map(std::borrow::Cow::Borrowed) }
    fn as_number(&self) -> Option<Self::Number> { if let Kind::Number(v)=self.kind() { Some(v) } else { None } }
    fn as_boolean(&self) -> Option<bool> { Node::as_bool(self) }
    fn is_null(&self) -> bool { matches!(self.kind(),Kind::Null) }
    fn json_type(&self) -> jsonschema::JsonType {
        use jsonschema::JsonType;
        match self.kind() { Kind::Null=>JsonType::Null,Kind::Bool(_)=>JsonType::Boolean,Kind::Number(_)=>JsonType::Number,Kind::String(_)=>JsonType::String,Kind::Array(_)=>JsonType::Array,Kind::Object(_)=>JsonType::Object }
    }
    fn to_value(&self) -> std::borrow::Cow<'a,Value> { std::borrow::Cow::Owned(Node::to_value(self)) }
    fn equals_value(&self, expected: &Value) -> bool {
        fn equal(node: &Node, expected: &Value) -> bool {
            match (node.kind(),expected) {
                (Kind::Null,Value::Null)=>true, (Kind::Bool(a),Value::Bool(b))=>a==b,
                (Kind::String(a),Value::String(b))=>a==b,
                (Kind::Number(a),Value::Number(b))=>jsonschema::json::cmp::equal_numbers(a,b),
                (Kind::Array(a),Value::Array(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|equal(a,b)),
                (Kind::Object(a),Value::Object(b))=>a.len()==b.len()&&a.iter().all(|(k,a)|b.get(k).is_some_and(|b|equal(a,b))),
                _=>false,
            }
        }
        equal(self,expected)
    }
    fn identity(&self) -> Option<jsonschema::json::NodeIdentity> { Some(jsonschema::json::NodeIdentity::new(Node::identity(self))) }
}
pub struct Members<'a>(std::collections::btree_map::Iter<'a,String,Node>);
impl<'a> Iterator for Members<'a> {
    type Item=(&'a str,&'a Node);
    fn next(&mut self)->Option<Self::Item> { self.0.next().map(|(k,v)|(k.as_str(),v)) }
}
impl<'a> jsonschema::json::Object<'a,SourceJson> for &'a BTreeMap<String,Node> {
    type Node=&'a Node;
    type MemberName=&'a str;
    type MembersIter=Members<'a>;
    fn len(&self)->usize { BTreeMap::len(self) }
    fn get(&self,key:&String)->Option<&'a Node> { BTreeMap::get(self,key) }
    fn members(&self)->Members<'a> { Members(self.iter()) }
}
impl<'a> jsonschema::json::Array<'a,SourceJson> for &'a [Node] {
    type Node=&'a Node;
    type ElementsIter=std::slice::Iter<'a,Node>;
    fn len(&self)->usize { <[Node]>::len(self) }
    fn elements(&self)->Self::ElementsIter { self.iter() }
}
