//! Common signature constraints consuming the existing Reader, names, lexical
//! identities, type arena and HeaderSeeds. Type readiness is not callability.
use std::collections::{BTreeMap, BTreeSet};
use crate::body_analysis::{Engine,BodyAnalysis};
use crate::{binding::{DeclarationId, ImportBinding, NameAnalysis},
    header_seeds::{self, HeaderCollection, HeaderSeed},model::Diagnostic,reader::{self,DecodedSource},
    semantic_types::*,type_constraints::{ConstraintMachine,ConstraintNeed,ConstraintState},binding::Budget,
    effect_analysis::{self,EffectLimits,EffectSummarySet}};

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
    input:std::sync::Arc<crate::captured_input::CapturedInput>,
    pub names: NameAnalysis,
    pub types: TypeArena,
    pub headers: Vec<HeaderSeed>,
    pub signatures: Vec<Signature>,
    pub needs: Vec<ConstraintNeed>,
    pub problems: Vec<SignatureProblem>,
    pub dependencies: BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    pub annotation_cycles: Vec<Vec<DeclarationId>>,
    pub bodies: BodyAnalysis,
    pub effects: EffectSummarySet,
}
/// The original retained session after BodyAnalysis. Fields remain private so
/// closing effects cannot be invoked on caller-forged qualified inputs.
pub struct PreparedAnalysis {
    input:std::sync::Arc<crate::captured_input::CapturedInput>,
    names:NameAnalysis,types:TypeArena,headers:Vec<HeaderSeed>,signatures:Vec<Signature>,
    needs:Vec<ConstraintNeed>,problems:Vec<SignatureProblem>,dependencies:BTreeMap<DeclarationId,BTreeSet<DeclarationId>>,
    annotation_cycles:Vec<Vec<DeclarationId>>,bodies:BodyAnalysis,budget:Budget,constraints:ConstraintState,
}
pub struct BodyView<'a> {
    pub names:&'a NameAnalysis,pub types:&'a TypeArena,pub headers:&'a [HeaderSeed],
    pub signatures:&'a [Signature],pub bodies:&'a BodyAnalysis,
}
impl PreparedAnalysis {
    pub fn input(&self)->&crate::captured_input::CapturedInput {&self.input}
    pub fn body_view(&self)->BodyView<'_> {BodyView {names:&self.names,types:&self.types,headers:&self.headers,signatures:&self.signatures,bodies:&self.bodies}}
    pub fn close_effects(self,limits:EffectLimits)->Result<SignatureResolution> {self.close_effects_retained(limits).map(|(result,_)|result)}
    pub(crate) fn close_effects_retained(mut self,limits:EffectLimits)->Result<(SignatureResolution,Budget)> {
        self.budget.tighten(limits.work,limits.bytes);
        let mut solver=ConstraintMachine::resume(&mut self.types,&mut self.budget,self.constraints);
        let mut effects=effect_analysis::close(&self.names,&self.headers,&self.signatures,&self.bodies,&self.needs,&mut solver)?;
        let generated=std::mem::take(&mut solver.needs);
        self.needs=finalize_needs(&mut solver,self.needs,generated,&mut effects)?;
        drop(solver);
        Ok((SignatureResolution {input:self.input,names:self.names,types:self.types,headers:self.headers,signatures:self.signatures,
            needs:self.needs,problems:self.problems,dependencies:self.dependencies,annotation_cycles:self.annotation_cycles,bodies:self.bodies,effects},self.budget))
    }
}
impl SignatureResolution {pub fn input(&self)->&crate::captured_input::CapturedInput {&self.input}}
pub fn prepare_input(input:crate::captured_input::PreparedInput)->Result<PreparedAnalysis> {prepare_headers(header_seeds::prepare_input(input)?)}
pub fn resolve_input(input:crate::captured_input::PreparedInput)->Result<SignatureResolution> {prepare_input(input)?.close_effects(EffectLimits::default())}
pub fn resolve(bytes:&[u8])->Result<SignatureResolution> {
    resolve_sources(&[reader::read(bytes)?],&[],0)
}
pub fn resolve_sources(sources:&[DecodedSource],imports:&[ImportBinding],root:usize)->Result<SignatureResolution> {
    prepare_analysis_sources(sources,imports,root)?.close_effects(EffectLimits::default())
}
pub fn prepare_analysis(bytes:&[u8])->Result<PreparedAnalysis> {prepare_analysis_sources(&[reader::read(bytes)?],&[],0)}
pub fn prepare_analysis_sources(sources:&[DecodedSource],imports:&[ImportBinding],root:usize)->Result<PreparedAnalysis> {
    prepare_headers(header_seeds::prepare_sources(sources,imports,root)?)
}
fn prepare_headers(prepared:header_seeds::PreparedHeaders)->Result<PreparedAnalysis> {
    let header_seeds::PreparedHeaders {collection,navigation,mut budget,input}=prepared;
    let HeaderCollection {names,mut types,headers}=collection;
    let mut solver=ConstraintMachine::shared(&mut types,&mut budget);
    solver.register_headers(&headers)?;
    let mut engine=Engine::new(&names,&headers,&navigation,solver)?;
    engine.run()?;
    let Engine {mut solver,signatures,needs,problems,dependencies,annotation_cycles,analysis,..}=engine;
    let mut all_needs=Vec::new();let mut identities=BTreeSet::new();
    for need in needs.into_iter().chain(std::mem::take(&mut solver.needs)) {
        if insert_need_identity(&mut solver,&mut identities,need.source,need.code)?{solver.charge(96)?;all_needs.push(need);}
    }
    let constraints=solver.into_state();
    Ok(PreparedAnalysis {input,names,types,headers,signatures,needs:all_needs,problems,dependencies,annotation_cycles,bodies:analysis,budget,constraints})
}

