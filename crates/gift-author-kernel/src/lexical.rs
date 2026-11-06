//! Capture-local lexical relations over the Reader's selected Schema navigation.
//! IDs describe this names/2 result. Types, effects, escape and runtime witnesses
//! retain their original consumers after a lexical relation has been established.
use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use crate::{binding::{Budget, DeclarationId, ModuleId}, grammar, model::{Diagnostic, fail},
    reader::{DecodedSource, Reader}, reference_slots::{Navigation, SHARED}, source::{Node, Origin}};

type Result<T> = std::result::Result<T, Diagnostic>;

macro_rules! arena_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
        #[serde(transparent)]
        pub struct $name(usize);
        impl $name { pub fn index(self) -> usize { self.0 } }
    };
}
arena_id!(OccurrenceId);
arena_id!(ScopeId);
arena_id!(LocalBindingId);

#[derive(Debug, Serialize)]
pub struct Occurrence {
    pub id: OccurrenceId,
    pub module: ModuleId,
    pub owner: Option<DeclarationId>,
    pub expanded_path: String,
    pub origin: Option<Origin>,
    pub schema_slot: String,
}
#[derive(Debug, Serialize)]
pub struct Scope {
    pub id: ScopeId,
    pub parent: Option<ScopeId>,
    pub occurrence: OccurrenceId,
    pub kind: &'static str,
}
#[derive(Debug, Serialize)]
pub struct LocalBinding {
    pub id: LocalBindingId,
    pub scope: ScopeId,
    pub occurrence: OccurrenceId,
    pub source_key: Option<String>,
    pub name: String,
    pub kind: String,
    pub domains: Vec<&'static str>,
    pub phase: &'static str,
    pub mutable: bool,
}
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum LocalResolution {
    Resolved { binding: LocalBindingId },
    Needs { code: &'static str },
    Rejected { code: &'static str },
}
#[derive(Debug, Serialize)]
pub struct LocalUse {
    pub occurrence: OccurrenceId,
    pub scope: ScopeId,
    pub domain: &'static str,
    pub selector: String,
    pub phase: &'static str,
    pub expected_kind: Option<String>,
    pub resolution: LocalResolution,
}
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ControlResolution {
    Resolved { scope: ScopeId },
    Needs { code: &'static str },
    Rejected { code: &'static str },
}
#[derive(Debug, Serialize)]
pub struct ControlExit {
    pub occurrence: OccurrenceId,
    pub kind: &'static str,
    pub target: ControlResolution,
}
#[derive(Debug, Serialize)]
pub struct Capture {
    pub scope: ScopeId,
    pub binding: LocalBindingId,
    pub occurrence: OccurrenceId,
}
#[derive(Debug, Serialize)]
pub struct RegionProblem { pub occurrence: OccurrenceId, pub code: &'static str }
#[derive(Debug, Default, Serialize)]
pub struct LexicalArena {
    pub occurrences: Vec<Occurrence>,
    pub scopes: Vec<Scope>,
    pub bindings: Vec<LocalBinding>,
    pub uses: Vec<LocalUse>,
    pub exits: Vec<ControlExit>,
    pub captures: Vec<Capture>,
    pub problems: Vec<RegionProblem>,
    pub pending_regions: Vec<RegionProblem>,
}

#[derive(Clone, Copy)]
struct Context {
    scope: ScopeId,
    phase: &'static str,
    unknown_outer: bool,
    function: Option<ScopeId>,
    loop_target: Option<ScopeId>,
}
#[derive(Default)]
struct Frame {
    semantic: BTreeMap<String, LocalBindingId>,
    values: BTreeMap<String, LocalBindingId>,
    semantic_barrier: bool,
}

struct Analyzer<'a> {
    reader: &'a Reader,
    navigation: &'a Navigation,
    module: ModuleId,
    owner: Option<DeclarationId>,
    arena: &'a mut LexicalArena,
    budget: &'a mut Budget,
    frames: BTreeMap<ScopeId, Frame>,
    occurrences: BTreeMap<String, OccurrenceId>,
    // These locator domains span one definition, including all nested scopes.
    keys: BTreeMap<(&'static str, String), Vec<LocalBindingId>>,
    captured: BTreeSet<(ScopeId, LocalBindingId, OccurrenceId)>,
    deferred_keys: Vec<(usize, &'static str, String)>,
}

impl Analyzer<'_> {
    fn node(&self, path: &str) -> Option<Node> {
        self.navigation.sites.get(path).map(|site| site.node.clone())
    }
    fn owner_at(&self, path: &str, resource: &str, definition: &str) -> bool {
        self.navigation.sites.get(path).is_some_and(|site| site.schemas.iter().any(|schema| {
            schema.split_once('#').is_some_and(|(r, p)| r == resource && p.strip_prefix("/$defs/") == Some(definition))
        }))
    }
    fn has(&self, path: &str, definition: &str) -> bool {
        self.owner_at(path, grammar::MODULE, definition) || self.owner_at(path, SHARED, definition)
    }
    fn path(&mut self, parent: &str, field: &str) -> Result<String> { self.budget.child_path(parent, field) }
    fn occurrence(&mut self, path: &str, node: &Node) -> Result<OccurrenceId> {
        self.budget.work(1)?;
        if let Some(id) = self.occurrences.get(path) { return Ok(*id); }
        self.budget.charge(256)?;
        let expanded_path = self.budget.copy(path)?;
        let index_key = self.budget.copy(path)?;
        let origin = self.budget.origin(node)?;
        let schema = self.navigation.sites.get(path).and_then(|site| site.schemas.iter().next())
            .map(String::as_str).unwrap_or(grammar::MODULE);
        let schema_slot = self.budget.copy(schema)?;
        let id = OccurrenceId(self.arena.occurrences.len());
        self.arena.occurrences.push(Occurrence { id, module: self.module, owner: self.owner, expanded_path, origin, schema_slot });
        self.occurrences.insert(index_key, id);
        Ok(id)
    }
    fn region(&mut self, occurrence: OccurrenceId, code: &'static str, pending: bool) -> Result<()> {
        self.budget.charge(96)?;
        let regions = if pending { &mut self.arena.pending_regions } else { &mut self.arena.problems };
        regions.push(RegionProblem { occurrence, code });
        Ok(())
    }
    fn scope(&mut self, context: Option<Context>, occurrence: OccurrenceId, kind: &'static str) -> Result<Context> {
        self.budget.charge(384)?;
        let id = ScopeId(self.arena.scopes.len());
        self.arena.scopes.push(Scope { id, parent: context.map(|c| c.scope), occurrence, kind });
        self.frames.insert(id, Frame::default());
        let mut child = context.unwrap_or(Context { scope: id, phase: "unknown", unknown_outer: true, function: None, loop_target: None });
        child.scope = id;
        if kind == "function" || kind == "lambda" {
            child.function = Some(id);
            child.loop_target = None;
        } else if kind == "loop" { child.loop_target = Some(id); }
        Ok(child)
    }
    fn bind(&mut self, node: &Node, path: &str, context: Context, kind: &str, semantic: bool, mutable: bool) -> Result<()> {
        self.budget.work(1)?;
        let occurrence = self.occurrence(path, node)?;
        let name = node.get("name").and_then(Node::as_str)
            .ok_or_else(|| fail("ReaderInvariant", path, "Lexical declaration has no validated name"))?;
        let source_key = node.get("key").and_then(Node::as_str);
        let domains: &[&'static str] = if semantic && kind == "Value" { &["semantic", "value"] }
            else if semantic { &["semantic"] } else { &["value"] };
        self.budget.charge(320 + domains.len() * 32)?;
        let id = LocalBindingId(self.arena.bindings.len());
        let name_owned = self.budget.copy(name)?;
        let kind_owned = self.budget.copy(kind)?;
        let key_owned = source_key.map(|key| self.budget.copy(key)).transpose()?;
        self.arena.bindings.push(LocalBinding { id, scope: context.scope, occurrence, source_key: key_owned,
            name: name_owned, kind: kind_owned, domains: domains.to_vec(), phase: if semantic { "static" } else { context.phase }, mutable });
        for domain in domains {
            let name = self.budget.copy(name)?;
            let frame = self.frames.get_mut(&context.scope).expect("allocated scope");
            let names = if *domain == "semantic" { &mut frame.semantic } else { &mut frame.values };
            if let std::collections::btree_map::Entry::Vacant(entry) = names.entry(name) { entry.insert(id); }
            else { self.region(occurrence, "DuplicateBindingName", false)?; }
            if let Some(key) = source_key {
                let key = self.budget.copy(key)?;
                self.budget.charge(96)?;
                let ids = self.keys.entry((*domain, key)).or_default();
                let duplicate = !ids.is_empty();
                ids.push(id);
                if duplicate { self.region(occurrence, "DuplicateBindingKey", false)?; }
            }
        }
        Ok(())
    }
    fn lookup(&mut self, context: Context, selector: &str, domain: &'static str, keyed: bool) -> Result<LocalResolution> {
        let target = if keyed {
            self.budget.text(selector)?;
            match self.keys.get(&(domain, selector.into())) {
                Some(ids) if ids.len() == 1 => Some(ids[0]),
                Some(_) => return Ok(LocalResolution::Rejected { code: "DuplicateBindingKey" }),
                None => None,
            }
        } else { None };
        let name = target.map(|id| self.arena.bindings[id.0].name.as_str()).unwrap_or(selector);
        let mut scope = Some(context.scope);
        while let Some(id) = scope {
            self.budget.work(1)?;
            let frame = self.frames.get(&id).expect("scope frame");
            let names = if domain == "semantic" { &frame.semantic } else { &frame.values };
            if let Some(binding) = names.get(name).filter(|_| !keyed || target.is_some()) {
                if !keyed || target == Some(*binding) { return Ok(LocalResolution::Resolved { binding: *binding }); }
                return Ok(LocalResolution::Rejected { code: "ShadowedBinding" });
            }
            if domain == "semantic" && frame.semantic_barrier {
                return Ok(LocalResolution::Needs { code: "NeedsExpectedLambdaSignature" });
            }
            scope = self.arena.scopes[id.0].parent;
        }
        if keyed && target.is_some() { return Ok(LocalResolution::Rejected { code: "BindingNotVisible" }); }
        Ok(if context.unknown_outer { LocalResolution::Needs { code: "NeedsOuterBindingEnvironment" } }
            else { LocalResolution::Rejected { code: "MissingLocalBinding" } })
    }
    fn use_binding(&mut self, node: &Node, path: &str, context: Context, selector: &str,
        domain: &'static str, keyed: bool, expected: Option<&str>, write: bool) -> Result<()> {
        let occurrence = self.occurrence(path, node)?;
        let mut resolution = self.lookup(context, selector, domain, keyed)?;
        if let LocalResolution::Resolved { binding } = resolution {
            let declaration = &self.arena.bindings[binding.0];
            resolution = if expected.is_some_and(|kind| kind != declaration.kind) {
                LocalResolution::Rejected { code: "BindingKindMismatch" }
            } else if context.phase == "static" && declaration.phase == "runtime" {
                LocalResolution::Rejected { code: "BindingPhaseMismatch" }
            } else if context.phase == "static" && declaration.phase == "unknown" {
                LocalResolution::Needs { code: "NeedsBindingPhase" }
            } else if write && !declaration.mutable {
                LocalResolution::Rejected { code: "ImmutableBindingWrite" }
            } else { LocalResolution::Resolved { binding } };
            if domain == "value" && matches!(resolution, LocalResolution::Resolved { .. }) {
                self.capture(context.scope, binding, occurrence)?;
            }
        }
        match resolution {
            LocalResolution::Needs { code } => self.region(occurrence, code, true)?,
            LocalResolution::Rejected { code } => self.region(occurrence, code, false)?,
            _ => (),
        }
        self.budget.charge(192)?;
        let selector = self.budget.copy(selector)?;
        let expected_kind = expected.map(|kind| self.budget.copy(kind)).transpose()?;
        if keyed && matches!(resolution, LocalResolution::Needs { code: "NeedsOuterBindingEnvironment" }) {
            self.budget.charge(96)?;
            let key = self.budget.copy(&selector)?;
            self.deferred_keys.push((self.arena.uses.len(), domain, key));
        }
        self.arena.uses.push(LocalUse { occurrence, scope: context.scope, domain, selector, phase: context.phase, expected_kind, resolution });
        Ok(())
    }
    fn capture(&mut self, mut scope: ScopeId, binding: LocalBindingId, occurrence: OccurrenceId) -> Result<()> {
        let owner = self.arena.bindings[binding.0].scope;
        while scope != owner {
            self.budget.work(1)?;
            if self.arena.scopes[scope.0].kind == "lambda" {
                self.budget.charge(128)?;
                if self.captured.insert((scope, binding, occurrence)) { self.arena.captures.push(Capture { scope, binding, occurrence }); }
            }
            let Some(parent) = self.arena.scopes[scope.0].parent else { break; };
            scope = parent;
        }
        Ok(())
    }
    fn child(&mut self, path: &str, key: &str, context: Context, depth: usize) -> Result<()> {
        let path = self.path(path, key)?;
        self.walk(&path, context, depth + 1)
    }
    fn children_except(&mut self, path: &str, node: &Node, context: Context, depth: usize, excluded: &[&str]) -> Result<()> {
        if let Some(object) = node.as_object() {
            for key in object.keys().filter(|key| !excluded.contains(&key.as_str())) { self.child(path, key, context, depth)?; }
        } else if let Some(array) = node.as_array() {
            for i in 0..array.len() { self.child(path, &i.to_string(), context, depth)?; }
        }
        Ok(())
    }
    fn semantic_parameters(&mut self, node: &Node, path: &str, field: &str, context: Context, depth: usize) -> Result<()> {
        let Some(parameters) = node.get(field).and_then(Node::as_array) else { return Ok(()); };
        let parameters_path = self.path(path, field)?;
        for (index, parameter) in parameters.iter().enumerate() {
            let parameter_path = self.path(&parameters_path, &index.to_string())?;
            // The exact graph owns whether these are semantic binders.
            if !self.has(&parameter_path, "TypeParam") && !self.has(&parameter_path, "SemanticParameter") { continue; }
            let kind_node = parameter.get("kind");
            let kind = kind_node.and_then(Node::as_str).unwrap_or_else(|| {
                if kind_node.is_some_and(|kind| kind.get("value").is_some()) { "Value" }
                else if kind_node.is_some_and(|kind| kind.get("constructor").is_some()) { "constructor" }
                else if kind_node.is_some_and(|kind| kind.get("pack").is_some()) { "pack" }
                else { "Type" }
            });
            self.bind(parameter, &parameter_path, context, kind, true, false)?;
        }
        // A common parameter list is one mutually visible binder group.
        // Its kind/constraint dependencies are checked after every head exists.
        for (index, parameter) in parameters.iter().enumerate() {
            let parameter_path = self.path(&parameters_path, &index.to_string())?;
            if self.has(&parameter_path, "TypeParam") || self.has(&parameter_path, "SemanticParameter") {
                self.children_except(&parameter_path, parameter, Context { phase: "static", ..context }, depth + 1, &[])?;
            }
        }
        Ok(())
    }
    fn runtime_parameters(&mut self, node: &Node, path: &str, field: &str, context: Context, depth: usize) -> Result<()> {
        let Some(parameters) = node.get(field).and_then(Node::as_array) else { return Ok(()); };
        let parameters_path = self.path(path, field)?;
        for (index, parameter) in parameters.iter().enumerate() {
            let parameter_path = self.path(&parameters_path, &index.to_string())?;
            self.children_except(&parameter_path, parameter, Context { phase: "static", ..context }, depth + 1, &[])?;
        }
        for (index, parameter) in parameters.iter().enumerate() {
            let parameter_path = self.path(&parameters_path, &index.to_string())?;
            self.bind(parameter, &parameter_path, context, "runtime_parameter", false, false)?;
        }
        Ok(())
    }
    fn function_definition(&self, path: &str) -> bool {
        self.navigation.sites.get(path).is_some_and(|site| site.schemas.iter().any(|uri| {
            let Some((resource, fragment)) = uri.split_once('#') else { return false; };
            resource == grammar::MODULE && self.reader.graph().get(resource).and_then(|root| root.pointer(fragment))
                .and_then(|schema| schema.pointer("/properties/kind/const")).and_then(Value::as_str) == Some("core:function")
        }))
    }
    fn walk(&mut self, path: &str, context: Context, depth: usize) -> Result<()> {
        self.budget.work(1)?;
        if depth > 192 { return Err(fail("ResourceLimit", path, "Lexical analysis depth budget exceeded")); }
        let Some(node) = self.node(path) else { return Ok(()); };
        let occurrence = self.occurrence(path, &node)?;
        if self.function_definition(path) {
            let body = node.get("body").ok_or_else(|| fail("ReaderInvariant", path, "Function body absent"))?;
            let body_path = self.path(path, "body")?;
            let mut function = self.scope(Some(context), occurrence, "function")?;
            function.phase = "runtime";
            function.unknown_outer = false;
            self.semantic_parameters(body, &body_path, "typeParams", function, depth)?;
            self.runtime_parameters(body, &body_path, "parameters", function, depth)?;
            return self.children_except(&body_path, body, function, depth, &["typeParams", "parameters"]);
        }
        if self.owner_at(path, grammar::MODULE, "Expr") {
            return self.expression(path, &node, context, depth, false);
        }
        if self.owner_at(path, SHARED, "Expr") || self.owner_at(path, SHARED, "ClosedExpr") {
            let context = if context.phase == "unknown" { Context { phase: "static", ..context } } else { context };
            return self.expression(path, &node, context, depth, true);
        }
        if self.owner_at(path, grammar::MODULE, "ExecBlock") { return self.block(path, &node, context, depth); }
        if self.owner_at(path, grammar::MODULE, "ExecStatement") { return self.statement(path, &node, context, depth); }
        if self.has(path, "Type") || self.has(path, "TypeTerm") || self.has(path, "FunctionType") {
            return self.ty(path, &node, context, depth);
        }
        if self.has(path, "SemanticArgument") || self.has(path, "PackElement") {
            return self.children_except(path, &node, Context { phase: "static", ..context }, depth, &[]);
        }
        if self.has(path, "ParameterRef") {
            let selector = node.get("parameter").and_then(Node::as_str).ok_or_else(|| fail("ReaderInvariant", path, "ParameterRef has no selector"))?;
            let expected = self.expected_parameter_kind(path);
            return self.use_binding(&node, path, Context { phase: "static", ..context }, selector, "semantic",
                self.owner_at(path, SHARED, "ParameterRef"), expected, false);
        }
        if self.has(path, "Pattern") { return self.pattern(path, &node, context, depth); }
        // A semantic parameter list is recognized by its actual item Schema,
        // independent of the enclosing professional Definition kind.
        let parameters = node.get("typeParams").and_then(Node::as_array);
        if parameters.is_some() {
            let first_path = self.path(path, "typeParams")?;
            let first_path = self.path(&first_path, "0")?;
            if self.has(&first_path, "TypeParam") || self.has(&first_path, "SemanticParameter") {
                let semantic = self.scope(Some(context), occurrence, "semantic")?;
                self.semantic_parameters(&node, path, "typeParams", semantic, depth)?;
                return self.children_except(path, &node, semantic, depth, &["typeParams"]);
            }
        }
        self.children_except(path, &node, context, depth, &[])
    }
    fn expected_parameter_kind(&self, path: &str) -> Option<&'static str> {
        if self.has(path, "ConstructorTerm") { return Some("constructor"); }
        if self.has(path, "PackTerm") { return Some("pack"); }
        let field = path.rsplit('/').next().unwrap_or("");
        match field {
            "region" => Some("Region"), "scope" => Some("Scope"), "tail" => Some("EffectRow"),
            _ => None,
        }
    }
    fn ty(&mut self, path: &str, node: &Node, context: Context, depth: usize) -> Result<()> {
        let context = Context { phase: "static", ..context };
        if node.get("tag").and_then(Node::as_str) == Some("param") {
            let name = node.get("name").and_then(Node::as_str).expect("validated Type.param");
            return self.use_binding(node, path, context, name, "semantic", false, Some("Type"), false);
        }
        if let Some(key) = node.get("parameter").and_then(Node::as_str) {
            return self.use_binding(node, path, context, key, "semantic",
                self.owner_at(path, SHARED, "TypeTerm"), Some("Type"), false);
        }
        if node.get("hole").is_some() {
            let occurrence = self.occurrence(path, node)?;
            self.region(occurrence, "NeedsTypeHole", true)?;
        }
        if node.get("tag").and_then(Node::as_str) == Some("exists") {
            let occurrence = self.occurrence(path, node)?;
            let semantic = self.scope(Some(context), occurrence, "semantic")?;
            self.semantic_parameters(node, path, "parameters", semantic, depth)?;
            return self.children_except(path, node, semantic, depth, &["parameters"]);
        }
        if let Some(exists) = node.get("exists") {
            let exists_path = self.path(path, "exists")?;
            let occurrence = self.occurrence(&exists_path, exists)?;
            let semantic = self.scope(Some(context), occurrence, "semantic")?;
            self.semantic_parameters(exists, &exists_path, "parameters", semantic, depth)?;
            return self.children_except(&exists_path, exists, semantic, depth, &["parameters"]);
        }
        if self.has(path, "FunctionType") || node.get("tag").and_then(Node::as_str) == Some("function") {
            let occurrence = self.occurrence(path, node)?;
            let semantic = self.scope(Some(context), occurrence, "semantic")?;
            self.semantic_parameters(node, path, "typeParams", semantic, depth)?;
            return self.children_except(path, node, semantic, depth, &["typeParams"]);
        }
        self.children_except(path, node, context, depth, &[])
    }
    fn expression(&mut self, path: &str, node: &Node, context: Context, depth: usize, shared: bool) -> Result<()> {
        let discriminator = if shared { "tag" } else { "op" };
        let operation = node.get(discriminator).and_then(Node::as_str).unwrap_or("");
        let occurrence = self.occurrence(path, node)?;
        match operation {
            "var" if !shared => {
                let name = node.get("name").and_then(Node::as_str).expect("validated variable");
                self.use_binding(node, path, context, name, "value", false, None, false)
            }
            "reference" if shared => {
                let reference = node.get("ref").expect("validated reference");
                if let Some(key) = reference.get("binding").and_then(Node::as_str) {
                    self.use_binding(node, path, context, key, "value", true, None, false)?;
                } else if reference.get("resultOf").is_some() {
                    self.region(occurrence, "NeedsPostconditionEnvironment", true)?;
                }
                self.children_except(path, node, context, depth, &[])
            }
            "let" => {
                let initial = if shared { "initializer" } else { "value" };
                let continuation = if shared { "continuation" } else { "body" };
                self.child(path, initial, context, depth)?;
                let local = self.scope(Some(context), occurrence, "let")?;
                if shared {
                    let binding = node.get("binding").expect("validated let Binding");
                    let binding_path = self.path(path, "binding")?;
                    self.children_except(&binding_path, binding, Context { phase: "static", ..context }, depth, &[])?;
                    self.bind(binding, &binding_path, local, "let", false, false)?;
                } else { self.bind(node, path, local, "let", false, false)?; }
                self.child(path, continuation, local, depth)
            }
            "lambda" => {
                let mut lambda = self.scope(Some(context), occurrence, "lambda")?;
                lambda.phase = "runtime";
                if node.get("typeParams").is_none() {
                    self.frames.get_mut(&lambda.scope).expect("lambda frame").semantic_barrier = true;
                    self.region(occurrence, "NeedsExpectedLambdaSignature", true)?;
                }
                self.semantic_parameters(node, path, "typeParams", lambda, depth)?;
                self.runtime_parameters(node, path, "params", lambda, depth)?;
                self.children_except(path, node, lambda, depth, &["typeParams", "params"])
            }
            "region" if shared => {
                let block = self.scope(Some(context), occurrence, "block")?;
                if let Some(bindings) = node.get("bindings").and_then(Node::as_array) {
                    let bindings_path = self.path(path, "bindings")?;
                    for (i, item) in bindings.iter().enumerate() {
                        let item_path = self.path(&bindings_path, &i.to_string())?;
                        self.child(&item_path, "initializer", block, depth)?;
                        let binding = item.get("binding").expect("validated region binding");
                        let binding_path = self.path(&item_path, "binding")?;
                        self.children_except(&binding_path, binding, Context { phase: "static", ..block }, depth, &[])?;
                        self.bind(binding, &binding_path, block, "let", false, false)?;
                    }
                }
                self.child(path, "expression", block, depth)
            }
            "if" => {
                self.child(path, "condition", context, depth)?;
                for field in ["then", "otherwise"] {
                    let branch_path = self.path(path, field)?;
                    if let Some(branch) = self.node(&branch_path) {
                        let occurrence = self.occurrence(&branch_path, &branch)?;
                        let branch_context = self.scope(Some(context), occurrence, "branch")?;
                        self.walk(&branch_path, branch_context, depth + 1)?;
                    }
                }
                Ok(())
            }
            "match" => {
                self.child(path, if shared { "subject" } else { "value" }, context, depth)?;
                let field = if shared { "arms" } else { "cases" };
                let arms_path = self.path(path, field)?;
                if let Some(arms) = node.get(field).and_then(Node::as_array) {
                    for (index, arm) in arms.iter().enumerate() {
                        let arm_path = self.path(&arms_path, &index.to_string())?;
                        let occurrence = self.occurrence(&arm_path, arm)?;
                        let branch = self.scope(Some(context), occurrence, "match_arm")?;
                        if shared { self.child(&arm_path, "pattern", branch, depth)?; }
                        else {
                            let name = arm.get("binding").expect("validated MatchCase.binding");
                            self.budget.charge(256)?;
                            let binding = Node::object(BTreeMap::from([("name".into(), name.clone())])).from_source(name);
                            self.bind(&binding, &arm_path, branch, "pattern", false, false)?;
                        }
                        self.child(&arm_path, if shared { "expression" } else { "body" }, branch, depth)?;
                    }
                }
                Ok(())
            }
            "try" if !shared => {
                let body = self.scope(Some(context), occurrence, "try_body")?;
                self.child(path, "body", body, depth)?;
                let handler = self.scope(Some(context), occurrence, "handler")?;
                let name = node.get("errorName").expect("validated errorName");
                self.budget.charge(256)?;
                let binding = Node::object(BTreeMap::from([("name".into(), name.clone())])).from_source(name);
                self.bind(&binding, path, handler, "handler", false, false)?;
                self.child(path, "onError", handler, depth)
            }
            "hole" if shared => self.region(occurrence, "NeedsExpressionHole", true),
            // Nonbinding constructors keep their exact Schema-owned children.
            // This covers calls, records, literals, field access and every
            // currently selected arithmetic, sequence and effect expression.
            _ => self.children_except(path, node, context, depth, &[]),
        }
    }
    fn pattern(&mut self, path: &str, node: &Node, context: Context, depth: usize) -> Result<()> {
        let mut bindings = Vec::new();
        self.pattern_inputs(path, node, context, depth, &mut bindings)?;
        for (binding, binding_path) in bindings {
            self.bind(&binding, &binding_path, context, "pattern", false, false)?;
        }
        Ok(())
    }
    fn pattern_inputs(&mut self, path: &str, node: &Node, context: Context, depth: usize,
        bindings: &mut Vec<(Node, String)>) -> Result<()> {
        self.budget.work(1)?;
        if depth > 192 { return Err(fail("ResourceLimit", path, "Pattern analysis depth budget exceeded")); }
        match node.get("tag").and_then(Node::as_str).unwrap_or("") {
            "bind" | "cons" => {
                let fields: &[&str] = if node.get("tag").and_then(Node::as_str) == Some("bind") { &["binding"] } else { &["head", "tail"] };
                for field in fields {
                    let binding = node.get(field).expect("validated pattern binding");
                    let binding_path = self.path(path, field)?;
                    self.children_except(&binding_path, binding, Context { phase: "static", ..context }, depth + 1, &[])?;
                    self.budget.charge(96)?;
                    bindings.push((binding.clone(), binding_path));
                }
                Ok(())
            }
            "constructor" => {
                self.child(path, "constructor", Context { phase: "static", ..context }, depth)?;
                let patterns_path = self.path(path, "patterns")?;
                if let Some(patterns) = node.get("patterns").and_then(Node::as_array) {
                    for (index, pattern) in patterns.iter().enumerate() {
                        let pattern_path = self.path(&patterns_path, &index.to_string())?;
                        self.pattern_inputs(&pattern_path, pattern, context, depth + 1, bindings)?;
                    }
                }
                Ok(())
            }
            "hole" => {
                let occurrence = self.occurrence(path, node)?;
                self.region(occurrence, "NeedsPatternHole", true)
            }
            _ => self.children_except(path, node, context, depth, &[]),
        }
    }
    fn block(&mut self, path: &str, node: &Node, context: Context, depth: usize) -> Result<()> {
        let occurrence = self.occurrence(path, node)?;
        let block = self.scope(Some(context), occurrence, "block")?;
        if let Some(statements) = node.get("statements").and_then(Node::as_array) {
            let statements_path = self.path(path, "statements")?;
            for index in 0..statements.len() { self.child(&statements_path, &index.to_string(), block, depth)?; }
        }
        self.child(path, "result", block, depth)
    }
    fn statement(&mut self, path: &str, node: &Node, context: Context, depth: usize) -> Result<()> {
        let occurrence = self.occurrence(path, node)?;
        let operation = node.get("op").and_then(Node::as_str).unwrap_or("");
        match operation {
            "let" | "var" => {
                self.child(path, "type", Context { phase: "static", ..context }, depth)?;
                self.child(path, "value", context, depth)?;
                self.bind(node, path, context, operation, false, operation == "var")
            }
            "set" => {
                self.child(path, "value", context, depth)?;
                let name = node.get("name").and_then(Node::as_str).expect("validated set target");
                self.use_binding(node, path, context, name, "value", false, None, true)
            }
            "while" => {
                let loop_context = self.scope(Some(context), occurrence, "loop")?;
                // The condition is lexically part of the loop target, including
                // selected try/ExecBody exits embedded in that expression.
                self.child(path, "condition", loop_context, depth)?;
                self.child(path, "body", loop_context, depth)
            }
            "if" => {
                self.child(path, "condition", context, depth)?;
                self.child(path, "then", context, depth)?;
                self.child(path, "else", context, depth)
            }
            "return" | "break" | "continue" => {
                self.child(path, "value", context, depth)?;
                let (kind, target) = match operation {
                    "return" => ("return", context.function),
                    "break" => ("break", context.loop_target),
                    _ => ("continue", context.loop_target),
                };
                let target = match target {
                    Some(scope) => ControlResolution::Resolved { scope },
                    None if context.unknown_outer && context.function.is_none() => ControlResolution::Needs { code: "NeedsControlEnvironment" },
                    None => ControlResolution::Rejected { code: "InvalidControlTarget" },
                };
                match target {
                    ControlResolution::Needs { code } => self.region(occurrence, code, true)?,
                    ControlResolution::Rejected { code } => self.region(occurrence, code, false)?,
                    _ => (),
                }
                self.budget.charge(128)?;
                self.arena.exits.push(ControlExit { occurrence, kind, target });
                Ok(())
            }
            _ => self.children_except(path, node, context, depth, &[]),
        }
    }
}

pub(crate) fn analyze_module(reader: &Reader, navigation: &Navigation, source: &DecodedSource,
    module: ModuleId, declarations: &BTreeMap<String, DeclarationId>, arena: &mut LexicalArena, budget: &mut Budget) -> Result<()> {
    let mut analyzer = Analyzer { reader, navigation, module, owner: None, arena, budget,
        frames: BTreeMap::new(), occurrences: BTreeMap::new(), keys: BTreeMap::new(), captured: BTreeSet::new(), deferred_keys: Vec::new() };
    let definitions = source.expanded().get("definitions").and_then(Node::as_object)
        .ok_or_else(|| fail("ReaderInvariant", "", "Expected module definitions"))?;
    for (name, definition) in definitions {
        analyzer.owner = declarations.get(name).copied();
        analyzer.keys.clear();
        let path = analyzer.path("/definitions", name)?;
        let occurrence = analyzer.occurrence(&path, definition)?;
        let mut context = analyzer.scope(None, occurrence, "definition")?;
        // Common type/static-value declarations close their lexical environment.
        // Other professional bodies may supply independent outer value binders.
        if matches!(definition.get("kind").and_then(Node::as_str), Some("core:type" | "core:constant")) {
            context.phase = "static";
            context.unknown_outer = false;
        }
        analyzer.walk(&path, context, 0)?;
        let mut inaccessible = BTreeSet::new();
        for (index, domain, key) in std::mem::take(&mut analyzer.deferred_keys) {
            analyzer.budget.work(1)?;
            if analyzer.keys.contains_key(&(domain, key)) {
                let occurrence = analyzer.arena.uses[index].occurrence;
                analyzer.arena.uses[index].resolution = LocalResolution::Rejected { code: "BindingNotVisible" };
                analyzer.budget.charge(64)?;
                inaccessible.insert(occurrence);
            }
        }
        if !inaccessible.is_empty() {
            analyzer.budget.work(analyzer.arena.pending_regions.len())?;
            analyzer.arena.pending_regions.retain(|region| region.code != "NeedsOuterBindingEnvironment" || !inaccessible.contains(&region.occurrence));
            for occurrence in inaccessible { analyzer.region(occurrence, "BindingNotVisible", false)?; }
        }
    }
    Ok(())
}
