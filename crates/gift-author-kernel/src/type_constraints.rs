//! Finite constraints over the common semantic arena. Equality does not issue
//! effect inclusion, static-value, callable or target qualifications.
use std::collections::{BTreeMap, BTreeSet};
use crate::{binding::{Budget, DeclarationId}, header_seeds::{HeaderKind, HeaderSeed, Representation},
    model::{Diagnostic, fail}, semantic_types::*};

type Result<T> = std::result::Result<T, Diagnostic>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation { Equal, Needs }
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConstraintNeed { pub source: SourceId, pub code: &'static str }
type Variable = InferenceVariable;
#[derive(Clone)]
struct Alias { binders: Vec<SemanticBinderId>, ty: TypeId, transparent: bool }

/// An opaque, session-local checkpoint. Restoring it does not refund work or
/// allocation accounting. Nested probes must restore in stack order.
pub(crate) struct Checkpoint {
    variables: Vec<Variable>,
    nodes: usize,
    binders: usize,
    needs: usize,
}
enum Meter<'a> { Shared(&'a mut Budget), Standalone { work: usize, bytes: usize } }

pub struct ConstraintMachine<'a> {
    pub(crate) arena: &'a mut TypeArena,
    pub(crate) needs: Vec<ConstraintNeed>,
    aliases: BTreeMap<DeclarationId, Alias>,
    meter: Meter<'a>,
    exhausted: bool,
}
impl<'a> ConstraintMachine<'a> {
    /// Bounded isolated use, for consumers that already own a formed arena.
    /// The signature frontend uses its original retained Reader/name budget.
    pub fn new(arena: &'a mut TypeArena, work: usize, bytes: usize) -> Self {
        Self { arena, needs: Vec::new(), aliases: BTreeMap::new(), meter:Meter::Standalone {work,bytes},exhausted:false }
    }
    pub(crate) fn shared(arena: &'a mut TypeArena, budget: &'a mut Budget) -> Self {
        Self { arena, needs: Vec::new(), aliases: BTreeMap::new(), meter:Meter::Shared(budget),exhausted:false }
    }
    pub fn arena(&self)->&TypeArena {self.arena}
    pub fn needs(&self)->&[ConstraintNeed] {&self.needs}
    pub(crate) fn work(&mut self, amount: usize) -> Result<()> {
        if self.exhausted {return Err(limit());}
        let result=match &mut self.meter {
            Meter::Shared(budget)=>budget.work(amount),
            Meter::Standalone {work,..}=>match work.checked_sub(amount){Some(left)=>{*work=left;Ok(())},None=>Err(limit())},
        };
        self.exhausted=result.is_err();result
    }
    pub(crate) fn charge(&mut self, amount: usize) -> Result<()> {
        if self.exhausted {return Err(limit());}
        let result=match &mut self.meter {
            Meter::Shared(budget)=>budget.charge(amount),
            Meter::Standalone {bytes,..}=>match bytes.checked_sub(amount){Some(left)=>{*bytes=left;Ok(())},None=>Err(limit())},
        };
        self.exhausted=result.is_err();result
    }
    pub(crate) fn path(&mut self, parent: &str, key: &str) -> Result<String> {
        self.charge((parent.len()+key.len()).saturating_mul(12).saturating_add(128))?;
        Ok(crate::source::pointer(parent,key))
    }
    pub fn insert(&mut self, ty: SemanticType) -> Result<TypeId> {
        self.work(1)?;
        self.account(type_cost(&ty,0))?;
        let id=TypeId(self.arena.nodes.len()); self.arena.nodes.push(ty); Ok(id)
    }
    fn account(&mut self,cost:OwnershipCost)->Result<()> {
        self.work(cost.work)?;
        self.charge(cost.bytes)
    }
    pub(crate) fn copy_type(&mut self,ty:TypeId)->Result<SemanticType> {
        self.account(type_cost(self.arena.get(ty),0))?;
        Ok(self.arena.get(ty).clone())
    }
    fn copy_binder(&mut self,id:SemanticBinderId)->Result<SemanticBinder> {
        self.account(binder_cost(&self.arena.binders[id.index()]))?;
        Ok(self.arena.binders[id.index()].clone())
    }
    pub(crate) fn account_function_metadata(&mut self,effects:Option<&EffectRow>,contracts:Option<&[ParameterContract]>,captures:Option<&[Capture]>,call_mode:Option<&str>)->Result<()> {
        let mut cost=OwnershipCost::new();
        if let Some(row)=effects {cost.merge(effect_cost(row,0));}
        if let Some(contracts)=contracts {cost.sequence(contracts.len(),64);for item in contracts{cost.text(&item.retention);}}
        if let Some(captures)=captures {cost.sequence(captures.len(),64);}
        if let Some(mode)=call_mode {cost.text(mode);}
        self.account(cost)
    }
    pub(crate) fn copy_annotations(&mut self,source:SourceId)->Result<Option<FunctionAnnotations>> {
        let Some(index)=self.arena.function_annotations.iter().position(|a|a.source==source) else{return Ok(None);};
        let annotations=&self.arena.function_annotations[index];
        let mut cost=OwnershipCost::new();
        if let Some(row)=&annotations.effects {cost.merge(effect_cost(row,0));}
        if let Some(contracts)=&annotations.parameter_contracts {cost.sequence(contracts.len(),64);for item in contracts{cost.text(&item.retention);}}
        if let Some(captures)=&annotations.captures {cost.sequence(captures.len(),64);}
        if let Some(mode)=&annotations.call_mode {cost.text(mode);}
        self.account(cost)?;
        Ok(Some(self.arena.function_annotations[index].clone()))
    }
    pub fn fresh(&mut self, kind: SemanticKind, visible: BTreeSet<SemanticBinderId>) -> Result<TypeId> {
        self.account(kind_cost(&kind,0))?;
        self.charge(192+visible.len().saturating_mul(64))?;
        let id=MetaId(self.arena.inference_variables.len());
        self.arena.inference_variables.push(Variable {kind,visible,value:None});
        self.insert(SemanticType::Inference(id))
    }
    pub(crate) fn checkpoint(&mut self) -> Result<Checkpoint> {
        self.work(self.arena.inference_variables.len().saturating_add(1))?;
        let mut cost=OwnershipCost::new();
        for variable in &self.arena.inference_variables {cost.merge(variable_cost(variable));}
        self.account(cost)?;
        Ok(Checkpoint {variables:self.arena.inference_variables.clone(),nodes:self.arena.nodes.len(),binders:self.arena.binders.len(),needs:self.needs.len()})
    }
    pub(crate) fn rollback(&mut self, point: Checkpoint) {
        self.arena.inference_variables=point.variables;
        self.arena.nodes.truncate(point.nodes);
        self.arena.binders.truncate(point.binders);
        self.needs.truncate(point.needs);
    }
    /// Every probe is speculative, including a successful one. Selection can
    /// repeat the selected constraint in the enclosing transaction to commit it.
    pub fn probe(&mut self, check: impl FnOnce(&mut Self)->Result<Relation>) -> Result<Relation> {
        let point=self.checkpoint()?;
        let result=check(self);
        self.rollback(point);
        result
    }
    pub fn need(&mut self, source: SourceId, code: &'static str) -> Result<Relation> {
        self.work(1)?;
        if !self.needs.iter().any(|item|item.source==source&&item.code==code) {
            self.charge(96)?; self.needs.push(ConstraintNeed {source,code});
        }
        Ok(Relation::Needs)
    }
    pub(crate) fn register_headers(&mut self, headers: &[HeaderSeed]) -> Result<()> {
        for header in headers {
            if let HeaderKind::Type {binders,representation,ty,opaque,..}=&header.kind {
                self.work(1)?; self.charge(128+binders.len()*64)?;
                self.aliases.insert(header.declaration,Alias {binders:binders.clone(),ty:*ty,
                    transparent:*representation==Representation::Alias&&*opaque!=Some(true)});
            }
        }
        Ok(())
    }
    pub fn validate_aliases(&mut self, headers:&[HeaderSeed])->Result<()> {
        for header in headers {
            if let HeaderKind::Type {ty,..}=header.kind {
                self.alias_walk(ty,header.source,&mut BTreeSet::new(),0)?;
            }
        }
        Ok(())
    }
    fn alias_walk(&mut self,ty:TypeId,source:SourceId,active:&mut BTreeSet<DeclarationId>,depth:usize)->Result<()> {
        self.depth(depth)?;
        let node=self.copy_type(ty)?;
        if let SemanticType::Declaration {target,..}=&node {
            if let Some(declaration)=target.declaration {
                if let Some(alias)=self.aliases.get(&declaration).cloned() {
                    if !alias.transparent {return Ok(());}
                    if !active.insert(declaration) {return Err(self.error("TypeAliasCycle",source,"Transparent alias cycle"));}
                    self.alias_walk(alias.ty,source,active,depth+1)?;
                    active.remove(&declaration);
                }
            }
        }
        for child in children(&node){self.alias_walk(child,source,active,depth+1)?;}
        Ok(())
    }
    pub fn resolve(&mut self, mut ty: TypeId) -> Result<TypeId> {
        for _ in 0..=self.arena.inference_variables.len() {
            self.work(1)?;
            match self.arena.get(ty) {
                SemanticType::Inference(id)=>match self.arena.inference_variables.get(id.index()).and_then(|v|v.value) {
                    Some(value)=>ty=value, None=>return Ok(ty),
                },
                _=>return Ok(ty),
            }
        }
        Err(fail("ConstraintInvariant","","Cyclic substitution"))
    }
    pub fn normalize(&mut self, ty: TypeId, source: SourceId) -> Result<TypeId> {
        self.normalize_inner(ty,source,&mut BTreeSet::new(),0)
    }
    /// Formation preserves syntax and bindings. This judgment checks the
    /// complete Type closure before any signature can become type-ready.
    pub fn validate_type(&mut self,ty:TypeId,source:SourceId)->Result<Relation> {
        self.validate_type_inner(ty,source,0)
    }
    fn validate_type_inner(&mut self,ty:TypeId,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        let ty=self.resolve(ty)?;
        let node=self.copy_type(ty)?;
        if let SemanticType::Parameter(usage)=&node {
            if usage.semantic.is_none() {
                let issue=self.arena.occurrences.iter().filter(|item|item.ty==ty)
                    .find_map(|item|self.arena.problems.iter().find(|problem|problem.source==item.source)).cloned();
                if let Some(issue)=issue {
                    return Err(self.error(if issue.code=="BindingKindMismatch"{"TypeKindMismatch"}else{issue.code},source,"Rejected Type binder reference"));
                }
                return self.need(source,"NeedsTypeInterpretation");
            }
        }
        let kind=self.kind(ty)?;
        if self.unify_kinds(kind,SemanticKind::Type,source,depth+1)?==Relation::Needs {return Ok(Relation::Needs);}
        if matches!(node,SemanticType::Inference(_)) {return Ok(Relation::Needs);}
        if let SemanticType::Declaration {target,arguments}=&node {
            let Some(declaration)=target.declaration else {return self.need(source,"NeedsDeclaredTypeQualification");};
            let Some(alias)=self.aliases.get(&declaration).cloned() else {return self.need(source,"NeedsProfessionalTypeQualification");};
            if self.has_expansion(arguments)? {
                let expected=if let Some(first)=alias.binders.first() {
                    let kind=self.copy_binder(*first)?.kind;
                    let mut homogeneous=true;
                    for binder in &alias.binders[1..] {
                        self.work(1)?;
                        homogeneous&=self.arena.binders[binder.index()].kind==kind;
                    }
                    homogeneous.then_some(kind)
                }else{None};
                for argument in arguments {
                    self.validate_sequence_item(argument,expected.as_ref(),source,depth+1)?;
                }
                return self.need(source,"NeedsSemanticArgumentArity");
            }
            if alias.binders.len()!=arguments.len(){return Err(self.error("TypeArity",source,"Declaration semantic argument count differs"));}
            let mut pending=false;
            for (binder,argument) in alias.binders.iter().zip(arguments) {
                let expected=self.copy_binder(*binder)?.kind;
                pending|=self.validate_argument(argument,&expected,source,depth+1)?==Relation::Needs;
            }
            if pending {return Ok(Relation::Needs);}
            if alias.transparent {
                let normalized=self.normalize(ty,source)?;
                if normalized==ty {return self.need(source,"NeedsAliasSemanticArguments");}
                return self.validate_type_inner(normalized,source,depth+1);
            }
            return Ok(Relation::Equal);
        }
        if unknown_node(&node) {return self.need(source,"NeedsTypeInterpretation");}
        if matches!(node,SemanticType::SubjectSchema {..}|SemanticType::DefinitionReference {..}) {
            return self.need(source,"NeedsProfessionalTypeQualification");
        }
        let mut pending=false;
        let sequence=match &node {
            SemanticType::Function(function)=>Some(function.parameters.as_slice()),
            SemanticType::Tuple(arguments)=>Some(arguments.as_slice()),_=>None,
        };
        if let Some(sequence)=sequence {
            for argument in sequence {
                pending|=self.validate_sequence_item(argument,Some(&SemanticKind::Type),source,depth+1)?==Relation::Needs;
            }
        }
        if let SemanticType::Apply {arguments,..}|SemanticType::Associated {arguments,..}=&node {
            if self.has_expansion(arguments)? {
                for argument in arguments {
                    self.validate_sequence_item(argument,None,source,depth+1)?;
                }
                pending=true;
                self.need(source,"NeedsSemanticArgumentArity")?;
            }
        }
        for child in self.scoped_children(&node)? {
            pending|=self.validate_type_inner(child,source,depth+1)?==Relation::Needs;
        }
        Ok(if pending{Relation::Needs}else{Relation::Equal})
    }
    fn validate_argument(&mut self,argument:&SemanticArgument,expected:&SemanticKind,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        let actual=match argument {
            SemanticArgument::Type(ty)=>{
                if *expected!=SemanticKind::Type {return Err(self.error("TypeKindMismatch",source,"Type argument supplied to a different semantic kind"));}
                return self.validate_type_inner(*ty,source,depth+1);
            },
            SemanticArgument::Region(usage)|SemanticArgument::Scope(usage)=>{
                let Some(id)=usage.semantic else{return self.need(source,"NeedsSemanticArgumentBinding");};
                self.copy_binder(id)?.kind
            },
            SemanticArgument::EffectRow(_)=>SemanticKind::EffectRow,
            SemanticArgument::Value(_) if matches!(expected,SemanticKind::Value(_))=>return self.need(source,"NeedsStaticValueQualification"),
            SemanticArgument::Constructor(_) if matches!(expected,SemanticKind::Constructor(_))=>return self.need(source,"NeedsConstructorArgumentQualification"),
            SemanticArgument::Pack(pack) if matches!(expected,SemanticKind::Pack(_))=>{
                let SemanticKind::Pack(element)=expected else{unreachable!()};
                self.validate_pack(pack,Some(element),source,depth+1)?;
                return self.need(source,"NeedsPackArgumentQualification");
            },
            SemanticArgument::PackElement {pack,..}=>{
                self.validate_pack(pack,Some(expected),source,depth+1)?;
                return self.need(source,"NeedsPackElementQualification");
            },
            _=>return Err(self.error("TypeKindMismatch",source,"Semantic argument kind differs from its binder")),
        };
        self.account(kind_cost(expected,0))?;
        self.unify_kinds(actual,expected.clone(),source,depth+1)
    }
    pub(crate) fn has_expansion(&mut self,arguments:&[SemanticArgument])->Result<bool> {
        self.work(arguments.len())?;
        Ok(arguments.iter().any(|argument|matches!(argument,SemanticArgument::Expand(_))))
    }
    /// Expand belongs to a sequence slot, never to one semantic argument slot.
    fn validate_sequence_item(&mut self,argument:&SemanticArgument,expected:Option<&SemanticKind>,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        if let SemanticArgument::Expand(pack)=argument {
            self.validate_pack(pack,expected,source,depth+1)?;
            return self.need(source,"NeedsPackExpansion");
        }
        if let Some(expected)=expected {return self.validate_argument(argument,expected,source,depth+1);}
        // An unresolved splice into a heterogeneous signature prevents assigning
        // later arguments to binder slots. Preserve their known Type obligations.
        if let SemanticArgument::Type(ty)=argument {return self.validate_type_inner(*ty,source,depth+1);}
        self.need(source,"NeedsSemanticArgumentKind")
    }
    fn validate_pack(&mut self,pack:&PackTerm,expected:Option<&SemanticKind>,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        let mut pending=false;
        match pack {
            PackTerm::Parameter(usage)=>{
                let Some(binder)=usage.semantic else{return self.need(source,"NeedsSemanticArgumentBinding");};
                let SemanticKind::Pack(element)=self.copy_binder(binder)?.kind else {
                    return Err(self.error("TypeKindMismatch",source,"Expansion requires a Pack binder"));
                };
                if let Some(expected)=expected {
                    self.account(kind_cost(expected,0))?;
                    pending=self.unify_kinds(*element,expected.clone(),source,depth+1)?==Relation::Needs;
                }
            },
            PackTerm::Items(arguments)=>for argument in arguments {
                pending|=self.validate_sequence_item(argument,expected,source,depth+1)?==Relation::Needs;
            },
            PackTerm::Concat(packs)=>for pack in packs {
                pending|=self.validate_pack(pack,expected,source,depth+1)?==Relation::Needs;
            },
        }
        Ok(if pending{Relation::Needs}else{Relation::Equal})
    }
    fn normalize_inner(&mut self, ty: TypeId, source: SourceId, active:&mut BTreeSet<DeclarationId>, depth:usize)->Result<TypeId> {
        self.depth(depth)?;
        let ty=self.resolve(ty)?;
        let SemanticType::Declaration {target,arguments}=self.copy_type(ty)? else {return Ok(ty);};
        let Some(declaration)=target.declaration else {return Ok(ty);};
        let Some(alias)=self.aliases.get(&declaration).cloned() else {return Ok(ty);};
        if !alias.transparent {return Ok(ty);}
        if self.has_expansion(&arguments)? {self.need(source,"NeedsSemanticArgumentArity")?;return Ok(ty);}
        if !active.insert(declaration) {return Err(self.error("TypeAliasCycle",source,"Transparent alias cycle"));}
        if alias.binders.len()!=arguments.len() {return Err(self.error("TypeArity",source,"Alias semantic argument count differs"));}
        let mut substitution=BTreeMap::new();
        for (binder,argument) in alias.binders.iter().zip(arguments) {
            match argument {
                SemanticArgument::Type(value) if self.arena.binders[binder.index()].kind==SemanticKind::Type=>{substitution.insert(*binder,Replacement::Type(value));},
                _=>{self.need(source,"NeedsAliasSemanticArguments")?;return Ok(ty);},
            }
        }
        let body=self.substitute(alias.ty,&substitution,source,depth+1)?;
        let result=self.normalize_inner(body,source,active,depth+1);
        active.remove(&declaration); result
    }
    fn depth(&mut self, depth:usize)->Result<()> {
        self.work(1)?;
        if depth>128 {return Err(limit());} Ok(())
    }
    fn error(&self, code:&str, source:SourceId, message:&str)->Diagnostic {
        fail(code,&self.arena.source(source).expanded_path,message)
    }
    pub fn kind(&mut self, ty:TypeId)->Result<SemanticKind> {
        let ty=self.resolve(ty)?;
        let kind=match self.arena.get(ty) {
            SemanticType::Inference(id)=>Some(&self.arena.inference_variables[id.index()].kind),
            SemanticType::Parameter(usage)=>usage.semantic.map(|id|&self.arena.binders[id.index()].kind),_=>None,
        };
        let cost=kind.map(|kind|kind_cost(kind,0)).unwrap_or_else(OwnershipCost::new);
        self.account(cost)?;
        Ok(match self.arena.get(ty) {
            SemanticType::Inference(id)=>self.arena.inference_variables[id.index()].kind.clone(),
            SemanticType::Parameter(usage)=>usage.semantic.map(|id|self.arena.binders[id.index()].kind.clone()).unwrap_or(SemanticKind::Type),_=>SemanticKind::Type,
        })
    }
    pub fn unify(&mut self, left:TypeId, right:TypeId, source:SourceId)->Result<Relation> {
        self.unify_inner(left,right,source,0)
    }
    /// Equality is a sufficient compatibility proof in this finite solver.
    /// Structural/function differences may require the original substitution,
    /// variance or effect-inclusion judgment, and do not become false errors.
    pub fn compatible(&mut self,actual:TypeId,expected:TypeId,source:SourceId)->Result<Relation> {
        let point=self.checkpoint()?;
        match self.unify(actual,expected,source) {
            Ok(result)=>Ok(result),
            Err(error)=>{
                self.rollback(point);
                let a=self.normalize(actual,source)?;let b=self.normalize(expected,source)?;
                if error.code=="TypeMismatch"&&matches!((self.arena.get(a),self.arena.get(b)),
                    (SemanticType::Record {..},SemanticType::Record {..})|(SemanticType::Function(_),SemanticType::Function(_))) {
                    self.need(source,"NeedsSubstitutionCompatibility")
                } else {Err(error)}
            },
        }
    }
    fn unify_inner(&mut self,left:TypeId,right:TypeId,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        let left=self.normalize(left,source)?; let right=self.normalize(right,source)?;
        if self.unknown_qualification(left)?||self.unknown_qualification(right)? {return self.need(source,"NeedsTypeInterpretation");}
        if left==right {
            if self.unknown_qualification(left)? {return self.need(source,"NeedsTypeInterpretation");}
            return Ok(Relation::Equal);
        }
        let left_kind=self.kind(left)?;let right_kind=self.kind(right)?;
        let kind_relation=self.unify_kinds(left_kind,right_kind,source,depth+1)?;
        if kind_relation==Relation::Needs {return Ok(Relation::Needs);}
        let a=self.copy_type(left)?; let b=self.copy_type(right)?;
        if let SemanticType::Inference(id)=a {return self.bind(id,right,source,depth+1);}
        if let SemanticType::Inference(id)=b {return self.bind(id,left,source,depth+1);}
        use SemanticType::*;
        let mut equations=Vec::new();
        let mut pending=false;
        match (a,b) {
            (Scalar(a),Scalar(b))=>{
                if a==b {return Ok(Relation::Equal);}
                if a.name==b.name&&!scalar_conflict(&a,&b)&&scalar_missing(&a,&b) {return self.need(source,"NeedsScalarAttributeSemantics");}
                return Err(self.error("TypeMismatch",source,"Different scalar types or attributes"));
            },
            (Parameter(a),Parameter(b)) if a.semantic.is_some()&&a.semantic==b.semantic=>{},
            (Declaration {target:a,arguments:aa},Declaration {target:b,arguments:bb}) if same_declaration(&a,&b)=>{
                pending=self.arguments_equal(&aa,&bb,source,&mut equations)?;
            },
            (Record {fields:a,open:ao,row:ar},Record {fields:b,open:bo,row:br})=>{
                if ao.unwrap_or(false)!=bo.unwrap_or(false)||a.keys().ne(b.keys()) {return Err(self.error("TypeMismatch",source,"Record fields/openness differ"));}
                for (name,field) in a {
                    let other=&b[&name];
                    if field.optional.unwrap_or(false)!=other.optional.unwrap_or(false)||field.mutable.unwrap_or(false)!=other.mutable.unwrap_or(false) {
                        return Err(self.error("TypeMismatch",source,"Record field presence/mutability differ"));
                    }
                    equations.push((field.ty,other.ty));
                }
                match (ar,br) {(Some(a),Some(b))=>equations.push((a,b)),(None,None)=>{},_=>return Err(self.error("TypeMismatch",source,"Record rows differ"))}
            },
            (Variant(a),Variant(b))=>{
                if a.keys().ne(b.keys()) {return Err(self.error("TypeMismatch",source,"Variant cases differ"));}
                equations.extend(a.into_iter().map(|(name,value)|(value,b[&name])));
            },
            (Tuple(a),Tuple(b))=>pending=self.arguments_equal(&a,&b,source,&mut equations)?,
            (Option(a),Option(b))|(List(a),List(b))|(Future(a),Future(b))=>equations.push((a,b)),
            (Sequence {item:a,ordered:true},List(b))|(List(a),Sequence {item:b,ordered:true})=>equations.push((a,b)),
            (Sequence {item:a,ordered:ao},Sequence {item:b,ordered:bo}) if ao==bo=>equations.push((a,b)),
            (Result {ok:a,error:ae},Result {ok:b,error:be})=>equations.extend([(a,b),(ae,be)]),
            (Function(a),Function(b))=>{
                let expanded=self.has_expansion(&a.parameters)?|self.has_expansion(&b.parameters)?;
                if a.binders.len()!=b.binders.len()||(!expanded&&a.parameters.len()!=b.parameters.len())||a.call_mode.as_deref().unwrap_or("shared")!=b.call_mode.as_deref().unwrap_or("shared") {
                    return Err(self.error("TypeMismatch",source,"Function signature shape differs"));
                }
                self.charge((a.parameters.len()+b.parameters.len()).saturating_mul(32))?;
                if expanded {pending=true;self.need(source,"NeedsPackExpansion")?;}
                else if normalized_contracts(&a)!=normalized_contracts(&b) {return Err(self.error("TypeMismatch",source,"Parameter retention contracts differ"));}
                let mut rename=BTreeMap::new();
                for (x,y) in a.binders.iter().zip(&b.binders) {
                    rename.insert(*y,Replacement::Binder(*x));
                }
                for (x,y) in a.binders.iter().zip(&b.binders) {
                    let left=self.copy_binder(*x)?;let right=self.copy_binder(*y)?;
                    let right_kind=self.map_kind(right.kind,&rename,source,depth+1)?;
                    pending|=self.unify_kinds(left.kind,right_kind,source,depth+1)?==Relation::Needs;
                    if !left.constraints.is_empty()||!right.constraints.is_empty()||!left.trait_bounds.is_empty()||!right.trait_bounds.is_empty() {
                        self.need(source,"NeedsBinderConstraintQualification")?;pending=true;
                    }
                }
                let b=self.map_function(b,&rename,source,depth+1)?;
                pending|=self.arguments_equal(&a.parameters,&b.parameters,source,&mut equations)?;
                equations.push((a.returns,b.returns));
                if a.pending_effects||b.pending_effects {pending=true;self.need(source,"NeedsEffectClosure")?;}
                else {pending|=self.effects_equal(a.effects.as_ref(),b.effects.as_ref(),source,&mut equations)?;}
                if a.pending_captures||b.pending_captures||capture_keys(&a)!=capture_keys(&b) {pending=true;self.need(source,"NeedsCaptureRelation")?;}
            },
            (Rational,Rational)=>{},
            (Opaque {interface:a},Opaque {interface:b}) if same_declaration(&a,&b)=>{},
            (Set {item:a,equality:ae},Set {item:b,equality:be})|(Bag {item:a,equality:ae},Bag {item:b,equality:be}) if equal_optional_declaration(&ae,&be)=>equations.push((a,b)),
            (Map {key:a,value:av,equality:ae},Map {key:b,value:bv,equality:be}) if equal_optional_declaration(&ae,&be)=>equations.extend([(a,b),(av,bv)]),
            (Stream {item:a,order:ao},Stream {item:b,order:bo}) if ao==bo=>equations.push((a,b)),
            (Handle {resource:a,lifetime:al},Handle {resource:b,lifetime:bl}) if same_declaration(&a,&b)&&al==bl=>{},
            (Quantity {scalar:a,unit_ref:au},Quantity {scalar:b,unit_ref:bu}) if au==bu=>equations.push((a,b)),
            (Needs {..},_)|(_,Needs {..})|(Hole {..},_)|(_,Hole {..})=>return self.need(source,"NeedsTypeInterpretation"),
            (SubjectSchema {..},_)|(_,SubjectSchema {..})=>return self.need(source,"NeedsSubjectRoleQualification"),
            (Exists {..},_)|(_,Exists {..})|(Apply {..},_)|(_,Apply {..})|(Associated {..},_)|(_,Associated {..})|
            (Refinement {..},_)|(_,Refinement {..})|(DefinitionReference {..},_)|(_,DefinitionReference {..})|
            (PackElement {..},_)|(_,PackElement {..})|(WireVariant {..},_)|(_,WireVariant {..})=>return self.need(source,"NeedsSpecializedTypeRelation"),
            _=>return Err(self.error("TypeMismatch",source,"Incompatible semantic types")),
        }
        for (a,b) in equations {pending|=self.unify_inner(a,b,source,depth+1)?==Relation::Needs;}
        Ok(if pending {Relation::Needs}else{Relation::Equal})
    }
    fn arguments_equal(&mut self,a:&[SemanticArgument],b:&[SemanticArgument],source:SourceId,equations:&mut Vec<(TypeId,TypeId)>)->Result<bool> {
        if self.has_expansion(a)?|self.has_expansion(b)? {self.need(source,"NeedsSemanticArgumentArity")?;return Ok(true);}
        if a.len()!=b.len() {return Err(self.error("TypeArity",source,"Semantic argument counts differ"));}
        let mut pending=false;
        for (a,b) in a.iter().zip(b) {
            self.work(1)?;
            match (a,b) {
                (SemanticArgument::Type(a),SemanticArgument::Type(b))=>equations.push((*a,*b)),
                (SemanticArgument::Region(a),SemanticArgument::Region(b))|(SemanticArgument::Scope(a),SemanticArgument::Scope(b)) if a.semantic.is_some()&&a.semantic==b.semantic=>{},
                _=>{pending=true;self.need(source,"NeedsSemanticArgumentRelation")?;},
            }
        }
        Ok(pending)
    }
    fn effects_equal(&mut self,a:Option<&EffectRow>,b:Option<&EffectRow>,source:SourceId,equations:&mut Vec<(TypeId,TypeId)>)->Result<bool> {
        let empty=EffectRow {members:Vec::new(),tail:None,explicit_row:false};
        let a=a.unwrap_or(&empty); let b=b.unwrap_or(&empty);
        if a.members.len()!=b.members.len()||semantic_use(a.tail.as_ref())!=semantic_use(b.tail.as_ref()) {
            self.need(source,"NeedsEffectRowRelation")?;return Ok(true);
        }
        let mut pending=false;
        for (a,b) in a.members.iter().zip(&b.members) {
            match (a,b) {
                (EffectAtom::Declaration(a),EffectAtom::Declaration(b)) if same_declaration(a,b)=>{},
                (EffectAtom::Structured {class:a,port:ap,resource:ar,scope_ref:as_,error:ae},EffectAtom::Structured {class:b,port:bp,resource:br,scope_ref:bs,error:be})
                    if a==b&&equal_optional_declaration(ap,bp)&&equal_optional_declaration(ar,br)&&as_==bs=>{
                        match (ae,be) {(Some(a),Some(b))=>equations.push((*a,*b)),(None,None)=>{},_=>pending=true}
                    },
                _=>pending=true,
            }
        }
        if pending {self.need(source,"NeedsEffectRowRelation")?;} Ok(pending)
    }
    fn bind(&mut self,id:MetaId,value:TypeId,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        if self.unknown_qualification(value)? {return self.need(source,"NeedsTypeInterpretation");}
        self.account(variable_cost(&self.arena.inference_variables[id.index()]))?;
        let variable=self.arena.inference_variables[id.index()].clone();
        let mut stack=vec![(value,BTreeSet::<SemanticBinderId>::new(),depth)];
        while let Some((ty,mut bound,depth))=stack.pop() {
            self.depth(depth)?; let ty=self.resolve(ty)?; let node=self.copy_type(ty)?;
            if let SemanticType::Inference(other)=node {
                if other==id {return Err(self.error("TypeOccurs",source,"Inference variable occurs in its solution"));}
                let allowed: BTreeSet<_>=variable.visible.union(&bound).copied().collect();
                let visible=self.arena.inference_variables[other.index()].visible.intersection(&allowed).copied().collect();
                self.arena.inference_variables[other.index()].visible=visible;
            }
            match &node {SemanticType::Function(f)=>bound.extend(&f.binders),SemanticType::Exists {binders,..}=>bound.extend(binders),_=>{}}
            for binder in binders_used(&node) {
                if !bound.contains(&binder)&&!variable.visible.contains(&binder) {return Err(self.error("TypeScopeEscape",source,"Solution captures an unavailable rigid binder"));}
            }
            if contains_static(&node) {return self.need(source,"NeedsStaticArgumentScope");}
            for child in self.scoped_children(&node)? {
                self.charge(bound.len().saturating_mul(64))?;
                stack.push((child,bound.clone(),depth+1));
            }
        }
        self.arena.inference_variables[id.index()].value=Some(value); Ok(Relation::Equal)
    }
    fn unify_kinds(&mut self,a:SemanticKind,b:SemanticKind,source:SourceId,depth:usize)->Result<Relation> {
        self.depth(depth)?;
        match (a,b) {
            (SemanticKind::Type,SemanticKind::Type)|(SemanticKind::Region,SemanticKind::Region)|
            (SemanticKind::Scope,SemanticKind::Scope)|(SemanticKind::EffectRow,SemanticKind::EffectRow)=>Ok(Relation::Equal),
            (SemanticKind::Value(a),SemanticKind::Value(b))=>self.unify_inner(a,b,source,depth+1),
            (SemanticKind::Pack(a),SemanticKind::Pack(b))=>self.unify_kinds(*a,*b,source,depth+1),
            (SemanticKind::Constructor(a),SemanticKind::Constructor(b)) if a.len()==b.len()=>{
                let mut pending=false;for(a,b)in a.into_iter().zip(b){pending|=self.unify_kinds(a,b,source,depth+1)?==Relation::Needs;}
                Ok(if pending{Relation::Needs}else{Relation::Equal})
            },
            _=>Err(self.error("TypeKindMismatch",source,"Constraint kinds differ")),
        }
    }
    pub fn unresolved(&mut self,ty:TypeId)->Result<bool> {
        let mut stack=vec![(ty,0)];
        while let Some((ty,depth))=stack.pop() {
            self.depth(depth)?; let ty=self.resolve(ty)?;
            if matches!(self.arena.get(ty),SemanticType::Inference(_))||unknown_node(self.arena.get(ty)) {return Ok(true);}
            let node=self.copy_type(ty)?;
            stack.extend(self.scoped_children(&node)?.into_iter().map(|t|(t,depth+1)));
        }
        Ok(false)
    }
    fn unknown_qualification(&mut self,ty:TypeId)->Result<bool> {
        let mut stack=vec![(ty,0)];
        while let Some((ty,depth))=stack.pop(){
            self.depth(depth)?;let ty=self.resolve(ty)?;
            if unknown_node(self.arena.get(ty)){return Ok(true);}
            let node=self.copy_type(ty)?;
            stack.extend(self.scoped_children(&node)?.into_iter().map(|child|(child,depth+1)));
        }
        Ok(false)
    }
    fn scoped_children(&mut self,node:&SemanticType)->Result<Vec<TypeId>> {
        fn kind_types(kind:&SemanticKind,out:&mut Vec<TypeId>) {
            match kind {SemanticKind::Value(ty)=>out.push(*ty),SemanticKind::Pack(kind)=>kind_types(kind,out),
                SemanticKind::Constructor(kinds)=>for kind in kinds{kind_types(kind,out)},_=>{}}
        }
        let mut result=children(node);
        let bound=match node {SemanticType::Function(f)=>f.binders.as_slice(),SemanticType::Exists {binders,..}=>binders.as_slice(),_=>&[]};
        for id in bound {
            self.work(1)?;let binder=&self.arena.binders[id.index()];
            kind_types(&binder.kind,&mut result);
            for bound in &binder.trait_bounds {
                result.push(bound.self_type);
                for argument in &bound.arguments{argument_children(argument,&mut result);}
                result.extend(bound.associated.values());
            }
        }
        self.charge(result.len().saturating_mul(64))?;
        Ok(result)
    }
    /// New semantic identities, with source provenance but no source locator.
    pub fn freshen_function(&mut self,function:FunctionType,source:SourceId)->Result<Option<FunctionType>> {
        let point=self.checkpoint()?;
        let start=self.needs.len();
        let result=self.freshen_inner(function,source);
        if result.is_err()||self.needs[start..].iter().any(|need|need.code=="NeedsStaticValueSubstitution") {
            let needs=self.needs[start..].to_vec();
            self.rollback(point);
            if let Err(error)=result {return Err(error);}
            for need in needs {self.need(need.source,need.code)?;}
            return Ok(None);
        }
        result.map(Some)
    }
    fn freshen_inner(&mut self,function:FunctionType,source:SourceId)->Result<FunctionType> {
        let mut map=BTreeMap::new();
        let start=self.arena.binders.len();
        for original in &function.binders {
            let mut binder=self.copy_binder(*original)?;
            self.work(1)?;
            binder.id=SemanticBinderId(self.arena.binders.len());
            binder.binding=None; binder.source=source;
            binder.provenance=BinderProvenance::Derived {original:*original};
            map.insert(*original,Replacement::Binder(binder.id)); self.arena.binders.push(binder);
        }
        for index in start..self.arena.binders.len() {
            let mut binder=self.copy_binder(SemanticBinderId(index))?;
            binder.kind=self.map_kind(binder.kind,&map,source,0)?;
            for bound in &mut binder.trait_bounds {
                bound.self_type=self.substitute(bound.self_type,&map,source,0)?;
                bound.arguments=self.map_arguments(std::mem::take(&mut bound.arguments),&map,source,0)?;
                for ty in bound.associated.values_mut(){*ty=self.substitute(*ty,&map,source,0)?;}
            }
            if !binder.constraints.is_empty()||!binder.trait_bounds.is_empty(){self.need(source,"NeedsBinderConstraintQualification")?;}
            self.arena.binders[index]=binder;
        }
        self.map_function(function,&map,source,0)
    }
    pub fn instantiate(&mut self,function:FunctionType,visible:BTreeSet<SemanticBinderId>,source:SourceId)->Result<Option<FunctionType>> {
        for binder in &function.binders {
            if !self.arena.binders[binder.index()].constraints.is_empty()||!self.arena.binders[binder.index()].trait_bounds.is_empty() {
                self.need(source,"NeedsBinderConstraintQualification")?;return Ok(None);
            }
            if self.arena.binders[binder.index()].kind!=SemanticKind::Type {self.need(source,"NeedsSemanticArgumentInstantiation")?;return Ok(None);}
        }
        let point=self.checkpoint()?;let start=self.needs.len();
        let mut map=BTreeMap::new();
        let mapped=(||{
            for binder in &function.binders {
                self.charge(visible.len().saturating_mul(64))?;
                let ty=self.fresh(SemanticKind::Type,visible.clone())?;
                map.insert(*binder,Replacement::Type(ty));
            }
            self.map_function(function,&map,source,0)
        })();
        if mapped.is_err()||self.needs[start..].iter().any(|need|need.code=="NeedsStaticValueSubstitution") {
            let needs=self.needs[start..].to_vec();self.rollback(point);
            if let Err(error)=mapped{return Err(error);}
            for need in needs{self.need(need.source,need.code)?;}
            return Ok(None);
        }
        let mut result=mapped?;result.binders.clear();Ok(Some(result))
    }
    fn map_kind(&mut self,kind:SemanticKind,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<SemanticKind> {
        self.depth(depth)?;
        Ok(match kind {
            SemanticKind::Value(ty)=>SemanticKind::Value(self.substitute(ty,map,source,depth+1)?),
            SemanticKind::Constructor(kinds)=>SemanticKind::Constructor(kinds.into_iter().map(|k|self.map_kind(k,map,source,depth+1)).collect::<Result<_>>()?),
            SemanticKind::Pack(kind)=>SemanticKind::Pack(Box::new(self.map_kind(*kind,map,source,depth+1)?)),
            other=>other,
        })
    }
    fn map_function(&mut self,mut function:FunctionType,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<FunctionType> {
        self.depth(depth)?;
        self.account(function_cost(&function,depth))?;
        function.binders=function.binders.iter().map(|id|match map.get(id) {Some(Replacement::Binder(id))=>*id,_=>*id}).collect();
        function.parameters=self.map_arguments(function.parameters,map,source,depth+1)?;
        function.returns=self.substitute(function.returns,map,source,depth+1)?;
        if let Some(row)=function.effects {function.effects=Some(self.map_effects(row,map,source,depth+1)?);}
        if let Some(captures)=function.captures {function.captures=Some(captures.into_iter().map(|c|match c {Capture::Region(u)=>Capture::Region(map_use(u,map)),Capture::Scope(u)=>Capture::Scope(map_use(u,map))}).collect());}
        Ok(function)
    }
    fn map_effects(&mut self,mut row:EffectRow,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<EffectRow> {
        row.tail=row.tail.map(|u|map_use(u,map));
        for member in &mut row.members {
            if let EffectAtom::Structured {error:Some(ty),..}=member {*ty=self.substitute(*ty,map,source,depth+1)?;}
        }
        Ok(row)
    }
    fn map_arguments(&mut self,args:Vec<SemanticArgument>,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<Vec<SemanticArgument>> {
        args.into_iter().map(|arg|Ok(match arg {
            SemanticArgument::Type(t)=>SemanticArgument::Type(self.substitute(t,map,source,depth+1)?),
            SemanticArgument::Region(u)=>SemanticArgument::Region(map_use(u,map)),
            SemanticArgument::Scope(u)=>SemanticArgument::Scope(map_use(u,map)),
            SemanticArgument::EffectRow(row)=>SemanticArgument::EffectRow(self.map_effects(row,map,source,depth+1)?),
            SemanticArgument::Constructor(c)=>SemanticArgument::Constructor(self.map_constructor(c,map,source,depth+1)?),
            SemanticArgument::Pack(p)=>SemanticArgument::Pack(self.map_pack(p,map,source,depth+1)?),
            SemanticArgument::Expand(p)=>SemanticArgument::Expand(self.map_pack(p,map,source,depth+1)?),
            SemanticArgument::PackElement {pack,index}=>{self.need(source,"NeedsStaticValueSubstitution")?;SemanticArgument::PackElement {pack:self.map_pack(pack,map,source,depth+1)?,index}},
            other=>{self.need(source,"NeedsStaticValueSubstitution")?;other},
        })).collect()
    }
    fn map_constructor(&mut self,constructor:ConstructorTerm,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<ConstructorTerm> {
        self.depth(depth)?;
        Ok(match constructor {
            ConstructorTerm::Parameter(u)=>ConstructorTerm::Parameter(map_use(u,map)),
            ConstructorTerm::Declaration {target,arguments}=>ConstructorTerm::Declaration {target,arguments:self.map_arguments(arguments,map,source,depth+1)?},
            ConstructorTerm::Apply {constructor,arguments}=>ConstructorTerm::Apply {constructor:Box::new(self.map_constructor(*constructor,map,source,depth+1)?),arguments:self.map_arguments(arguments,map,source,depth+1)?},
        })
    }
    fn map_pack(&mut self,pack:PackTerm,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<PackTerm> {
        self.depth(depth)?;
        Ok(match pack {
            PackTerm::Parameter(u)=>PackTerm::Parameter(map_use(u,map)),
            PackTerm::Items(args)=>PackTerm::Items(self.map_arguments(args,map,source,depth+1)?),
            PackTerm::Concat(packs)=>PackTerm::Concat(packs.into_iter().map(|p|self.map_pack(p,map,source,depth+1)).collect::<Result<_>>()?),
        })
    }
    fn substitute(&mut self,ty:TypeId,map:&BTreeMap<SemanticBinderId,Replacement>,source:SourceId,depth:usize)->Result<TypeId> {
        self.depth(depth)?;
        if map.is_empty(){return Ok(ty);}
        let node=self.copy_type(ty)?;
        use SemanticType::*;
        let mapped=match node {
            Parameter(mut u)=>match u.semantic.and_then(|id|map.get(&id)) {
                Some(Replacement::Type(t))=>return Ok(*t),
                Some(Replacement::Binder(id))=>{u=derived_use(*id);Parameter(u)},None=>return Ok(ty),
            },
            Record {mut fields,open,row}=>{for field in fields.values_mut(){field.ty=self.substitute(field.ty,map,source,depth+1)?;}
                Record {fields,open,row:row.map(|t|self.substitute(t,map,source,depth+1)).transpose()?}},
            Variant(mut cases)=>{for value in cases.values_mut(){*value=self.substitute(*value,map,source,depth+1)?;}Variant(cases)},
            Tuple(args)=>Tuple(self.map_arguments(args,map,source,depth+1)?),
            Option(t)=>Option(self.substitute(t,map,source,depth+1)?),
            List(t)=>List(self.substitute(t,map,source,depth+1)?),
            Future(t)=>Future(self.substitute(t,map,source,depth+1)?),
            Sequence {item,ordered}=>Sequence {item:self.substitute(item,map,source,depth+1)?,ordered},
            Result {ok,error}=>Result {ok:self.substitute(ok,map,source,depth+1)?,error:self.substitute(error,map,source,depth+1)?},
            Function(f)=>Function(self.map_function(f,map,source,depth+1)?),
            Declaration {target,arguments}=>Declaration {target,arguments:self.map_arguments(arguments,map,source,depth+1)?},
            SubjectSchema {target,arguments,role}=>SubjectSchema {target,arguments:self.map_arguments(arguments,map,source,depth+1)?,role},
            Set {item,equality}=>Set {item:self.substitute(item,map,source,depth+1)?,equality},
            Bag {item,equality}=>Bag {item:self.substitute(item,map,source,depth+1)?,equality},
            Map {key,value,equality}=>Map {key:self.substitute(key,map,source,depth+1)?,value:self.substitute(value,map,source,depth+1)?,equality},
            Stream {item,order}=>Stream {item:self.substitute(item,map,source,depth+1)?,order},
            Quantity {scalar,unit_ref}=>Quantity {scalar:self.substitute(scalar,map,source,depth+1)?,unit_ref},
            Refinement {base,predicate}=>Refinement {base:self.substitute(base,map,source,depth+1)?,predicate},
            Exists {binders,body}=>Exists {binders,body:self.substitute(body,map,source,depth+1)?},
            Apply {constructor,arguments}=>Apply {constructor:self.map_constructor(constructor,map,source,depth+1)?,arguments:self.map_arguments(arguments,map,source,depth+1)?},
            Associated {trait_ref,self_type,arguments,member}=>Associated {trait_ref,self_type:self.substitute(self_type,map,source,depth+1)?,arguments:self.map_arguments(arguments,map,source,depth+1)?,member},
            DefinitionReference {role,contract,arguments}=>DefinitionReference {role,contract,arguments:self.map_arguments(arguments,map,source,depth+1)?},
            WireVariant {mut known,unknown,encoding,duplicates}=>{for ty in known.values_mut(){*ty=self.substitute(*ty,map,source,depth+1)?;}WireVariant {known,unknown,encoding,duplicates}},
            PackElement {pack,index}=>{self.need(source,"NeedsStaticValueSubstitution")?;PackElement {pack:self.map_pack(pack,map,source,depth+1)?,index}},
            _=>return Ok(ty),
        };
        self.insert(mapped)
    }
}

#[derive(Clone)]
enum Replacement { Type(TypeId), Binder(SemanticBinderId) }
fn derived_use(id:SemanticBinderId)->BinderUse {BinderUse {lexical_use:None,binder:None,semantic:Some(id)}}
fn map_use(usage:BinderUse,map:&BTreeMap<SemanticBinderId,Replacement>)->BinderUse {
    match usage.semantic.and_then(|id|map.get(&id)) {Some(Replacement::Binder(id))=>derived_use(*id),_=>usage}
}
fn semantic_use(usage:Option<&BinderUse>)->Option<SemanticBinderId> {usage.and_then(|u|u.semantic)}
fn same_declaration(a:&DeclarationUse,b:&DeclarationUse)->bool {a.declaration.is_some()&&a.declaration==b.declaration}
fn equal_optional_declaration(a:&Option<DeclarationUse>,b:&Option<DeclarationUse>)->bool {
    match (a,b) {(None,None)=>true,(Some(a),Some(b))=>same_declaration(a,b),_=>false}
}
fn normalized_contracts(function:&FunctionType)->Vec<&str> {
    let mut result=vec!["may-retain";function.parameters.len()];
    for contract in function.parameter_contracts.iter().flatten() {
        if let Some(slot)=result.get_mut(contract.position as usize){*slot=contract.retention.as_str();}
    }
    result
}
fn capture_keys(function:&FunctionType)->Vec<(bool,Option<SemanticBinderId>)> {
    function.captures.iter().flatten().map(|c|match c {
        Capture::Region(u)=>(false,u.semantic),Capture::Scope(u)=>(true,u.semantic),
    }).collect()
}
fn scalar_missing(a:&ScalarType,b:&ScalarType)->bool {
    macro_rules! optional {($field:ident)=>{a.$field!=b.$field&&(a.$field.is_none()||b.$field.is_none())};}
    optional!(bits)||optional!(scale)||optional!(overflow)||optional!(text_index)||optional!(rounding)||optional!(nan_policy)||optional!(encoding)||optional!(clock_ref)
}
fn scalar_conflict(a:&ScalarType,b:&ScalarType)->bool {
    macro_rules! conflict {($field:ident)=>{a.$field.is_some()&&b.$field.is_some()&&a.$field!=b.$field};}
    conflict!(bits)||conflict!(scale)||conflict!(overflow)||conflict!(text_index)||conflict!(rounding)||conflict!(nan_policy)||conflict!(encoding)||conflict!(clock_ref)
}
fn limit()->Diagnostic {fail("ResourceLimit","","Finite type-constraint budget exceeded")}

// Account every owned member before cloning a semantic node. TypeId and
// SourceId edges remain shared. The conservative container allowances include
// map/set entries and allocator overhead, while UTF-8 contents use their actual
// byte lengths. This is independent of author names or the tested fixture size.
struct OwnershipCost { bytes:usize, work:usize }
impl OwnershipCost {
    fn new()->Self {Self {bytes:128,work:1}}
    fn overflow()->Self {Self {bytes:usize::MAX,work:usize::MAX}}
    fn merge(&mut self,other:Self) {
        self.bytes=self.bytes.saturating_add(other.bytes);
        self.work=self.work.saturating_add(other.work);
    }
    fn text(&mut self,text:&str) {
        self.bytes=self.bytes.saturating_add(text.len()).saturating_add(128);
        self.work=self.work.saturating_add(text.len()).saturating_add(1);
    }
    fn sequence(&mut self,length:usize,item:usize) {
        self.bytes=self.bytes.saturating_add(length.saturating_mul(item)).saturating_add(128);
        self.work=self.work.saturating_add(length);
    }
}
fn kind_cost(kind:&SemanticKind,depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();
    match kind {
        SemanticKind::Constructor(kinds)=>{cost.sequence(kinds.len(),128);for kind in kinds{cost.merge(kind_cost(kind,depth+1));}},
        SemanticKind::Pack(kind)=>cost.merge(kind_cost(kind,depth+1)),_=>{},
    }
    cost
}
fn variable_cost(variable:&InferenceVariable)->OwnershipCost {
    let mut cost=kind_cost(&variable.kind,0);cost.sequence(variable.visible.len(),64);cost
}
fn binder_cost(binder:&SemanticBinder)->OwnershipCost {
    let mut cost=kind_cost(&binder.kind,0);
    if let Some(text)=&binder.introduction{cost.text(text);}
    cost.sequence(binder.constraints.len(),64);
    cost.sequence(binder.trait_bounds.len(),256);
    for bound in &binder.trait_bounds {
        cost.merge(arguments_cost(&bound.arguments,0));
        cost.sequence(bound.associated.len(),128);
        for name in bound.associated.keys(){cost.text(name);}
    }
    cost
}
fn effect_cost(row:&EffectRow,depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();cost.sequence(row.members.len(),256);
    for member in &row.members {
        if let EffectAtom::Structured {class,scope_ref,..}=member {
            cost.text(class);if let Some(scope)=scope_ref{cost.text(scope);}
        }
    }
    cost
}
fn arguments_cost(arguments:&[SemanticArgument],depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();cost.sequence(arguments.len(),192);
    for argument in arguments {
        match argument {
            SemanticArgument::EffectRow(row)=>cost.merge(effect_cost(row,depth+1)),
            SemanticArgument::Constructor(term)=>cost.merge(constructor_cost(term,depth+1)),
            SemanticArgument::Pack(pack)|SemanticArgument::Expand(pack)|SemanticArgument::PackElement {pack,..}=>cost.merge(pack_cost(pack,depth+1)),
            _=>{},
        }
    }
    cost
}
fn constructor_cost(term:&ConstructorTerm,depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();
    match term {
        ConstructorTerm::Declaration {arguments,..}=>cost.merge(arguments_cost(arguments,depth+1)),
        ConstructorTerm::Apply {constructor,arguments}=>{cost.merge(constructor_cost(constructor,depth+1));cost.merge(arguments_cost(arguments,depth+1));},
        _=>{},
    }
    cost
}
fn pack_cost(pack:&PackTerm,depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();
    match pack {
        PackTerm::Items(arguments)=>cost.merge(arguments_cost(arguments,depth+1)),
        PackTerm::Concat(packs)=>{cost.sequence(packs.len(),128);for pack in packs{cost.merge(pack_cost(pack,depth+1));}},_=>{},
    }
    cost
}
fn function_cost(function:&FunctionType,depth:usize)->OwnershipCost {
    let mut cost=arguments_cost(&function.parameters,depth+1);
    cost.sequence(function.binders.len(),64);
    if let Some(row)=&function.effects{cost.merge(effect_cost(row,depth+1));}
    if let Some(mode)=&function.call_mode{cost.text(mode);}
    if let Some(contracts)=&function.parameter_contracts {
        cost.sequence(contracts.len(),64);for item in contracts{cost.text(&item.retention);}
    }
    if let Some(captures)=&function.captures{cost.sequence(captures.len(),64);}
    cost
}
fn type_cost(node:&SemanticType,depth:usize)->OwnershipCost {
    if depth>128{return OwnershipCost::overflow();}
    let mut cost=OwnershipCost::new();
    match node {
        SemanticType::Scalar(s)=>{
            cost.text(&s.name);
            for text in [&s.overflow,&s.text_index,&s.rounding,&s.nan_policy,&s.encoding,&s.clock_ref].into_iter().flatten(){cost.text(text);}
        },
        SemanticType::Declaration {arguments,..}|SemanticType::SubjectSchema {arguments,..}|SemanticType::Tuple(arguments)=>cost.merge(arguments_cost(arguments,depth+1)),
        SemanticType::Record {fields,..}=>{cost.sequence(fields.len(),192);for name in fields.keys(){cost.text(name);}},
        SemanticType::Variant(cases)=>{cost.sequence(cases.len(),128);for name in cases.keys(){cost.text(name);}},
        SemanticType::Function(function)=>cost.merge(function_cost(function,depth+1)),
        SemanticType::Handle {lifetime,..}=>cost.text(lifetime),
        SemanticType::Stream {order,..}=>cost.text(order),
        SemanticType::Quantity {unit_ref,..}=>cost.text(unit_ref),
        SemanticType::Exists {binders,..}=>cost.sequence(binders.len(),64),
        SemanticType::Apply {constructor,arguments}=>{cost.merge(constructor_cost(constructor,depth+1));cost.merge(arguments_cost(arguments,depth+1));},
        SemanticType::PackElement {pack,..}=>cost.merge(pack_cost(pack,depth+1)),
        SemanticType::WireVariant {known,unknown,encoding,duplicates}=>{
            cost.sequence(known.len(),128);for name in known.keys(){cost.text(name);}
            cost.text(unknown);cost.text(encoding);cost.text(duplicates);
        },
        SemanticType::Associated {arguments,member,..}=>{cost.merge(arguments_cost(arguments,depth+1));cost.text(member);},
        SemanticType::DefinitionReference {arguments,role,..}=>{cost.merge(arguments_cost(arguments,depth+1));cost.text(role);},
        SemanticType::Hole {expected,raw_text}=>{cost.text(expected);if let Some(text)=raw_text{cost.text(text);}},_=>{},
    }
    cost
}
fn unknown_node(node:&SemanticType)->bool {
    match node {
        SemanticType::Needs {..}|SemanticType::Hole {..}|SemanticType::Apply {..}|SemanticType::Associated {..}|SemanticType::PackElement {..}=>true,
        SemanticType::Parameter(u)=>u.semantic.is_none(),
        SemanticType::Declaration {target,..}|SemanticType::SubjectSchema {target,..}=>target.declaration.is_none(),
        SemanticType::Opaque {interface}=>interface.declaration.is_none(),
        SemanticType::Handle {resource,..}=>resource.declaration.is_none(),
        _=>false,
    }
}

fn argument_children(arg:&SemanticArgument,out:&mut Vec<TypeId>) {
    match arg {
        SemanticArgument::Type(t)=>out.push(*t),
        SemanticArgument::EffectRow(row)=>effect_children(row,out),
        SemanticArgument::Constructor(term)=>constructor_children(term,out),
        SemanticArgument::Pack(pack)|SemanticArgument::Expand(pack)|SemanticArgument::PackElement {pack,..}=>pack_children(pack,out),
        _=>{},
    }
}
fn effect_children(row:&EffectRow,out:&mut Vec<TypeId>) {for member in &row.members {if let EffectAtom::Structured {error:Some(t),..}=member{out.push(*t);}}}
fn constructor_children(term:&ConstructorTerm,out:&mut Vec<TypeId>) {match term {
    ConstructorTerm::Declaration {arguments,..}=>for a in arguments{argument_children(a,out);},
    ConstructorTerm::Apply {constructor,arguments}=>{constructor_children(constructor,out);for a in arguments{argument_children(a,out);}},_=>{}}}
fn pack_children(pack:&PackTerm,out:&mut Vec<TypeId>) {match pack {
    PackTerm::Items(items)=>for a in items{argument_children(a,out);},PackTerm::Concat(items)=>for a in items{pack_children(a,out);},_=>{}}}
pub(crate) fn children(node:&SemanticType)->Vec<TypeId> {
    use SemanticType::*;
    let mut out=Vec::new();
    match node {
        Record {fields,row,..}=>{out.extend(fields.values().map(|f|f.ty));out.extend(row);},
        Variant(cases)|WireVariant {known:cases,..}=>out.extend(cases.values()),
        Option(t)|List(t)|Future(t)|Sequence {item:t,..}|Set {item:t,..}|Bag {item:t,..}|Stream {item:t,..}|Quantity {scalar:t,..}|Refinement {base:t,..}|Exists {body:t,..}=>out.push(*t),
        Result {ok,error}=>out.extend([*ok,*error]),Map {key,value,..}=>out.extend([*key,*value]),
        Function(f)=>{for a in &f.parameters{argument_children(a,&mut out);}out.push(f.returns);if let Some(row)=&f.effects{effect_children(row,&mut out);}},
        Tuple(arguments)|Declaration {arguments,..}|SubjectSchema {arguments,..}|DefinitionReference {arguments,..}=>for a in arguments{argument_children(a,&mut out);},
        Apply {constructor,arguments}=>{constructor_children(constructor,&mut out);for a in arguments{argument_children(a,&mut out);}},
        Associated {self_type,arguments,..}=>{out.push(*self_type);for a in arguments{argument_children(a,&mut out);}},
        PackElement {pack,..}=>pack_children(pack,&mut out),_=>{},
    }
    out
}
fn binders_used(node:&SemanticType)->BTreeSet<SemanticBinderId> {
    fn usage(u:&BinderUse,out:&mut BTreeSet<SemanticBinderId>){out.extend(u.semantic);}
    fn pack(p:&PackTerm,out:&mut BTreeSet<SemanticBinderId>){match p {PackTerm::Parameter(u)=>usage(u,out),PackTerm::Items(a)=>for x in a{arg(x,out)},PackTerm::Concat(p)=>for x in p{pack(x,out)}}}
    fn constructor(c:&ConstructorTerm,out:&mut BTreeSet<SemanticBinderId>){match c {ConstructorTerm::Parameter(u)=>usage(u,out),ConstructorTerm::Declaration {arguments,..}=>for x in arguments{arg(x,out)},ConstructorTerm::Apply {constructor:c,arguments}=>{constructor(c,out);for x in arguments{arg(x,out)}}}}
    fn arg(a:&SemanticArgument,out:&mut BTreeSet<SemanticBinderId>){match a {
        SemanticArgument::Region(u)|SemanticArgument::Scope(u)=>usage(u,out),SemanticArgument::EffectRow(row)=>{if let Some(u)=&row.tail{usage(u,out)}},
        SemanticArgument::Constructor(c)=>constructor(c,out),SemanticArgument::Pack(p)|SemanticArgument::Expand(p)|SemanticArgument::PackElement {pack:p,..}=>pack(p,out),_=>{}}}
    let mut out=BTreeSet::new();
    match node {
        SemanticType::Parameter(u)=>usage(u,&mut out),
        SemanticType::Function(f)=>{for a in &f.parameters{arg(a,&mut out)}if let Some(row)=&f.effects{if let Some(u)=&row.tail{usage(u,&mut out)}}for c in f.captures.iter().flatten(){match c{Capture::Region(u)|Capture::Scope(u)=>usage(u,&mut out)}}},
        SemanticType::Tuple(a)|SemanticType::Declaration {arguments:a,..}|SemanticType::SubjectSchema {arguments:a,..}|SemanticType::Associated {arguments:a,..}|SemanticType::DefinitionReference {arguments:a,..}=>for x in a{arg(x,&mut out)},
        SemanticType::Apply {constructor:c,arguments}=>{constructor(c,&mut out);for a in arguments{arg(a,&mut out)}},
        SemanticType::PackElement {pack:p,..}=>pack(p,&mut out),_=>{},
    }
    out
}
fn contains_static(node:&SemanticType)->bool {
    fn args(a:&[SemanticArgument])->bool {a.iter().any(|a|!matches!(a,SemanticArgument::Type(_)|SemanticArgument::Region(_)|SemanticArgument::Scope(_)|SemanticArgument::EffectRow(_)))}
    match node {
        SemanticType::Declaration {arguments,..}|SemanticType::SubjectSchema {arguments,..}|SemanticType::Tuple(arguments)|SemanticType::Apply {arguments,..}|SemanticType::Associated {arguments,..}|SemanticType::DefinitionReference {arguments,..}=>args(arguments),
        SemanticType::Function(f)=>args(&f.parameters),SemanticType::PackElement {..}=>true,_=>false,
    }
}
