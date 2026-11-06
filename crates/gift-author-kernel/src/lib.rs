//! Pure, bounded author compilation. Files, tools and mutable workspaces belong to the host.
pub mod model;
pub mod source;
pub mod grammar;
pub mod expansion;
pub mod reader;
pub mod binding;
pub mod lexical;
mod reference_slots;
mod typescript;

use std::collections::{BTreeMap, BTreeSet};
use serde::Serialize;
use sha2::{Digest, Sha256};
use model::{Diagnostic, Definition, Expr, ExprKind, Module, Query, QueryKind, Type, fail};

pub const METHOD: &str = "gift:finite-ordered-records/2";
pub const MAX_SOURCE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ValueType { Data(Type), Ordering }

#[derive(Clone, Debug, Serialize)]
pub struct Term {
    pub source: String,
    pub ty: ValueType,
    pub kind: TermKind,
}

#[derive(Clone, Debug, Serialize)]
pub enum TermKind {
    Int(String), Bool(bool), Text(String), Variable(String), Definition(String),
    Record(Vec<(String, Term)>), Sequence(Vec<Term>),
    Field(Box<Term>, String), Call(String, Vec<Term>), Primitive(Primitive, Vec<Term>),
    If(Box<Term>, Box<Term>, Box<Term>),
    Match(Box<Term>, BTreeMap<String, Term>),
}

#[derive(Clone, Copy, Debug, Serialize)]
pub enum Primitive { IntCompare, IntEq, IntAdd, IntSub, IntMul, BoolNot }

#[derive(Clone, Debug, Serialize)]
pub enum OrderedPlan {
    Scan { source: String, pointer: String },
    Filter { source: Box<OrderedPlan>, predicate: String, pointer: String },
}

#[derive(Clone, Debug, Serialize)]
pub enum LoweredDefinition {
    Type(Type),
    Constant { ty: Type, value: Term },
    Function { parameters: Vec<model::Parameter>, returns: Type, body: Term },
    Meaning { parameters: Vec<model::Parameter>, returns: Type, interpretation: String },
    Query { result: Type, plan: OrderedPlan },
}

