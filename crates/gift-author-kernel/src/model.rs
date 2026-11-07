//! The supported, strict subset of the existing author-module/2 encoding.
//! Decoding never obtains files, imports, runtime observations or permissions.
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize)]
pub struct Diagnostic {
    pub code: String,
    pub path: String,
    pub message: String,
}

pub fn fail(code: &str, path: &str, message: impl Into<String>) -> Diagnostic {
    Diagnostic { code: code.into(), path: path.into(), message: message.into() }
}

#[derive(Clone, Debug, Serialize)]
pub struct Module {
    pub module_id: String,
    pub definitions: BTreeMap<String, Definition>,
    pub exports: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum Type {
    Int,
    Bool,
    Text,
    Record(BTreeMap<String, Type>),
    Sequence(Box<Type>),
}

#[derive(Clone, Debug, Serialize)]
pub enum Definition {
    Constant { ty: Type, value: Expr },
    Function { parameters: Vec<Parameter>, returns: Type, body: Expr },
    Meaning { parameters: Vec<Parameter>, returns: Type, interpretation: String },
    Query { inputs: Vec<String>, algebra: Query, result: Type },
    Type(Type),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Parameter { pub name: String, pub ty: Type }

#[derive(Clone, Debug, Serialize)]
pub struct Expr { pub path: String, pub kind: ExprKind }

#[derive(Clone, Debug, Serialize)]
pub enum ExprKind {
    Int(String),
    Bool(bool),
    Text(String),
    Var(String),
    Symbol(String),
    Record(Vec<(String, Expr)>),
    Sequence(Vec<Expr>),
    Field { record: Box<Expr>, name: String },
    Call { callee: Box<Expr>, arguments: Vec<Expr> },
    If { condition: Box<Expr>, then: Box<Expr>, otherwise: Box<Expr> },
    Match { value: Box<Expr>, cases: Vec<Case> },
}

#[derive(Clone, Debug, Serialize)]
pub struct Case { pub constructor: String, pub binding: String, pub body: Expr }

#[derive(Clone, Debug, Serialize)]
pub struct Query { pub path: String, pub kind: QueryKind }

#[derive(Clone, Debug, Serialize)]
pub enum QueryKind {
    Scan(String),
    Filter { source: Box<Query>, predicate: String },
}

type Result<T> = std::result::Result<T, Diagnostic>;

fn at(path: &str, key: &str) -> String {
    format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"))
}

fn invalid(path: &str, message: impl Into<String>) -> Diagnostic {
    fail("InvalidAuthorSource", path, message)
}

fn need(path: &str, message: impl Into<String>) -> Diagnostic {
    fail("NeedsSemanticBridge", path, message)
}

fn object<'a>(v: &'a Value, path: &str) -> Result<&'a Map<String, Value>> {
    v.as_object().ok_or_else(|| invalid(path, "Expected an object"))
}

fn array<'a>(v: &'a Value, path: &str) -> Result<&'a Vec<Value>> {
    v.as_array().ok_or_else(|| invalid(path, "Expected an array"))
}

fn text(v: &Value, path: &str) -> Result<String> {
    v.as_str().map(str::to_owned).ok_or_else(|| invalid(path, "Expected a string"))
}

fn get<'a>(o: &'a Map<String, Value>, key: &str, path: &str) -> Result<&'a Value> {
    o.get(key).ok_or_else(|| invalid(&at(path, key), "Required field is missing"))
}

fn string(o: &Map<String, Value>, key: &str, path: &str) -> Result<String> {
    text(get(o, key, path)?, &at(path, key))
}

fn keys(o: &Map<String, Value>, path: &str, supported: &[&str], unsupported: &[&str]) -> Result<()> {
    for key in o.keys() {
        if supported.contains(&key.as_str()) { continue; }
        if unsupported.contains(&key.as_str()) {
            return Err(need(&at(path, key), "This author field requires an unsupported semantic profile"));
        }
        return Err(invalid(&at(path, key), "Unknown field in this author encoding"));
    }
    Ok(())
}

fn identifier(value: String, path: &str, member: bool) -> Result<String> {
    let mut chars = value.chars();
    let first = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    if !first || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || (member && c == '-')) {
        return Err(invalid(path, "Invalid author identifier"));
    }
    Ok(value)
}

fn name(o: &Map<String, Value>, key: &str, path: &str, member: bool) -> Result<String> {
    identifier(string(o, key, path)?, &at(path, key), member)
}

