//! Navigation of already validated structure. Schema addresses identify slots;
//! they do not establish lexical binding, declaration roles or interpretation.
use std::collections::{BTreeMap, BTreeSet};
use serde_json::Value;
use crate::{binding::Budget, grammar, model::{Diagnostic, fail}, reader::Reader, source::{Node, pointer}};

const NAMES: &str = "urn:gift:design-schema:first-layer-names";
const REQUIREMENT: &str = "urn:gift:design-schema:requirement-structure-1-converged-base";
pub(crate) const SHARED: &str = "urn:gift:design-schema:shared-semantic-structure-1-converged-base";
const INTENT: &str = "urn:gift:design-schema:intent-body-1-converged-base";
const PATTERN: &str = "urn:gift:design-schema:semantic-pattern-1-converged-base";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SlotKind { Source, Definition, Profile }

pub(crate) struct Slot {
    pub path: String,
    pub schema: String,
    pub kind: SlotKind,
    pub node: Node,
}
/// Selected Schema navigation, shared by module and lexical name consumers.
/// A site is one expanded occurrence, even when its Node is shared elsewhere.
pub(crate) struct Site {
    pub node: Node,
    pub schemas: BTreeSet<String>,
}
#[derive(Default)]
pub(crate) struct Navigation {
    pub references: BTreeMap<String, Slot>,
    pub sites: BTreeMap<String, Site>,
}
type Slots = Navigation;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Address { resource: String, pointer: String }
impl Address {
    fn child(&self, key: &str) -> Self {
        Self { resource: self.resource.clone(), pointer: pointer(&self.pointer, key) }
    }
    fn reference(&self, reference: &str) -> Result<Self, Diagnostic> {
        let (resource, fragment) = reference.split_once('#').unwrap_or((reference, ""));
        let fragment = percent_encoding::percent_decode_str(fragment).decode_utf8()
            .map_err(|e| fail("GrammarDrift", "", e.to_string()))?;
        if !fragment.is_empty() && !fragment.starts_with('/') {
            return Err(fail("GrammarCapabilityUnsupported", "", "Name navigation requires an exact Schema JSON Pointer"));
        }
        Ok(Self { resource: if resource.is_empty() { self.resource.clone() } else { resource.into() }, pointer: fragment.into_owned() })
    }
    fn uri(&self) -> String {
        const FRAGMENT: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS.add(b' ').add(b'#').add(b'%').add(b'"').add(b'<').add(b'>').add(b'\\');
        format!("{}#{}", self.resource, percent_encoding::utf8_percent_encode(&self.pointer, FRAGMENT))
    }
}

