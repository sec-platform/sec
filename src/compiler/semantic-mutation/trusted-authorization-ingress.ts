import type { FactDeltaEndpointContext } from '../../semantic/engineering-ir/contract/delta-types.ts';
import type { SemanticEntityId } from '../../semantic/engineering-ir/contract/entity-types.ts';
import type { NormalizedSemanticMutationRequest, SemanticMutationAuthorizationContext, SemanticMutationCondition, SemanticMutationDiagnostic, SemanticMutationLoadedSourceCandidate, SemanticMutationOperation, VerificationRequirement } from '../../semantic/mutation/contract/types.ts';
import {
  cloneAndDeepFreeze,
  compareCodeUnits,
  exactOwnKeys,
  isPlainObject,
  throwMutationDiagnostic
} from './canonical.ts';
import {
  normalizeSemanticMutationAuthorization,
  semanticMutationAuthorizationRevision
} from './normalize-request.ts';
import { resolveSemanticMutationSourceAuthority } from './source-adapter-registry.ts';

const TRUSTED_LOCAL_POLICY_KEYS = Object.freeze([
  'allowedOperationKinds',
  'allowedTargetEntityIds',
  'requiredPreconditions',
  'requiredPostconditions',
  'minimumVerification'
]);

export type TrustedLocalSemanticMutationPolicyDraft = {
  readonly allowedOperationKinds: readonly SemanticMutationOperation['kind'][];
  readonly allowedTargetEntityIds: readonly SemanticEntityId[];
  readonly requiredPreconditions: readonly SemanticMutationCondition[];
  readonly requiredPostconditions: readonly SemanticMutationCondition[];
  readonly minimumVerification: readonly VerificationRequirement[];
  readonly authorizationRevision?: never;
  readonly taskId?: never;
  readonly envelopeRevision?: never;
  readonly allowedSourceOwnerIds?: never;
  readonly allowedPathPrefixes?: never;
};

export interface TrustedLocalSemanticMutationAuthorizationInput {
  readonly request: NormalizedSemanticMutationRequest;
  readonly base: FactDeltaEndpointContext;
  readonly sourceCandidates: readonly SemanticMutationLoadedSourceCandidate[];
  readonly policy: TrustedLocalSemanticMutationPolicyDraft;
}

export type TrustedLocalSemanticMutationAuthorizationResult =
  | {
      readonly status: 'authorized';
      readonly authorization: SemanticMutationAuthorizationContext;
    }
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
    };

function trustedLocalPolicyRecord(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input) || !exactOwnKeys(input, TRUSTED_LOCAL_POLICY_KEYS)) {
    throwMutationDiagnostic(
      'SEMANTIC-MUTATION-001',
      'request',
      'Trusted local Semantic Mutation policy contains missing or forbidden authority fields',
      {
        details: {
          actualKeys: isPlainObject(input) ? Object.keys(input).sort(compareCodeUnits) : []
        }
      }
    );
  }
  return input;
}

function normalizeAuthorizationDraft(
  draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'>
): SemanticMutationAuthorizationContext {
  return normalizeSemanticMutationAuthorization({
    ...draft,
    authorizationRevision: semanticMutationAuthorizationRevision(draft)
  });
}

export function buildTrustedLocalSemanticMutationAuthorization(
  input: TrustedLocalSemanticMutationAuthorizationInput
): TrustedLocalSemanticMutationAuthorizationResult {
  const policy = trustedLocalPolicyRecord(input.policy);
  const provisional = normalizeAuthorizationDraft({
    allowedOperationKinds: policy.allowedOperationKinds as SemanticMutationOperation['kind'][],
    allowedTargetEntityIds: policy.allowedTargetEntityIds as SemanticEntityId[],
    allowedSourceOwnerIds: [],
    allowedPathPrefixes: [],
    requiredPreconditions: policy.requiredPreconditions as SemanticMutationCondition[],
    requiredPostconditions: policy.requiredPostconditions as SemanticMutationCondition[],
    minimumVerification: policy.minimumVerification as VerificationRequirement[]
  });
  const authorityResolution = resolveSemanticMutationSourceAuthority(
    input.request,
    input.base,
    provisional,
    input.sourceCandidates
  );
  if (authorityResolution.status === 'rejected') return authorityResolution;

  const { authorizationRevision: _provisionalRevision, ...normalizedPolicy } = provisional;
  const authorization = normalizeAuthorizationDraft({
    ...normalizedPolicy,
    allowedSourceOwnerIds: [authorityResolution.authority.ownerId],
    allowedPathPrefixes: [authorityResolution.authority.writablePathPrefix]
  });
  return cloneAndDeepFreeze({ status: 'authorized', authorization });
}