fn reference(v: &Value, path: &str) -> Result<String> {
    let value = text(v, path)?;
    let Some((alias, symbol)) = value.split_once(':') else {
        return Err(invalid(path, "Expected an alias:Definition reference"));
    };
    identifier(alias.into(), path, false)?;
    identifier(symbol.into(), path, false)?;
    Ok(value)
}

fn reference_field(o: &Map<String, Value>, key: &str, path: &str) -> Result<String> {
    reference(get(o, key, path)?, &at(path, key))
}

fn optional_false(o: &Map<String, Value>, key: &str, path: &str) -> Result<()> {
    if let Some(value) = o.get(key) {
        match value.as_bool() {
            Some(false) => (),
            Some(true) => return Err(need(&at(path, key), "This profile requires a closed immutable required record")),
            None => return Err(invalid(&at(path, key), "Expected a boolean")),
        }
    }
    Ok(())
}

fn read_type(v: &Value, path: &str) -> Result<Type> {
    let o = object(v, path)?;
    if o.contains_key("packElement") { return Err(need(path, "Pack-element types require static parameter elaboration")); }
    let tag = string(o, "tag", path)?;
    match tag.as_str() {
        "scalar" => {
            keys(o, path, &["tag", "name"], &["bits", "scale", "overflow", "textIndex", "rounding", "nanPolicy", "encoding", "clockRef"])?;
            match string(o, "name", path)?.as_str() {
                "int" => Ok(Type::Int), "bool" => Ok(Type::Bool), "text" => Ok(Type::Text),
                "unit" | "never" | "uint" | "decimal" | "float" | "bytes" | "timestamp" | "duration" => Err(need(path, "Scalar type has no method in this profile")),
                _ => Err(invalid(&at(path, "name"), "Unknown scalar type")),
            }
        }
        "record" => {
            keys(o, path, &["tag", "fields", "open"], &["rowType"])?;
            optional_false(o, "open", path)?;
            let field_path = at(path, "fields");
            let mut fields = BTreeMap::new();
            for (key, value) in object(get(o, "fields", path)?, &field_path)? {
                let p = at(&field_path, key);
                identifier(key.clone(), &p, true)?;
                let f = object(value, &p)?;
                keys(f, &p, &["type", "mutable", "optional"], &[])?;
                optional_false(f, "mutable", &p)?;
                optional_false(f, "optional", &p)?;
                fields.insert(key.clone(), read_type(get(f, "type", &p)?, &at(&p, "type"))?);
            }
            Ok(Type::Record(fields))
        }
        "sequence" => {
            keys(o, path, &["tag", "item", "ordered"], &[])?;
            if o.get("ordered").is_some_and(|v| v != &Value::Bool(true)) {
                return Err(invalid(&at(path, "ordered"), "Sequence ordered, when present, must be true"));
            }
            Ok(Type::Sequence(Box::new(read_type(get(o, "item", path)?, &at(path, "item"))?)))
        }
        "nominal" | "param" | "opaque" | "variant" | "tuple" | "option" | "result" | "set" | "bag" | "map" | "function" | "handle" | "future" | "stream" | "quantity" | "refinement" | "apply" => Err(need(path, format!("Type {tag} requires another semantic method"))),
        _ => Err(invalid(&at(path, "tag"), "Unknown type tag")),
    }
}

