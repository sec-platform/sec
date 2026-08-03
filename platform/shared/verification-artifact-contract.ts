import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { PolicyReport } from './policy-types.ts';
import {
  buildBlockedProductVerificationClaimSummary,
  buildExpectedProductVerificationClaimSummary,
  inferProductVerificationRuntimeMode
} from './product-verification-profile.ts';
import {
  CodexDevelopmentAssertVerificationGateResultV1,
  type VerificationAggregateResultV1,
  type VerificationClaimResultV1,
  type VerificationGateResultV1
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

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalValue(nested)])
    );
  }
  return value;
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function exactString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0');
}

function exactStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(exactString);
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactUniqueStringArray(value: unknown): value is string[] {
  return exactStringArray(value) && uniqueStrings(value);
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
    exactString(value.path) && exactUniqueStringArray(value.policyIds);
}

function exactPolicyViolation(value: unknown): boolean {
  return exactKeys(value, [
    'id', 'severity', 'appliesTo', 'rule', 'files', 'message', 'sourceScope', 'sourcePath'
  ]) && exactString(value.id) &&
    (value.severity === 'info' || value.severity === 'warn' ||
      value.severity === 'error' || value.severity === 'blocker') &&
    exactUniqueStringArray(value.appliesTo) && exactString(value.rule) &&
    exactUniqueStringArray(value.files) && exactString(value.message) &&
    (value.sourceScope === 'official' || value.sourceScope === 'project') &&
    exactString(value.sourcePath);
}

function exactPolicyScope(value: unknown): boolean {
  return exactKeys(value, ['policies', 'sources', 'violations']) &&
    exactUniqueStringArray(value.policies) && Array.isArray(value.sources) &&
    value.sources.every(exactPolicySource) && Array.isArray(value.violations) &&
    value.violations.every(exactPolicyViolation);
}

function exactMergedPolicy(value: unknown): boolean {
  return exactKeys(value, ['id', 'sourceScope', 'sourcePath', 'targets']) &&
    exactString(value.id) &&
    (value.sourceScope === 'official' || value.sourceScope === 'project') &&
    exactString(value.sourcePath) && exactUniqueStringArray(value.targets) &&
    value.targets.length > 0;
}

function exactPolicyReport(value: unknown): value is PolicyReport {
  return exactKeys(value, ['status', 'official', 'project', 'merged', 'violations']) &&
    exactVerificationStatus(value.status) && exactPolicyScope(value.official) &&
    exactPolicyScope(value.project) && exactKeys(value.merged, ['policies']) &&
    Array.isArray(value.merged.policies) && value.merged.policies.every(exactMergedPolicy) &&
    Array.isArray(value.violations) && value.violations.every(exactPolicyViolation);
}

function exactFastVerificationReport(value: unknown): value is FastVerificationLaneReport {
  if (!exactKeys(value, [
    'status', 'build', 'unit', 'acceptance', 'policy', 'policyReport', 'logs'
  ]) || !exactVerificationStatus(value.status) ||
    !exactKeys(value.build, ['status']) || !exactVerificationStatus(value.build.status) ||
    !exactKeys(value.unit, ['status', 'passed']) || !exactVerificationStatus(value.unit.status) ||
    !exactUniqueStringArray(value.unit.passed) ||
    !exactKeys(value.acceptance, ['status', 'passed', 'failed']) ||
    !exactVerificationStatus(value.acceptance.status) ||
    !exactUniqueStringArray(value.acceptance.passed) ||
    !exactUniqueStringArray(value.acceptance.failed) ||
    !exactKeys(value.policy, ['status', 'violations']) ||
    !exactVerificationStatus(value.policy.status) ||
    !Array.isArray(value.policy.violations) ||
    !value.policy.violations.every(exactPolicyViolation) ||
    !exactPolicyReport(value.policyReport) || !exactLogs(value.logs)) {
    return false;
  }
  return value.acceptance.status !== 'passed' || value.acceptance.failed.length === 0;
}

