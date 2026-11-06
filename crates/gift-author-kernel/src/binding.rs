//! Capture-local name analysis. No nominal identity, ModuleUse, type or callable
//! qualification is issued here. Every result ID belongs to input_revision.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
use serde::Serialize;
use crate::{model::{Diagnostic, fail}, reader::{self, DecodedSource}, reference_slots::{self, SlotKind}, source::{Node, Origin, pointer}};

type Result<T> = std::result::Result<T, Diagnostic>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct ModuleId(usize);
impl ModuleId { pub fn index(self) -> usize { self.0 } }
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct DeclarationId(usize);
impl DeclarationId { pub fn index(self) -> usize { self.0 } }

/// An explicit in-memory import request, not a resolved declaration or lock proof.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ImportBinding { pub from: usize, pub alias: String, pub target: usize }

#[derive(Serialize, Debug)]
pub struct ModuleNames {
    pub id: ModuleId,
    pub module_id: String,
    pub source_revision: String,
    pub grammar_revision: String,
}
#[derive(Serialize, Debug)]
pub struct DeclarationSeed {
    pub id: DeclarationId,
    pub module: ModuleId,
    pub name: String,
    pub kind: String,
    pub origin: Option<Origin>,
}
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
pub struct ExportHop {
    pub module: ModuleId,
    pub export: String,
    pub via_import: Option<String>,
    pub qualification: &'static str,
}
#[derive(Serialize, Debug)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Resolution {
    Resolved { declaration: DeclarationId, route: Vec<ExportHop> },
    Needs { code: &'static str, selector: String, route: Vec<ExportHop> },
    Rejected { code: &'static str, selector: String, route: Vec<ExportHop> },
}
impl Resolution {
    fn route_mut(&mut self) -> &mut Vec<ExportHop> {
        match self { Self::Resolved { route, .. } | Self::Needs { route, .. } | Self::Rejected { route, .. } => route }
    }
}
#[derive(Serialize, Debug)]
pub struct ReferenceResolution {
    pub module: ModuleId,
    pub owner: Option<DeclarationId>,
    pub expanded_path: String,
    pub origin: Option<Origin>,
    pub schema_slot: String,
    pub domain: &'static str,
    pub resolution: Resolution,
}
#[derive(Serialize, Debug)]
pub struct ExportResolution { pub module: ModuleId, pub name: String, pub resolution: Resolution }
#[derive(Serialize, Debug)]
pub struct PendingRegion { pub module: ModuleId, pub path: String, pub code: &'static str }
#[derive(Serialize, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct NameRead { pub module: ModuleId, pub domain: &'static str, pub name: String }
#[derive(Serialize, Debug)]
pub struct NameProblem { pub module: ModuleId, pub path: String, pub code: &'static str }

#[derive(Serialize, Debug)]
pub struct NameAnalysis {
    pub schema: &'static str,
    pub stage: &'static str,
    pub identity_scope: &'static str,
    pub input_revision: String,
    pub source_revision: String,
    pub root: ModuleId,
    pub modules: Vec<ModuleNames>,
    pub declarations: Vec<DeclarationSeed>,
    pub references: Vec<ReferenceResolution>,
    pub exports: Vec<ExportResolution>,
    pub reads: Vec<NameRead>,
    pub problems: Vec<NameProblem>,
    pub pending_regions: Vec<PendingRegion>,
    pub lexical: crate::lexical::LexicalArena,
    pub unchecked: &'static [&'static str],
}

/// Conservative retained/output allocation and repeated validation-work limits.
/// Exhaustion is ResourceLimit, never a statement that the author is invalid.
struct BudgetCounters {bytes:AtomicUsize,work:AtomicUsize}
pub(crate) struct Budget {counters:Arc<BudgetCounters>}
pub(crate) struct BudgetObserver {counters:Arc<BudgetCounters>}
impl BudgetObserver {pub(crate) fn remaining(&self)->(usize,usize) {(self.counters.work.load(Ordering::Relaxed),self.counters.bytes.load(Ordering::Relaxed))}}
impl Budget {
    pub(crate) fn new() -> Self { Self {counters:Arc::new(BudgetCounters {bytes:AtomicUsize::new(48*1024*1024),work:AtomicUsize::new(8_000_000)})} }
    pub(crate) fn observer(&self)->BudgetObserver {BudgetObserver {counters:Arc::clone(&self.counters)}}
    pub(crate) fn tighten(&mut self,work:usize,bytes:usize) {
        self.counters.work.store(self.counters.work.load(Ordering::Relaxed).min(work),Ordering::Relaxed);
        self.counters.bytes.store(self.counters.bytes.load(Ordering::Relaxed).min(bytes),Ordering::Relaxed);
    }
    pub(crate) fn work(&mut self, amount: usize) -> Result<()> {
        let remaining=self.counters.work.load(Ordering::Relaxed).checked_sub(amount).ok_or_else(|| fail("ResourceLimit", "", "Name-analysis work budget exceeded"))?;
        self.counters.work.store(remaining,Ordering::Relaxed);
        Ok(())
    }
    pub(crate) fn charge(&mut self, amount: usize) -> Result<()> {
        let remaining=self.counters.bytes.load(Ordering::Relaxed).checked_sub(amount).ok_or_else(|| fail("ResourceLimit", "", "Name-analysis allocation budget exceeded"))?;
        self.counters.bytes.store(remaining,Ordering::Relaxed);
        Ok(())
    }
    pub(crate) fn text(&mut self, text: &str) -> Result<()> { self.charge(text.len().saturating_mul(6).saturating_add(128)) }
    pub(crate) fn copy(&mut self, text: &str) -> Result<String> { self.text(text)?; Ok(text.into()) }
    pub(crate) fn origin(&mut self, node: &Node) -> Result<Option<Origin>> {
        if let Some(origin) = node.origin() { self.text(&origin.pointer)?; Ok(Some(origin.clone())) } else { Ok(None) }
    }
    pub(crate) fn child_path(&mut self, parent: &str, key: &str) -> Result<String> {
        let length = parent.len().saturating_add(key.len()).saturating_add(1)
            .saturating_add(key.bytes().filter(|c| matches!(c, b'~' | b'/')).count());
        self.charge(length.saturating_mul(6).saturating_add(128))?;
        Ok(pointer(parent, key))
    }
}

struct Prepared<'a> {
    sources: &'a [DecodedSource],
    declarations: Vec<BTreeMap<String, DeclarationId>>,
    imports: BTreeMap<(usize, String), usize>,
    conflicting_aliases: BTreeSet<(usize, String)>,
}
struct Resolver<'a> {
    input: Prepared<'a>,
    budget: Budget,
    reads: BTreeSet<NameRead>,
}
impl Resolver<'_> {
    fn read(&mut self, module: usize, domain: &'static str, name: &str) -> Result<()> {
        let name = self.budget.copy(name)?;
        self.reads.insert(NameRead { module: ModuleId(module), domain, name });
        Ok(())
    }
    fn unresolved(&mut self, need: bool, code: &'static str, selector: &str) -> Result<Resolution> {
        let selector = self.budget.copy(selector)?;
        Ok(if need { Resolution::Needs { code, selector, route: Vec::new() } }
            else { Resolution::Rejected { code, selector, route: Vec::new() } })
    }
    fn local(&mut self, module: usize, name: &str) -> Result<Resolution> {
        self.read(module, "local-declaration", name)?;
        if let Some(id) = self.input.declarations[module].get(name) {
            Ok(Resolution::Resolved { declaration: *id, route: Vec::new() })
        } else { self.unresolved(false, "MissingLocalDeclaration", name) }
    }
    fn import(&mut self, module: usize, alias: &str, name: &str) -> Result<Resolution> {
        self.read(module, "import-slot", alias)?;
        if self.input.conflicting_aliases.contains(&(module, alias.into())) {
            return self.unresolved(false, "ConflictingNamespaceAlias", alias);
        }
        if self.input.sources[module].expanded().get("imports").and_then(|i| i.get(alias)).is_none() {
            return self.unresolved(false, "MissingImportAlias", alias);
        }
        let Some(target) = self.input.imports.get(&(module, alias.into())).copied() else {
            return self.unresolved(true, "NeedsModuleCapture", alias);
        };
        self.public(target, name)
    }
    fn public(&mut self, mut module: usize, name: &str) -> Result<Resolution> {
        let mut name = self.budget.copy(name)?;
        let mut route = Vec::new();
        let mut active = BTreeSet::new();
        let mut result;
        loop {
            self.budget.work(1)?;
            self.budget.text(&name)?;
            if !active.insert((module, name.clone())) {
                result = self.unresolved(false, "ExportAliasCycle", &name)?;
                break;
            }
            self.read(module, "public-export", &name)?;
            let source = &self.input.sources[module];
            let Some(export) = source.expanded().get("exports").and_then(|e| e.get(&name)) else {
                result = self.unresolved(false, "MissingPublicExport", &name)?;
                break;
            };
            if let Some(local) = export.get("definitionId").and_then(Node::as_str) {
                route.push(ExportHop { module: ModuleId(module), export: self.budget.copy(&name)?, via_import: None, qualification: "capture-local" });
                let local = self.budget.copy(local)?;
                result = self.local(module, &local)?;
                break;
            }
            let alias = required_text(export, "import")?;
            let next = required_text(export, "export")?;
            let alias = self.budget.copy(alias)?;
            let next = self.budget.copy(next)?;
            let imported = source.expanded().get("imports").and_then(|i| i.get(&alias));
            let locked = imported.and_then(|i| i.get("mode")).and_then(Node::as_str) == Some("locked");
            route.push(ExportHop { module: ModuleId(module), export: self.budget.copy(&name)?, via_import: Some(self.budget.copy(&alias)?),
                qualification: if locked { "pending-lock-and-module-use" } else { "capture-local" } });
            self.read(module, "import-slot", &alias)?;
            if self.input.conflicting_aliases.contains(&(module, alias.clone())) {
                result = self.unresolved(false, "ConflictingNamespaceAlias", &alias)?; break;
            }
            if imported.is_none() { result = self.unresolved(false, "MissingImportAlias", &alias)?; break; }
            let Some(target) = self.input.imports.get(&(module, alias.clone())).copied() else {
                result = self.unresolved(true, "NeedsModuleCapture", &alias)?; break;
            };
            module = target; name = next;
        }
        *result.route_mut() = route;
        Ok(result)
    }
    fn dialect(&mut self, module: usize, alias: &str, consumer: &str, permitted: bool) -> Result<Resolution> {
        if !permitted { return self.unresolved(false, "InvalidReferenceNamespace", alias); }
        self.read(module, "dialect-slot", alias)?;
        if self.input.conflicting_aliases.contains(&(module, alias.into())) {
            return self.unresolved(false, "ConflictingNamespaceAlias", alias);
        }
        if self.input.sources[module].expanded().get("dialects").and_then(|d| d.get(alias)).is_none() {
            return self.unresolved(false, "MissingDialectAlias", alias);
        }
        self.unresolved(true, "NeedsDialectInterpretation", consumer)
    }
    fn selector(&mut self, module: usize, node: &Node, kind: &SlotKind, dialect_slot: bool) -> Result<Resolution> {
        if *kind == SlotKind::Profile {
            return self.unresolved(true, "NeedsProfileNameResolution", node.as_str().ok_or_else(|| fail("ReaderInvariant", "", "Expected original profile selector"))?);
        }
        if *kind == SlotKind::Definition {
            if let Some(local) = node.get("definitionId").and_then(Node::as_str) { return self.local(module, local); }
            return self.import(module, required_text(node, "import")?, required_text(node, "export")?);
        }
        if let Some(legacy) = node.as_str() {
            let (alias, name) = legacy.split_once(':').ok_or_else(|| fail("ReaderInvariant", "", "Expected validated LegacyRef"))?;
            if dialect_slot { return self.dialect(module, alias, name, true); }
            return match alias {
                "local" => self.local(module, name),
                "std" => self.unresolved(true, "NeedsPreludeInterpretation", name),
                _ => self.import(module, alias, name),
            };
        }
        match required_text(node, "space")? {
            "local" if !dialect_slot => self.local(module, required_text(node, "definition")?),
            "import" if !dialect_slot => self.import(module, required_text(node, "alias")?, required_text(node, "export")?),
            "dialect" => self.dialect(module, required_text(node, "alias")?, required_text(node, "consumer")?, dialect_slot),
            _ => self.unresolved(false, "InvalidReferenceNamespace", required_text(node, "space")?),
        }
    }
}

