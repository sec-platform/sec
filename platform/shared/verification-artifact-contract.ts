import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { PolicyReport } from './policy-types.ts';
import {
  CodexDevelopmentAssertVerificationGateResultV1,
  type VerificationAggregateResultV1,
  type VerificationClaimResultV1,
  type VerificationGateResultV1,
  type VerificationReasonCode,
  type VerificationResultStatus
} from './verification-result-contract.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationClaimSummary,
  VerificationReport,
  VerificationStatus
} from './verification-types.ts';

export interface VerificationArtifactSet {
  readonly verificationReport: unknown;
  readonly runtimeReport: unknown;
  readonly policyReport: unknown;
  readonly acceptanceCoverage: unknown;
}

export interface CanonicalVerificationArtifactSet {
  readonly verificationReport: VerificationReport;
  readonly runtimeReport: RuntimeVerificationLaneReport;
  readonly policyReport: PolicyReport;
  readonly acceptanceCoverage: AcceptanceCoverageReport;
}

const PASSED_REASON_CODES: ReadonlySet<VerificationReasonCode> = new Set([
  'executed-success'
]);
const FAILED_REASON_CODES: ReadonlySet<VerificationReasonCode> = new Set([
  'executed-failure', 'timeout', 'cleanup-failed', 'process-settlement-failed'
]);
const NOT_RUN_REASON_CODES: ReadonlySet<VerificationReasonCode> = new Set([
  'not-applicable', 'fail-fast-prerequisite-failed',
  'current-runner-not-owning-environment', 'not-dispatched',
  'required-artifact-missing'
]);
const UNSUPPORTED_REASON_CODES: ReadonlySet<VerificationReasonCode> = new Set([
  'capability-unsupported', 'platform-unsupported'
]);
const INVALIDATED_REASON_CODES: ReadonlySet<VerificationReasonCode> = new Set([
  'selection-unresolved', 'input-invalidated', 'evidence-stale',
  'superseded-revision', 'cancelled'
]);
const VERIFICATION_STATUS_PRIORITY: Readonly<Record<VerificationResultStatus, number>> = {
  passed: 0,
  'not-run': 1,
  unsupported: 2,
  invalidated: 3,
  failed: 4
};

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index]);
}

function exactStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactVerificationStatus(value: unknown): value is VerificationStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped';
}

function exactUnifiedVerificationStatus(value: unknown): value is VerificationResultStatus {
  return value === 'passed' || value === 'failed' || value === 'not-run' ||
    value === 'unsupported' || value === 'invalidated';
}

function exactVerificationReasonCode(value: unknown): value is VerificationReasonCode {
  return value === 'executed-success' ||
    value === 'executed-failure' ||
    value === 'not-applicable' ||
    value === 'fail-fast-prerequisite-failed' ||
    value === 'current-runner-not-owning-environment' ||
    value === 'not-dispatched' ||
    value === 'required-artifact-missing' ||
    value === 'capability-unsupported' ||
    value === 'platform-unsupported' ||
    value === 'selection-unresolved' ||
    value === 'input-invalidated' ||
    value === 'evidence-stale' ||
    value === 'superseded-revision' ||
    value === 'cancelled' ||
    value === 'timeout' ||
    value === 'cleanup-failed' ||
    value === 'process-settlement-failed';
}

function reasonMatchesStatus(
  status: VerificationResultStatus,
  reasonCode: VerificationReasonCode
): boolean {
  if (status === 'passed') return PASSED_REASON_CODES.has(reasonCode);
  if (status === 'failed') return FAILED_REASON_CODES.has(reasonCode);
  if (status === 'not-run') return NOT_RUN_REASON_CODES.has(reasonCode);
  if (status === 'unsupported') return UNSUPPORTED_REASON_CODES.has(reasonCode);
  return INVALIDATED_REASON_CODES.has(reasonCode);
}

function exactLogs(value: unknown): boolean {
  return exactKeys(value, ['stdout', 'stderr']) &&
    typeof value.stdout === 'string' && typeof value.stderr === 'string';
}

function exactPolicySource(value: unknown): boolean {
  return exactKeys(value, ['path', 'policyIds']) &&
    typeof value.path === 'string' && exactStringArray(value.policyIds);
}

