import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
  SEMANTIC_MUTATION_VERIFICATION_REPORT_REVISION,
  type SemanticMutationVerificationReport
} from '../contract/types.ts';
import type {
  SemanticMutationBase,
  VerificationRequirement
} from '../../../semantics/mutation/types.ts';
import { compareCodeUnits, sha256 } from '../../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequiredVerificationDigest } from '../../../compiler/semantic-mutation/verification-policy.ts';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SAFE_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

export function semanticMutationVerificationRequirementKey(
  requirement: VerificationRequirement
): string {
  if (requirement.kind === 'acceptance') return `acceptance\u0000${requirement.acceptanceEntityId}`;
  if (requirement.kind === 'selector') return `selector\u0000${requirement.selector}`;
  return `pass\u0000${requirement.passId}`;
}

export function normalizeSemanticMutationVerificationRequirement(
  requirement: VerificationRequirement
): VerificationRequirement {
  if (requirement.kind === 'acceptance') {
    return { kind: 'acceptance', acceptanceEntityId: requirement.acceptanceEntityId };
  }
  if (requirement.kind === 'selector') return { kind: 'selector', selector: requirement.selector };
  return { kind: 'pass', passId: requirement.passId };
}

export function isCanonicalSemanticMutationVerificationSelector(value: string): boolean {
  return SAFE_SELECTOR.test(value);
}

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
    SHA256_PATTERN.test(String(value.inputRevision)) &&
    SHA256_PATTERN.test(String(value.semanticRevision));
}

export function isExactSemanticMutationVerificationRequirement(
  value: unknown
): value is VerificationRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const requirement = value as Record<string, unknown>;
  if (requirement.kind === 'pass') {
    return exactKeys(value, ['kind', 'passId']) && requirement.passId === 'verify';
  }
  if (requirement.kind === 'acceptance') {
    return exactKeys(value, ['kind', 'acceptanceEntityId']) &&
      typeof requirement.acceptanceEntityId === 'string' &&
      requirement.acceptanceEntityId.length > 0;
  }
  return requirement.kind === 'selector' &&
    exactKeys(value, ['kind', 'selector']) &&
    typeof requirement.selector === 'string' &&
    isCanonicalSemanticMutationVerificationSelector(requirement.selector);
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
    !SHA256_PATTERN.test(report.planRevision) ||
    !exactEndpoint(report.attempted) ||
    !SHA256_PATTERN.test(report.stagedSourceDigest) ||
    !SHA256_PATTERN.test(report.requiredVerificationDigest) ||
    !statuses.includes(report.status) ||
    !Array.isArray(report.executions) ||
    report.executions.length === 0) {
    throw new Error('Semantic Mutation Verification report is invalid');
  }
  const requirements: VerificationRequirement[] = [];
  for (const execution of report.executions) {
    if (!exactKeys(execution, ['requirement', 'runner', 'status', 'evidenceDigest']) ||
      !isExactSemanticMutationVerificationRequirement(execution.requirement) ||
      execution.runner !== 'verify-all' ||
      execution.status !== report.status ||
      typeof execution.evidenceDigest !== 'string' ||
      !SHA256_PATTERN.test(execution.evidenceDigest)) {
      throw new Error('Semantic Mutation Verification report execution is invalid');
    }
    requirements.push(normalizeSemanticMutationVerificationRequirement(execution.requirement));
  }
  const sortedRequirements = [...requirements].sort((left, right) =>
    compareCodeUnits(
      semanticMutationVerificationRequirementKey(left),
      semanticMutationVerificationRequirementKey(right)
    ));
  if (JSON.stringify(requirements) !== JSON.stringify(sortedRequirements) ||
    new Set(requirements.map(semanticMutationVerificationRequirementKey)).size !== requirements.length ||
    report.requiredVerificationDigest !== semanticMutationRequiredVerificationDigest(requirements)) {
    throw new Error('Semantic Mutation Verification report requirement union is invalid');
  }
  const { reportRevision, ...withoutRevision } = report;
  if (reportRevision !== sha256({
    domain: 'semantic-mutation-verification-report-v1',
    ...withoutRevision
  })) {
    throw new Error('Semantic Mutation Verification report revision is stale or forged');
  }
}