fn required_text<'a>(node: &'a Node, field: &str) -> Result<&'a str> {
    node.get(field).and_then(Node::as_str).ok_or_else(|| fail("ReaderInvariant", "", "Missing field in Reader-validated module"))
}
fn definitions(source: &DecodedSource) -> Result<&BTreeMap<String, Node>> {
    source.expanded().get("definitions").and_then(Node::as_object)
        .ok_or_else(|| fail("ReaderInvariant", "", "Expected module definitions"))
}

/// Analyze fixed captures and explicit in-memory import edges. Each capture slot
/// is distinct; no global moduleId map or byte deduplication creates identity.
pub fn analyze_sources(sources: &[DecodedSource], bindings: &[ImportBinding], root: usize) -> Result<NameAnalysis> {
    Ok(prepare_sources(sources, bindings, root, false)?.names)
}

pub(crate) struct PreparedNames {
    pub names: NameAnalysis,
    pub navigation: Vec<reference_slots::Navigation>,
    pub budget: Budget,
}

/// Type/header formation retains this same navigation and its remaining budget.
/// Ordinary names callers do not execute type formation or retain its inputs.
pub(crate) fn prepare_sources(sources: &[DecodedSource], bindings: &[ImportBinding], root: usize,
    retain_navigation: bool) -> Result<PreparedNames> {
    prepare_sources_budget(sources,bindings,root,retain_navigation,Budget::new(),None)
}

