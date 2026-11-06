//! Production consumer of the fixed author_codec_spec short-form equations.
//! Expansion preserves occurrences and leaves strict structure/meaning checks to their owners.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::grammar::{MODULE, resolve};
use crate::model::{Diagnostic, fail};
use crate::source::{Kind, Node};

type Result<T> = std::result::Result<T, Diagnostic>;

const MAX_DEPTH: usize = 256;
const MAX_VISITS: usize = 1_000_000;
const MAX_DERIVED_NODES: usize = 400_000;

struct SchemaBranch<'a> {
    node: &'a Value,
    resource: String,
}

pub struct Expansion<'a> {
    graph: &'a BTreeMap<String, Value>,
    kinds: BTreeSet<String>,
    scalars: BTreeSet<String>,
    expressions: BTreeMap<String, Vec<SchemaBranch<'a>>>,
    expression_schema: &'a Value,
    execution_schema: &'a Value,
    sequence_collect_ref: Option<Node>,
}

impl<'a> Expansion<'a> {
    pub fn new(
        graph: &'a BTreeMap<String, Value>,
        sequence_collect_ref: Option<Node>,
    ) -> Result<Self> {
        let module = graph.get(MODULE).ok_or_else(|| graph_error("Candidate module resource is missing"))?;
        let definitions = module.pointer("/$defs/Definition/oneOf").and_then(Value::as_array)
            .ok_or_else(|| graph_error("Complete Definition union is missing"))?;
        let mut kinds = BTreeSet::new();
        for branch in definitions {
            let (branch, _) = resolve(graph, branch, MODULE)?;
            let kind = branch.pointer("/properties/kind/const").and_then(Value::as_str)
                .ok_or_else(|| graph_error("Complete Definition branch has no unique kind"))?;
            if !kinds.insert(kind.to_owned()) {
                return Err(graph_error("Complete Definition dispatch is ambiguous"));
            }
        }

        let types = module.pointer("/$defs/Type/oneOf").and_then(Value::as_array)
            .ok_or_else(|| graph_error("Complete Type union is missing"))?;
        let mut scalar_branches = Vec::new();
        for branch in types {
            let (branch, _) = resolve(graph, branch, MODULE)?;
            if branch.pointer("/properties/tag") == Some(&serde_json::json!({"const":"scalar"})) {
                scalar_branches.push(branch);
            }
        }
        if scalar_branches.len() != 1 {
            return Err(graph_error("Scalar Type owner is ambiguous"));
        }
        let scalars = scalar_branches[0].pointer("/properties/name/enum").and_then(Value::as_array)
            .ok_or_else(|| graph_error("Scalar Type names are missing"))?
            .iter().map(|name| name.as_str().map(str::to_owned)
                .ok_or_else(|| graph_error("Scalar Type name must be a string")))
            .collect::<Result<BTreeSet<_>>>()?;

        let mut expressions: BTreeMap<String, Vec<SchemaBranch<'a>>> = BTreeMap::new();
        let branches = module.pointer("/$defs/Expr/oneOf").and_then(Value::as_array)
            .ok_or_else(|| graph_error("Complete Expr union is missing"))?;
        for branch in branches {
            let (node, resource) = resolve(graph, branch, MODULE)?;
            if let Some(operation) = node.pointer("/properties/op/const").and_then(Value::as_str) {
                expressions.entry(operation.to_owned()).or_default().push(SchemaBranch { node, resource });
            }
        }
        let expression_schema = module.pointer("/$defs/Expr")
            .ok_or_else(|| graph_error("Complete Expr owner is missing"))?;
        let execution_schema = module.pointer("/$defs/ExecBody")
            .ok_or_else(|| graph_error("Complete ExecBody owner is missing"))?;
        let (expression_schema, _) = resolve(graph, expression_schema, MODULE)?;
        let (execution_schema, _) = resolve(graph, execution_schema, MODULE)?;
        Ok(Self { graph, kinds, scalars, expressions, expression_schema, execution_schema, sequence_collect_ref })
    }

    /// Each request owns its budget. No mutable state or cache escapes this call.
    pub fn expand(&self, slot: &str, value: &Node) -> Result<Node> {
        let mut run = Run { expansion: self, visits: 0, derived_nodes: 0 };
        run.dispatch(slot, value, 0)
    }
}

fn graph_error(message: &str) -> Diagnostic {
    fail("GrammarDrift", "", message)
}

fn invalid(source: &Node, message: impl Into<String>) -> Diagnostic {
    fail("InvalidAuthorSource", source.origin().map_or("", |origin| origin.pointer.as_str()), message)
}

fn object_at<'n>(value: &'n Node, slot: &str) -> Result<&'n BTreeMap<String, Node>> {
    value.as_object().ok_or_else(|| invalid(value, format!("{slot}: expected object")))
}