fn read_expr(v: &Value, path: &str) -> Result<Expr> {
    let o = object(v, path)?;
    let op = string(o, "op", path)?;
    let kind = match op.as_str() {
        "literal" => {
            keys(o, path, &["op", "type", "value"], &[])?;
            let ty = read_type(get(o, "type", path)?, &at(path, "type"))?;
            let value = get(o, "value", path)?;
            match ty {
                Type::Int => {
                    let decimal = text(value, &at(path, "value"))?;
                    let digits = decimal.strip_prefix('-').unwrap_or(&decimal);
                    let canonical = decimal == "0" || (!digits.is_empty() && digits.as_bytes()[0] >= b'1' && digits.as_bytes()[0] <= b'9' && digits.bytes().all(|b| b.is_ascii_digit()));
                    if !canonical { return Err(invalid(&at(path, "value"), "Int requires a canonical exact decimal string")); }
                    ExprKind::Int(decimal)
                }
                Type::Bool => ExprKind::Bool(value.as_bool().ok_or_else(|| invalid(&at(path, "value"), "Bool literal requires a boolean"))?),
                Type::Text => ExprKind::Text(text(value, &at(path, "value"))?),
                _ => return Err(need(path, "Composite values require their explicit author constructors")),
            }
        }
        "var" => { keys(o, path, &["op", "name"], &[])?; ExprKind::Var(name(o, "name", path, false)?) }
        "symbol" => { keys(o, path, &["op", "ref"], &[])?; ExprKind::Symbol(reference_field(o, "ref", path)?) }
        "record" => {
            keys(o, path, &["op", "fields"], &[])?;
            let p = at(path, "fields");
            let mut fields = Vec::new();
            let mut names = BTreeSet::new();
            for (i, f) in array(get(o, "fields", path)?, &p)?.iter().enumerate() {
                let p = at(&p, &i.to_string());
                let f = object(f, &p)?;
                keys(f, &p, &["name", "value"], &[])?;
                let key = name(f, "name", &p, true)?;
                if !names.insert(key.clone()) { return Err(invalid(&at(&p, "name"), "Duplicate record initializer")); }
                fields.push((key, read_expr(get(f, "value", &p)?, &at(&p, "value"))?));
            }
            ExprKind::Record(fields)
        }
        "sequence" => {
            keys(o, path, &["op", "items"], &[])?;
            ExprKind::Sequence(read_expr_array(get(o, "items", path)?, &at(path, "items"))?)
        }
        "field" => {
            keys(o, path, &["op", "record", "name"], &[])?;
            ExprKind::Field { record: Box::new(read_expr(get(o, "record", path)?, &at(path, "record"))?), name: name(o, "name", path, true)? }
        }
        "call" => {
            keys(o, path, &["op", "callee", "arguments"], &["semanticArguments"])?;
            ExprKind::Call { callee: Box::new(read_expr(get(o, "callee", path)?, &at(path, "callee"))?), arguments: read_expr_array(get(o, "arguments", path)?, &at(path, "arguments"))? }
        }
        "if" => {
            keys(o, path, &["op", "condition", "then", "otherwise"], &[])?;
            ExprKind::If {
                condition: Box::new(read_expr(get(o, "condition", path)?, &at(path, "condition"))?),
                then: Box::new(read_expr(get(o, "then", path)?, &at(path, "then"))?),
                otherwise: Box::new(read_expr(get(o, "otherwise", path)?, &at(path, "otherwise"))?),
            }
        }
        "match" => {
            keys(o, path, &["op", "value", "cases"], &[])?;
            let p = at(path, "cases");
            let source = array(get(o, "cases", path)?, &p)?;
            if source.is_empty() { return Err(invalid(&p, "Match requires at least one case")); }
            let mut cases = Vec::new();
            let mut constructors = BTreeSet::new();
            for (i, case) in source.iter().enumerate() {
                let p = at(&p, &i.to_string());
                let c = object(case, &p)?;
                keys(c, &p, &["constructor", "binding", "body"], &[])?;
                let constructor = name(c, "constructor", &p, true)?;
                if !constructors.insert(constructor.clone()) { return Err(invalid(&at(&p, "constructor"), "Duplicate match constructor")); }
                cases.push(Case { constructor, binding: name(c, "binding", &p, false)?, body: read_expr(get(c, "body", &p)?, &at(&p, "body"))? });
            }
            ExprKind::Match { value: Box::new(read_expr(get(o, "value", path)?, &at(path, "value"))?), cases }
        }
        "let" | "lambda" | "variant" | "do" | "perform" | "await" | "throw" | "try" | "exec:block" => return Err(fail("NeedsMethod", path, format!("Expression {op} is outside this pure method"))),
        _ => return Err(invalid(&at(path, "op"), "Unknown expression operation")),
    };
    Ok(Expr { path: path.into(), kind })
}

fn read_expr_array(v: &Value, path: &str) -> Result<Vec<Expr>> {
    array(v, path)?.iter().enumerate().map(|(i, v)| read_expr(v, &at(path, &i.to_string()))).collect()
}