pub(crate) fn prepare_sources_budget(sources:&[DecodedSource],bindings:&[ImportBinding],root:usize,
    retain_navigation:bool,mut budget:Budget,qualified:Option<&BTreeSet<(usize,String)>>)->Result<PreparedNames> {
    if sources.is_empty() || root >= sources.len() { return Err(fail("InvalidNameInput", "", "Root must select an actual captured module")); }
    if sources.len() > 128 || sources.iter().map(|s| s.bytes().len()).sum::<usize>() > 32 * 1024 * 1024 {
        return Err(fail("ResourceLimit", "", "Name-analysis capture budget exceeded"));
    }
    let mut modules = Vec::new();
    let mut seeds = Vec::new();
    let mut tables = Vec::new();
    let mut problems = Vec::new();
    let mut pending_regions = Vec::new();
    let mut conflicting_aliases = BTreeSet::new();
    for (index, source) in sources.iter().enumerate() {
        budget.work(source.bytes().len()/16+1)?;
        if source.source_format() != "gift.author-module/design-converged" {
            return Err(fail("NeedsModuleCapture", "", "Name analysis needs captured modules; a project describes capture requests"));
        }
        let module = source.expanded();
        modules.push(ModuleNames { id: ModuleId(index), module_id: budget.copy(required_text(module, "moduleId")?)?,
            source_revision: crate::digest(source.bytes()), grammar_revision: budget.copy(source.grammar_revision())? });
        let mut table = BTreeMap::new();
        for (name, definition) in definitions(source)? {
            budget.work(1)?;
            let id = DeclarationId(seeds.len());
            table.insert(budget.copy(name)?, id);
            seeds.push(DeclarationSeed { id, module: ModuleId(index), name: budget.copy(name)?,
                kind: budget.copy(required_text(definition, "kind")?)?, origin: budget.origin(definition)? });
            if required_text(definition, "kind")? == "extension:definition" {
                let path = budget.child_path("/definitions", name)?;
                pending_regions.push(PendingRegion { module: ModuleId(index), path: budget.child_path(&path, "body")?, code: "NeedsProfessionalInterpretation" });
                let body = definition.get("body").ok_or_else(|| fail("ReaderInvariant", "", "Expected extension body"))?;
                let alias = required_text(body, "dialectRef")?;
                if module.get("dialects").and_then(|d| d.get(alias)).is_none() {
                    problems.push(NameProblem { module: ModuleId(index), path: budget.child_path(&pointer(&path, "body"), "dialectRef")?, code: "MissingDialectAlias" });
                }
            }
        }
        for group in ["imports", "dialects"] {
            if let Some(entries) = module.get(group).and_then(Node::as_object) {
                for name in entries.keys() {
                    if name == "local" || name == "std" || (group == "dialects" && module.get("imports").and_then(|i| i.get(name)).is_some()) {
                        conflicting_aliases.insert((index, budget.copy(name)?));
                        problems.push(NameProblem { module: ModuleId(index), path: budget.child_path(&format!("/{group}"), name)?, code: "ConflictingNamespaceAlias" });
                    }
                }
            }
        }
        tables.push(table);
    }
    let mut imports = BTreeMap::new();
    for binding in bindings {
        budget.work(1)?;
        if binding.from >= sources.len() || binding.target >= sources.len() {
            return Err(fail("InvalidNameInput", "", "Import binding selects an uncaptured source slot"));
        }
        let import = sources[binding.from].expanded().get("imports").and_then(|i| i.get(&binding.alias))
            .ok_or_else(|| fail("InvalidNameInput", "", "Import binding must select a real source import alias"))?;
        if required_text(import, "moduleId")? != modules[binding.target].module_id {
            return Err(fail("ImportModuleMismatch", "", "Captured target moduleId does not match the source import"));
        }
        if imports.insert((binding.from, budget.copy(&binding.alias)?), binding.target).is_some() {
            return Err(fail("AmbiguousImportBinding", "", "An import slot cannot have two explicit bindings"));
        }
    }
    // Hash the entire input relation, not merely the root author's bytes.
    let edges: Vec<_> = imports.iter().map(|((from, alias), target)| (*from, alias, *target)).collect();
    let input_revision = crate::digest(&serde_json::to_vec(&(&modules, edges, root)).map_err(|e| fail("OutputFailure", "", e.to_string()))?);
    let source_revision = modules[root].source_revision.clone();
    let prepared = Prepared { sources, declarations: tables, imports, conflicting_aliases };
    let mut resolver = Resolver { input: prepared, budget, reads: BTreeSet::new() };
    let mut exports = Vec::new();
    let mut references = Vec::new();
    let mut lexical = crate::lexical::LexicalArena::default();
    let mut retained_navigation = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        let reader=source.reader();
        if let Some(entries) = source.expanded().get("imports").and_then(Node::as_object) {
            for (alias, import) in entries {
                resolver.read(index, "import-slot", alias)?;
                if !resolver.input.imports.contains_key(&(index, alias.clone())) {
                    pending_regions.push(PendingRegion { module: ModuleId(index), path: resolver.budget.child_path("/imports", alias)?, code: "NeedsModuleCapture" });
                } else if required_text(import, "mode")? == "locked" && !qualified.is_some_and(|edges|edges.contains(&(index,alias.clone()))) {
                    pending_regions.push(PendingRegion { module: ModuleId(index), path: resolver.budget.child_path("/imports", alias)?, code: "NeedsLockQualification" });
                }
            }
        }
        if let Some(entries) = source.expanded().get("exports").and_then(Node::as_object) {
            for name in entries.keys() {
                let resolution = resolver.public(index, name)?;
                exports.push(ExportResolution { module: ModuleId(index), name: resolver.budget.copy(name)?, resolution });
            }
        }
        let mut navigation = reference_slots::collect(reader, source.expanded(), &mut resolver.budget)?;
        crate::lexical::analyze_module(reader, &navigation, source, ModuleId(index),
            &resolver.input.declarations[index], &mut lexical, &mut resolver.budget)?;
        for slot in std::mem::take(&mut navigation.references).into_values() {
            let name = slot.path.strip_prefix("/definitions/").and_then(|path| path.split_once('/')).map(|(name, _)| name.replace("~1", "/").replace("~0", "~"));
            let owner = name.as_ref().and_then(|name| resolver.input.declarations[index].get(name)).copied();
            let dialect_slot = owner.is_some_and(|id| seeds[id.0].kind == "extension:definition" &&
                slot.path == format!("{}/body/bindingRef", pointer("/definitions", &seeds[id.0].name)));
            let resolution = resolver.selector(index, &slot.node, &slot.kind, dialect_slot)?;
            let domain = match slot.kind { SlotKind::Source => if dialect_slot { "dialect-consumer" } else { "source-reference" },
                SlotKind::Definition => "declaration-selector", SlotKind::Profile => "profile-selector" };
            references.push(ReferenceResolution { module: ModuleId(index), owner, expanded_path: slot.path,
                origin: resolver.budget.origin(&slot.node)?, schema_slot: slot.schema, domain, resolution });
        }
        if retain_navigation {
            resolver.budget.charge(128)?;
            retained_navigation.push(navigation);
        }
    }
    if let Some(qualified)=qualified {
        for resolution in exports.iter_mut().map(|export|&mut export.resolution).chain(references.iter_mut().map(|reference|&mut reference.resolution)) {
            for hop in resolution.route_mut() {
                resolver.budget.work(1+4*(qualified.len()+1).ilog2() as usize)?;
                let known=if let Some(alias)=&hop.via_import {
                    resolver.budget.text(alias)?;
                    qualified.contains(&(hop.module.0,alias.clone()))
                }else{true};
                if known {hop.qualification="module-use";}
            }
        }
    }
    let names = NameAnalysis { schema: "gift.author-names/2", stage: "names", identity_scope: if qualified.is_some(){"module-use"}else{"capture-local"}, input_revision, source_revision,
        root: ModuleId(root), modules, declarations: seeds, references, exports, reads: resolver.reads.into_iter().collect(), problems, pending_regions, lexical,
        unchecked: if qualified.is_some(){&["declaration-roles", "types", "effects", "capture-lifetimes-and-escape", "initialization-dependencies", "professional-interpretation", "callable-qualification", "persistent-declaration-lineage", "target"]}
            else{&["declaration-roles", "types", "effects", "capture-lifetimes-and-escape", "initialization-dependencies", "professional-interpretation", "callable-qualification", "module-use-and-lock", "persistent-declaration-lineage", "target"]} };
    Ok(PreparedNames { names, navigation: retained_navigation, budget: resolver.budget })
}

pub fn analyze(bytes: &[u8]) -> Result<NameAnalysis> { analyze_sources(&[reader::read(bytes)?], &[], 0) }
