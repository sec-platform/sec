//! Real input seeds for the subsequent signature dependency/constraint algorithm.
//! Every declaration remains represented, including uninterpreted professional
//! bodies. A seed is not a completed callable or a target qualification.
use crate::{binding::{self, DeclarationId, ImportBinding, ModuleId, NameAnalysis},
    lexical::LocalBindingId, model::Diagnostic, reader::{self, DecodedSource},
    semantic_types::{Capture, EffectRow, ExprRef, Formation, ParameterContract, SemanticBinderId, SourceId, TypeArena, TypeId}};

#[derive(Debug)]
pub struct HeaderCollection {
    pub names: NameAnalysis,
    pub types: TypeArena,
    pub headers: Vec<HeaderSeed>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypeRequest { Explicit(TypeId), InferFromBody(ExprRef), InferFromInitializer(ExprRef) }
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EffectRequest { Explicit(EffectRow), InferFromBody(ExprRef) }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Representation { Alias, NominalRecord, NominalVariant }
#[derive(Debug)]
pub struct RuntimeParameterSeed {
    pub binding: LocalBindingId,
    pub source: SourceId,
    pub ty: TypeId,
    pub mode: Option<String>,
}
#[derive(Debug)]
pub enum HeaderKind {
    Type {
        binders: Vec<SemanticBinderId>,
        representation: Representation,
        ty: TypeId,
        opaque: Option<bool>,
        visibility: Option<String>,
    },
    Function {
        binders: Vec<SemanticBinderId>,
        parameters: Vec<RuntimeParameterSeed>,
        returns: TypeRequest,
        body: ExprRef,
        effects: EffectRequest,
        contract: Option<SourceId>,
        termination: Option<String>,
        call_mode: Option<String>,
        parameter_contracts: Option<Vec<ParameterContract>>,
        captures: Option<Vec<Capture>>,
    },
    Constant { expected: TypeRequest, initializer: ExprRef },
    Uninterpreted { kind: String, body: SourceId, need: &'static str },
}
#[derive(Debug)]
pub struct HeaderSeed {
    pub declaration: DeclarationId,
    pub module: ModuleId,
    pub source: SourceId,
    pub kind: HeaderKind,
}

pub fn collect(bytes: &[u8]) -> Result<HeaderCollection, Diagnostic> {
    collect_sources(&[reader::read(bytes)?], &[], 0)
}

pub fn collect_sources(sources: &[DecodedSource], imports: &[ImportBinding], root: usize) -> Result<HeaderCollection, Diagnostic> {
    Ok(prepare_sources(sources,imports,root)?.collection)
}

pub(crate) struct PreparedHeaders {
    pub collection: HeaderCollection,
    pub navigation: Vec<crate::reference_slots::Navigation>,
    pub budget: binding::Budget,
}

pub(crate) fn prepare_sources(sources: &[DecodedSource], imports: &[ImportBinding], root: usize) -> Result<PreparedHeaders, Diagnostic> {
    let binding::PreparedNames { names, navigation, mut budget } = binding::prepare_sources(sources,imports,root,true)?;
    let mut formation=Formation::new(&names,sources,&navigation,&mut budget)?;
    formation.form_all()?;
    let mut headers=Vec::new();
    for declaration in &names.declarations {
        formation.budget.work(1)?;
        let module=declaration.module;
        let path=formation.path("/definitions",&declaration.name)?;
        let body_path=formation.path(&path,"body")?;
        let body=formation.node(module,&body_path)?;
        let source=formation.source(module,&path)?;
        let kind=match declaration.kind.as_str() {
            "core:type" => {
                let type_path=formation.path(&body_path,"type")?;
                let syntax=formation.node(module,&type_path)?;
                let representation=match syntax.get("tag").and_then(crate::source::Node::as_str) {
                    Some("record")=>Representation::NominalRecord,
                    Some("variant")=>Representation::NominalVariant,
                    _=>Representation::Alias,
                };
                let ty=formation.form(module,&type_path,0)?;
                let binders=formation.binder_list(module,&body_path,&body,"typeParams")?;
                let visibility=optional_text(&mut formation,&body,"visibility")?;
                HeaderKind::Type {binders,representation,ty,opaque:body.get("opaque").and_then(crate::source::Node::as_bool),visibility}
            }
            "core:function" => {
                let binders=formation.binder_list(module,&body_path,&body,"typeParams")?;
                let parameters_path=formation.path(&body_path,"parameters")?;
                let mut parameters=Vec::new();
                if let Some(items)=body.get("parameters").and_then(crate::source::Node::as_array) {
                    for (index,parameter) in items.iter().enumerate() {
                        let parameter_path=formation.path(&parameters_path,&index.to_string())?;
                        let source=formation.source(module,&parameter_path)?;
                        let binding=formation.binding(module,&parameter_path)?;
                        let type_path=formation.path(&parameter_path,"type")?;
                        let ty=formation.form(module,&type_path,0)?;
                        let mode=optional_text(&mut formation,parameter,"mode")?;
                        formation.budget.charge(192)?;
                        parameters.push(RuntimeParameterSeed {binding,source,ty,mode});
                    }
                }
                let expression_path=formation.path(&body_path,"body")?;
                let expression=formation.expr(module,&expression_path)?;
                let returns=if body.get("returns").is_some() {
                    let path=formation.path(&body_path,"returns")?;
                    TypeRequest::Explicit(formation.form(module,&path,0)?)
                } else {TypeRequest::InferFromBody(expression.clone())};
                let effects=if body.get("effects").is_some() {
                    let path=formation.path(&body_path,"effects")?;
                    EffectRequest::Explicit(formation.effects(module,&path,0)?)
                } else {EffectRequest::InferFromBody(expression.clone())};
                let contract=if body.get("contract").is_some() {
                    let path=formation.path(&body_path,"contract")?; Some(formation.source(module,&path)?)
                } else {None};
                HeaderKind::Function {binders,parameters,returns,body:expression,effects,contract,
                    termination:optional_text(&mut formation,&body,"termination")?,call_mode:optional_text(&mut formation,&body,"callMode")?,
                    parameter_contracts:formation.contracts(&body)?,captures:formation.captures(module,&body_path,&body)?}
            }
            "core:constant" => {
                let value_path=formation.path(&body_path,"value")?;
                let initializer=formation.expr(module,&value_path)?;
                let expected=if body.get("type").is_some() {
                    let type_path=formation.path(&body_path,"type")?;
                    TypeRequest::Explicit(formation.form(module,&type_path,0)?)
                } else {TypeRequest::InferFromInitializer(initializer.clone())};
                HeaderKind::Constant {expected,initializer}
            }
            _ => {
                let body=formation.source(module,&body_path)?;
                formation.issue(body,"NeedsProfessionalHeaderInterpretation",false)?;
                HeaderKind::Uninterpreted {kind:formation.budget.copy(&declaration.kind)?,body,need:"NeedsProfessionalHeaderInterpretation"}
            }
        };
        formation.budget.charge(512)?;
        headers.push(HeaderSeed {declaration:declaration.id,module,source,kind});
    }
    let types=formation.arena;
    Ok(PreparedHeaders {collection:HeaderCollection {names,types,headers},navigation,budget})
}

fn optional_text(formation: &mut Formation<'_>, node: &crate::source::Node, field: &str) -> Result<Option<String>,Diagnostic> {
    node.get(field).and_then(crate::source::Node::as_str).map(|value|formation.budget.copy(value)).transpose()
}