fn insert_need_identity(solver:&mut ConstraintMachine<'_>,identities:&mut BTreeSet<(SourceId,&'static str)>,source:SourceId,code:&'static str)->Result<bool> {
    solver.work(1+4*(identities.len()+1).ilog2() as usize)?;
    if identities.contains(&(source,code)){return Ok(false);}
    solver.charge(96)?;identities.insert((source,code));Ok(true)
}

fn finalize_needs(solver:&mut ConstraintMachine<'_>,prior:Vec<ConstraintNeed>,generated:Vec<ConstraintNeed>,effects:&mut EffectSummarySet)->Result<Vec<ConstraintNeed>> {
    let mut identities=BTreeSet::new();
    let old_effects=std::mem::take(&mut effects.needs);
    for need in old_effects.into_iter().chain(generated.into_iter().map(|need|effect_analysis::EffectNeed {source:need.source,code:need.code})) {
        if insert_need_identity(solver,&mut identities,need.source,need.code)?{solver.charge(96)?;effects.needs.push(need);}
    }
    identities.clear();let mut needs=Vec::new();
    for need in prior {
        solver.work(1+4*(effects.consumed.len()+1).ilog2() as usize)?;
        if effects.consumed.contains(&(need.source,need.code)){continue;}
        if insert_need_identity(solver,&mut identities,need.source,need.code)?{solver.charge(96)?;needs.push(need);}
    }
    for need in &effects.needs {
        if insert_need_identity(solver,&mut identities,need.source,need.code)?{
            solver.charge(96)?;needs.push(ConstraintNeed {source:need.source,code:need.code});
        }
    }
    Ok(needs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_session_need_finalization_uses_its_remaining_budget() {
        let input=br#"{"schema":"gift.author-module/design-converged","moduleId":"finalize","definitions":{"F":{"kind":"core:function","body":{"parameters":[],"returns":{"tag":"scalar","name":"unit"},"body":{"op":"exec:block","statements":[]}}}}}"#;
        for (work,bytes) in [(0,usize::MAX),(usize::MAX,0)] {
            let mut prepared=prepare_analysis(input).unwrap();assert!(prepared.signatures[0].body_type_checked);
            let mut solver=ConstraintMachine::resume(&mut prepared.types,&mut prepared.budget,prepared.constraints);
            let mut effects=effect_analysis::close(&prepared.names,&prepared.headers,&prepared.signatures,&prepared.bodies,&prepared.needs,&mut solver).unwrap();
            let generated=std::mem::take(&mut solver.needs);let state=solver.into_state();
            assert!(!prepared.needs.is_empty());
            prepared.budget.tighten(work,bytes);
            let mut solver=ConstraintMachine::resume(&mut prepared.types,&mut prepared.budget,state);
            let error=finalize_needs(&mut solver,prepared.needs,generated,&mut effects).unwrap_err();
            assert_eq!(error.code,"ResourceLimit");
        }
    }
}