fn read_parameters(v: &Value, path: &str, meaning: bool) -> Result<Vec<Parameter>> {
    let mut result = Vec::new();
    let mut names = BTreeSet::new();
    for (i, v) in array(v, path)?.iter().enumerate() {
        let p = at(path, &i.to_string());
        let o = object(v, &p)?;
        if meaning {
            keys(o, &p, &["name", "type", "cardinality"], &["scopeRef", "bindingLevel"])?;
            if let Some(c) = o.get("cardinality") {
                let c = text(c, &at(&p, "cardinality"))?;
                if !["one", "optional", "set", "bag", "sequence"].contains(&c.as_str()) { return Err(invalid(&at(&p, "cardinality"), "Unknown role cardinality")); }
                if c != "one" { return Err(need(&at(&p, "cardinality"), "This method requires one value per role")); }
            }
        } else {
            keys(o, &p, &["name", "type", "mode"], &[])?;
            if let Some(mode) = o.get("mode") {
                let mode = text(mode, &at(&p, "mode"))?;
                if !["in", "borrow", "move", "out", "inout"].contains(&mode.as_str()) { return Err(invalid(&at(&p, "mode"), "Unknown parameter mode")); }
                if mode != "in" { return Err(need(&at(&p, "mode"), "Parameter ownership mode is outside this pure method")); }
            }
        }
        let name = name(o, "name", &p, false)?;
        if !names.insert(name.clone()) { return Err(invalid(&at(&p, "name"), "Duplicate parameter name")); }
        result.push(Parameter { name, ty: read_type(get(o, "type", &p)?, &at(&p, "type"))? });
    }
    Ok(result)
}

fn read_query(v: &Value, path: &str) -> Result<Query> {
    let o = object(v, path)?;
    let op = string(o, "op", path)?;
    let kind = match op.as_str() {
        "scan" => { keys(o, path, &["op", "sourceRef"], &[])?; QueryKind::Scan(reference_field(o, "sourceRef", path)?) }
        "filter" => {
            keys(o, path, &["op", "source", "predicateRef"], &[])?;
            QueryKind::Filter { source: Box::new(read_query(get(o, "source", path)?, &at(path, "source"))?), predicate: reference_field(o, "predicateRef", path)? }
        }
        "project" | "join" | "union" | "group" | "sort" | "limit" | "fixpoint" => return Err(fail("NeedsMethod", path, format!("Query operation {op} has no ordered method"))),
        _ => return Err(invalid(&at(path, "op"), "Unknown query operation")),
    };
    Ok(Query { path: path.into(), kind })
}

