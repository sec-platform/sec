import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { PolicyReport } from './policy-types.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
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

function exactVerificationStatus(value: unknown): value is VerificationStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped';
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

function exactVerificationReport(value: unknown): value is VerificationReport {
  if (!exactKeys(value, [
    'build', 'unit', 'acceptance', 'policy', 'fast', 'runtime', 'summary', 'logs'
  ]) || !exactFastVerificationReport(value.fast) ||
    !exactRuntimeVerificationReport(value.runtime) || !exactLogs(value.logs) ||
    !exactKeys(value.summary, ['status', 'requestedLane', 'failedLanes']) ||
    (value.summary.status !== 'passed' && value.summary.status !== 'failed') ||
    value.summary.requestedLane !== 'all' || !Array.isArray(value.summary.failedLanes) ||
    !value.summary.failedLanes.every((lane) => lane === 'fast' || lane === 'runtime')) {
    return false;
  }
  const report = value as unknown as VerificationReport;
  const failedLanes = [
    ...(report.fast.status === 'failed' ? ['fast' as const] : []),
    ...(report.runtime.status === 'failed' ? ['runtime' as const] : [])
  ];
  const expectedSummaryStatus = failedLanes.length === 0 ? 'passed' : 'failed';
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