function exactVerificationStep(value: unknown): boolean {
  if (!exactKeys(value, ['status', 'passed', 'failed', 'command']) ||
    !exactVerificationStatus(value.status) ||
    !exactUniqueStringArray(value.passed) ||
    !exactUniqueStringArray(value.failed) ||
    !exactString(value.command)) {
    return false;
  }
  if (value.status === 'skipped') {
    return value.passed.length === 0 && value.failed.length === 0;
  }
  if (value.status === 'passed') return value.failed.length === 0;
  return value.failed.length > 0;
}

function exactRuntimeVerificationReport(value: unknown): value is RuntimeVerificationLaneReport {
  return exactKeys(value, ['status', 'build', 'unit', 'acceptance', 'logs']) &&
    exactVerificationStatus(value.status) && exactVerificationStep(value.build) &&
    exactVerificationStep(value.unit) && exactVerificationStep(value.acceptance) && exactLogs(value.logs);
}

function exactVerificationClaimResultShape(value: unknown): value is VerificationClaimResultV1 {
  return exactKeys(value, [
    'claimId', 'status', 'reasonCode', 'contributingGateIds', 'coverageComplete'
  ]) && exactString(value.claimId) && exactString(value.status) && exactString(value.reasonCode) &&
    exactUniqueStringArray(value.contributingGateIds) && typeof value.coverageComplete === 'boolean';
}

function exactVerificationAggregateShape(value: unknown): value is VerificationAggregateResultV1 {
  return exactKeys(value, ['overallStatus', 'overallReasonCode', 'claimResults']) &&
    exactString(value.overallStatus) && exactString(value.overallReasonCode) &&
    Array.isArray(value.claimResults) && value.claimResults.length > 0 &&
    value.claimResults.every(exactVerificationClaimResultShape) &&
    uniqueStrings(value.claimResults.map((claim) => claim.claimId));
}

function exactVerificationGateResult(value: unknown): value is VerificationGateResultV1 {
  try {
    CodexDevelopmentAssertVerificationGateResultV1(value);
    return true;
  } catch {
    return false;
  }
}

function exactClaimSummaryShape(value: unknown): value is VerificationClaimSummary {
  return exactKeys(value, ['overall', 'gates']) &&
    exactVerificationAggregateShape(value.overall) &&
    Array.isArray(value.gates) && value.gates.length > 0 &&
    value.gates.every(exactVerificationGateResult) &&
    uniqueStrings(value.gates.map((gate) => gate.gateId));
}

function blockedPhysicalProfile(
  report: Pick<VerificationReport, 'fast' | 'runtime' | 'summary'>
): boolean {
  return report.summary.status === 'failed' &&
    report.summary.failedLanes.length === 1 && report.summary.failedLanes[0] === 'fast' &&
    report.fast.status === 'failed' &&
    report.fast.build.status === 'skipped' &&
    report.fast.unit.status === 'skipped' &&
    report.fast.acceptance.status === 'skipped' &&
    report.runtime.status === 'skipped';
}

function exactVerificationClaimSummary(
  value: unknown,
  requestedLane: VerificationReport['summary']['requestedLane'],
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  policyReport: PolicyReport,
  blocked: boolean
): value is VerificationClaimSummary {
  if (!exactClaimSummaryShape(value)) return false;
  const expected = blocked
    ? buildBlockedProductVerificationClaimSummary(requestedLane)
    : buildExpectedProductVerificationClaimSummary(
        requestedLane,
        fast,
        runtime,
        inferProductVerificationRuntimeMode(runtime, requestedLane),
        policyReport
      );
  return structurallyEqual(value, expected);
}

function exactCoverageEntry(value: unknown, accepted: ReadonlySet<string>): boolean {
  if (!exactKeys(value, ['id', 'declaredAcceptance', 'coveredBy', 'uncovered']) ||
    !exactString(value.id) || !exactUniqueStringArray(value.declaredAcceptance) ||
    !exactUniqueStringArray(value.coveredBy) || typeof value.uncovered !== 'boolean') {
    return false;
  }
  const declared = new Set(value.declaredAcceptance);
  if (value.coveredBy.some((id) => !declared.has(id) || !accepted.has(id))) return false;
  return value.uncovered === (value.coveredBy.length === 0);
}

