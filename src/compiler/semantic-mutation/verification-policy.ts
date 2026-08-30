import type { SemanticImpactPropagation } from '../../semantic/impact/contract/types.ts';
import { SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION, type SemanticMutationDiagnostic, type SemanticMutationVerificationCapability, type SemanticMutationVerificationPlanningContext, type VerificationRequirement } from '../../semantic/mutation/contract/types.ts';
import {
  canonicalEquals,
  cloneAndDeepFreeze,
  compareVerificationRequirements,
  exactOwnKeys,
  isPlainObject,
  mutationDiagnostic,
  nonEmptyString,
  sha256,
  verificationRequirementKey
} from './canonical.ts';

type PlanningContextDraft = Omit<
  SemanticMutationVerificationPlanningContext,
  'policyRevision' | 'requiredVerificationDigest' | 'planningRevision'
>;

export function semanticMutationRequiredVerificationDigest(
  requirements: readonly VerificationRequirement[]
): string {
  return sha256({ domain: 'semantic-mutation-required-verification-v1', requirements });
}

function planningRevision(
  value: Omit<SemanticMutationVerificationPlanningContext, 'planningRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-verification-planning-v1', ...value });
}

export function buildSemanticMutationVerificationPlanningContext(
  draft: PlanningContextDraft,
  requiredVerification: readonly VerificationRequirement[]
): SemanticMutationVerificationPlanningContext {
  const capabilities = draft.capabilities.map((capability) => structuredClone(capability))
    .sort((left, right) => compareVerificationRequirements(left.requirement, right.requirement));
  const withoutRevision = {
    policyRevision: SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION,
    adapterId: draft.adapterId,
    adapterRevision: draft.adapterRevision,
    impactRevision: draft.impactRevision,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(requiredVerification),
    uncertaintyStatus: draft.uncertaintyStatus,
    capabilities
  } as const;
  return cloneAndDeepFreeze({ ...withoutRevision, planningRevision: planningRevision(withoutRevision) });
}

function requirementLooksValid(requirement: unknown): requirement is VerificationRequirement {
  if (!isPlainObject(requirement) || typeof requirement.kind !== 'string') return false;
  if (requirement.kind === 'acceptance') {
    return exactOwnKeys(requirement, ['kind', 'acceptanceEntityId']) && nonEmptyString(requirement.acceptanceEntityId);
  }
  if (requirement.kind === 'selector') {
    return exactOwnKeys(requirement, ['kind', 'selector']) && nonEmptyString(requirement.selector) &&
      !requirement.selector.startsWith('!') && !requirement.selector.startsWith('-');
  }
  if (requirement.kind === 'pass') {
    return exactOwnKeys(requirement, ['kind', 'passId']) && nonEmptyString(requirement.passId);
  }
  return false;
}

function capabilityLooksValid(value: unknown): value is SemanticMutationVerificationCapability {
  return isPlainObject(value) && exactOwnKeys(value, ['requirement', 'status', 'isolated']) &&
    requirementLooksValid(value.requirement) &&
    (value.status === 'runnable' || value.status === 'non-runnable') &&
    typeof value.isolated === 'boolean';
}

export function evaluateSemanticMutationVerificationPlanning(
  context: SemanticMutationVerificationPlanningContext,
  impact: SemanticImpactPropagation,
  requiredVerification: readonly VerificationRequirement[]
): SemanticMutationDiagnostic[] {
  const diagnostics: SemanticMutationDiagnostic[] = [];
  if (!isPlainObject(context) || !exactOwnKeys(context, [
    'policyRevision',
    'adapterId',
    'adapterRevision',
    'impactRevision',
    'requiredVerificationDigest',
    'uncertaintyStatus',
    'capabilities',
    'planningRevision'
  ]) || context.policyRevision !== SEMANTIC_MUTATION_VERIFICATION_POLICY_REVISION ||
    !nonEmptyString(context.adapterId) || !nonEmptyString(context.adapterRevision) ||
    !Array.isArray(context.capabilities) || !context.capabilities.every(capabilityLooksValid) ||
    (context.uncertaintyStatus !== 'covered' && context.uncertaintyStatus !== 'blocked')) {
    return [mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Verification planning context violates the frozen v1 schema'
    )];
  }
  const sortedCapabilities = [...context.capabilities]
    .sort((left, right) => compareVerificationRequirements(left.requirement, right.requirement));
  const capabilityKeys = sortedCapabilities.map((entry) => verificationRequirementKey(entry.requirement));
  const expectedKeys = requiredVerification.map(verificationRequirementKey);
  const duplicate = capabilityKeys.some((key, index) => index > 0 && key === capabilityKeys[index - 1]);
  const expectedWithoutRevision = {
    policyRevision: context.policyRevision,
    adapterId: context.adapterId,
    adapterRevision: context.adapterRevision,
    impactRevision: context.impactRevision,
    requiredVerificationDigest: context.requiredVerificationDigest,
    uncertaintyStatus: context.uncertaintyStatus,
    capabilities: sortedCapabilities
  };
  if (context.impactRevision !== impact.impactRevision ||
    context.requiredVerificationDigest !== semanticMutationRequiredVerificationDigest(requiredVerification) ||
    context.planningRevision !== planningRevision(expectedWithoutRevision) ||
    duplicate || !canonicalEquals(capabilityKeys, expectedKeys)) {
    diagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Verification planning context does not exactly bind Impact and the complete requirement union',
      {
        details: {
          impactRevision: impact.impactRevision,
          suppliedImpactRevision: context.impactRevision,
          expectedRequirementKeys: expectedKeys,
          suppliedCapabilityKeys: capabilityKeys
        }
      }
    ));
  }
  if (context.uncertaintyStatus === 'blocked') {
    diagnostics.push(mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Verification policy blocks the canonical Impact uncertainty set',
      { details: { uncertaintyCount: impact.uncertainties.length } }
    ));
  }
  for (const capability of sortedCapabilities) {
    if (capability.status !== 'runnable' || !capability.isolated) {
      diagnostics.push(mutationDiagnostic(
        'SEMANTIC-MUTATION-010',
        'impact-verification',
        'Every required verifier must be runnable and isolated before live publish',
        {
          details: {
            requirement: capability.requirement,
            status: capability.status,
            isolated: capability.isolated
          }
        }
      ));
    }
  }
  return diagnostics;
}