function exactPolicyViolation(value: unknown): boolean {
  return exactKeys(value, [
    'id', 'severity', 'appliesTo', 'rule', 'files', 'message', 'sourceScope', 'sourcePath'
  ]) && typeof value.id === 'string' &&
    (value.severity === 'info' || value.severity === 'warn' ||
      value.severity === 'error' || value.severity === 'blocker') &&
    exactStringArray(value.appliesTo) && typeof value.rule === 'string' &&
    exactStringArray(value.files) && typeof value.message === 'string' &&
    (value.sourceScope === 'official' || value.sourceScope === 'project') &&
    typeof value.sourcePath === 'string';
}

function exactPolicyScope(value: unknown): boolean {
  return exactKeys(value, ['policies', 'sources', 'violations']) &&
    exactStringArray(value.policies) && Array.isArray(value.sources) &&
    value.sources.every(exactPolicySource) && Array.isArray(value.violations) &&
    value.violations.every(exactPolicyViolation);
}

function exactMergedPolicy(value: unknown): boolean {
  return exactKeys(value, ['id', 'sourceScope', 'sourcePath', 'targets']) &&
    typeof value.id === 'string' &&
    (value.sourceScope === 'official' || value.sourceScope === 'project') &&
    typeof value.sourcePath === 'string' && exactStringArray(value.targets);
}

function exactPolicyReport(value: unknown): value is PolicyReport {
  return exactKeys(value, ['status', 'official', 'project', 'merged', 'violations']) &&
    exactVerificationStatus(value.status) && exactPolicyScope(value.official) &&
    exactPolicyScope(value.project) && exactKeys(value.merged, ['policies']) &&
    Array.isArray(value.merged.policies) && value.merged.policies.every(exactMergedPolicy) &&
    Array.isArray(value.violations) && value.violations.every(exactPolicyViolation);
}

function exactFastVerificationReport(value: unknown): value is FastVerificationLaneReport {
  return exactKeys(value, [
    'status', 'build', 'unit', 'acceptance', 'policy', 'policyReport', 'logs'
  ]) && exactVerificationStatus(value.status) &&
    exactKeys(value.build, ['status']) && exactVerificationStatus(value.build.status) &&
    exactKeys(value.unit, ['status', 'passed']) && exactVerificationStatus(value.unit.status) &&
    exactStringArray(value.unit.passed) &&
    exactKeys(value.acceptance, ['status', 'passed', 'failed']) &&
    exactVerificationStatus(value.acceptance.status) &&
    exactStringArray(value.acceptance.passed) && exactStringArray(value.acceptance.failed) &&
    exactKeys(value.policy, ['status', 'violations']) && exactVerificationStatus(value.policy.status) &&
    Array.isArray(value.policy.violations) && value.policy.violations.every(exactPolicyViolation) &&
    exactPolicyReport(value.policyReport) && exactLogs(value.logs);
}

function exactVerificationStep(value: unknown): boolean {
  return exactKeys(value, ['status', 'passed', 'failed', 'command']) &&
    exactVerificationStatus(value.status) && exactStringArray(value.passed) &&
    exactStringArray(value.failed) && (value.command === null || typeof value.command === 'string');
}

function exactRuntimeVerificationReport(value: unknown): value is RuntimeVerificationLaneReport {
  return exactKeys(value, ['status', 'build', 'unit', 'acceptance', 'logs']) &&
    exactVerificationStatus(value.status) && exactVerificationStep(value.build) &&
    exactVerificationStep(value.unit) && exactVerificationStep(value.acceptance) && exactLogs(value.logs);
}

function exactVerificationClaimResult(value: unknown): value is VerificationClaimResultV1 {
  if (!exactKeys(value, [
    'claimId', 'status', 'reasonCode', 'contributingGateIds', 'coverageComplete'
  ]) || typeof value.claimId !== 'string' || value.claimId.length === 0 ||
    !exactUnifiedVerificationStatus(value.status) ||
    !exactVerificationReasonCode(value.reasonCode) ||
    !exactStringArray(value.contributingGateIds) ||
    !uniqueStrings(value.contributingGateIds) ||
    typeof value.coverageComplete !== 'boolean') {
    return false;
  }
  if (!reasonMatchesStatus(value.status, value.reasonCode)) return false;
  return value.status !== 'passed' || value.coverageComplete;
}

