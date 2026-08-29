import type { ValidatedEngineeringIRSnapshot } from '../../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticMutationBase, SemanticMutationVerificationCapability, VerificationRequirement } from '../../semantic/mutation/contract/types.ts';
import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION, SEMANTIC_MUTATION_VERIFICATION_CAPABILITY_PLAN_REVISION, SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION, type SemanticMutationVerificationCapabilityPlan, type SemanticMutationVerificationReport, type SemanticMutationVerifyAllRunner } from '../../verification/contract/types.ts';
import { cloneAndDeepFreeze, compareCodeUnits, sha256 } from '../semantic-mutation/canonical.ts';
import { forwardSemanticMutationIsolatedRuntimePlanBinding } from './semantic-mutation-isolated-runtime-binding.ts';
import {
  hasProvenSemanticMutationIsolationCapability,
  probeSemanticMutationIsolationCapability,
  type SemanticMutationIsolationCapabilityProbe
} from './semantic-mutation-isolation-capability.ts';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SAFE_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const issuedRunnableCapabilityPlans = new WeakSet<object>();

function requirementKey(requirement: VerificationRequirement): string {
  if (requirement.kind === 'acceptance') return `acceptance\u0000${requirement.acceptanceEntityId}`;
  if (requirement.kind === 'selector') return `selector\u0000${requirement.selector}`;
  return `pass\u0000${requirement.passId}`;
}

function normalizeRequirement(requirement: VerificationRequirement): VerificationRequirement {
  if (requirement.kind === 'acceptance') {
    return { kind: 'acceptance', acceptanceEntityId: requirement.acceptanceEntityId };
  }
  if (requirement.kind === 'selector') return { kind: 'selector', selector: requirement.selector };
  return { kind: 'pass', passId: requirement.passId };
}

function selectorIsAuthoritative(snapshot: ValidatedEngineeringIRSnapshot, selector: string): boolean {
  return SAFE_SELECTOR.test(selector) && snapshot.ir.facts.some((fact) => {
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
    requirement: normalizeRequirement(requirement),
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
      requirementKey(left.requirement),
      requirementKey(right.requirement)
    ));
  const blockedKeys = new Set<string>();
  let previous = '';
  for (const capability of capabilities) {
    const key = requirementKey(capability.requirement);
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

function requiredVerificationDigest(requirements: readonly VerificationRequirement[]): string {
  return sha256({ domain: 'semantic-mutation-required-verification-v1', requirements });
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function exactEndpoint(value: unknown): value is SemanticMutationBase {
  return exactKeys(value, ['transactionId', 'inputRevision', 'semanticRevision']) &&
    typeof value.transactionId === 'string' && value.transactionId.length > 0 &&
    SHA256_PATTERN.test(String(value.inputRevision)) && SHA256_PATTERN.test(String(value.semanticRevision));
}

function exactRequirement(value: unknown): value is VerificationRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const requirement = value as Record<string, unknown>;
  if (requirement.kind === 'pass') {
    return exactKeys(value, ['kind', 'passId']) && requirement.passId === 'verify';
  }
  if (requirement.kind === 'acceptance') {
    return exactKeys(value, ['kind', 'acceptanceEntityId']) &&
      typeof requirement.acceptanceEntityId === 'string' && requirement.acceptanceEntityId.length > 0;
  }
  return requirement.kind === 'selector' && exactKeys(value, ['kind', 'selector']) &&
    typeof requirement.selector === 'string' && SAFE_SELECTOR.test(requirement.selector);
}

export function assertSemanticMutationVerificationReportInvariant(
  value: unknown
): asserts value is SemanticMutationVerificationReport {
  if (!exactKeys(value, [
    'formatRevision', 'adapterId', 'adapterRevision', 'planRevision', 'attempted',
    'stagedSourceDigest', 'requiredVerificationDigest', 'executions', 'status', 'reportRevision'
  ])) {
    throw new Error('Semantic Mutation Verification report has a non-canonical schema');
  }
  const report = value as unknown as SemanticMutationVerificationReport;
  const statuses = ['passed', 'failed', 'blocked'] as const;
  if (report.formatRevision !== SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION ||
    report.adapterId !== SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID ||
    report.adapterRevision !== SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION ||
    !SHA256_PATTERN.test(report.planRevision) || !exactEndpoint(report.attempted) ||
    !SHA256_PATTERN.test(report.stagedSourceDigest) ||
    !SHA256_PATTERN.test(report.requiredVerificationDigest) ||
    !statuses.includes(report.status) || !Array.isArray(report.executions) || report.executions.length === 0) {
    throw new Error('Semantic Mutation Verification report is invalid');
  }
  const requirements: VerificationRequirement[] = [];
  for (const execution of report.executions) {
    if (!exactKeys(execution, ['requirement', 'runner', 'status', 'evidenceDigest']) ||
      !exactRequirement(execution.requirement) || execution.runner !== 'verify-all' ||
      execution.status !== report.status || typeof execution.evidenceDigest !== 'string' ||
      !SHA256_PATTERN.test(execution.evidenceDigest)) {
      throw new Error('Semantic Mutation Verification report execution is invalid');
    }
    requirements.push(normalizeRequirement(execution.requirement));
  }
  const sortedRequirements = [...requirements].sort((left, right) =>
    compareCodeUnits(requirementKey(left), requirementKey(right)));
  if (JSON.stringify(requirements) !== JSON.stringify(sortedRequirements) ||
    new Set(requirements.map(requirementKey)).size !== requirements.length ||
    report.requiredVerificationDigest !== requiredVerificationDigest(requirements)) {
    throw new Error('Semantic Mutation Verification report requirement union is invalid');
  }
  const { reportRevision, ...withoutRevision } = report;
  if (reportRevision !== sha256({ domain: 'semantic-mutation-verification-report-v1', ...withoutRevision })) {
    throw new Error('Semantic Mutation Verification report revision is stale or forged');
  }
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
    suppliedRequirements.every((requirement) => exactRequirement(requirement));
  const requirements = suppliedRequirements.map(normalizeRequirement)
    .sort((left, right) => compareCodeUnits(requirementKey(left), requirementKey(right)));
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
      exactKeys(entry, ['requirement', 'status', 'isolated']) && exactRequirement(entry.requirement) &&
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
    input.requiredVerificationDigest !== requiredVerificationDigest(requirements) ||
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
