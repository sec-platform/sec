//! Captured Project Target/Profile input. Shape and exact locked bytes do not
//! establish installed lowering applicability, semantic preservation or a
//! target ABI. Construction belongs to the original preparation session.
use std::sync::Arc;
use crate::{binding::Budget,captured_input::BindingLocation,model::{Diagnostic,fail},reader::Reader,source::{self,Node}};
type Result<T> = std::result::Result<T,Diagnostic>;
pub const PROFILE_SCHEMA:&str="urn:gift:design-schema:target-profile-1-converged";
pub const PROFILE_FORMAT:&str="gift.target-profile-manifest/design-converged";

pub struct CapturedTarget {
    name:String,project_id:String,source_pointer:String,binding:BindingLocation,target:Node,
    candidate_basis:String,profile:Option<CapturedTargetProfile>,
}
impl CapturedTarget {
    pub fn name(&self)->&str {&self.name}
    pub fn project_id(&self)->&str {&self.project_id}
    pub fn source_pointer(&self)->&str {&self.source_pointer}
    pub fn binding_location(&self)->&BindingLocation {&self.binding}
    pub fn target(&self)->&Node {&self.target}
    pub fn profile_ref(&self)->&Node {self.target.get("profileRef").expect("Reader-validated Target")}
    pub fn candidate_basis(&self)->&str {&self.candidate_basis}
    pub fn profile(&self)->Option<&CapturedTargetProfile> {self.profile.as_ref()}
    pub(crate) fn new(name:String,project_id:String,binding:BindingLocation,target:Node,budget:&mut Budget)->Result<Self> {
        budget.work(name.len()/16+1)?;budget.charge(name.len()*6+256)?;
        let source_pointer=source::pointer("/targets",&name);
        Ok(Self {name,project_id,source_pointer,binding,target,candidate_basis:String::new(),profile:None})
    }
    pub(crate) fn set_profile(&mut self,profile:CapturedTargetProfile) {self.profile=Some(profile);}
    pub(crate) fn set_basis(&mut self,basis:String) {self.candidate_basis=basis;}
}
pub struct CapturedTargetProfile {
    bytes:Arc<[u8]>,manifest:Node,locator:String,source_revision:String,
    lock_locator:String,lock_revision:String,node_id:String,selected_node:Node,
}
impl CapturedTargetProfile {
    pub fn bytes(&self)->&[u8] {&self.bytes}
    pub fn manifest(&self)->&Node {&self.manifest}
    pub fn locator(&self)->&str {&self.locator}
    pub fn source_revision(&self)->&str {&self.source_revision}
    pub fn lock_locator(&self)->&str {&self.lock_locator}
    pub fn lock_revision(&self)->&str {&self.lock_revision}
    pub fn node_id(&self)->&str {&self.node_id}
    pub fn selected_node(&self)->&Node {&self.selected_node}
    pub(crate) fn read(reader:&Reader,content:crate::project_input::LockedContent,budget:&mut Budget)->Result<Self> {
        budget.work(content.bytes.len()/16+1)?;budget.charge(content.bytes.len().saturating_mul(4)+1024)?;
        let manifest=source::decode(&content.bytes)?;
        if !reader.validator(PROFILE_SCHEMA)?.is_valid(&manifest) {
            return Err(fail("InvalidTargetProfile",&content.locator,"Captured content does not satisfy the fixed current Target Profile Schema"));
        }
        let profile=manifest.get("profile").expect("Schema-validated profile identity");
        if profile.get("id").and_then(Node::as_str)!=content.node.get("subjectId").and_then(Node::as_str)||
            profile.get("revision").and_then(Node::as_str)!=content.node.get("revision").and_then(Node::as_str) {
            return Err(fail("TargetProfileIdentityMismatch",&content.locator,"Profile identity differs from the actual selected lock node"));
        }
        budget.work(content.bytes.len()/16+1)?;budget.charge(256)?;
        let source_revision=crate::digest(&content.bytes);
        Ok(Self {bytes:content.bytes.into(),manifest,locator:content.locator,source_revision,
            lock_locator:content.lock_locator,lock_revision:content.lock_revision,node_id:content.node_id,selected_node:content.node})
    }
}
