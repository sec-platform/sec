//! Common semantic type formation from the existing selected source navigation.
//! Formation retains unresolved qualifications and static expressions. It does
//! not unify types, evaluate arguments, complete signatures or qualify targets.
use std::collections::{BTreeMap, BTreeSet};
use crate::{binding::{Budget, DeclarationId, ModuleId, NameAnalysis, Resolution}, grammar,
    lexical::{LocalBindingId, LocalResolution, OccurrenceId}, model::{Diagnostic, fail},
    reader::DecodedSource, reference_slots::{Navigation, SHARED}, source::{Kind as JsonKind, Node, Origin}};

type Result<T> = std::result::Result<T, Diagnostic>;
const REQUIREMENT: &str = "urn:gift:design-schema:requirement-structure-1-converged-base";
const DECLARATIONS: &str = "urn:gift:design-schema:requirement-declarations-converged";

macro_rules! local_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
        pub struct $name(pub(crate) usize);
        impl $name { pub fn index(self) -> usize { self.0 } }
    };
}
local_id!(TypeId);
local_id!(SourceId);
local_id!(NameReferenceId);
local_id!(SemanticBinderId);
local_id!(MetaId);

#[derive(Debug)]
pub struct SourceOccurrence {
    pub id: SourceId,
    pub module: ModuleId,
    pub owner: Option<DeclarationId>,
    pub expanded_path: String,
    /// Exact byte span in the module's captured source_revision. Callers retain
    /// those bytes. Number formatting from syntax is not the original lexeme.
    pub origin: Option<Origin>,
    pub lexical: Option<OccurrenceId>,
    pub syntax: Node,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypeOccurrence { pub source: SourceId, pub ty: TypeId }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypeIssue { pub source: SourceId, pub code: &'static str }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeclarationUse { pub reference: NameReferenceId, pub declaration: Option<DeclarationId> }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BinderUse {
    pub lexical_use: Option<usize>,
    pub binder: Option<LocalBindingId>,
    pub semantic: Option<SemanticBinderId>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExprRef { pub source: SourceId }

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ScalarType {
    pub name: String,
    pub bits: Option<u64>,
    pub scale: Option<u64>,
    pub overflow: Option<String>,
    pub text_index: Option<String>,
    pub rounding: Option<String>,
    pub nan_policy: Option<String>,
    pub encoding: Option<String>,
    pub clock_ref: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field { pub ty: TypeId, pub optional: Option<bool>, pub mutable: Option<bool> }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SemanticType {
    Inference(MetaId),
    Scalar(ScalarType),
    Declaration { target: DeclarationUse, arguments: Vec<SemanticArgument> },
    SubjectSchema { target: DeclarationUse, arguments: Vec<SemanticArgument>, role: SubjectRole },
    Parameter(BinderUse),
    Opaque { interface: DeclarationUse },
    Record { fields: BTreeMap<String, Field>, open: Option<bool>, row: Option<TypeId> },
    Variant(BTreeMap<String, TypeId>),
    Tuple(Vec<SemanticArgument>),
    Option(TypeId),
    Result { ok: TypeId, error: TypeId },
    List(TypeId),
    Sequence { item: TypeId, ordered: bool },
    Set { item: TypeId, equality: Option<DeclarationUse> },
    Bag { item: TypeId, equality: Option<DeclarationUse> },
    Map { key: TypeId, value: TypeId, equality: Option<DeclarationUse> },
    Function(FunctionType),
    Handle { resource: DeclarationUse, lifetime: String },
    Future(TypeId),
    Stream { item: TypeId, order: String },
    Quantity { scalar: TypeId, unit_ref: String },
    Refinement { base: TypeId, predicate: DeclarationUse },
    Exists { binders: Vec<SemanticBinderId>, body: TypeId },
    Apply { constructor: ConstructorTerm, arguments: Vec<SemanticArgument> },
    PackElement { pack: PackTerm, index: ExprRef },
    Rational,
    WireVariant { known: BTreeMap<String, TypeId>, unknown: String, encoding: String, duplicates: String },
    Associated { trait_ref: DeclarationUse, self_type: TypeId, arguments: Vec<SemanticArgument>, member: String },
    DefinitionReference { role: String, contract: DeclarationUse, arguments: Vec<SemanticArgument> },
    Hole { expected: String, raw_text: Option<String> },
    Needs { source: SourceId, code: &'static str },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubjectRole { LogicalParameter, FiniteDesignList, DependentArgument, Unqualified }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SemanticKind { Type, Region, Scope, EffectRow, Value(TypeId), Constructor(Vec<SemanticKind>), Pack(Box<SemanticKind>) }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SemanticArgument {
    Type(TypeId), Value(ExprRef), Region(BinderUse), Scope(BinderUse), EffectRow(EffectRow),
    Constructor(ConstructorTerm), Pack(PackTerm), PackElement { pack: PackTerm, index: ExprRef }, Expand(PackTerm),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConstructorTerm {
    Declaration { target: DeclarationUse, arguments: Vec<SemanticArgument> },
    Parameter(BinderUse),
    Apply { constructor: Box<ConstructorTerm>, arguments: Vec<SemanticArgument> },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PackTerm { Items(Vec<SemanticArgument>), Parameter(BinderUse), Concat(Vec<PackTerm>) }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EffectAtom {
    Declaration(DeclarationUse),
    Structured { class: String, port: Option<DeclarationUse>, resource: Option<DeclarationUse>, scope_ref: Option<String>, error: Option<TypeId> },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectRow { pub members: Vec<EffectAtom>, pub tail: Option<BinderUse>, pub explicit_row: bool }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParameterContract { pub position: u64, pub retention: String }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Capture { Region(BinderUse), Scope(BinderUse) }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FunctionType {
    pub binders: Vec<SemanticBinderId>,
    pub parameters: Vec<SemanticArgument>,
    pub returns: TypeId,
    /// None is the shared function type's omitted empty upper bound. Declaration
    /// effect inference is represented separately by header_seeds::EffectRequest.
    pub effects: Option<EffectRow>,
    /// True only for a declaration/lambda whose omitted effects still require
    /// body analysis. An independent FunctionType omission is an empty bound.
    pub pending_effects: bool,
    pub pending_captures: bool,
    pub call_mode: Option<String>,
    pub parameter_contracts: Option<Vec<ParameterContract>>,
    pub captures: Option<Vec<Capture>>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TraitBound { pub trait_ref: DeclarationUse, pub self_type: TypeId, pub arguments: Vec<SemanticArgument>, pub associated: BTreeMap<String, TypeId> }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SemanticBinder {
    pub id: SemanticBinderId,
    pub binding: Option<LocalBindingId>,
    pub provenance: BinderProvenance,
    pub source: SourceId,
    pub kind: SemanticKind,
    pub introduction: Option<String>,
    pub constraints: Vec<DeclarationUse>,
    pub trait_bounds: Vec<TraitBound>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BinderProvenance {
    Authored,
    Derived { original: SemanticBinderId },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArgumentOccurrence { pub source: SourceId, pub argument: SemanticArgument }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FunctionAnnotations {
    pub source: SourceId,
    pub effects: Option<EffectRow>,
    pub captures: Option<Vec<Capture>>,
    pub parameter_contracts: Option<Vec<ParameterContract>>,
    pub call_mode: Option<String>,
}
#[derive(Clone, Debug)]
pub struct InferenceVariable {
    pub kind: SemanticKind,
    pub visible: BTreeSet<SemanticBinderId>,
    pub value: Option<TypeId>,
}
/// A formed representation with explicit remaining obligations. TypeId equality
/// and derived structural PartialEq are not semantic equivalence/compatibility.
/// Source omission/defaults continue to use their original semantic owners.
#[derive(Debug, Default)]
pub struct TypeArena {
    pub nodes: Vec<SemanticType>,
    pub sources: Vec<SourceOccurrence>,
    pub occurrences: Vec<TypeOccurrence>,
    pub binders: Vec<SemanticBinder>,
    pub arguments: Vec<ArgumentOccurrence>,
    pub function_annotations: Vec<FunctionAnnotations>,
    pub inference_variables: Vec<InferenceVariable>,
    pub needs: Vec<TypeIssue>,
    pub problems: Vec<TypeIssue>,
}
impl TypeArena {
    /// A consumer follows the retained solution in this same analysis arena.
    /// Unsolved variables retain their kind and allowed rigid-binder scope.
    pub fn resolved(&self, mut ty:TypeId) -> TypeId {
        for _ in 0..=self.inference_variables.len() {
            match self.get(ty) {
                SemanticType::Inference(id)=>match self.inference_variables.get(id.index()).and_then(|v|v.value) {
                    Some(value)=>ty=value,None=>return ty,
                },_=>return ty,
            }
        }
        ty
    }
    pub fn authored_binder(&self, binding: LocalBindingId) -> Option<SemanticBinderId> {
        self.binders.iter().find(|item| item.binding == Some(binding)).map(|item| item.id)
    }
    pub fn get(&self, id: TypeId) -> &SemanticType { &self.nodes[id.0] }
    pub fn source(&self, id: SourceId) -> &SourceOccurrence { &self.sources[id.0] }
    pub fn at(&self, module: ModuleId, path: &str) -> Option<TypeId> {
        self.occurrences.iter().find(|item| {
            let source = &self.sources[item.source.0]; source.module == module && source.expanded_path == path
        }).map(|item| item.ty)
    }
}

pub(crate) struct Formation<'a> {
    pub names: &'a NameAnalysis,
    pub budget: &'a mut Budget,
    pub arena: TypeArena,
    sources: &'a [DecodedSource],
    navigation: &'a [Navigation],
    source_ids: BTreeMap<(ModuleId, String), SourceId>,
    type_ids: BTreeMap<(ModuleId, String), TypeId>,
    references: BTreeMap<(ModuleId, String), usize>,
    uses: BTreeMap<(ModuleId, String), usize>,
    bindings: BTreeMap<(ModuleId, String), LocalBindingId>,
    semantic_bindings: BTreeMap<LocalBindingId, SemanticBinderId>,
    lexical_occurrences: BTreeMap<(ModuleId, String), OccurrenceId>,
    declaration_paths: BTreeMap<(ModuleId, String), DeclarationId>,
    active: BTreeSet<(ModuleId, String)>,
    scalars: BTreeMap<ScalarType, TypeId>,
    issues: BTreeSet<(SourceId, &'static str, bool)>,
}
impl<'a> Formation<'a> {
    pub(crate) fn new(names: &'a NameAnalysis, sources: &'a [DecodedSource], navigation: &'a [Navigation], budget: &'a mut Budget) -> Result<Self> {
        let mut result = Self { names, sources, navigation, budget, arena: TypeArena::default(), source_ids: BTreeMap::new(),
            type_ids: BTreeMap::new(), references: BTreeMap::new(), uses: BTreeMap::new(), bindings: BTreeMap::new(),
            lexical_occurrences: BTreeMap::new(), declaration_paths: BTreeMap::new(), active: BTreeSet::new(), scalars: BTreeMap::new(), issues:BTreeSet::new(), semantic_bindings:BTreeMap::new() };
        for binding in &names.lexical.bindings {
            if binding.domains.contains(&"semantic") {
                result.budget.charge(96)?;
                result.semantic_bindings.insert(binding.id, SemanticBinderId(result.semantic_bindings.len()));
            }
        }
        for declaration in &names.declarations {
            let path=result.path("/definitions",&declaration.name)?;
            let key=result.key(declaration.module,&path)?;
            result.declaration_paths.insert(key,declaration.id);
        }
        for (index, reference) in names.references.iter().enumerate() {
            let key = result.key(reference.module, &reference.expanded_path)?;
            result.references.insert(key, index);
        }
        for occurrence in &names.lexical.occurrences {
            let key = result.key(occurrence.module, &occurrence.expanded_path)?;
            result.lexical_occurrences.insert(key, occurrence.id);
        }
        for (index, usage) in names.lexical.uses.iter().enumerate() {
            let occurrence = &names.lexical.occurrences[usage.occurrence.index()];
            let key = result.key(occurrence.module, &occurrence.expanded_path)?;
            result.uses.insert(key, index);
        }
        for binding in &names.lexical.bindings {
            let occurrence = &names.lexical.occurrences[binding.occurrence.index()];
            let key = result.key(occurrence.module, &occurrence.expanded_path)?;
            result.bindings.insert(key, binding.id);
        }
        Ok(result)
    }
    fn key(&mut self, module: ModuleId, path: &str) -> Result<(ModuleId, String)> {
        self.budget.charge(96)?; Ok((module, self.budget.copy(path)?))
    }
    pub(crate) fn path(&mut self, parent: &str, key: &str) -> Result<String> { self.budget.child_path(parent, key) }
    pub(crate) fn node(&mut self, module: ModuleId, path: &str) -> Result<Node> {
        self.optional_node(module,path)?.ok_or_else(||invariant(path))
    }
    fn optional_node(&mut self, module: ModuleId, path: &str) -> Result<Option<Node>> {
        self.budget.work(1)?;
        if let Some(site)=self.navigation[module.index()].sites.get(path) { return Ok(Some(site.node.clone())); }
        let mut node = self.sources[module.index()].expanded();
        if !path.is_empty() {
            for part in path.strip_prefix('/').ok_or_else(|| invariant(path))?.split('/') {
                self.budget.work(part.len().saturating_add(1))?;
                self.budget.charge(part.len().saturating_mul(12).saturating_add(128))?;
                let key = part.replace("~1", "/").replace("~0", "~");
                let child = if let Some(array) = node.as_array() { array.get(key.parse::<usize>().map_err(|_| invariant(path))?) }
                    else { node.get(&key) };
                let Some(child)=child else { return Ok(None); };
                node=child;
            }
        }
        Ok(Some(node.clone()))
    }
    fn owns(&self, module: ModuleId, path: &str, resource: &str, definition: &str) -> bool {
        self.navigation[module.index()].sites.get(path).is_some_and(|site| site.schemas.iter().any(|schema| {
            schema.split_once('#').is_some_and(|(r,p)| r == resource && p.strip_prefix("/$defs/") == Some(definition))
        }))
    }
    fn is_type(&self, module: ModuleId, path: &str) -> bool {
        self.owns(module,path,grammar::MODULE,"Type") || self.owns(module,path,SHARED,"TypeTerm") || self.owns(module,path,REQUIREMENT,"Type")
    }
    pub(crate) fn source(&mut self, module: ModuleId, path: &str) -> Result<SourceId> {
        self.budget.work(path.len().saturating_add(1))?;
        self.budget.text(path)?;
        let key = (module, path.to_owned());
        if let Some(id) = self.source_ids.get(&key) { return Ok(*id); }
        let node = self.node(module,path)?;
        let lexical = self.lexical_occurrences.get(&key).copied();
        let owner = if let Some(id)=lexical { self.names.lexical.occurrences[id.index()].owner }
            else if let Some(tail)=path.strip_prefix("/definitions/") {
                let name=tail.split('/').next().unwrap_or("");
                let end="/definitions/".len()+name.len();
                let declaration_key=self.key(module,&path[..end])?;
                self.declaration_paths.get(&declaration_key).copied()
            } else { None };
        self.budget.charge(320)?;
        let id = SourceId(self.arena.sources.len());
        let origin = self.budget.origin(&node)?;
        let expanded_path = self.budget.copy(path)?;
        self.arena.sources.push(SourceOccurrence { id, module, owner, expanded_path, origin, lexical, syntax: node });
        self.source_ids.insert(key,id);
        Ok(id)
    }
    pub(crate) fn issue(&mut self, source: SourceId, code: &'static str, rejected: bool) -> Result<()> {
        self.budget.work(1)?;
        self.budget.charge(160)?;
        if !self.issues.insert((source,code,rejected)) { return Ok(()); }
        let issues = if rejected { &mut self.arena.problems } else { &mut self.arena.needs };
        issues.push(TypeIssue { source, code }); Ok(())
    }
    pub(crate) fn reference(&mut self, module: ModuleId, path: &str) -> Result<DeclarationUse> {
        let key = self.key(module,path)?;
        let index = *self.references.get(&key).ok_or_else(|| invariant(path))?;
        let source = self.source(module,path)?;
        let declaration = match &self.names.references[index].resolution {
            Resolution::Resolved { declaration, .. } => Some(*declaration),
            Resolution::Needs { code, .. } => { self.issue(source,code,false)?; None },
            Resolution::Rejected { code, .. } => { self.issue(source,code,true)?; None },
        };
        Ok(DeclarationUse { reference: NameReferenceId(index), declaration })
    }
    fn binder_use(&mut self, module: ModuleId, path: &str) -> Result<BinderUse> {
        let key = self.key(module,path)?;
        let index = *self.uses.get(&key).ok_or_else(|| invariant(path))?;
        let source = self.source(module,path)?;
        let binder = match self.names.lexical.uses[index].resolution {
            LocalResolution::Resolved { binding } => Some(binding),
            LocalResolution::Needs { code } => { self.issue(source,code,false)?; None },
            LocalResolution::Rejected { code } => { self.issue(source,code,true)?; None },
        };
        let semantic=binder.and_then(|binding|self.semantic_bindings.get(&binding).copied());
        Ok(BinderUse { lexical_use:Some(index), binder, semantic })
    }
    pub(crate) fn binding(&mut self, module: ModuleId, path: &str) -> Result<LocalBindingId> {
        let key = self.key(module,path)?;
        self.bindings.get(&key).copied().ok_or_else(|| invariant(path))
    }
    pub(crate) fn expr(&mut self, module: ModuleId, path: &str) -> Result<ExprRef> {
        Ok(ExprRef { source: self.source(module,path)? })
    }
    fn deferred_expr(&mut self, module: ModuleId, path: &str) -> Result<ExprRef> {
        let expression = self.expr(module,path)?;
        self.issue(expression.source,"NeedsStaticValue",false)?;
        Ok(expression)
    }
    fn visit(&mut self, path: &str, depth: usize) -> Result<()> {
        self.budget.work(1)?;
        if depth > 128 { return Err(fail("ResourceLimit",path,"Type formation depth budget exceeded")); }
        Ok(())
    }
    pub(crate) fn form_all(&mut self) -> Result<()> {
        for (module_index, navigation) in self.navigation.iter().enumerate() {
            let module = self.names.modules[module_index].id;
            for path in navigation.sites.keys() {
                self.budget.work(1)?;
                if self.is_type(module,path) { self.form(module,path,0)?; }
                let node=self.node(module,path)?;
                if (self.owns(module,path,grammar::MODULE,"Expr")||self.owns(module,path,SHARED,"Expr")) &&
                    (node.get("op").or_else(||node.get("tag"))).and_then(Node::as_str)==Some("lambda") {
                    let source=self.source(module,path)?;
                    let effects=if node.get("effects").is_some(){let child=self.path(path,"effects")?;Some(self.effects(module,&child,0)?)}else{None};
                    let captures=self.captures(module,path,&node)?;
                    let parameter_contracts=self.contracts(&node)?;
                    let call_mode=self.optional_text(&node,"callMode")?;
                    self.budget.charge(256)?;
                    self.arena.function_annotations.push(FunctionAnnotations {source,effects,captures,parameter_contracts,call_mode});
                }
                if self.owns(module,path,grammar::MODULE,"SemanticArgument") || self.owns(module,path,SHARED,"SemanticArgument") {
                    let argument = self.argument(module,path,0)?;
                    let source = self.source(module,path)?;
                    self.budget.charge(192)?;
                    self.arena.arguments.push(ArgumentOccurrence { source, argument });
                }
            }
        }
        for binding in &self.names.lexical.bindings {
            if !binding.domains.contains(&"semantic") { continue; }
            let occurrence = &self.names.lexical.occurrences[binding.occurrence.index()];
            let source = self.source(occurrence.module,&occurrence.expanded_path)?;
            let node = self.node(occurrence.module,&occurrence.expanded_path)?;
            let kind_path = self.path(&occurrence.expanded_path,"kind")?;
            let kind = if node.get("kind").is_some() { self.kind(occurrence.module,&kind_path,0)? } else { SemanticKind::Type };
            let introduction = self.optional_text(&node,"binding")?;
            let constraints_path = self.path(&occurrence.expanded_path,"constraintRefs")?;
            let mut constraints = Vec::new();
            if let Some(items) = node.get("constraintRefs").and_then(Node::as_array) {
                for index in 0..items.len() {
                    let path = self.path(&constraints_path,&index.to_string())?;
                    let reference = self.reference(occurrence.module,&path)?;
                    self.budget.charge(96)?; constraints.push(reference);
                }
            }
            let bounds_path = self.path(&occurrence.expanded_path,"traitBounds")?;
            let mut trait_bounds = Vec::new();
            if let Some(items) = node.get("traitBounds").and_then(Node::as_array) {
                for index in 0..items.len() {
                    let path = self.path(&bounds_path,&index.to_string())?;
                    let bound = self.node(occurrence.module,&path)?;
                    let reference_path = self.path(&path,"traitRef")?;
                    let trait_ref = self.reference(occurrence.module,&reference_path)?;
                    let self_type=self.type_child(occurrence.module,&path,"selfType",0)?;
                    let arguments_path = self.path(&path,"traitArguments")?;
                    let arguments = self.arguments(occurrence.module,&arguments_path,0)?;
                    let associated_path = self.path(&path,"associatedTypes")?;
                    let associated = self.type_map(occurrence.module,&associated_path,bound.get("associatedTypes"),0)?;
                    self.budget.charge(192)?;
                    trait_bounds.push(TraitBound { trait_ref, self_type, arguments, associated });
                }
            }
            self.budget.charge(256)?;
            let id=self.semantic_bindings[&binding.id];
            self.arena.binders.push(SemanticBinder { id, binding:Some(binding.id), provenance:BinderProvenance::Authored,
                source, kind, introduction, constraints, trait_bounds });
        }
        Ok(())
    }
    fn optional_text(&mut self, node: &Node, key: &str) -> Result<Option<String>> {
        node.get(key).and_then(Node::as_str).map(|value| self.budget.copy(value)).transpose()
    }
    fn copy_text(&mut self, node: &Node, key: &str) -> Result<String> { self.budget.copy(text(node,key)?) }
    fn type_child(&mut self, module: ModuleId, path: &str, field: &str, depth: usize) -> Result<TypeId> {
        let child = self.path(path,field)?; self.form(module,&child,depth+1)
    }
    fn reference_child(&mut self, module: ModuleId, path: &str, field: &str) -> Result<DeclarationUse> {
        let child = self.path(path,field)?; self.reference(module,&child)
    }
    fn optional_reference(&mut self, module: ModuleId, path: &str, node: &Node, field: &str) -> Result<Option<DeclarationUse>> {
        if node.get(field).is_some() { Ok(Some(self.reference_child(module,path,field)?)) } else { Ok(None) }
    }
    fn type_map(&mut self, module: ModuleId, path: &str, node: Option<&Node>, depth: usize) -> Result<BTreeMap<String, TypeId>> {
        let mut result = BTreeMap::new();
        if let Some(fields) = node.and_then(Node::as_object) {
            for name in fields.keys() {
                let child = self.path(path,name)?;
                let ty = self.form(module,&child,depth+1)?;
                self.budget.charge(96)?;
                result.insert(self.budget.copy(name)?,ty);
            }
        }
        Ok(result)
    }
    pub(crate) fn form(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<TypeId> {
        self.visit(path,depth)?;
        let key = self.key(module,path)?;
        if let Some(id) = self.type_ids.get(&key) { return Ok(*id); }
        self.budget.charge(96)?;
        let active_key = self.key(module,path)?;
        if !self.active.insert(active_key) { return Err(fail("TypeFormationCycle",path,"Type formation revisited the same source occurrence")); }
        let source = self.source(module,path)?;
        let node = self.node(module,path)?;
        let formed = self.decode_type(module,path,&node,source,depth)?;
        if matches!(formed,SemanticType::Parameter(_)) && self.subject_role(module,path)?!=SubjectRole::Unqualified {
            self.issue(source,"NeedsSubjectRoleQualification",false)?;
        }
        let qualification=match &formed {
            SemanticType::Declaration{..}=>Some("NeedsDeclaredTypeQualification"),
            SemanticType::Opaque{..}=>Some("NeedsOpaqueTypeQualification"),
            SemanticType::Handle{..}=>Some("NeedsResourceTypeQualification"),
            SemanticType::Quantity{..}=>Some("NeedsQuantityQualification"),
            SemanticType::Refinement{..}=>Some("NeedsRefinementQualification"),
            SemanticType::Associated{..}=>Some("NeedsAssociatedTypeWitness"),
            SemanticType::DefinitionReference{..}=>Some("NeedsDefinitionReferenceQualification"),
            SemanticType::Apply{..}=>Some("NeedsConstructorApplication"),
            SemanticType::Exists{..}=>Some("NeedsExistentialQualification"),
            SemanticType::Record{row:Some(_),..}=>Some("NeedsRecordRowConstraints"),
            SemanticType::Set{..}|SemanticType::Bag{..}|SemanticType::Map{..}=>Some("NeedsCollectionValueOperations"),
            _=>None,
        };
        if let Some(code)=qualification { self.issue(source,code,false)?; }
        let id = if let SemanticType::Scalar(scalar) = &formed {
            if let Some(id) = self.scalars.get(scalar) { *id }
            else {
                self.budget.charge(1024)?;
                for text in [Some(&scalar.name),scalar.overflow.as_ref(),scalar.text_index.as_ref(),scalar.rounding.as_ref(),
                    scalar.nan_policy.as_ref(),scalar.encoding.as_ref(),scalar.clock_ref.as_ref()].into_iter().flatten() { self.budget.text(text)?; }
                let id = TypeId(self.arena.nodes.len());
                self.scalars.insert(scalar.clone(),id);
                self.arena.nodes.push(formed); id
            }
        } else {
            self.budget.charge(768)?;
            let id = TypeId(self.arena.nodes.len()); self.arena.nodes.push(formed); id
        };
        self.active.remove(&key);
        self.type_ids.insert(key,id);
        self.budget.charge(96)?;
        self.arena.occurrences.push(TypeOccurrence { source, ty:id });
        Ok(id)
    }
    fn scalar(&mut self, node: &Node, name: &str) -> Result<SemanticType> {
        let name = self.budget.copy(name)?;
        Ok(SemanticType::Scalar(ScalarType { name, bits:node.get("bits").map(unsigned).transpose()?, scale:node.get("scale").map(unsigned).transpose()?,
            overflow:self.optional_text(node,"overflow")?, text_index:self.optional_text(node,"textIndex")?, rounding:self.optional_text(node,"rounding")?,
            nan_policy:self.optional_text(node,"nanPolicy")?, encoding:self.optional_text(node,"encoding")?, clock_ref:self.optional_text(node,"clockRef")? }))
    }
    fn decode_type(&mut self, module: ModuleId, path: &str, node: &Node, source: SourceId, depth: usize) -> Result<SemanticType> {
        let tag = node.get("tag").and_then(Node::as_str);
        if tag.is_none() { return self.shared_type(module,path,node,source,depth); }
        Ok(match tag.unwrap() {
            "scalar" => return self.scalar(node,text(node,"name")?),
            "nominal" => {
                let target = self.reference_child(module,path,"ref")?;
                let arguments_path = self.path(path,"args")?;
                let arguments = self.arguments(module,&arguments_path,depth+1)?;
                return self.declaration_type(module,path,source,target,arguments);
            }
            "param" => SemanticType::Parameter(self.binder_use(module,path)?),
            "opaque" => SemanticType::Opaque { interface:self.reference_child(module,path,"interfaceRef")? },
            "record" => self.record(module,path,node,false,depth)?,
            "variant" => {
                let fields_path = self.path(path,"cases")?;
                SemanticType::Variant(self.type_map(module,&fields_path,node.get("cases"),depth)?)
            }
            "tuple" => { let items = self.path(path,"items")?; SemanticType::Tuple(self.arguments(module,&items,depth+1)?) }
            "option" => SemanticType::Option(self.type_child(module,path,"inner",depth)?),
            "result" => SemanticType::Result { ok:self.type_child(module,path,"ok",depth)?, error:self.type_child(module,path,"error",depth)? },
            "sequence" => SemanticType::Sequence { item:self.type_child(module,path,"item",depth)?, ordered:node.get("ordered").and_then(Node::as_bool).unwrap_or(true) },
            "set" | "bag" => {
                let item = self.type_child(module,path,"item",depth)?;
                let equality = self.optional_reference(module,path,node,"equalityRef")?;
                if tag == Some("set") { SemanticType::Set {item,equality} } else { SemanticType::Bag {item,equality} }
            }
            "map" => SemanticType::Map { key:self.type_child(module,path,"key",depth)?, value:self.type_child(module,path,"value",depth)?,
                equality:self.optional_reference(module,path,node,"keyEqualityRef")? },
            "function" => SemanticType::Function(self.function_type(module,path,node,false,depth)?),
            "handle" => SemanticType::Handle { resource:self.reference_child(module,path,"resourceRef")?, lifetime:self.copy_text(node,"lifetime")? },
            "future" => SemanticType::Future(self.type_child(module,path,"result",depth)?),
            "stream" => SemanticType::Stream { item:self.type_child(module,path,"item",depth)?, order:self.copy_text(node,"order")? },
            "quantity" => SemanticType::Quantity { scalar:self.type_child(module,path,"scalar",depth)?, unit_ref:self.copy_text(node,"unitRef")? },
            "refinement" => SemanticType::Refinement { base:self.type_child(module,path,"base",depth)?, predicate:self.reference_child(module,path,"predicateRef")? },
            "exists" => SemanticType::Exists { binders:self.binder_list(module,path,node,"parameters")?, body:self.type_child(module,path,"type",depth)? },
            "apply" => { let constructor_path=self.path(path,"constructor")?; let arguments_path=self.path(path,"arguments")?;
                SemanticType::Apply { constructor:self.constructor(module,&constructor_path,depth+1)?, arguments:self.arguments(module,&arguments_path,depth+1)? } }
            "rational" => SemanticType::Rational,
            "wire-variant" => { let known_path=self.path(path,"known")?;
                SemanticType::WireVariant { known:self.type_map(module,&known_path,node.get("known"),depth)?, unknown:self.copy_text(node,"unknown")?,
                    encoding:self.copy_text(node,"encoding")?, duplicates:self.copy_text(node,"duplicates")? } }
            "associated" => { let arguments_path=self.path(path,"traitArguments")?;
                SemanticType::Associated { trait_ref:self.reference_child(module,path,"traitRef")?, self_type:self.type_child(module,path,"selfType",depth)?,
                    arguments:self.arguments(module,&arguments_path,depth+1)?, member:self.copy_text(node,"member")? } }
            _ => { self.issue(source,"NeedsTypeInterpretation",false)?; SemanticType::Needs {source,code:"NeedsTypeInterpretation"} }
        })
    }
    fn shared_type(&mut self, module: ModuleId, path: &str, node: &Node, source: SourceId, depth: usize) -> Result<SemanticType> {
        if let Some(name) = node.get("core").or_else(||node.get("builtin")).and_then(Node::as_str) {
            let scalar = match name { "Int"=>Some("int"),"Bool"=>Some("bool"),"Text"=>Some("text"),"Unit"=>Some("unit"),"Never"=>Some("never"),"Bytes"=>Some("bytes"),_=>None };
            if let Some(name) = scalar { return self.scalar(node,name); }
            let arguments_path = self.path(path,"arguments")?;
            let first = self.path(&arguments_path,"0")?;
            let item = self.form(module,&first,depth+1)?;
            return Ok(match name {
                "List" => SemanticType::List(item), "Option" => SemanticType::Option(item),
                "Result" => { let second=self.path(&arguments_path,"1")?; SemanticType::Result {ok:item,error:self.form(module,&second,depth+1)?} }
                _ => return Err(invariant(path)),
            });
        }
        if node.get("decl").is_some() || node.get("ref").is_some() {
            let target=self.reference_child(module,path,if node.get("decl").is_some(){"decl"}else{"ref"})?;
            let arguments_path=self.path(path,"arguments")?;
            let arguments=self.arguments(module,&arguments_path,depth+1)?;
            return self.declaration_type(module,path,source,target,arguments);
        }
        if node.get("parameter").is_some() { return Ok(SemanticType::Parameter(self.binder_use(module,path)?)); }
        if node.get("record").is_some() { return self.record(module,path,node,true,depth); }
        if node.get("list").is_some() { return Ok(SemanticType::List(self.type_child(module,path,"list",depth)?)); }
        if let Some(function)=node.get("function") { let child=self.path(path,"function")?;
            return Ok(SemanticType::Function(self.function_type(module,&child,function,true,depth+1)?)); }
        if let Some(exists)=node.get("exists") { let child=self.path(path,"exists")?;
            return Ok(SemanticType::Exists { binders:self.binder_list(module,&child,exists,"parameters")?, body:self.type_child(module,&child,"type",depth+1)? }); }
        if node.get("apply").is_some() { let child=self.path(path,"apply")?;
            let constructor=self.path(&child,"constructor")?; let arguments=self.path(&child,"arguments")?;
            return Ok(SemanticType::Apply {constructor:self.constructor(module,&constructor,depth+1)?,arguments:self.arguments(module,&arguments,depth+1)?}); }
        if node.get("packElement").is_some() { let child=self.path(path,"packElement")?; let pack=self.path(&child,"pack")?; let index=self.path(&child,"index")?;
            return Ok(SemanticType::PackElement {pack:self.pack(module,&pack,depth+1)?,index:self.deferred_expr(module,&index)?}); }
        if let Some(reference)=node.get("definition-reference") { let child=self.path(path,"definition-reference")?; let arguments=self.path(&child,"typeArguments")?;
            return Ok(SemanticType::DefinitionReference {role:self.copy_text(reference,"role")?,contract:self.reference_child(module,&child,"contractRef")?,
                arguments:self.arguments(module,&arguments,depth+1)?}); }
        if let Some(hole)=node.get("hole") { self.issue(source,"NeedsTypeHole",false)?;
            return Ok(SemanticType::Hole {expected:self.copy_text(hole,"expected")?,raw_text:self.optional_text(hole,"rawText")?}); }
        self.issue(source,"NeedsTypeInterpretation",false)?;
        Ok(SemanticType::Needs {source,code:"NeedsTypeInterpretation"})
    }
    fn declaration_type(&mut self, module: ModuleId, path: &str, source: SourceId, target: DeclarationUse,
        arguments: Vec<SemanticArgument>) -> Result<SemanticType> {
        if let Some(id)=target.declaration {
            let kind=self.names.declarations[id.index()].kind.as_str();
            if kind == "req:subject" {
                let role=self.subject_role(module,path)?;
                if role==SubjectRole::Unqualified { self.issue(source,"SubjectSchemaOutsideLogicalRole",true)?; }
                if role==SubjectRole::DependentArgument { self.issue(source,"NeedsSubjectRoleQualification",false)?; }
                return Ok(SemanticType::SubjectSchema {target,arguments,role});
            }
            if kind != "core:type" { self.issue(source,"NeedsProfessionalTypeQualification",false)?; }
        }
        Ok(SemanticType::Declaration {target,arguments})
    }
    fn subject_role(&mut self, module: ModuleId, path: &str) -> Result<SubjectRole> {
        let mut ancestor=path;
        while let Some((parent,_))=ancestor.rsplit_once('/') {
            self.budget.work(1)?;
            if self.owns(module,parent,DECLARATIONS,"RuleFieldType") {
                let field=self.node(module,parent)?;
                let relative=path.strip_prefix(parent).unwrap_or("");
                if field.get("kind").and_then(Node::as_str)==Some("subject") {
                    if let Some(tail)=relative.strip_prefix("/subjectKinds/") {
                        let index=tail.split('/').next().unwrap_or("");
                        let list=self.path(parent,"subjectKinds")?; let root=self.path(&list,index)?;
                        return self.subject_root_role(module,&root,path,SubjectRole::LogicalParameter);
                    }
                }
            }
            if self.owns(module,parent,DECLARATIONS,"SubjectBody") {
                let relative=path.strip_prefix(parent).unwrap_or("");
                let mut parts=relative.split('/');
                if parts.next()==Some("") && parts.next()==Some("roles") {
                    if let Some(name)=parts.next() {
                        if parts.next()==Some("type") {
                            let root_length=parent.len()+"/roles/".len()+name.len()+"/type".len();
                            return self.subject_root_role(module,&path[..root_length],path,SubjectRole::LogicalParameter);
                        }
                    }
                }
            }
            if self.owns(module,parent,REQUIREMENT,"Parameter") {
                let parameter=self.node(module,parent)?;
                if parameter.get("role").and_then(Node::as_str)==Some("subject") {
                    let root=self.path(parent,"type")?;
                    return self.subject_root_role(module,&root,path,SubjectRole::LogicalParameter);
                }
                if parameter.get("role").and_then(Node::as_str)==Some("value") {
                    let root=self.path(parent,"type")?;
                    return self.subject_list_role(module,&root,path);
                }
                break;
            }
            ancestor=parent;
        }
        Ok(SubjectRole::Unqualified)
    }
    fn subject_list_role(&mut self, module: ModuleId, root: &str, path: &str) -> Result<SubjectRole> {
        let mut element=self.budget.copy(root)?;
        let mut depth=0;
        loop {
            self.visit(&element,depth)?;
            if !self.is_type(module,&element) { return Ok(SubjectRole::Unqualified); }
            let ty=self.node(module,&element)?;
            let next=if ty.get("core").and_then(Node::as_str)==Some("List") {
                let arguments=self.path(&element,"arguments")?;
                self.path(&arguments,"0")?
            } else if ty.get("list").is_some() {
                self.path(&element,"list")?
            } else {
                return if depth==0 { Ok(SubjectRole::Unqualified) }
                    else { self.subject_root_role(module,&element,path,SubjectRole::FiniteDesignList) };
            };
            if !path.strip_prefix(&next).is_some_and(|tail|tail.is_empty()||tail.starts_with('/')) {
                return Ok(SubjectRole::Unqualified);
            }
            element=next;
            depth+=1;
        }
    }
    fn subject_root_role(&mut self, module: ModuleId, root: &str, path: &str, direct: SubjectRole) -> Result<SubjectRole> {
        if root==path { return Ok(direct); }
        let root_node=self.node(module,root)?;
        if root_node.get("decl").is_some() && path.strip_prefix(root).is_some_and(|tail| tail.starts_with("/arguments/")) {
            return Ok(SubjectRole::DependentArgument);
        }
        Ok(SubjectRole::Unqualified)
    }
    fn record(&mut self, module: ModuleId, path: &str, node: &Node, shared: bool, depth: usize) -> Result<SemanticType> {
        let field_path=self.path(path,if shared{"record"}else{"fields"})?;
        let mut fields=BTreeMap::new();
        let entries=node.get(if shared{"record"}else{"fields"}).ok_or_else(||invariant(path))?;
        if shared {
            for (index,field) in entries.as_array().ok_or_else(||invariant(path))?.iter().enumerate() {
                let entry=self.path(&field_path,&index.to_string())?;
                let name=self.copy_text(field,"name")?;
                let ty=self.type_child(module,&entry,"type",depth)?;
                self.budget.charge(128)?;
                if fields.insert(name,Field {ty,optional:field.get("optional").and_then(Node::as_bool),mutable:field.get("mutable").and_then(Node::as_bool)}).is_some() {
                    let source=self.source(module,&entry)?; self.issue(source,"DuplicateRecordField",true)?;
                }
            }
        } else {
            for (name,field) in entries.as_object().ok_or_else(||invariant(path))? {
                let entry=self.path(&field_path,name)?; let ty=self.type_child(module,&entry,"type",depth)?;
                self.budget.charge(128)?;
                fields.insert(self.budget.copy(name)?,Field {ty,optional:field.get("optional").and_then(Node::as_bool),mutable:field.get("mutable").and_then(Node::as_bool)});
            }
        }
        let row=if node.get("rowType").is_some(){Some(self.type_child(module,path,"rowType",depth)?)}else{None};
        Ok(SemanticType::Record {fields,open:node.get("open").and_then(Node::as_bool),row})
    }
    fn kind(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<SemanticKind> {
        self.visit(path,depth)?;
        let node=self.node(module,path)?;
        Ok(match node.as_str() {
            Some("Type")=>SemanticKind::Type,Some("Region")=>SemanticKind::Region,Some("Scope")=>SemanticKind::Scope,Some("EffectRow")=>SemanticKind::EffectRow,
            _ if node.get("value").is_some()=>SemanticKind::Value(self.type_child(module,path,"value",depth)?),
            _ if node.get("pack").is_some()=>{ let child=self.path(path,"pack")?; self.budget.charge(128)?; SemanticKind::Pack(Box::new(self.kind(module,&child,depth+1)?)) },
            _ if node.get("constructor").is_some()=>{
                let constructor=self.path(path,"constructor")?; let parameters=self.path(&constructor,"parameters")?;
                let items=self.node(module,&parameters)?; let mut kinds=Vec::new();
                for index in 0..items.as_array().ok_or_else(||invariant(path))?.len() {
                    let child=self.path(&parameters,&index.to_string())?; let kind=self.kind(module,&child,depth+1)?;
                    self.budget.charge(128)?; kinds.push(kind);
                }
                SemanticKind::Constructor(kinds)
            }
            _=>return Err(invariant(path)),
        })
    }
    fn arguments(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<Vec<SemanticArgument>> {
        self.visit(path,depth)?;
        let mut result=Vec::new();
        if let Some(node)=self.optional_node(module,path)? {
            for index in 0..node.as_array().ok_or_else(||invariant(path))?.len() {
                let child=self.path(path,&index.to_string())?;
                let argument=self.argument(module,&child,depth+1)?;
                self.budget.charge(192)?; result.push(argument);
            }
        }
        Ok(result)
    }
    fn argument(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<SemanticArgument> {
        self.visit(path,depth)?;
        let node=self.node(module,path)?;
        if node.get("expand").is_some() { let child=self.path(path,"expand")?; return Ok(SemanticArgument::Expand(self.pack(module,&child,depth+1)?)); }
        let semantic_slot=self.owns(module,path,grammar::MODULE,"SemanticArgument") || self.owns(module,path,SHARED,"SemanticArgument");
        if self.is_type(module,path) && (!semantic_slot || node.get("packElement").is_none()) {
            return Ok(SemanticArgument::Type(self.form(module,path,depth+1)?));
        }
        for (field,variant) in [("value",0),("region",1),("scope",2),("effectRow",3),("typeConstructor",4),("pack",5),("packElement",6)] {
            if node.get(field).is_none() { continue; }
            let child=self.path(path,field)?;
            return Ok(match variant {
                0=>SemanticArgument::Value(self.deferred_expr(module,&child)?),
                1=>SemanticArgument::Region(self.binder_use(module,&child)?),
                2=>SemanticArgument::Scope(self.binder_use(module,&child)?),
                3=>SemanticArgument::EffectRow(self.effects(module,&child,depth+1)?),
                4=>SemanticArgument::Constructor(self.constructor(module,&child,depth+1)?),
                5=>SemanticArgument::Pack(self.pack(module,&child,depth+1)?),
                _=>{ let pack=self.path(&child,"pack")?; let index=self.path(&child,"index")?;
                    SemanticArgument::PackElement {pack:self.pack(module,&pack,depth+1)?,index:self.deferred_expr(module,&index)?} },
            });
        }
        Err(invariant(path))
    }
    fn constructor(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<ConstructorTerm> {
        self.visit(path,depth)?;
        let node=self.node(module,path)?;
        if node.get("parameter").is_some() { return Ok(ConstructorTerm::Parameter(self.binder_use(module,path)?)); }
        if node.get("decl").is_some() { let arguments=self.path(path,"arguments")?;
            return Ok(ConstructorTerm::Declaration {target:self.reference_child(module,path,"decl")?,arguments:self.arguments(module,&arguments,depth+1)?}); }
        let apply=self.path(path,"apply")?; let constructor=self.path(&apply,"constructor")?; let arguments=self.path(&apply,"arguments")?;
        let constructor=self.constructor(module,&constructor,depth+1)?;
        self.budget.charge(128)?;
        Ok(ConstructorTerm::Apply {constructor:Box::new(constructor),arguments:self.arguments(module,&arguments,depth+1)?})
    }
    fn pack(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<PackTerm> {
        self.visit(path,depth)?;
        let node=self.node(module,path)?;
        if node.as_array().is_some() { return Ok(PackTerm::Items(self.arguments(module,path,depth+1)?)); }
        if node.get("parameter").is_some() { return Ok(PackTerm::Parameter(self.binder_use(module,path)?)); }
        let concat=self.path(path,"concat")?; let items=self.node(module,&concat)?;
        let mut packs=Vec::new();
        for index in 0..items.as_array().ok_or_else(||invariant(path))?.len() {
            let child=self.path(&concat,&index.to_string())?; let pack=self.pack(module,&child,depth+1)?;
            self.budget.charge(128)?; packs.push(pack);
        }
        Ok(PackTerm::Concat(packs))
    }
    pub(crate) fn effects(&mut self, module: ModuleId, path: &str, depth: usize) -> Result<EffectRow> {
        self.visit(path,depth)?;
        let node=self.node(module,path)?;
        let explicit_row=node.as_array().is_none();
        let members_path=if explicit_row {self.path(path,"members")?}else{self.budget.copy(path)?};
        let items=self.node(module,&members_path)?;
        let mut members=Vec::new();
        for index in 0..items.as_array().ok_or_else(||invariant(path))?.len() {
            let child=self.path(&members_path,&index.to_string())?; let atom=self.node(module,&child)?;
            let key=self.key(module,&child)?;
            let effect=if self.references.contains_key(&key) { EffectAtom::Declaration(self.reference(module,&child)?) }
                else {
                    let error=if atom.get("errorType").is_some(){Some(self.type_child(module,&child,"errorType",depth)?)}else{None};
                    EffectAtom::Structured {class:self.copy_text(&atom,"class")?,port:self.optional_reference(module,&child,&atom,"portRef")?,
                        resource:self.optional_reference(module,&child,&atom,"resourceRef")?,scope_ref:self.optional_text(&atom,"scopeRef")?,error}
                };
            self.budget.charge(192)?; members.push(effect);
        }
        let tail=if node.get("tail").is_some() {let child=self.path(path,"tail")?;Some(self.binder_use(module,&child)?)}else{None};
        Ok(EffectRow {members,tail,explicit_row})
    }
    pub(crate) fn binder_list(&mut self, module: ModuleId, path: &str, node: &Node, field: &str) -> Result<Vec<SemanticBinderId>> {
        let mut result=Vec::new();
        if let Some(items)=node.get(field).and_then(Node::as_array) {
            let parent=self.path(path,field)?;
            for index in 0..items.len() {
                let child=self.path(&parent,&index.to_string())?; let binder=self.binding(module,&child)?;
                self.budget.charge(64)?;
                result.push(*self.semantic_bindings.get(&binder).ok_or_else(||invariant(&child))?);
            }
        }
        Ok(result)
    }
    pub(crate) fn contracts(&mut self, node: &Node) -> Result<Option<Vec<ParameterContract>>> {
        let Some(items)=node.get("parameterContracts").and_then(Node::as_array) else {return Ok(None);};
        let mut result=Vec::new();
        for item in items {
            let position=unsigned(item.get("position").ok_or_else(||invariant("position"))?)?;
            let retention=self.copy_text(item,"retention")?;
            self.budget.charge(128)?; result.push(ParameterContract {position,retention});
        }
        Ok(Some(result))
    }
    pub(crate) fn captures(&mut self, module: ModuleId, path: &str, node: &Node) -> Result<Option<Vec<Capture>>> {
        let Some(items)=node.get("captures").and_then(Node::as_array) else {return Ok(None);};
        let parent=self.path(path,"captures")?; let mut result=Vec::new();
        for (index,item) in items.iter().enumerate() {
            let child=self.path(&parent,&index.to_string())?;
            let field=if item.get("region").is_some(){"region"}else{"scope"};
            let child=self.path(&child,field)?;
            let binder=self.binder_use(module,&child)?;
            self.budget.charge(128)?;
            result.push(if field=="region"{Capture::Region(binder)}else{Capture::Scope(binder)});
        }
        Ok(Some(result))
    }
    fn function_type(&mut self, module: ModuleId, path: &str, node: &Node, shared: bool, depth: usize) -> Result<FunctionType> {
        self.visit(path,depth)?;
        let binders=self.binder_list(module,path,node,"typeParams")?;
        let parameters=self.path(path,if shared{"parameters"}else{"params"})?;
        let parameters=self.arguments(module,&parameters,depth+1)?;
        let returns=self.type_child(module,path,"returns",depth)?;
        let effects=if node.get("effects").is_some(){let child=self.path(path,"effects")?;Some(self.effects(module,&child,depth+1)?)}else{None};
        Ok(FunctionType {binders,parameters,returns,effects,pending_effects:false,pending_captures:false,call_mode:self.optional_text(node,"callMode")?,
            parameter_contracts:self.contracts(node)?,captures:self.captures(module,path,node)?})
    }
}

fn invariant(path: &str) -> Diagnostic { fail("ReaderInvariant",path,"Expected original selected type/name occurrence") }
fn text<'a>(node: &'a Node, key: &str) -> Result<&'a str> {
    node.get(key).and_then(Node::as_str).ok_or_else(|| invariant(key))
}
fn unsigned(node: &Node) -> Result<u64> {
    // Only Reader-validated control slots call this function. Their schemas
    // prove mathematical integrality and 0..=2^53-1, where every integer has an
    // exact f64 representation. Serde also accepts equivalent 8.0/8e0 tokens.
    // Original source Nodes retain those tokens. Arbitrary values never use it.
    match node.kind() {
        JsonKind::Number(number) => number.as_f64().filter(|value| value.is_finite() && value.fract()==0.0 &&
            *value>=0.0 && *value<=9_007_199_254_740_991.0).map(|value|value as u64).ok_or_else(||invariant("")),
        _ => Err(invariant("")),
    }
}
