import type {
  FactDeltaEndpointContext,
  SemanticEntityId
} from '../../shared/engineering-ir-types.ts';
import type {
  NormalizedSemanticMutationRequestV2,
  SemanticMutationAuthorizationContextV2,
  SemanticMutationConditionV1,
  SemanticMutationDiagnosticV2,
  SemanticMutationLoadedSourceCandidateV1,
  SemanticMutationOperationV1,
  VerificationRequirementV1
} from '../../shared/semantic-mutation-types.ts';
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

export type TrustedLocalSemanticMutationPolicyDraftV1 = {
  readonly allowedOperationKinds: readonly SemanticMutationOperationV1['kind'][];
  readonly allowedTargetEntityIds: readonly SemanticEntityId[];
  readonly requiredPreconditions: readonly SemanticMutationConditionV1[];
  readonly requiredPostconditions: readonly SemanticMutationConditionV1[];
  readonly minimumVerification: readonly VerificationRequirementV1[];
  readonly authorizationRevision?: never;
  readonly taskId?: never;
  readonly envelopeRevision?: never;
  readonly allowedSourceOwnerIds?: never;
  readonly allowedPathPrefixes?: never;
};

export interface TrustedLocalSemanticMutationAuthorizationInputV1 {
  readonly request: NormalizedSemanticMutationRequestV2;
  readonly base: FactDeltaEndpointContext;
  readonly sourceCandidates: readonly SemanticMutationLoadedSourceCandidateV1[];
  readonly policy: TrustedLocalSemanticMutationPolicyDraftV1;
}

export type TrustedLocalSemanticMutationAuthorizationResultV1 =
  | {
      readonly status: 'authorized';
      readonly authorization: SemanticMutationAuthorizationContextV2;
    }
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
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
  draft: Omit<SemanticMutationAuthorizationContextV2, 'authorizationRevision'>
): SemanticMutationAuthorizationContextV2 {
  return normalizeSemanticMutationAuthorization({
    ...draft,
    authorizationRevision: semanticMutationAuthorizationRevision(draft)
  });
}

export function buildTrustedLocalSemanticMutationAuthorization(
  input: TrustedLocalSemanticMutationAuthorizationInputV1
): TrustedLocalSemanticMutationAuthorizationResultV1 {
  const policy = trustedLocalPolicyRecord(input.policy);
  const provisional = normalizeAuthorizationDraft({
    allowedOperationKinds: policy.allowedOperationKinds as SemanticMutationOperationV1['kind'][],
    allowedTargetEntityIds: policy.allowedTargetEntityIds as SemanticEntityId[],
    allowedSourceOwnerIds: [],
    allowedPathPrefixes: [],
    requiredPreconditions: policy.requiredPreconditions as SemanticMutationConditionV1[],
    requiredPostconditions: policy.requiredPostconditions as SemanticMutationConditionV1[],
    minimumVerification: policy.minimumVerification as VerificationRequirementV1[]
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