function strongestClaimStatus(
  claimResults: readonly VerificationClaimResultV1[]
): VerificationResultStatus {
  let strongest: VerificationResultStatus = 'passed';
  for (const result of claimResults) {
    if (VERIFICATION_STATUS_PRIORITY[result.status] > VERIFICATION_STATUS_PRIORITY[strongest]) {
      strongest = result.status;
    }
  }
  return strongest;
}

function exactVerificationAggregateResult(
  value: unknown
): value is VerificationAggregateResultV1 {
  if (!exactKeys(value, ['overallStatus', 'overallReasonCode', 'claimResults']) ||
    !exactUnifiedVerificationStatus(value.overallStatus) ||
    !exactVerificationReasonCode(value.overallReasonCode) ||
    !reasonMatchesStatus(value.overallStatus, value.overallReasonCode) ||
    !Array.isArray(value.claimResults) ||
    !value.claimResults.every(exactVerificationClaimResult)) {
    return false;
  }

  const result = value as unknown as VerificationAggregateResultV1;
  if (!uniqueStrings(result.claimResults.map((claim) => claim.claimId)) ||
    strongestClaimStatus(result.claimResults) !== result.overallStatus) {
    return false;
  }
  if (result.overallStatus === 'passed') {
    return result.overallReasonCode === 'executed-success';
  }
  if (result.overallStatus === 'failed') {
    return result.overallReasonCode === 'executed-failure' ||
      result.claimResults.some((claim) => (
        claim.status === 'failed' && claim.reasonCode === result.overallReasonCode
      ));
  }
  return result.claimResults.some((claim) => (
    claim.status === result.overallStatus && claim.reasonCode === result.overallReasonCode
  ));
}

function exactVerificationGateResult(value: unknown): value is VerificationGateResultV1 {
  try {
    CodexDevelopmentAssertVerificationGateResultV1(value);
    return true;
  } catch {
    return false;
  }
}

function claimMatchesContributingGates(
  claim: VerificationClaimResultV1,
  gateById: ReadonlyMap<string, VerificationGateResultV1>
): boolean {
  const gates = claim.contributingGateIds.map((gateId) => gateById.get(gateId));
  if (gates.some((gate) => gate === undefined)) return false;
  const contributing = gates as VerificationGateResultV1[];
  if (contributing.some((gate) => !gate.requiredForClaims.includes(claim.claimId))) {
    return false;
  }
  if (claim.status === 'passed') {
    return claim.coverageComplete && contributing.every((gate) => (
      gate.status === 'passed' && gate.supportedClaims.includes(claim.claimId)
    ));
  }
  if (claim.status === 'failed') {
    return contributing.some((gate) => gate.status === 'failed');
  }
  if (claim.status === 'unsupported') {
    return contributing.some((gate) => gate.status === 'unsupported');
  }
  if (claim.status === 'not-run') {
    return !claim.coverageComplete || contributing.some((gate) => gate.status === 'not-run');
  }
  return !claim.coverageComplete || contributing.some((gate) => gate.status === 'invalidated');
}

function exactVerificationClaimSummary(value: unknown): value is VerificationClaimSummary {
  if (!exactKeys(value, ['overall', 'gates']) ||
    !exactVerificationAggregateResult(value.overall) ||
    !Array.isArray(value.gates) ||
    !value.gates.every(exactVerificationGateResult)) {
    return false;
  }

  const summary = value as unknown as VerificationClaimSummary;
  const gates = [...summary.gates];
  if (!uniqueStrings(gates.map((gate) => gate.gateId))) return false;

  const claimIds = new Set(summary.overall.claimResults.map((claim) => claim.claimId));
  if (gates.some((gate) => (
    [...gate.requiredForClaims, ...gate.supportedClaims].some((claimId) => !claimIds.has(claimId))
  ))) {
    return false;
  }

  const gateById = new Map(gates.map((gate) => [gate.gateId, gate] as const));
  return summary.overall.claimResults.every((claim) => (
    claimMatchesContributingGates(claim, gateById)
  ));
}