#[derive(Clone, Debug, Serialize)]
pub struct UseBinding {
    /// Occurrence within this exact source; never a persistent runtime instance ID.
    pub occurrence: String,
    pub definition: String,
    pub roles: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Program {
    pub definitions: BTreeMap<String, LoweredDefinition>,
    pub order: Vec<String>,
    pub exports: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Artifact { pub path: String, pub content: String }

#[derive(Clone, Debug, Serialize)]
pub struct SourceMapping {
    pub definition: String,
    pub source_pointer: String,
    pub source_revision: String,
    pub artifact: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct Compilation {
    pub schema: &'static str,
    pub module_id: String,
    pub source_revision: String,
    pub semantic_revision: String,
    pub method: &'static str,
    pub program: Program,
    pub bindings: Vec<UseBinding>,
    pub dependencies: BTreeMap<String, BTreeSet<String>>,
    pub definition_revisions: BTreeMap<String, String>,
    pub artifacts: Vec<Artifact>,
    pub source_map: Vec<SourceMapping>,
}

fn digest(bytes: &[u8]) -> String { format!("sha256:{:x}", Sha256::digest(bytes)) }

pub fn compile(bytes: &[u8]) -> Result<Compilation, Diagnostic> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err(fail("ResourceLimit", "", "Author source exceeds the compiler input budget"));
    }
    let module = model::read_source(bytes)?;
    let source_revision = digest(bytes);
    let semantic_revision = digest(&serde_json::to_vec(&module).expect("serializable author model"));
    let mut checker = Checker {
        module: &module, definitions: BTreeMap::new(), order: Vec::new(), visiting: BTreeSet::new(),
        dependencies: BTreeMap::new(), bindings: Vec::new(), current: String::new(),
    };
    // The whole submitted module is checked: independent obligations are never dropped as dead code.
    for name in module.definitions.keys() { checker.definition(name, "/definitions")?; }
    for (public, name) in &module.exports {
        if !module.definitions.contains_key(name) {
            return Err(fail("UnresolvedReference", &format!("/exports/{public}"), name));
        }
        if matches!(checker.definitions.get(name), Some(LoweredDefinition::Function { .. } | LoweredDefinition::Meaning { .. })) {
            return Err(fail("NeedsTargetBridge", &format!("/exports/{public}"),
                "Callable exports require a qualified native input codec; TypeScript structural types do not ensure immutable records or Unicode scalar Text"));
        }
    }
    let definition_revisions = module.definitions.iter().map(|(name, definition)| {
        (name.clone(), digest(&serde_json::to_vec(definition).expect("serializable definition")))
    }).collect();
    let program = Program { definitions: checker.definitions, order: checker.order, exports: module.exports.clone() };
    let (artifacts, source_map) = typescript::emit(&program, &source_revision);
    Ok(Compilation {
        schema: "gift.author-compilation/1", module_id: module.module_id.clone(), source_revision,
        semantic_revision, method: METHOD, program, bindings: checker.bindings,
        dependencies: checker.dependencies, definition_revisions, artifacts, source_map,
    })
}

/// Sound impact for this closed module. Compilation is clean; no cache or incremental speed claim.
pub fn affected_exports(before: &Compilation, after: &Compilation) -> Vec<String> {
    fn closure(c: &Compilation, name: &str, seen: &mut BTreeSet<String>) {
        if !seen.insert(name.to_owned()) { return; }
        if let Some(deps) = c.dependencies.get(name) { for dep in deps { closure(c, dep, seen); } }
    }
    let changed: BTreeSet<_> = before.definition_revisions.keys().chain(after.definition_revisions.keys())
        .filter(|name| before.definition_revisions.get(*name) != after.definition_revisions.get(*name))
        .cloned().collect();
    let exports: BTreeSet<_> = before.program.exports.keys().chain(after.program.exports.keys()).cloned().collect();
    exports.into_iter().filter(|public| {
        if before.module_id != after.module_id || before.method != after.method ||
            before.program.exports.get(public) != after.program.exports.get(public) { return true; }
        let mut dependencies = BTreeSet::new();
        if let Some(name) = before.program.exports.get(public) { closure(before, name, &mut dependencies); }
        if let Some(name) = after.program.exports.get(public) { closure(after, name, &mut dependencies); }
        !dependencies.is_disjoint(&changed)
    }).collect()
}

struct Checker<'a> {
    module: &'a Module,
    definitions: BTreeMap<String, LoweredDefinition>,
    order: Vec<String>,
    visiting: BTreeSet<String>,
    dependencies: BTreeMap<String, BTreeSet<String>>,
    bindings: Vec<UseBinding>,
    current: String,
}

