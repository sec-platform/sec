/**
 * Legacy V1 projection seam for unowned freeze/tree tools.
 *
 * This module is not a Session authority. V2 runtime, Evidence, Review, and
 * IntegrationAuthorization must import platform/shared directly and reject
 * every V1 projection as stale input.
 */
export {
  VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
  VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
  VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
  createCandidateTreeParityV1,
  createFreezeSessionV1,
  parseVerificationCandidateTreeParityV1,
  parseVerificationFreezeSessionV1,
  parseVerificationRegistryProjectionV1,
  type VerificationCandidateTreeParityV1,
  type VerificationFreezeSessionV1,
  type VerificationManifestSource,
  type VerificationRegistryEntryV1,
  type VerificationRegistryProjectionV1
} from '../../platform/shared/verification-session-contract.ts';
