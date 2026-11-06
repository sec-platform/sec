//! Common signature constraints consuming the existing Reader, names, lexical
//! identities, type arena and HeaderSeeds. Type readiness is not callability.
use std::collections::{BTreeMap, BTreeSet};
use crate::body_analysis::{Engine,BodyAnalysis};
use crate::{binding::{DeclarationId, ImportBinding, NameAnalysis},
    header_seeds::{self, HeaderCollection, HeaderSeed},model::Diagnostic,reader::{self,DecodedSource},
    semantic_types::*,type_constraints::{ConstraintMachine,ConstraintNeed}};

type Result<T> = std::result::Result<T,Diagnostic>;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub enum SignatureState { TypeReady, NeedsAnnotation, NeedsInput, Rejected }
#[derive(Debug)]
pub struct Signature {
    pub declaration: DeclarationId,
    pub ty: Option<TypeId>,
    pub state: SignatureState,
    /// Only the implemented common body type constraints. Effects, contracts,
    /// source-value profiles, captures and callable freezing remain explicit.
    pub body_type_checked: bool,
}
#[derive(Debug)]
pub struct SignatureProblem { pub declaration: DeclarationId, pub diagnostic: Diagnostic }
#[derive(Debug)]
pub struct SignatureResolution {
    pub names: NameAnalysis,
    pub types: TypeArena,
    pub headers: Vec<HeaderSeed>,
    pub signatures: Vec<Signature>,
    pub needs: Vec<ConstraintNeed>,
    pub problems: Vec<SignatureProblem>,
    pub dependencies: BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    pub annotation_cycles: Vec<Vec<DeclarationId>>,
    pub bodies: BodyAnalysis,
}
pub fn resolve(bytes:&[u8])->Result<SignatureResolution> {
    resolve_sources(&[reader::read(bytes)?],&[],0)
}
pub fn resolve_sources(sources:&[DecodedSource],imports:&[ImportBinding],root:usize)->Result<SignatureResolution> {
    let header_seeds::PreparedHeaders {collection,navigation,mut budget}=header_seeds::prepare_sources(sources,imports,root)?;
    let HeaderCollection {names,mut types,headers}=collection;
    let mut solver=ConstraintMachine::shared(&mut types,&mut budget);
    solver.register_headers(&headers)?;
    let mut engine=Engine::new(&names,&headers,&navigation,solver)?;
    engine.run()?;
    let Engine {solver,signatures,needs,problems,dependencies,annotation_cycles,analysis,..}=engine;
    let mut all_needs=needs;
    for need in solver.needs {
        if !all_needs.contains(&need){all_needs.push(need);}
    }
    Ok(SignatureResolution {names,types,headers,signatures,needs:all_needs,problems,dependencies,annotation_cycles,bodies:analysis})
}
