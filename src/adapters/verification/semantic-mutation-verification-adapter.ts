import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { SemanticMutationBase, SemanticMutationVerificationCapability, VerificationRequirement } from '../../semantics/mutation/types.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION, SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION, type SemanticMutationVerificationCapabilityPlan, type SemanticMutationVerificationReport, type SemanticMutationVerifyAllRunner } from '../../assurance/verification/contract/types.ts';
import { cloneAndDeepFreeze, compareCodeUnits, sha256 } from '../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequiredVerificationDigest } from '../../compiler/semantic-mutation/verification-policy.ts';
import {
  assertSemanticMutationVerificationReportInvariant,
  isCanonicalSemanticMutationVerificationSelector,
  isExactSemanticMutationVerificationRequirement,
  normalizeSemanticMutationVerificationRequirement,
  semanticMutationVerificationRequirementKey
} from '../../assurance/verification/semantic-mutation/report-contract.ts';
import { forwardSemanticMutationIsolatedRuntimePlanBinding } from './semantic-mutation-isolated-runtime-binding.ts';
import {
  hasProvenSemanticMutationIsolationCapability,
  probeSemanticMutationIsolationCapability,
  type SemanticMutationIsolationCapabilityProbe
} from './semantic-mutation-isolation-capability.ts';

const issuedRunnableCapabilityPlans = new WeakSet<object>();

function selectorIsAuthoritative(snapshot: ValidatedEngineeringIRSnapshot, selector: string): boolean {
  return isCanonicalSemanticMutationVerificationSelector(selector) && snapshot.ir.facts.some((fact) => {
    if (fact.predicate !== 'VERIFIED_BY' || fact.object.kind !== 'value' ||
      fact.object.value === null || typeof fact.object.value !== 'object' ||
      Array.isArray(fact.object.value)) {
      return false;
    }
    const value = fact.object.value as Record<string, unknown>;
    return Object.keys(value).length === 1 && value.selector === selector &&
      fact.assertions.some((assertion) =>
        assertion.authority === 'authoritative' || assertion.authority === 'derived');
  });
}

function hasExternalIrreversibleEffect(snapshot: ValidatedEngineeringIRSnapshot): boolean {
  const externalEffects = new Set(snapshot.ir.entities
    .filter((entity) => entity.kind === 'effect' && entity.attributes.some((attribute) =>
      attribute.key === 'effectKind' && attribute.value === 'external-service-call'))
    .map((entity) => entity.id));
  // A declared external-service effect is conservatively non-isolatable even
  // before checking whether its PERFORMS_EFFECT edge is currently reachable.
  return externalEffects.size > 0;
}

function capabilityFor(
  snapshot: ValidatedEngineeringIRSnapshot,
  requirement: VerificationRequirement,
  isolationProven: boolean
): SemanticMutationVerificationCapability {
  let runnable = false;
  if (requirement.kind === 'pass') {
    runnable = requirement.passId === 'verify';
  } else if (requirement.kind === 'acceptance') {
    runnable = snapshot.ir.entities.some((entity) =>
      entity.id === requirement.acceptanceEntityId && entity.kind === 'acceptance');
  } else {
    runnable = selectorIsAuthoritative(snapshot, requirement.selector);
  }
  const externalIrreversibleEffect = hasExternalIrreversibleEffect(snapshot);
  const available = runnable && !externalIrreversibleEffect && isolationProven;
  return {
    requirement: normalizeSemanticMutationVerificationRequirement(requirement),
    status: available ? 'runnable' : 'non-runnable',
    isolated: available
  };
}

function capabilityPlanRevision(
  value: Omit<SemanticMutationVerificationCapabilityPlan, 'capabilityPlanRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-verification-capability-plan-v1', ...value });
}