fn array_at<'n>(value: &'n Node, slot: &str) -> Result<&'n [Node]> {
    value.as_array().ok_or_else(|| invalid(value, format!("{slot}: expected array")))
}

fn required<'n>(object: &'n BTreeMap<String, Node>, key: &str, source: &Node) -> Result<&'n Node> {
    object.get(key).ok_or_else(|| invalid(source, format!("Required field {key} is missing")))
}

fn exactly(value: &Node, fields: &[&str], slot: &str) -> Result<()> {
    let object = object_at(value, slot)?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(invalid(value, format!("{slot}: unexpected or missing fields")));
    }
    Ok(())
}

fn identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn legacy_reference(value: &str) -> bool {
    value.split_once(':').is_some_and(|(alias, name)| identifier(alias) && identifier(name))
}

struct Run<'e, 'g> {
    expansion: &'e Expansion<'g>,
    visits: usize,
    derived_nodes: usize,
}

impl Run<'_, '_> {
    fn visit(&mut self, source: &Node, depth: usize) -> Result<()> {
        if depth > MAX_DEPTH || self.visits >= MAX_VISITS {
            return Err(fail("ResourceLimit", source.origin().map_or("", |origin| origin.pointer.as_str()), "Short-form expansion depth/visit budget exceeded"));
        }
        self.visits += 1;
        Ok(())
    }

    fn derived(&mut self, value: Node, source: &Node) -> Result<Node> {
        if self.derived_nodes >= MAX_DERIVED_NODES {
            return Err(fail("ResourceLimit", source.origin().map_or("", |origin| origin.pointer.as_str()), "Short-form expansion node budget exceeded"));
        }
        self.derived_nodes += 1;
        Ok(value.from_source(source))
    }

    fn string(&mut self, value: &str, source: &Node) -> Result<Node> {
        self.derived(Node::string(value), source)
    }

    fn object(&mut self, fields: BTreeMap<String, Node>, source: &Node) -> Result<Node> {
        self.derived(Node::object(fields), source)
    }

    fn array(&mut self, values: Vec<Node>, source: &Node) -> Result<Node> {
        self.derived(Node::array(values), source)
    }

    fn tagged(&mut self, discriminator: &str, name: &str, mut fields: BTreeMap<String, Node>, source: &Node) -> Result<Node> {
        fields.insert(discriminator.to_owned(), self.string(name, source)?);
        self.object(fields, source)
    }

    fn dispatch(&mut self, slot: &str, source: &Node, depth: usize) -> Result<Node> {
        match slot {
            "module_value" => self.module_value(source, depth),
            "definition" => self.definition(source, depth),
            "type" => self.ty(source, depth),
            "field" => self.field(source, depth),
            "arguments" => self.arguments(source, depth),
            "expression" => self.expression(source, depth),
            "formula" => self.formula(source, depth),
            "goal" => self.goal(source, depth),
            "state" => self.state(source, depth),
            _ => Err(invalid(source, format!("Unknown expansion slot {slot}"))),
        }
    }

    fn const_matches(&mut self, source: &Node, expected: &Value, depth: usize) -> Result<bool> {
        self.visit(source, depth)?;
        Ok(match (source.kind(), expected) {
            (Kind::Null, Value::Null) => true,
            (Kind::Bool(actual), Value::Bool(expected)) => actual == expected,
            (Kind::Number(actual), Value::Number(expected)) => actual == expected,
            (Kind::String(actual), Value::String(expected)) => actual == expected,
            (Kind::Array(actual), Value::Array(expected)) => {
                if actual.len() != expected.len() { return Ok(false); }
                for (actual, expected) in actual.iter().zip(expected) {
                    if !self.const_matches(actual, expected, depth + 1)? { return Ok(false); }
                }
                true
            }
            (Kind::Object(actual), Value::Object(expected)) => {
                if actual.len() != expected.len() { return Ok(false); }
                for (name, expected) in expected {
                    let Some(actual) = actual.get(name) else { return Ok(false); };
                    if !self.const_matches(actual, expected, depth + 1)? { return Ok(false); }
                }
                true
            }
            _ => false,
        })
    }