struct Navigator<'a> {
    reader: &'a Reader,
    budget: &'a mut Budget,
    // Validation work counts logical occurrences, even for a shared source DAG.
    weights: BTreeMap<usize, usize>,
    active: BTreeSet<(Address, usize)>,
}
impl Navigator<'_> {
    fn weight(&mut self, node: &Node) -> Result<usize, Diagnostic> {
        if let Some(weight) = self.weights.get(&node.identity()) { return Ok(*weight); }
        self.budget.work(1)?;
        self.budget.charge(96)?;
        let mut weight = 1usize;
        if let Some(object) = node.as_object() {
            for (key, child) in object { weight = weight.saturating_add(key.len()).saturating_add(self.weight(child)?); }
        } else if let Some(array) = node.as_array() {
            for child in array { weight = weight.saturating_add(self.weight(child)?); }
        } else if let Some(text) = node.as_str() {
            weight = weight.saturating_add(text.len());
        } else if let Some(origin) = node.origin() {
            weight = weight.saturating_add(origin.end - origin.start);
        }
        self.weights.insert(node.identity(), weight);
        Ok(weight)
    }
    fn valid(&mut self, address: &Address, node: &Node) -> Result<bool, Diagnostic> {
        let weight = self.weight(node)?;
        self.budget.work(weight)?;
        Ok(self.reader.validator(&address.uri())?.is_valid(node))
    }
    fn slot(&mut self, address: &Address, node: &Node, path: &str, kind: SlotKind) -> Result<Slots, Diagnostic> {
        let uri = address.uri();
        self.budget.text(path)?;
        self.budget.text(&uri)?;
        let slot = Slot { path: path.into(), schema: uri, kind, node: node.clone() };
        self.budget.text(path)?;
        Ok(Navigation { references: BTreeMap::from([(path.into(), slot)]), sites: BTreeMap::new() })
    }
    fn merge(&mut self, into: &mut Slots, from: Slots) -> Result<(), Diagnostic> {
        for (path, slot) in from.references {
            if let Some(old) = into.references.get(&path) {
                if old.kind != slot.kind {
                    return Err(fail("AmbiguousReferenceSlots", &path, "Applicable Schema branches disagree about the reference domain"));
                }
            } else { into.references.insert(path, slot); }
        }
        for (path, site) in from.sites {
            if let Some(old) = into.sites.get_mut(&path) {
                old.schemas.extend(site.schemas);
            } else { into.sites.insert(path, site); }
        }
        Ok(())
    }
    fn walk(&mut self, address: &Address, node: &Node, path: &str, depth: usize) -> Result<Slots, Diagnostic> {
        self.budget.work(1)?;
        if depth > 256 { return Err(fail("ResourceLimit", "", "Name navigation depth budget exceeded")); }
        // A schema-only cycle at one occurrence contributes no additional slots.
        let key = (address.clone(), node.identity());
        if !self.active.insert(key.clone()) { return Ok(Slots::default()); }
        let result = self.walk_inner(address, node, path, depth);
        self.active.remove(&key);
        result
    }
    fn walk_inner(&mut self, address: &Address, node: &Node, path: &str, depth: usize) -> Result<Slots, Diagnostic> {
        if (address.resource == grammar::MODULE && address.pointer == "/$defs/Ref") ||
            (address.resource == NAMES && matches!(address.pointer.as_str(), "/$defs/SourceRef" | "/$defs/StructuredSourceRef")) {
            return self.slot(address, node, path, SlotKind::Source);
        }
        if matches!(address.resource.as_str(), REQUIREMENT | SHARED) && address.pointer == "/$defs/DefinitionRef" {
            return self.slot(address, node, path, SlotKind::Definition);
        }
        // These exact owners define ordinary JSON data, not another author region.
        if (address.resource == grammar::MODULE || address.resource == REQUIREMENT) && address.pointer == "/$defs/Json" { return Ok(Slots::default()); }
        let reader = self.reader;
        let schema = reader.graph().get(&address.resource).and_then(|root| root.pointer(&address.pointer))
            .ok_or_else(|| fail("GrammarDrift", "", "Name navigation references an absent Schema node"))?;
        if !schema.is_object() { return Ok(Slots::default()); }
        if matches!(address.resource.as_str(), INTENT | PATTERN) && node.as_str().is_some() &&
            schema.get("oneOf").and_then(Value::as_array).is_some_and(|branches| branches.iter().any(|branch|
                branch.get("$ref").and_then(Value::as_str) == Some("urn:gift:design-schema:first-layer-names#/$defs/StructuredSourceRef"))) {
            return self.slot(address, node, path, SlotKind::Profile);
        }
        let mut result = Slots::default();
        if node.as_object().is_some() || node.as_array().is_some() {
            self.budget.text(path)?;
            self.budget.charge(192)?;
            let uri = address.uri();
            self.budget.text(&uri)?;
            result.sites.insert(path.into(), Site { node: node.clone(), schemas: BTreeSet::from([uri]) });
        }
        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            let target = address.reference(reference)?;
            let slots = self.walk(&target, node, path, depth + 1)?;
            self.merge(&mut result, slots)?;
            // Draft 2020-12 siblings continue below.
        }
        if let Some(branches) = schema.get("allOf").and_then(Value::as_array) {
            for i in 0..branches.len() {
                let slots = self.walk(&address.child("allOf").child(&i.to_string()), node, path, depth + 1)?;
                self.merge(&mut result, slots)?;
            }
        }
        for union in ["oneOf", "anyOf"] {
            if let Some(branches) = schema.get(union).and_then(Value::as_array) {
                let mut selected: Option<Slots> = None;
                let mut count = 0;
                for i in 0..branches.len() {
                    let branch = address.child(union).child(&i.to_string());
                    if !self.valid(&branch, node)? { continue; }
                    count += 1;
                    let slots = self.walk(&branch, node, path, depth + 1)?;
                    if let Some(old) = &selected {
                        if old.references.len() != slots.references.len() || old.references.iter().any(|(p,s)| slots.references.get(p).is_none_or(|n| n.kind != s.kind)) {
                            return Err(fail("AmbiguousReferenceSlots", path, "Valid alternatives disagree between reference slots and ordinary data"));
                        }
                        // Applicable branches may add complementary structural
                        // addresses, but must agree on the reference domains.
                        if let Some(selected) = &mut selected { self.merge(selected, slots)?; }
                    } else { selected = Some(slots); }
                }
                if count == 0 || (union == "oneOf" && count != 1) {
                    return Err(fail("ReaderInvariant", path, "Validated source no longer selects the required Schema branch"));
                }
                self.merge(&mut result, selected.unwrap_or_default())?;
            }
        }
        if schema.get("if").is_some() {
            let branch = if self.valid(&address.child("if"), node)? { "then" } else { "else" };
            if schema.get(branch).is_some() {
                let slots = self.walk(&address.child(branch), node, path, depth + 1)?;
                self.merge(&mut result, slots)?;
            }
        }
        // Current captured grammar has no pattern/unevaluated/dependent schemas.
        // Refuse a future navigation requirement rather than silently omit children.
        for key in ["patternProperties", "unevaluatedProperties", "unevaluatedItems", "dependentSchemas"] {
            if schema.get(key).is_some() {
                return Err(fail("GrammarCapabilityUnsupported", path, format!("Name navigation requires qualification for {key}")));
            }
        }
        if let Some(object) = node.as_object() {
            let properties = schema.get("properties").and_then(Value::as_object);
            for (name, child) in object {
                let child_address = if properties.is_some_and(|p| p.contains_key(name)) {
                    Some(address.child("properties").child(name))
                } else if schema.get("additionalProperties").is_some_and(Value::is_object) {
                    Some(address.child("additionalProperties"))
                } else { None };
                if let Some(child_address) = child_address {
                    let child_path = self.budget.child_path(path, name)?;
                    let slots = self.walk(&child_address, child, &child_path, depth + 1)?;
                    self.merge(&mut result, slots)?;
                }
            }
        }
        if let Some(array) = node.as_array() {
            let prefix = schema.get("prefixItems").and_then(Value::as_array).map_or(0, Vec::len);
            for (i, child) in array.iter().enumerate() {
                let child_path = self.budget.child_path(path, &i.to_string())?;
                let child_address = if i < prefix { Some(address.child("prefixItems").child(&i.to_string())) }
                    else if schema.get("items").is_some_and(Value::is_object) { Some(address.child("items")) } else { None };
                if let Some(child_address) = child_address {
                    let slots = self.walk(&child_address, child, &child_path, depth + 1)?;
                    self.merge(&mut result, slots)?;
                }
                if schema.get("contains").is_some() && self.valid(&address.child("contains"), child)? {
                    let slots = self.walk(&address.child("contains"), child, &child_path, depth + 1)?;
                    self.merge(&mut result, slots)?;
                }
            }
        }
        Ok(result)
    }
}

pub(crate) fn collect(reader: &Reader, node: &Node, budget: &mut Budget) -> Result<Navigation, Diagnostic> {
    let address = Address { resource: grammar::MODULE.into(), pointer: String::new() };
    Navigator { reader, budget, weights: BTreeMap::new(), active: BTreeSet::new() }
        .walk(&address, node, "", 0)
}