function exactAcceptanceCoverage(value: unknown): value is AcceptanceCoverageReport {
  if (!exactKeys(value, [
    'formatVersion', 'status', 'acceptancePassed', 'blocks', 'slots',
    'uncoveredBlocks', 'uncoveredSlots'
  ]) || value.formatVersion !== '1' || !exactVerificationStatus(value.status) ||
    !exactUniqueStringArray(value.acceptancePassed) ||
    !Array.isArray(value.blocks) || !Array.isArray(value.slots) ||
    !exactUniqueStringArray(value.uncoveredBlocks) || !exactUniqueStringArray(value.uncoveredSlots)) {
    return false;
  }
  const accepted = new Set(value.acceptancePassed);
  if (!value.blocks.every((entry) => exactCoverageEntry(entry, accepted)) ||
    !value.slots.every((entry) => exactCoverageEntry(entry, accepted))) {
    return false;
  }
  const report = value as unknown as AcceptanceCoverageReport;
  return uniqueStrings(report.blocks.map((entry) => entry.id)) &&
    uniqueStrings(report.slots.map((entry) => entry.id)) &&
    structurallyEqual(
      report.uncoveredBlocks,
      report.blocks.filter((entry) => entry.uncovered).map((entry) => entry.id)
    ) && structurallyEqual(
      report.uncoveredSlots,
      report.slots.filter((entry) => entry.uncovered).map((entry) => entry.id)
    );
}

function exactVerificationReport(value: unknown): value is VerificationReport {
  if (!exactKeys(value, [
    'build', 'unit', 'acceptance', 'policy', 'fast', 'runtime', 'summary', 'logs'
  ]) || !exactFastVerificationReport(value.fast) ||
    !exactRuntimeVerificationReport(value.runtime) || !exactLogs(value.logs)) {
    return false;
  }
  const summary = value.summary;
  // Current production authorization requires the claim-bound protocol. A
  // no-claimSummary legacy report may remain readable elsewhere as diagnostic
  // data, but it cannot authorize pipeline or Semantic Mutation PASS/FAIL.
  if (!exactKeys(summary, ['status', 'requestedLane', 'failedLanes', 'claimSummary']) ||
    (summary.status !== 'passed' && summary.status !== 'failed') ||
    summary.requestedLane !== 'all' ||
    !exactUniqueStringArray(summary.failedLanes) ||
    !summary.failedLanes.every((lane) => lane === 'fast' || lane === 'runtime')) {
    return false;
  }
  const report = value as unknown as VerificationReport;
  const blocked = blockedPhysicalProfile(report);
  if (!exactVerificationClaimSummary(
    summary.claimSummary,
    summary.requestedLane,
    report.fast,
    report.runtime,
    report.fast.policyReport as PolicyReport,
    blocked
  )) return false;

  const failedLanes = [
    ...(report.fast.status === 'failed' ? ['fast' as const] : []),
    ...(report.runtime.status === 'failed' ? ['runtime' as const] : [])
  ];
  const expectedSummaryStatus = report.summary.claimSummary!.overall.overallStatus === 'passed'
    ? 'passed'
    : 'failed';
  const expectedLogs = {
    stdout: [report.fast.logs.stdout, report.runtime.logs.stdout].filter(Boolean).join('\n'),
    stderr: [report.fast.logs.stderr, report.runtime.logs.stderr].filter(Boolean).join('\n')
  };
  return structurallyEqual(report.build, report.fast.build) &&
    structurallyEqual(report.unit, report.fast.unit) &&
    structurallyEqual(report.acceptance, report.fast.acceptance) &&
    structurallyEqual(report.policy, report.fast.policy) &&
    structurallyEqual(report.logs, expectedLogs) &&
    report.summary.status === expectedSummaryStatus &&
    structurallyEqual(report.summary.failedLanes, failedLanes);
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
  return structurallyEqual(report.runtime, input.runtimeReport) &&
    structurallyEqual(report.fast.policyReport, input.policyReport) &&
    structurallyEqual(report.policy, {
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