export async function planSemanticMutationVerificationCapabilities(input: {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly requirements: readonly VerificationRequirement[];
  readonly isolationCapabilityProbe?: SemanticMutationIsolationCapabilityProbe;
}): Promise<SemanticMutationVerificationCapabilityPlan> {
  const isolationCapability = await probeSemanticMutationIsolationCapability(
    input.isolationCapabilityProbe
  );
  const isolationProven = hasProvenSemanticMutationIsolationCapability(isolationCapability);
  const capabilities = input.requirements
    .map((requirement) => capabilityFor(input.snapshot, requirement, isolationProven))
    .sort((left, right) => compareCodeUnits(
      semanticMutationVerificationRequirementKey(left.requirement),
      semanticMutationVerificationRequirementKey(right.requirement)
    ));
  const blockedKeys = new Set<string>();
  let previous = '';
  for (const capability of capabilities) {
    const key = semanticMutationVerificationRequirementKey(capability.requirement);
    if (key === previous || capability.status !== 'runnable' || !capability.isolated) blockedKeys.add(key);
    previous = key;
  }
  if (capabilities.length === 0) blockedKeys.add('empty-requirement-union');
  const withoutRevision = {
    formatRevision: SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION,
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    snapshotInputRevision: input.snapshot.ir.inputRevision,
    snapshotSemanticRevision: input.snapshot.ir.semanticRevision,
    status: blockedKeys.size === 0 ? 'runnable' as const : 'blocked' as const,
    capabilities,
    blockedRequirementKeys: [...blockedKeys].sort(compareCodeUnits)
  };
  const plan = cloneAndDeepFreeze({
    ...withoutRevision,
    capabilityPlanRevision: capabilityPlanRevision(withoutRevision)
  });
  if (plan.status === 'runnable' && isolationProven) {
    issuedRunnableCapabilityPlans.add(plan);
    forwardSemanticMutationIsolatedRuntimePlanBinding(isolationCapability, plan);
  }
  return plan;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function exactEndpoint(value: unknown): value is SemanticMutationBase {
  return exactKeys(value, ['transactionId', 'inputRevision', 'semanticRevision']) &&
    typeof value.transactionId === 'string' && value.transactionId.length > 0 &&
    digest.test(String(value.inputRevision)) && digest.test(String(value.semanticRevision));
}

function assertExecutionBinding(input: {
  readonly capabilityPlan: SemanticMutationVerificationCapabilityPlan;
  readonly requirements: readonly VerificationRequirement[];
  readonly planRevision: string;
  readonly attempted: SemanticMutationBase;
  readonly stagedSourceDigest: string;
  readonly requiredVerificationDigest: string;
}): VerificationRequirement[] {
  const suppliedRequirements = Array.isArray(input.requirements) ? input.requirements : [];
  const exactSuppliedRequirements = suppliedRequirements.length > 0 &&
    suppliedRequirements.every((requirement) => isExactSemanticMutationVerificationRequirement(requirement));
  const requirements = suppliedRequirements.map(normalizeRequirement)
    .sort((left, right) => compareCodeUnits(semanticMutationVerificationRequirementKey(left), semanticMutationVerificationRequirementKey(right)));
  const plannedRequirements = input.capabilityPlan.capabilities.map((entry) => entry.requirement);
  const plannedRequirementKeys = plannedRequirements.map(requirementKey);
  const { capabilityPlanRevision: suppliedPlanRevision, ...capabilityPlanWithoutRevision } = input.capabilityPlan;
  const exactCapabilityPlan = exactKeys(input.capabilityPlan, [
    'formatRevision', 'adapterId', 'adapterRevision', 'snapshotInputRevision',
    'snapshotSemanticRevision', 'status', 'capabilities', 'blockedRequirementKeys',
    'capabilityPlanRevision'
  ]) && input.capabilityPlan.formatRevision === SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION &&
    Array.isArray(input.capabilityPlan.capabilities) && input.capabilityPlan.capabilities.length > 0 &&
    input.capabilityPlan.capabilities.every((entry) =>
      exactKeys(entry, ['requirement', 'status', 'isolated']) && isExactSemanticMutationVerificationRequirement(entry.requirement) &&
      entry.status === 'runnable' && entry.isolated === true) &&
    new Set(plannedRequirementKeys).size === plannedRequirementKeys.length &&
    Array.isArray(input.capabilityPlan.blockedRequirementKeys) &&
    input.capabilityPlan.blockedRequirementKeys.length === 0 &&
    issuedRunnableCapabilityPlans.has(input.capabilityPlan);
  if (!exactKeys(input, [
      'capabilityPlan', 'requirements', 'planRevision', 'attempted',
      'stagedSourceDigest', 'requiredVerificationDigest'
    ]) || !exactSuppliedRequirements || !exactEndpoint(input.attempted) ||
    JSON.stringify(input.requirements) !== JSON.stringify(requirements) || !exactCapabilityPlan ||
    suppliedPlanRevision !== capabilityPlanRevision(capabilityPlanWithoutRevision) ||
    input.capabilityPlan.status !== 'runnable' ||
    input.capabilityPlan.adapterId !== SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID ||
    input.capabilityPlan.adapterRevision !== SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION ||
    input.attempted.inputRevision !== input.capabilityPlan.snapshotInputRevision ||
    input.attempted.semanticRevision !== input.capabilityPlan.snapshotSemanticRevision ||
    JSON.stringify(requirements) !== JSON.stringify(plannedRequirements) ||
    input.requiredVerificationDigest !== semanticMutationRequiredVerificationDigest(requirements) ||
    !SHA256_PATTERN.test(input.planRevision) || !SHA256_PATTERN.test(input.stagedSourceDigest)) {
    throw new Error('Semantic Mutation Verification execution binding is invalid or blocked');
  }
  return requirements;
}

export async function executeSemanticMutationVerification(
  input: {
    readonly capabilityPlan: SemanticMutationVerificationCapabilityPlan;
    readonly requirements: readonly VerificationRequirement[];
    readonly planRevision: string;
    readonly attempted: SemanticMutationBase;
    readonly stagedSourceDigest: string;
    readonly requiredVerificationDigest: string;
  },
  runner: SemanticMutationVerifyAllRunner
): Promise<SemanticMutationVerificationReport> {
  const requirements = assertExecutionBinding(input);
  const runnerResult = await runner(cloneAndDeepFreeze({
    runner: 'verify-all' as const,
    planRevision: input.planRevision,
    attempted: input.attempted,
    stagedSourceDigest: input.stagedSourceDigest,
    requiredVerificationDigest: input.requiredVerificationDigest,
    requirements
  }));
  if ((runnerResult.status !== 'passed' && runnerResult.status !== 'failed' &&
    runnerResult.status !== 'blocked') || !SHA256_PATTERN.test(runnerResult.evidenceDigest)) {
    throw new Error('Semantic Mutation verify-all runner returned invalid evidence');
  }
  const withoutRevision = {
    formatRevision: SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION,
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    planRevision: input.planRevision,
    attempted: structuredClone(input.attempted),
    stagedSourceDigest: input.stagedSourceDigest,
    requiredVerificationDigest: input.requiredVerificationDigest,
    executions: requirements.map((requirement) => ({
      requirement,
      runner: 'verify-all' as const,
      status: runnerResult.status,
      evidenceDigest: runnerResult.evidenceDigest
    })),
    status: runnerResult.status
  };
  const report = {
    ...withoutRevision,
    reportRevision: sha256({ domain: 'semantic-mutation-verification-report-v1', ...withoutRevision })
  };
  assertSemanticMutationVerificationReportInvariant(report);
  return cloneAndDeepFreeze(report);
}
