import { acceptanceIdsProvenByVerificationReportsV1 } from './acceptance-proof-contract.ts';
import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { PolicyReport } from './policy-types.ts';
import { buildProductVerificationClaimPlan } from './product-verification-claim-plan.ts';
import {
  CodexDevelopmentAssertVerificationAggregateResultV1,
  CodexDevelopmentSnapshotVerificationDataV1,
  CodexDevelopmentVerificationDataEqualV1
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

export type CurrentCanonicalVerificationReport = Omit<VerificationReport, 'summary'> & {
  summary: Omit<VerificationReport['summary'], 'claimSummary'> & {
    claimSummary: VerificationClaimSummary;
  };
};

export interface CanonicalVerificationArtifactSet {
  readonly verificationReport: CurrentCanonicalVerificationReport;
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

function exactVerificationClaimSummary(value: unknown): value is VerificationClaimSummary {
  if (!exactKeys(value, ['overall', 'gates']) || !Array.isArray(value.gates)) {
    return false;
  }
  try {
    CodexDevelopmentAssertVerificationAggregateResultV1(value.overall, {
      claims: buildProductVerificationClaimPlan('all'),
      gateResults: value.gates
    });
    return true;
  } catch {
    return false;
  }
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
  return CodexDevelopmentVerificationDataEqualV1(report.build, report.fast.build) &&
    CodexDevelopmentVerificationDataEqualV1(report.unit, report.fast.unit) &&
    CodexDevelopmentVerificationDataEqualV1(report.acceptance, report.fast.acceptance) &&
    CodexDevelopmentVerificationDataEqualV1(report.policy, report.fast.policy) &&
    CodexDevelopmentVerificationDataEqualV1(report.logs, expectedLogs) &&
    report.summary.status === expectedSummaryStatus &&
    CodexDevelopmentVerificationDataEqualV1(report.summary.failedLanes, failedLanes);
}

function exactCurrentCanonicalVerificationReport(
  value: unknown
): value is CurrentCanonicalVerificationReport {
  return exactVerificationReport(value) && value.summary.claimSummary !== undefined;
}

function exactCoverageEntry(value: unknown, accepted: ReadonlySet<string>): boolean {
  if (!exactKeys(value, ['id', 'declaredAcceptance', 'coveredBy', 'uncovered']) ||
    typeof value.id !== 'string' || !exactStringArray(value.declaredAcceptance) ||
    !exactStringArray(value.coveredBy) || typeof value.uncovered !== 'boolean') {
    return false;
  }
  const declared = value.declaredAcceptance as string[];
  const coveredBy = value.coveredBy as string[];
  return coveredBy.every((id) => declared.includes(id) && accepted.has(id)) &&
    value.uncovered === (declared.length === 0 || coveredBy.length !== declared.length);
}

function exactAcceptanceCoverage(
  value: unknown,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): value is AcceptanceCoverageReport {
  if (!exactKeys(value, [
    'formatVersion', 'status', 'acceptancePassed', 'blocks', 'slots',
    'uncoveredBlocks', 'uncoveredSlots'
  ]) || value.formatVersion !== '1' || !exactVerificationStatus(value.status) ||
    !exactStringArray(value.acceptancePassed) || !Array.isArray(value.blocks) ||
    !Array.isArray(value.slots) || !exactStringArray(value.uncoveredBlocks) ||
    !exactStringArray(value.uncoveredSlots)) {
    return false;
  }
  const report = value as unknown as AcceptanceCoverageReport;
  const declaredAcceptance = [...new Set([
    ...report.blocks.flatMap((entry) => entry.declaredAcceptance),
    ...report.slots.flatMap((entry) => entry.declaredAcceptance)
  ])].sort();
  const expectedAccepted = acceptanceIdsProvenByVerificationReportsV1(
    fast,
    runtime,
    declaredAcceptance
  );
  if (!CodexDevelopmentVerificationDataEqualV1(report.acceptancePassed, expectedAccepted)) {
    return false;
  }
  const accepted = new Set(report.acceptancePassed);
  if (!report.blocks.every((entry) => exactCoverageEntry(entry, accepted)) ||
    !report.slots.every((entry) => exactCoverageEntry(entry, accepted))) {
    return false;
  }
  if (new Set(report.blocks.map((entry) => entry.id)).size !== report.blocks.length ||
    new Set(report.slots.map((entry) => entry.id)).size !== report.slots.length) {
    return false;
  }
  return CodexDevelopmentVerificationDataEqualV1(
    report.uncoveredBlocks,
    report.blocks.filter((entry) => entry.uncovered).map((entry) => entry.id)
  ) && CodexDevelopmentVerificationDataEqualV1(
    report.uncoveredSlots,
    report.slots.filter((entry) => entry.uncovered).map((entry) => entry.id)
  );
}

export function isCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): input is CanonicalVerificationArtifactSet {
  let candidate: VerificationArtifactSet;
  try {
    const snapshot = CodexDevelopmentSnapshotVerificationDataV1(
      input,
      'verification artifact set'
    );
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    candidate = snapshot as unknown as VerificationArtifactSet;
  } catch {
    return false;
  }
  if (!exactCurrentCanonicalVerificationReport(candidate.verificationReport) ||
    !exactRuntimeVerificationReport(candidate.runtimeReport) ||
    !exactPolicyReport(candidate.policyReport) ||
    !exactAcceptanceCoverage(
      candidate.acceptanceCoverage,
      candidate.verificationReport.fast,
      candidate.verificationReport.runtime
    )) {
    return false;
  }
  const report = candidate.verificationReport;
  return CodexDevelopmentVerificationDataEqualV1(report.runtime, candidate.runtimeReport) &&
    CodexDevelopmentVerificationDataEqualV1(report.fast.policyReport, candidate.policyReport) &&
    CodexDevelopmentVerificationDataEqualV1(report.policy, {
      status: candidate.policyReport.status,
      violations: candidate.policyReport.violations
    }) && candidate.acceptanceCoverage.status === candidate.runtimeReport.status;
}

export function assertCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): asserts input is CanonicalVerificationArtifactSet {
  if (!isCanonicalVerificationArtifactSet(input)) {
    throw new Error('Pipeline completion Verification artifacts do not match the exact canonical schema');
  }
}