impl Checker<'_> {
    fn local(&self, reference: &str, path: &str) -> Result<String, Diagnostic> {
        let Some(name) = reference.strip_prefix("local:") else {
            return Err(fail("NeedsSemanticBridge", path, format!("Unbound module or primitive: {reference}")));
        };
        if !self.module.definitions.contains_key(name) {
            return Err(fail("UnresolvedReference", path, reference));
        }
        Ok(name.to_owned())
    }

    fn dependency(&mut self, reference: &str, path: &str) -> Result<String, Diagnostic> {
        let name = self.local(reference, path)?;
        self.dependencies.entry(self.current.clone()).or_default().insert(name.clone());
        self.definition(&name, path)?;
        Ok(name)
    }

    fn definition(&mut self, name: &str, path: &str) -> Result<(), Diagnostic> {
        if self.definitions.contains_key(name) { return Ok(()); }
        if self.visiting.len() >= 128 { return Err(fail("ResourceLimit", path, "Definition dependency depth exceeds budget")); }
        if !self.visiting.insert(name.to_owned()) {
            return Err(fail("NeedsMethod", path, format!("Recursive dependency {name} requires a qualified termination method")));
        }
        let previous = std::mem::replace(&mut self.current, name.to_owned());
        self.dependencies.entry(name.to_owned()).or_default();
        let definition = self.module.definitions.get(name).ok_or_else(|| fail("UnresolvedReference", path, name))?.clone();
        let pointer = format!("/definitions/{name}/body");
        let lowered = match definition {
            Definition::Type(ty) => LoweredDefinition::Type(ty),
            Definition::Constant { ty, value } => {
                let value = self.term(&value, &BTreeMap::new(), Some(&ty))?;
                require_type(&value, &ty)?;
                LoweredDefinition::Constant { ty, value }
            }
            Definition::Function { parameters, returns, body } => {
                let scope = parameters.iter().map(|p| (p.name.clone(), p.ty.clone())).collect();
                let body = self.term(&body, &scope, Some(&returns))?;
                require_type(&body, &returns)?;
                LoweredDefinition::Function { parameters, returns, body }
            }
            Definition::Meaning { parameters, returns, interpretation } => {
                let implementation = self.dependency(&interpretation, &pointer)?;
                let (actual_params, actual_result) = self.signature(&implementation, &pointer)?;
                if actual_params != parameters || actual_result != returns {
                    return Err(fail("TypeMismatch", &pointer, "Meaning roles and result must match the actual interpretation signature"));
                }
                self.bindings.push(UseBinding { occurrence: format!("{pointer}/interpretationRef"), definition: implementation.clone(), roles: BTreeMap::new() });
                LoweredDefinition::Meaning { parameters, returns, interpretation: implementation }
            }
            Definition::Query { inputs, algebra, result } => {
                let Type::Sequence(item) = &result else { return Err(fail("NeedsMethod", &pointer, "Ordered method requires a Sequence result")); };
                if !matches!(item.as_ref(), Type::Record(_)) { return Err(fail("NeedsMethod", &pointer, "Ordered record method requires record items")); }
                let mut scans = BTreeSet::new();
                let plan = self.query(&algebra, &result, item, &mut scans)?;
                let declared: BTreeSet<_> = inputs.iter().cloned().collect();
                if declared.len() != inputs.len() || declared != scans {
                    return Err(fail("InvalidQueryInputs", &pointer, "inputRefs must name exactly the distinct scan sources of this ordered plan"));
                }
                LoweredDefinition::Query { result, plan }
            }
        };
        self.current = previous;
        self.visiting.remove(name);
        self.order.push(name.to_owned());
        self.definitions.insert(name.to_owned(), lowered);
        Ok(())
    }

    fn signature(&self, name: &str, path: &str) -> Result<(Vec<model::Parameter>, Type), Diagnostic> {
        match self.definitions.get(name) {
            Some(LoweredDefinition::Function { parameters, returns, .. } | LoweredDefinition::Meaning { parameters, returns, .. }) => Ok((parameters.clone(), returns.clone())),
            _ => Err(fail("TypeMismatch", path, format!("{name} is not a callable definition"))),
        }
    }

    fn query(&mut self, query: &Query, sequence: &Type, row: &Type, scans: &mut BTreeSet<String>) -> Result<OrderedPlan, Diagnostic> {
        match &query.kind {
            QueryKind::Scan(reference) => {
                let name = self.dependency(reference, &query.path)?;
                match self.definitions.get(&name) {
                    Some(LoweredDefinition::Constant { ty, .. }) if ty == sequence => {},
                    _ => return Err(fail("NeedsMethod", &query.path, "Scan must resolve to a complete, static constant of exactly the ordered result type")),
                }
                scans.insert(reference.clone());
                self.bindings.push(UseBinding { occurrence: query.path.clone(), definition: name.clone(), roles: BTreeMap::new() });
                Ok(OrderedPlan::Scan { source: name, pointer: query.path.clone() })
            }
            QueryKind::Filter { source, predicate } => {
                let source = self.query(source, sequence, row, scans)?;
                let name = self.dependency(predicate, &query.path)?;
                let (parameters, returns) = self.signature(&name, &query.path)?;
                if parameters.len() != 1 || parameters[0].ty != *row || returns != Type::Bool {
                    return Err(fail("TypeMismatch", &query.path, "Filter requires a pure total Row -> Bool predicate"));
                }
                self.bindings.push(UseBinding { occurrence: query.path.clone(), definition: name.clone(), roles: BTreeMap::from([(parameters[0].name.clone(), source_pointer(&source).to_owned())]) });
                Ok(OrderedPlan::Filter { source: Box::new(source), predicate: name, pointer: query.path.clone() })
            }
        }
    }

    fn term(&mut self, expression: &Expr, scope: &BTreeMap<String, Type>, expected: Option<&Type>) -> Result<Term, Diagnostic> {
        let path = &expression.path;
        let (ty, kind) = match &expression.kind {
            ExprKind::Int(value) => {
                // Mature arbitrary-precision parser also checks accepted literal values; never f64/i64.
                value.parse::<num_bigint::BigInt>().map_err(|_| fail("InvalidAuthorSource", path, "Invalid exact integer"))?;
                (ValueType::Data(Type::Int), TermKind::Int(value.clone()))
            }
            ExprKind::Bool(value) => (ValueType::Data(Type::Bool), TermKind::Bool(*value)),
            ExprKind::Text(value) => (ValueType::Data(Type::Text), TermKind::Text(value.clone())),
            ExprKind::Var(name) => {
                let ty = scope.get(name).ok_or_else(|| fail("UnboundVariable", path, name))?;
                (ValueType::Data(ty.clone()), TermKind::Variable(name.clone()))
            }
            ExprKind::Symbol(reference) => {
                let name = self.dependency(reference, path)?;
                let Some(LoweredDefinition::Constant { ty, .. }) = self.definitions.get(&name) else {
                    return Err(fail("NeedsMethod", path, "Only constants are first-class values in this method"));
                };
                self.bindings.push(UseBinding { occurrence: path.clone(), definition: name.clone(), roles: BTreeMap::new() });
                (ValueType::Data(ty.clone()), TermKind::Definition(name))
            }
            ExprKind::Record(fields) => {
                let expected_fields = match expected { Some(Type::Record(fields)) => Some(fields), _ => None };
                let mut values = Vec::new();
                let mut types = BTreeMap::new();
                for (name, expr) in fields {
                    let value = self.term(expr, scope, expected_fields.and_then(|f| f.get(name)))?;
                    types.insert(name.clone(), data_type(&value)?.clone());
                    values.push((name.clone(), value));
                }
                (ValueType::Data(Type::Record(types)), TermKind::Record(values))
            }
            ExprKind::Sequence(items) => {
                let mut item_type = match expected { Some(Type::Sequence(item)) => Some(item.as_ref().clone()), _ => None };
                let mut values = Vec::new();
                for item in items {
                    let value = self.term(item, scope, item_type.as_ref())?;
                    if let Some(ty) = &item_type { require_type(&value, ty)?; }
                    else { item_type = Some(data_type(&value)?.clone()); }
                    values.push(value);
                }
                let item = item_type.ok_or_else(|| fail("NeedsType", path, "Empty sequence requires an exact expected item type"))?;
                (ValueType::Data(Type::Sequence(Box::new(item))), TermKind::Sequence(values))
            }
            ExprKind::Field { record, name } => {
                let value = self.term(record, scope, None)?;
                let ValueType::Data(Type::Record(fields)) = &value.ty else { return Err(fail("TypeMismatch", path, "Field access requires a closed record")); };
                let ty = fields.get(name).ok_or_else(|| fail("UnknownField", path, name))?.clone();
                (ValueType::Data(ty), TermKind::Field(Box::new(value), name.clone()))
            }
            ExprKind::Call { callee, arguments } => {
                let ExprKind::Symbol(reference) = &callee.kind else { return Err(fail("NeedsMethod", path, "Dynamic callable values require another method")); };
                if reference.starts_with("std:") {
                    let primitive = match reference.as_str() {
                        "std:IntCompare" => Primitive::IntCompare, "std:IntEq" => Primitive::IntEq,
                        "std:IntAdd" => Primitive::IntAdd, "std:IntSub" => Primitive::IntSub,
                        "std:IntMul" => Primitive::IntMul, "std:BoolNot" => Primitive::BoolNot,
                        _ => return Err(fail("NeedsMethod", &callee.path, reference)),
                    };
                    let boolean = matches!(primitive, Primitive::BoolNot);
                    let arity = if boolean { 1 } else { 2 };
                    if arguments.len() != arity { return Err(fail("ArityMismatch", path, reference)); }
                    let input = if boolean { Type::Bool } else { Type::Int };
                    let mut values = Vec::new();
                    for argument in arguments {
                        let value = self.term(argument, scope, Some(&input))?;
                        require_type(&value, &input)?; values.push(value);
                    }
                    let result = match primitive { Primitive::IntCompare => ValueType::Ordering, Primitive::IntEq | Primitive::BoolNot => ValueType::Data(Type::Bool), _ => ValueType::Data(Type::Int) };
                    self.bindings.push(UseBinding { occurrence: path.clone(), definition: reference.clone(), roles: arguments.iter().enumerate().map(|(i, a)| (i.to_string(), a.path.clone())).collect() });
                    (result, TermKind::Primitive(primitive, values))
                } else {
                    let name = self.dependency(reference, &callee.path)?;
                    let (parameters, result) = self.signature(&name, &callee.path)?;
                    if parameters.len() != arguments.len() { return Err(fail("ArityMismatch", path, reference)); }
                    let mut values = Vec::new();
                    let mut roles = BTreeMap::new();
                    for (parameter, argument) in parameters.iter().zip(arguments) {
                        let value = self.term(argument, scope, Some(&parameter.ty))?;
                        require_type(&value, &parameter.ty)?;
                        roles.insert(parameter.name.clone(), argument.path.clone()); values.push(value);
                    }
                    self.bindings.push(UseBinding { occurrence: path.clone(), definition: name.clone(), roles });
                    (ValueType::Data(result), TermKind::Call(name, values))
                }
            }
            ExprKind::If { condition, then, otherwise } => {
                let condition = self.term(condition, scope, Some(&Type::Bool))?;
                require_type(&condition, &Type::Bool)?;
                let then = self.term(then, scope, expected)?;
                let otherwise = self.term(otherwise, scope, Some(data_type(&then)?))?;
                if then.ty != otherwise.ty { return Err(fail("TypeMismatch", path, "if branches must have the same type")); }
                (then.ty.clone(), TermKind::If(Box::new(condition), Box::new(then), Box::new(otherwise)))
            }
            ExprKind::Match { value, cases } => {
                let value = self.term(value, scope, None)?;
                if value.ty != ValueType::Ordering { return Err(fail("NeedsMethod", path, "This method matches only the complete Ordering type")); }
                let mut branches = BTreeMap::new();
                let mut result_type = expected.cloned();
                for case in cases {
                    if !["Less", "Equal", "Greater"].contains(&case.constructor.as_str()) || branches.contains_key(&case.constructor) {
                        return Err(fail("InvalidMatch", path, "Ordering cases must be unique Less, Equal and Greater"));
                    }
                    // The no-payload binding has Unit type, unavailable in this method; shadowing is still real.
                    let mut branch_scope = scope.clone(); branch_scope.remove(&case.binding);
                    let branch = self.term(&case.body, &branch_scope, result_type.as_ref())?;
                    if let Some(ty) = &result_type { require_type(&branch, ty)?; }
                    else { result_type = Some(data_type(&branch)?.clone()); }
                    branches.insert(case.constructor.clone(), branch);
                }
                if branches.len() != 3 { return Err(fail("InvalidMatch", path, "Ordering match must be exhaustive")); }
                (ValueType::Data(result_type.expect("three branches")), TermKind::Match(Box::new(value), branches))
            }
        };
        let term = Term { source: path.clone(), ty, kind };
        if let Some(expected) = expected { require_type(&term, expected)?; }
        Ok(term)
    }
}

fn data_type(term: &Term) -> Result<&Type, Diagnostic> {
    match &term.ty { ValueType::Data(ty) => Ok(ty), _ => Err(fail("TypeMismatch", &term.source, "Ordering is not a data value of this method")) }
}
fn require_type(term: &Term, expected: &Type) -> Result<(), Diagnostic> {
    if term.ty == ValueType::Data(expected.clone()) { Ok(()) }
    else { Err(fail("TypeMismatch", &term.source, format!("Expected {expected:?}, received {:?}", term.ty))) }
}
fn source_pointer(plan: &OrderedPlan) -> &str {
    match plan { OrderedPlan::Scan { pointer, .. } | OrderedPlan::Filter { pointer, .. } => pointer }
}