function exactVerificationReport(value: unknown): value is VerificationReport {
  if (!exactKeys(value, [
    'build', 'unit', 'acceptance', 'policy', 'fast', 'runtime', 'summary', 'logs'
  ]) || !exactFastVerificationReport(value.fast) ||
    !exactRuntimeVerificationReport(value.runtime) || !exactLogs(value.logs)) {
    return false;
  }

  const rawSummary = value.summary;
  if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) {
    return false;
  }
  const summary = rawSummary as Record<string, unknown>;
  const summaryHasClaim = exactKeys(summary, [
    'status', 'requestedLane', 'failedLanes', 'claimSummary'
  ]);
  const summaryIsLegacy = exactKeys(summary, [
    'status', 'requestedLane', 'failedLanes'
  ]);
  if ((!summaryHasClaim && !summaryIsLegacy) ||
    (summary.status !== 'passed' && summary.status !== 'failed') ||
    summary.requestedLane !== 'all' || !Array.isArray(summary.failedLanes) ||
    !summary.failedLanes.every((lane) => lane === 'fast' || lane === 'runtime') ||
    (summaryHasClaim && !exactVerificationClaimSummary(summary.claimSummary))) {
    return false;
  }

  const report = value as unknown as VerificationReport;
  const failedLanes = [
    ...(report.fast.status === 'failed' ? ['fast' as const] : []),
    ...(report.runtime.status === 'failed' ? ['runtime' as const] : [])
  ];
  const expectedSummaryStatus = report.summary.claimSummary
    ? report.summary.claimSummary.overall.overallStatus === 'passed' ? 'passed' : 'failed'
    : failedLanes.length === 0 ? 'passed' : 'failed';
  const expectedLogs = {
    stdout: [report.fast.logs.stdout, report.runtime.logs.stdout].filter(Boolean).join('\n'),
    stderr: [report.fast.logs.stderr, report.runtime.logs.stderr].filter(Boolean).join('\n')
  };
  return JSON.stringify(report.build) === JSON.stringify(report.fast.build) &&
    JSON.stringify(report.unit) === JSON.stringify(report.fast.unit) &&
    JSON.stringify(report.acceptance) === JSON.stringify(report.fast.acceptance) &&
    JSON.stringify(report.policy) === JSON.stringify(report.fast.policy) &&
    JSON.stringify(report.logs) === JSON.stringify(expectedLogs) &&
    report.summary.status === expectedSummaryStatus &&
    JSON.stringify(report.summary.failedLanes) === JSON.stringify(failedLanes);
}

function exactCoverageEntry(value: unknown): boolean {
  return exactKeys(value, ['id', 'declaredAcceptance', 'coveredBy', 'uncovered']) &&
    typeof value.id === 'string' && exactStringArray(value.declaredAcceptance) &&
    exactStringArray(value.coveredBy) && typeof value.uncovered === 'boolean' &&
    value.uncovered === (value.coveredBy.length === 0);
}

function exactAcceptanceCoverage(value: unknown): value is AcceptanceCoverageReport {
  return exactKeys(value, [
    'formatVersion', 'status', 'acceptancePassed', 'blocks', 'slots',
    'uncoveredBlocks', 'uncoveredSlots'
  ]) && value.formatVersion === '1' && exactVerificationStatus(value.status) &&
    exactStringArray(value.acceptancePassed) && Array.isArray(value.blocks) &&
    value.blocks.every(exactCoverageEntry) && Array.isArray(value.slots) &&
    value.slots.every(exactCoverageEntry) && exactStringArray(value.uncoveredBlocks) &&
    exactStringArray(value.uncoveredSlots);
}

export function isCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): input is CanonicalVerificationArtifactSet {
  if (!exactVerificationReport(input.verificationReport) ||
    !exactRuntimeVerificationReport(input.runtimeReport) ||
    !exactPolicyReport(input.policyReport) ||
    !exactAcceptanceCoverage(input.acceptanceCoverage)) {
    return false;
  }
  const report = input.verificationReport;
  return JSON.stringify(report.runtime) === JSON.stringify(input.runtimeReport) &&
    JSON.stringify(report.fast.policyReport) === JSON.stringify(input.policyReport) &&
    JSON.stringify(report.policy) === JSON.stringify({
      status: input.policyReport.status,
      violations: input.policyReport.violations
    }) && input.acceptanceCoverage.status === input.runtimeReport.status;
}

export function assertCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): asserts input is CanonicalVerificationArtifactSet {
  if (!isCanonicalVerificationArtifactSet(input)) {
    throw new Error('Pipeline completion Verification artifacts do not match the exact canonical schema');
  }
}