fn read_definition(v: &Value, path: &str) -> Result<Definition> {
    let o = object(v, path)?;
    keys(o, path, &["kind", "body"], &["qualifiers"])?;
    let kind = string(o, "kind", path)?;
    let p = at(path, "body");
    let body = object(get(o, "body", path)?, &p)?;
    match kind.as_str() {
        "core:type" => {
            keys(body, &p, &["type", "opaque", "visibility"], &["typeParams"])?;
            optional_false(body, "opaque", &p)?;
            if let Some(visibility) = body.get("visibility") {
                let visibility = text(visibility, &at(&p, "visibility"))?;
                if !["public", "private"].contains(&visibility.as_str()) { return Err(invalid(&at(&p, "visibility"), "Unknown visibility")); }
                if visibility != "public" { return Err(need(&at(&p, "visibility"), "Private representation visibility requires its semantic profile")); }
            }
            Ok(Definition::Type(read_type(get(body, "type", &p)?, &at(&p, "type"))?))
        }
        "core:constant" => {
            keys(body, &p, &["type", "value"], &[])?;
            Ok(Definition::Constant { ty: read_type(get(body, "type", &p)?, &at(&p, "type"))?, value: read_expr(get(body, "value", &p)?, &at(&p, "value"))? })
        }
        "core:function" => {
            keys(body, &p, &["parameters", "returns", "effects", "termination", "body"], &["typeParams", "contract", "callMode", "parameterContracts", "captures"])?;
            if let Some(effects) = body.get("effects") {
                if !effects.as_array().is_some_and(Vec::is_empty) { return Err(need(&at(&p, "effects"), "Only a closed empty effect bound is supported; omission requires complete-body checking")); }
            }
            if let Some(termination) = body.get("termination") {
                let termination = text(termination, &at(&p, "termination"))?;
                if !["total", "partial", "assumed-total"].contains(&termination.as_str()) { return Err(invalid(&at(&p, "termination"), "Unknown termination qualification")); }
                if termination != "total" { return Err(fail("NeedsMethod", &at(&p, "termination"), "This finite method requires checked total functions")); }
            }
            Ok(Definition::Function {
                parameters: read_parameters(get(body, "parameters", &p)?, &at(&p, "parameters"), false)?,
                returns: read_type(get(body, "returns", &p)?, &at(&p, "returns"))?,
                body: read_expr(get(body, "body", &p)?, &at(&p, "body"))?,
            })
        }
        "domain:meaning" => {
            keys(body, &p, &["category", "parameters", "result", "interpretationRef"], &["observationRef", "authorityRef", "scopeRef"])?;
            let category = string(body, "category", &p)?;
            if !["predicate", "relation", "operation", "measurement", "event"].contains(&category.as_str()) { return Err(invalid(&at(&p, "category"), "Unknown meaning category")); }
            if category != "predicate" { return Err(need(&at(&p, "category"), "Only a pure predicate interpretation is supported")); }
            let returns = read_type(get(body, "result", &p)?, &at(&p, "result"))?;
            if returns != Type::Bool { return Err(need(&at(&p, "result"), "Predicate interpretation must return Bool")); }
            Ok(Definition::Meaning { parameters: read_parameters(get(body, "parameters", &p)?, &at(&p, "parameters"), true)?, returns, interpretation: reference_field(body, "interpretationRef", &p)? })
        }
        "data:query" => {
            keys(body, &p, &["inputRefs", "algebra", "result"], &["completenessRef", "consistencyRef"])?;
            let ip = at(&p, "inputRefs");
            let inputs = array(get(body, "inputRefs", &p)?, &ip)?.iter().enumerate().map(|(i, v)| reference(v, &at(&ip, &i.to_string()))).collect::<Result<Vec<_>>>()?;
            Ok(Definition::Query { inputs, algebra: read_query(get(body, "algebra", &p)?, &at(&p, "algebra"))?, result: read_type(get(body, "result", &p)?, &at(&p, "result"))? })
        }
        "core:interface" | "state:machine" | "event:stream" | "workflow:plan" | "api:protocol" | "data:model" | "ui:view" | "resource:model" | "concurrency:contract" | "security:policy" | "effect:port" | "observation:contract" | "quality:contract" | "product:component" | "product:system" | "product:deployment" | "native:implementation" | "extension:definition" | "intent:goal" | "semantic:pattern" | "semantic:pattern-use" | "req:composite" => Err(fail("NeedsMethod", path, format!("Definition {kind} requires its own qualified method"))),
        _ => Err(invalid(&at(path, "kind"), "Unknown Definition kind")),
    }
}

pub fn read_source(bytes: &[u8]) -> Result<Module> {
    let value = crate::source::decode(bytes)?.to_value();
    let o = object(&value, "")?;
    if string(o, "schema", "")? != "gift.author-module/2" {
        return Err(fail("UnsupportedAuthorSchema", "/schema", "This reader is locked to gift.author-module/2"));
    }
    keys(o, "", &["schema", "moduleId", "definitions", "exports", "imports", "dialects"], &["namespace", "annotations"])?;
    for key in ["imports", "dialects"] {
        if let Some(v) = o.get(key) {
            if !object(v, &at("", key))?.is_empty() { return Err(need(&at("", key), "This reader requires a closed module; no implicit import or dialect resolution")); }
        }
    }
    let module_id = string(o, "moduleId", "")?;
    if module_id.is_empty() { return Err(invalid("/moduleId", "moduleId must be nonempty")); }
    let local_definitions = object(get(o, "definitions", "")?, "/definitions")?;
    if local_definitions.is_empty() {
        return Err(invalid("/definitions", "A closed module must contain at least one local definition"));
    }
    let mut definitions = BTreeMap::new();
    for (key, value) in local_definitions {
        let p = at("/definitions", key);
        identifier(key.clone(), &p, false)?;
        definitions.insert(key.clone(), read_definition(value, &p)?);
    }
    let mut exports = BTreeMap::new();
    if let Some(value) = o.get("exports") {
        for (key, value) in object(value, "/exports")? {
            let p = at("/exports", key);
            identifier(key.clone(), &p, false)?;
            let export = object(value, &p)?;
            keys(export, &p, &["definitionId"], &["import", "export"])?;
            let definition = name(export, "definitionId", &p, false)?;
            if !definitions.contains_key(&definition) { return Err(fail("UnresolvedReference", &at(&p, "definitionId"), "Export does not resolve to a local definition")); }
            exports.insert(key.clone(), definition);
        }
    }
    Ok(Module { module_id, definitions, exports })
}