    fn branch_matches(&mut self, schema: &Value, resource: &str, value: &Node, depth: usize) -> Result<bool> {
        self.visit(value, depth)?;
        let (schema, resource) = resolve(self.expansion.graph, schema, resource)?;
        for union in ["oneOf", "anyOf"] {
            if let Some(branches) = schema.get(union).and_then(Value::as_array) {
                for branch in branches {
                    if self.branch_matches(branch, &resource, value, depth + 1)? { return Ok(true); }
                }
                return Ok(false);
            }
        }
        let Some(object) = value.as_object() else { return Ok(false); };
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for field in required {
                let name = field.as_str().ok_or_else(|| graph_error("Schema required field must be a string"))?;
                if !object.contains_key(name) { return Ok(false); }
            }
        }
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            for (name, property) in properties {
                if let Some(expected) = property.get("const") {
                    let Some(actual) = object.get(name) else { return Ok(false); };
                    if !self.const_matches(actual, expected, depth + 1)? { return Ok(false); }
                }
            }
        }
        Ok(true)
    }

    fn equivalent(&mut self, left: &Node, right: &Node, depth: usize, seen: &mut BTreeSet<(usize, usize)>) -> Result<bool> {
        self.visit(left, depth)?;
        if left.identity() == right.identity() || !seen.insert((left.identity(), right.identity())) { return Ok(true); }
        Ok(match (left.kind(), right.kind()) {
            (Kind::Null, Kind::Null) => true,
            (Kind::Bool(left), Kind::Bool(right)) => left == right,
            (Kind::Number(left), Kind::Number(right)) => left == right,
            (Kind::String(left), Kind::String(right)) => left == right,
            (Kind::Array(left), Kind::Array(right)) => {
                if left.len() != right.len() { return Ok(false); }
                for (left, right) in left.iter().zip(right) {
                    if !self.equivalent(left, right, depth + 1, seen)? { return Ok(false); }
                }
                true
            }
            (Kind::Object(left), Kind::Object(right)) => {
                if left.len() != right.len() { return Ok(false); }
                for (name, left) in left {
                    let Some(right) = right.get(name) else { return Ok(false); };
                    if !self.equivalent(left, right, depth + 1, seen)? { return Ok(false); }
                }
                true
            }
            _ => false,
        })
    }

    fn expression_slots(&mut self, schema: &Value, value: &Node, resource: &str, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let Some(schema_object) = schema.as_object() else { return Ok(value.clone()); };
        if let Some(reference) = schema_object.get("$ref").and_then(Value::as_str) {
            let (base, fragment) = reference.split_once('#').unwrap_or((reference, ""));
            let actual_resource = if base.is_empty() { resource } else { base };
            if actual_resource == MODULE && fragment == "/$defs/Expr" {
                return self.expression(value, depth + 1);
            }
            if actual_resource == MODULE && fragment == "/$defs/ExecBody" {
                if value.get("statements").is_some() { return Ok(value.clone()); }
                return self.expression(value, depth + 1);
            }
            let (target, target_resource) = resolve(self.expansion.graph, schema, resource)?;
            // Alias resolution retains graph references, so these identity checks
            // also recognize indirect and percent-encoded references to the owners.
            if std::ptr::eq(target, self.expansion.expression_schema) {
                return self.expression(value, depth + 1);
            }
            if std::ptr::eq(target, self.expansion.execution_schema) {
                if value.get("statements").is_some() { return Ok(value.clone()); }
                return self.expression(value, depth + 1);
            }
            return self.expression_slots(target, value, &target_resource, depth + 1);
        }
        let union = schema.get("oneOf").or_else(|| schema.get("anyOf")).and_then(Value::as_array);
        if let Some(branches) = union {
            let mut expanded: Option<Node> = None;
            for branch in branches {
                let (branch, branch_resource) = resolve(self.expansion.graph, branch, resource)?;
                if !self.branch_matches(branch, &branch_resource, value, depth + 1)? { continue; }
                let candidate = self.expression_slots(branch, value, &branch_resource, depth + 1)?;
                if let Some(previous) = &expanded {
                    if !self.equivalent(previous, &candidate, depth + 1, &mut BTreeSet::new())? {
                        return Err(invalid(value, "Short Expr has ambiguous Schema-owned child slots"));
                    }
                } else {
                    expanded = Some(candidate);
                }
            }
            return Ok(expanded.unwrap_or_else(|| value.clone()));
        }
        if let (Some(object), Some(properties)) = (value.as_object(), schema.get("properties").and_then(Value::as_object)) {
            let mut result = object.clone();
            for (name, child) in object {
                if let Some(child_schema) = properties.get(name) {
                    result.insert(name.clone(), self.expression_slots(child_schema, child, resource, depth + 1)?);
                }
            }
            return self.object(result, value);
        }
        if let (Some(array), Some(items)) = (value.as_array(), schema.get("items").filter(|items| items.is_object())) {
            let mut result = Vec::new();
            for child in array { result.push(self.expression_slots(items, child, resource, depth + 1)?); }
            return self.array(result, value);
        }
        Ok(value.clone())
    }

    fn expression(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let object = object_at(value, "Expr")?;
        if object.contains_key("op") { return Ok(value.clone()); }
        if object.len() != 1 { return Err(invalid(value, "Expr: expected one short constructor")); }
        let (operation, payload) = object.first_key_value().expect("one entry");
        if operation == "comprehension" { return self.comprehension(payload, value, depth + 1); }
        let expansion = self.expansion;
        let branches = expansion.expressions.get(operation)
            .ok_or_else(|| invalid(value, "Expr: unknown short constructor"))?;
        let mut complete = object_at(payload, "Short Expr payload")?.clone();
        if complete.contains_key("op") { return Err(invalid(payload, "Short Expr payload cannot override op")); }
        complete.insert("op".to_owned(), self.string(operation, value)?);
        let complete = self.object(complete, value)?;
        let mut chosen = None;
        for branch in branches {
            if self.branch_matches(branch.node, &branch.resource, &complete, depth + 1)? {
                if chosen.is_some() { return Err(invalid(value, "Short Expr requires one complete constructor branch")); }
                chosen = Some(branch);
            }
        }
        let chosen = chosen.ok_or_else(|| invalid(value, "Short Expr requires one complete constructor branch"))?;
        self.expression_slots(chosen.node, &complete, &chosen.resource, depth + 1)
    }

    fn comprehension(&mut self, payload: &Node, source: &Node, depth: usize) -> Result<Node> {
        self.visit(source, depth)?;
        exactly(payload, &["yield", "clauses"], "Sequence comprehension")?;
        let object = object_at(payload, "Sequence comprehension")?;
        let yield_source = required(object, "yield", payload)?;
        let yielded = self.expression(yield_source, depth + 1)?;
        let items = self.array(vec![yielded], yield_source)?;
        let mut result = self.tagged("op", "sequence", BTreeMap::from([("items".to_owned(), items)]), source)?;
        let clauses_source = required(object, "clauses", payload)?;
        let clauses = array_at(clauses_source, "Sequence qualifiers")?;
        for clause in clauses.iter().rev() {
            self.visit(clause, depth + 1)?;
            let choices = object_at(clause, "Sequence qualifier")?;
            if choices.len() != 1 { return Err(invalid(clause, "Sequence qualifier: expected one discriminator")); }
            let (mode, part) = choices.first_key_value().expect("one entry");
            match mode.as_str() {
                "where" => {
                    let condition = self.expression(part, depth + 1)?;
                    let empty_items = self.array(Vec::new(), clause)?;
                    let empty = self.tagged("op", "sequence", BTreeMap::from([("items".to_owned(), empty_items)]), clause)?;
                    result = self.tagged("op", "if", BTreeMap::from([
                        ("condition".to_owned(), condition), ("then".to_owned(), result), ("otherwise".to_owned(), empty),
                    ]), clause)?;
                }
                "from" | "let" => {
                    let value_key = if mode == "from" { "in" } else { "value" };
                    exactly(part, &["bind", value_key], "Sequence binding qualifier")?;
                    let part_object = object_at(part, "Sequence binding qualifier")?;
                    let name = required(part_object, "bind", part)?;
                    if !name.as_str().is_some_and(identifier) {
                        return Err(invalid(name, "Sequence binder requires the existing lexical Identifier"));
                    }
                    let expression = self.expression(required(part_object, value_key, part)?, depth + 1)?;
                    if mode == "from" {
                        let reference = self.expansion.sequence_collect_ref.as_ref().ok_or_else(|| {
                            fail("NeedsSurfaceBinding", source.origin().map_or("", |origin| origin.pointer.as_str()), "Sequence comprehension requires a qualified ordinary Collect binding")
                        })?.clone();
                        let parameter = self.object(BTreeMap::from([("name".to_owned(), name.clone())]), name)?;
                        let parameters = self.array(vec![parameter], clause)?;
                        let lambda = self.tagged("op", "lambda", BTreeMap::from([
                            ("params".to_owned(), parameters), ("body".to_owned(), result),
                        ]), clause)?;
                        let callee = self.tagged("op", "symbol", BTreeMap::from([("ref".to_owned(), reference)]), clause)?;
                        let arguments = self.array(vec![expression, lambda], clause)?;
                        result = self.tagged("op", "call", BTreeMap::from([
                            ("callee".to_owned(), callee), ("arguments".to_owned(), arguments),
                        ]), clause)?;
                    } else {
                        result = self.tagged("op", "let", BTreeMap::from([
                            ("name".to_owned(), name.clone()), ("value".to_owned(), expression), ("body".to_owned(), result),
                        ]), clause)?;
                    }
                }
                _ => return Err(invalid(clause, "Sequence qualifier: unknown discriminator")),
            }
        }
        Ok(result)
    }

    fn ty(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        if let Some(name) = value.as_str() {
            if self.expansion.scalars.contains(name) {
                let name = self.string(name, value)?;
                return self.tagged("tag", "scalar", BTreeMap::from([("name".to_owned(), name)]), value);
            }
            if legacy_reference(name) {
                return self.tagged("tag", "nominal", BTreeMap::from([("ref".to_owned(), value.clone())]), value);
            }
            return Err(invalid(value, "Type: unknown bare name"));
        }
        let object = object_at(value, "Type")?;
        if object.contains_key("tag") || object.contains_key("packElement") { return Ok(value.clone()); }
        if let Some(fields_source) = object.get("record") {
            exactly(value, &["record", "open"], "Short record Type")?;
            let mut fields = BTreeMap::new();
            for (name, field) in object_at(fields_source, "Record fields")? {
                fields.insert(name.clone(), self.field(field, depth + 1)?);
            }
            let fields = self.object(fields, fields_source)?;
            return self.tagged("tag", "record", BTreeMap::from([
                ("fields".to_owned(), fields), ("open".to_owned(), required(object, "open", value)?.clone()),
            ]), value);
        }
        if let Some(reference) = object.get("nominal") {
            exactly(value, &["nominal"], "Short nominal Type")?;
            return self.tagged("tag", "nominal", BTreeMap::from([("ref".to_owned(), reference.clone())]), value);
        }
        if let Some(flag) = object.get("rational") {
            exactly(value, &["rational"], "Short rational Type")?;
            if flag.as_bool() != Some(true) { return Err(invalid(flag, "Rational: expected true")); }
            return self.tagged("tag", "rational", BTreeMap::new(), value);
        }
        if let Some(payload) = object.get("wireVariant") {
            exactly(value, &["wireVariant"], "Short wire Type")?;
            let mut result = object_at(payload, "WireVariant payload")?.clone();
            if result.contains_key("tag") { return Err(invalid(payload, "WireVariant payload cannot override tag")); }
            if let Some(known) = result.get("known").cloned() {
                let mut fields = BTreeMap::new();
                for (name, ty) in object_at(&known, "Wire known")? {
                    fields.insert(name.clone(), self.ty(ty, depth + 1)?);
                }
                result.insert("known".to_owned(), self.object(fields, &known)?);
            }
            return self.tagged("tag", "wire-variant", result, value);
        }
        if object.len() == 1 {
            let (name, attributes) = object.first_key_value().expect("one entry");
            if self.expansion.scalars.contains(name) {
                let mut fields = object_at(attributes, "Scalar attributes")?.clone();
                if fields.contains_key("tag") || fields.contains_key("name") {
                    return Err(invalid(attributes, "Scalar attributes cannot override discriminator"));
                }
                fields.insert("name".to_owned(), self.string(name, value)?);
                return self.tagged("tag", "scalar", fields, value);
            }
        }
        Err(invalid(value, "Type: unknown or mixed short shape"))
    }

    fn field(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        if let Some(object) = value.as_object().filter(|object| object.contains_key("type")) {
            let mut result = object.clone();
            result.insert("type".to_owned(), self.ty(required(object, "type", value)?, depth + 1)?);
            return self.object(result, value);
        }
        let ty = self.ty(value, depth + 1)?;
        self.object(BTreeMap::from([("type".to_owned(), ty)]), value)
    }

    fn arguments(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let arguments = object_at(value, "Named arguments")?;
        let mut result = arguments.clone();
        for (name, argument) in arguments {
            let fields = object_at(argument, "Argument")?;
            if fields.len() == 1 && fields.contains_key("value") {
                let expression = self.expression(required(fields, "value", argument)?, depth + 1)?;
                let expanded = self.object(BTreeMap::from([("value".to_owned(), expression)]), argument)?;
                result.insert(name.clone(), expanded);
            } else if fields.len() != 1 || !fields.contains_key("binding") {
                return Err(invalid(argument, "Argument requires exactly binding or value"));
            }
        }
        self.object(result, value)
    }

    fn formula(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let object = object_at(value, "Formula")?;
        if object.contains_key("op") { return Ok(value.clone()); }
        if object.len() != 1 { return Err(invalid(value, "Formula: expected exactly one short discriminator")); }
        let (operation, payload) = object.first_key_value().expect("one entry");
        match operation.as_str() {
            "apply" => {
                exactly(payload, &["meaningRef", "arguments"], "Short Meaning application")?;
                let fields = object_at(payload, "Short Meaning application")?;
                let arguments = self.arguments(required(fields, "arguments", payload)?, depth + 1)?;
                self.tagged("op", "call", BTreeMap::from([
                    ("meaningRef".to_owned(), required(fields, "meaningRef", payload)?.clone()),
                    ("arguments".to_owned(), arguments),
                ]), value)
            }
            "all" | "any" => {
                let mut items = Vec::new();
                for item in array_at(payload, operation)? { items.push(self.formula(item, depth + 1)?); }
                let items = self.array(items, payload)?;
                self.tagged("op", operation, BTreeMap::from([("items".to_owned(), items)]), value)
            }
            "not" => {
                let item = self.formula(payload, depth + 1)?;
                self.tagged("op", "not", BTreeMap::from([("item".to_owned(), item)]), value)
            }
            "implies" | "iff" => {
                let operands = array_at(payload, operation)?;
                if operands.len() != 2 { return Err(invalid(payload, format!("{operation}: expected two operands"))); }
                // Expand each source occurrence once. Only these repeated uses share its Arc.
                let left = self.formula(&operands[0], depth + 1)?;
                let right = self.formula(&operands[1], depth + 1)?;
                let forward = self.tagged("op", "implies", BTreeMap::from([
                    ("if".to_owned(), left.clone()), ("then".to_owned(), right.clone()),
                ]), value)?;
                if operation == "implies" { return Ok(forward); }
                let backward = self.tagged("op", "implies", BTreeMap::from([
                    ("if".to_owned(), right), ("then".to_owned(), left),
                ]), value)?;
                let items = self.array(vec![forward, backward], payload)?;
                self.tagged("op", "all", BTreeMap::from([("items".to_owned(), items)]), value)
            }
            "quantify" | "temporal" => {
                let fields = object_at(payload, operation)?;
                if fields.contains_key("op") { return Err(invalid(payload, "Short Formula payload cannot override op")); }
                let mut result = fields.clone();
                let expression_key = if operation == "quantify" { "domain" } else { "range" };
                if let Some(expression) = fields.get(expression_key) {
                    result.insert(expression_key.to_owned(), self.expression(expression, depth + 1)?);
                }
                let formula_keys: &[&str] = if operation == "quantify" { &["predicate"] } else { &["item", "boundary"] };
                for key in formula_keys {
                    if let Some(formula) = fields.get(*key) {
                        result.insert((*key).to_owned(), self.formula(formula, depth + 1)?);
                    }
                }
                self.tagged("op", operation, result, value)
            }
            reference if legacy_reference(reference) => {
                let meaning = self.string(reference, value)?;
                self.tagged("op", "call", BTreeMap::from([
                    ("meaningRef".to_owned(), meaning), ("bindings".to_owned(), payload.clone()),
                ]), value)
            }
            _ => Err(invalid(value, "Formula: unknown short discriminator")),
        }
    }

    fn clause(&mut self, identity: &str, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let fields = object_at(value, "Goal clause")?;
        if fields.contains_key("id") || fields.contains_key("modality") {
            return Err(invalid(value, "Keyed clause cannot override id or modality"));
        }
        let modes: Vec<_> = fields.keys().filter(|name| {
            ["achieve", "maintain", "avoid", "oblige", "permit", "prefer"].contains(&name.as_str())
        }).collect();
        if modes.len() != 1 { return Err(invalid(value, "Clause requires exactly one modality")); }
        let mode = modes[0];
        let payload = required(fields, mode, value)?;
        let mut result;
        if ["achieve", "maintain", "avoid"].contains(&mode.as_str()) {
            if fields.contains_key("formula") { return Err(invalid(value, "Clause contains both short and full formula")); }
            result = fields.clone();
            result.remove(mode);
            result.insert("formula".to_owned(), self.formula(payload, depth + 1)?);
        } else {
            exactly(value, &[mode.as_str()], "Professional clause wrapper")?;
            let fields = object_at(payload, mode)?;
            if fields.contains_key("id") || fields.contains_key("modality") {
                return Err(invalid(payload, "Professional clause cannot override id or modality"));
            }
            result = fields.clone();
            if mode == "oblige" {
                for key in ["trigger", "fulfilment"] {
                    if let Some(formula) = fields.get(key) {
                        result.insert(key.to_owned(), self.formula(formula, depth + 1)?);
                    }
                }
            }
            if mode == "prefer" {
                if let Some(arguments_source) = fields.get("metricArguments") {
                    let mut arguments = BTreeMap::new();
                    for (term, values) in object_at(arguments_source, "Metric arguments")? {
                        arguments.insert(term.clone(), self.arguments(values, depth + 1)?);
                    }
                    result.insert("metricArguments".to_owned(), self.object(arguments, arguments_source)?);
                }
            }
        }
        result.insert("id".to_owned(), self.string(identity, value)?);
        result.insert("modality".to_owned(), self.string(mode, value)?);
        self.object(result, value)
    }

    fn goal(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let fields = object_at(value, "Goal Body")?;
        let mut result = fields.clone();
        if let Some(roles_source) = fields.get("roles") {
            let mut roles = BTreeMap::new();
            for (name, role) in object_at(roles_source, "Goal roles")? {
                let role = if let Some(reference) = role.as_str() {
                    if !legacy_reference(reference) {
                        return Err(invalid(role, "Short role requires a legacy Ref; use a typeRef object for other names"));
                    }
                    let cardinality = self.string("one", role)?;
                    self.object(BTreeMap::from([
                        ("typeRef".to_owned(), role.clone()), ("cardinality".to_owned(), cardinality),
                    ]), role)?
                } else {
                    role.clone()
                };
                roles.insert(name.clone(), role);
            }
            result.insert("roles".to_owned(), self.object(roles, roles_source)?);
        }
        if let Some(clauses_source) = fields.get("clauses") {
            if let Some(clauses) = clauses_source.as_object() {
                let mut expanded = Vec::new();
                for (identity, clause) in clauses { expanded.push(self.clause(identity, clause, depth + 1)?); }
                result.insert("clauses".to_owned(), self.array(expanded, clauses_source)?);
            }
        }
        if let Some(assumptions_source) = fields.get("assumptions") {
            let mut assumptions = Vec::new();
            for assumption in array_at(assumptions_source, "Assumptions")? {
                if let Some(object) = assumption.as_object().filter(|object| object.contains_key("formula")) {
                    let mut expanded = object.clone();
                    expanded.insert("formula".to_owned(), self.formula(required(object, "formula", assumption)?, depth + 1)?);
                    assumptions.push(self.object(expanded, assumption)?);
                } else {
                    assumptions.push(assumption.clone());
                }
            }
            result.insert("assumptions".to_owned(), self.array(assumptions, assumptions_source)?);
        }
        self.object(result, value)
    }

    fn state(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let fields = object_at(value, "State Body")?;
        let mut result = fields.clone();
        if let Some(events_source) = fields.get("events") {
            let mut events = Vec::new();
            for event in array_at(events_source, "Events")? {
                if event.as_str().is_some() {
                    let name = self.string("unit", event)?;
                    let payload = self.tagged("tag", "scalar", BTreeMap::from([("name".to_owned(), name)]), event)?;
                    events.push(self.object(BTreeMap::from([
                        ("name".to_owned(), event.clone()), ("payload".to_owned(), payload),
                    ]), event)?);
                } else {
                    events.push(event.clone());
                }
            }
            result.insert("events".to_owned(), self.array(events, events_source)?);
        }
        if let Some(transitions_source) = fields.get("transitions") {
            if let Some(transitions) = transitions_source.as_object() {
                if transitions.len() == 1 && transitions.contains_key("rules") {
                    let rules = required(transitions, "rules", transitions_source)?;
                    array_at(rules, "Transition rules")?;
                    result.insert("transitions".to_owned(), rules.clone());
                } else if transitions.len() == 1 && transitions.contains_key("table") {
                    let table_source = required(transitions, "table", transitions_source)?;
                    let mut rows = Vec::new();
                    for (state, events_source) in object_at(table_source, "Transition table")? {
                        for (event, target) in object_at(events_source, "State event table")? {
                            self.visit(target, depth + 1)?;
                            let from = self.string(state, events_source)?;
                            let event = self.string(event, target)?;
                            rows.push(self.object(BTreeMap::from([
                                ("from".to_owned(), from), ("event".to_owned(), event), ("to".to_owned(), target.clone()),
                            ]), target)?);
                        }
                    }
                    result.insert("transitions".to_owned(), self.array(rows, transitions_source)?);
                } else {
                    return Err(invalid(transitions_source, "Transitions require exactly table or rules"));
                }
            }
        }
        self.object(result, value)
    }

    fn definition(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let fields = object_at(value, "Definition")?;
        if fields.contains_key("kind") { return Ok(value.clone()); }
        let kinds: Vec<_> = fields.keys().filter(|name| self.expansion.kinds.contains(*name)).collect();
        if kinds.len() != 1 { return Err(invalid(value, "Definition requires exactly one known kind-key")); }
        let kind = kinds[0];
        if fields.contains_key("body") { return Err(invalid(value, "Definition contains both short and exact body")); }
        let body = required(fields, kind, value)?;
        let body = match kind.as_str() {
            "core:type" => {
                if let Some(fields) = body.as_object().filter(|fields| fields.contains_key("type")) {
                    let mut result = fields.clone();
                    result.insert("type".to_owned(), self.ty(required(fields, "type", body)?, depth + 1)?);
                    self.object(result, body)?
                } else {
                    let ty = self.ty(body, depth + 1)?;
                    self.object(BTreeMap::from([("type".to_owned(), ty)]), body)?
                }
            }
            "core:constant" => {
                let fields = object_at(body, "Constant Body")?;
                let mut result = fields.clone();
                if let Some(ty) = fields.get("type") {
                    result.insert("type".to_owned(), self.ty(ty, depth + 1)?);
                }
                if let Some(literal) = fields.get("literal") {
                    if fields.contains_key("value") || !fields.contains_key("type") {
                        return Err(invalid(body, "Constant literal requires type and excludes value"));
                    }
                    let ty = required(&result, "type", body)?.clone();
                    let literal = self.tagged("op", "literal", BTreeMap::from([
                        ("type".to_owned(), ty), ("value".to_owned(), literal.clone()),
                    ]), literal)?;
                    result.remove("literal");
                    result.insert("value".to_owned(), literal);
                } else if let Some(expression) = fields.get("value") {
                    result.insert("value".to_owned(), self.expression(expression, depth + 1)?);
                }
                self.object(result, body)?
            }
            "core:function" => {
                let fields = object_at(body, "Function Body")?;
                let mut result = fields.clone();
                if let Some(expression) = fields.get("body") {
                    if expression.get("statements").is_none() {
                        result.insert("body".to_owned(), self.expression(expression, depth + 1)?);
                    }
                }
                self.object(result, body)?
            }
            "intent:goal" => self.goal(body, depth + 1)?,
            "domain:meaning" => {
                let fields = object_at(body, "Meaning Body")?;
                let mut result = fields.clone();
                if let Some(formula) = fields.get("formula") {
                    result.insert("formula".to_owned(), self.formula(formula, depth + 1)?);
                }
                self.object(result, body)?
            }
            "state:machine" => self.state(body, depth + 1)?,
            _ => body.clone(),
        };
        let mut result = fields.clone();
        result.remove(kind);
        result.insert("body".to_owned(), body);
        result.insert("kind".to_owned(), self.string(kind, value)?);
        self.object(result, value)
    }

    fn module_value(&mut self, value: &Node, depth: usize) -> Result<Node> {
        self.visit(value, depth)?;
        let fields = object_at(value, "Module")?;
        if fields.get("schema").and_then(Node::as_str) != Some("gift.author-module/design-converged") {
            return Err(invalid(value, "Unsupported module codec"));
        }
        let definitions_source = required(fields, "definitions", value)?;
        let definitions = object_at(definitions_source, "Definitions")?;
        let mut expanded_definitions = BTreeMap::new();
        for (name, definition) in definitions {
            expanded_definitions.insert(name.clone(), self.definition(definition, depth + 1)?);
        }
        let mut result = fields.clone();
        result.insert("definitions".to_owned(), self.object(expanded_definitions, definitions_source)?);
        if let Some(imports_source) = fields.get("imports") {
            let mut imports = BTreeMap::new();
            for (alias, imported) in object_at(imports_source, "Imports")? {
                let fields = object_at(imported, "Import")?;
                if fields.contains_key("mode") {
                    imports.insert(alias.clone(), imported.clone());
                    continue;
                }
                let modes: Vec<_> = fields.keys().filter(|name| ["workspace", "locked"].contains(&name.as_str())).collect();
                if modes.len() != 1 || fields.contains_key("moduleId") {
                    return Err(invalid(imported, "Import requires one short mode and no moduleId"));
                }
                let mode = modes[0];
                let mut expanded = fields.clone();
                let module_id = required(fields, mode, imported)?.clone();
                expanded.remove(mode);
                expanded.insert("mode".to_owned(), self.string(mode, imported)?);
                expanded.insert("moduleId".to_owned(), module_id);
                imports.insert(alias.clone(), self.object(expanded, imported)?);
            }
            result.insert("imports".to_owned(), self.object(imports, imports_source)?);
        }
        if let Some(exports_source) = fields.get("exports") {
            let mut exports = BTreeMap::new();
            if let Some(names) = exports_source.as_array() {
                for name in names {
                    self.visit(name, depth + 1)?;
                    let public = name.as_str().ok_or_else(|| invalid(name, "Exports require distinct Names"))?;
                    if exports.contains_key(public) { return Err(invalid(name, "Exports require distinct Names")); }
                    if !definitions.contains_key(public) { return Err(invalid(name, "Same-name export has no local definition")); }
                    let export = self.object(BTreeMap::from([("definitionId".to_owned(), name.clone())]), name)?;
                    exports.insert(public.to_owned(), export);
                }
            } else {
                for (name, reference) in object_at(exports_source, "Exports")? {
                    let export = if reference.as_str().is_some() {
                        self.object(BTreeMap::from([("definitionId".to_owned(), reference.clone())]), reference)?
                    } else {
                        reference.clone()
                    };
                    exports.insert(name.clone(), export);
                }
            }
            result.insert("exports".to_owned(), self.object(exports, exports_source)?);
        }
        self.object(result, value)
    }
}
