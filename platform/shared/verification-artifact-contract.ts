import { validateAcceptanceCoverageReportV1 } from './acceptance-coverage-authority.ts';
import { acceptanceIdsProvenByVerificationReportsV1 } from './acceptance-proof-contract.ts';
import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import { canonicalEquals } from './canonical-primitives.ts';
import { uniqueSorted } from './collections.ts';
import { validatePolicyReportV1 } from './policy-report-authority.ts';
import type { PolicyReport } from './policy-types.ts';
import {
  buildBlockedProductVerificationClaimSummary,
  buildExpectedProductVerificationClaimSummary,
  inferProductVerificationRuntimeMode
} from './product-verification-profile.ts';
import {
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
  return actual.length === canonicalExpected.length && actual.every((key, index) => key === canonicalExpected[index]);
}

function exactCanonicalStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    return false;
  }
  return canonicalEquals(value, uniqueSorted(value as string[]));
}

function exactVerificationStatus(value: unknown): value is VerificationStatus {
  return value === 'passed' || value === 'failed' || value === 'skipped';
}

function exactLogs(value: unknown): boolean {
  return exactKeys(value, ['stdout', 'stderr']) &&
    typeof value.stdout === 'string' && typeof value.stderr === 'string';
}

function validatedPolicyReport(value: unknown): PolicyReport | null {
  try {
    return validatePolicyReportV1(value);
  } catch {
    return null;
  }
}

function validatedAcceptanceCoverage(value: unknown): AcceptanceCoverageReport | null {
  try {
    return validateAcceptanceCoverageReportV1(value);
  } catch {
    return null;
  }
}

function exactFastVerificationReport(value: unknown): value is FastVerificationLaneReport {
  if (!exactKeys(value, ['status', 'build', 'unit', 'acceptance', 'policy', 'policyReport', 'logs']) ||
      !exactVerificationStatus(value.status) ||
      !exactKeys(value.build, ['status']) || !exactVerificationStatus(value.build.status) ||
      !exactKeys(value.unit, ['status', 'passed']) || !exactVerificationStatus(value.unit.status) ||
      !exactCanonicalStringArray(value.unit.passed) ||
      !exactKeys(value.acceptance, ['status', 'passed', 'failed']) ||
      !exactVerificationStatus(value.acceptance.status) ||
      !exactCanonicalStringArray(value.acceptance.passed) || !exactCanonicalStringArray(value.acceptance.failed) ||
      !exactKeys(value.policy, ['status', 'violations']) ||
      !exactVerificationStatus(value.policy.status) || !Array.isArray(value.policy.violations) ||
      !exactLogs(value.logs)) {
    return false;
  }
  const policyReport = validatedPolicyReport(value.policyReport);
  return policyReport !== null && CodexDevelopmentVerificationDataEqualV1(value.policy, {
    status: policyReport.status,
    violations: structuredClone(policyReport.violations)
  });
}

function exactVerificationStep(value: unknown): boolean {
  return exactKeys(value, ['status', 'passed', 'failed', 'command']) &&
    exactVerificationStatus(value.status) && exactCanonicalStringArray(value.passed) &&
    exactCanonicalStringArray(value.failed) && (value.command === null || typeof value.command === 'string');
}

function exactRuntimeVerificationReport(value: unknown): value is RuntimeVerificationLaneReport {
  return exactKeys(value, ['status', 'build', 'unit', 'acceptance', 'logs']) &&
    exactVerificationStatus(value.status) && exactVerificationStep(value.build) &&
    exactVerificationStep(value.unit) && exactVerificationStep(value.acceptance) && exactLogs(value.logs);
}

function blockedPhysicalProfile(report: Pick<VerificationReport, 'fast' | 'runtime' | 'summary'>): boolean {
  return report.summary.status === 'failed' &&
    report.summary.failedLanes.length === 1 && report.summary.failedLanes[0] === 'fast' &&
    report.fast.status === 'failed' && report.fast.build.status === 'skipped' &&
    report.fast.unit.status === 'skipped' && report.fast.acceptance.status === 'skipped' &&
    report.runtime.status === 'skipped';
}

function exactVerificationClaimSummary(
  value: unknown,
  requestedLane: VerificationReport['summary']['requestedLane'],
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  policyReport: PolicyReport,
  acceptanceCoverage: AcceptanceCoverageReport,
  blocked: boolean
): value is VerificationClaimSummary {
  if (!exactKeys(value, ['overall', 'gates']) || !Array.isArray(value.gates)) return false;
  const expected = blocked
    ? buildBlockedProductVerificationClaimSummary(requestedLane)
    : buildExpectedProductVerificationClaimSummary(
        requestedLane,
        fast,
        runtime,
        inferProductVerificationRuntimeMode(runtime, requestedLane),
        policyReport,
        acceptanceCoverage
      );
  return CodexDevelopmentVerificationDataEqualV1(value, expected);
}

function exactVerificationReport(
  value: unknown,
  acceptanceCoverage: AcceptanceCoverageReport
): value is VerificationReport {
  if (!exactKeys(value, ['build', 'unit', 'acceptance', 'policy', 'fast', 'runtime', 'summary', 'logs']) ||
      !exactFastVerificationReport(value.fast) || !exactRuntimeVerificationReport(value.runtime) || !exactLogs(value.logs)) {
    return false;
  }
  const policyReport = validatedPolicyReport(value.fast.policyReport);
  if (policyReport === null) return false;

  const rawSummary = value.summary;
  if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) return false;
  const summary = rawSummary as Record<string, unknown>;
  const summaryHasClaim = exactKeys(summary, ['status', 'requestedLane', 'failedLanes', 'claimSummary']);
  const summaryIsLegacy = exactKeys(summary, ['status', 'requestedLane', 'failedLanes']);
  if ((!summaryHasClaim && !summaryIsLegacy) ||
      (summary.status !== 'passed' && summary.status !== 'failed') ||
      summary.requestedLane !== 'all' || !Array.isArray(summary.failedLanes) ||
      !summary.failedLanes.every((lane) => lane === 'fast' || lane === 'runtime') ||
      (summaryHasClaim && !exactVerificationClaimSummary(
        summary.claimSummary,
        summary.requestedLane,
        value.fast,
        value.runtime,
        policyReport,
        acceptanceCoverage,
        blockedPhysicalProfile(value as unknown as VerificationReport)
      ))) {
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
  value: unknown,
  acceptanceCoverage: AcceptanceCoverageReport
): value is CurrentCanonicalVerificationReport {
  return exactVerificationReport(value, acceptanceCoverage) &&
    (value as VerificationReport).summary.claimSummary !== undefined;
}

function exactAcceptanceCoverage(
  value: unknown,
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): value is AcceptanceCoverageReport {
  const report = validatedAcceptanceCoverage(value);
  if (report === null) return false;
  const declaredAcceptance = [...new Set([
    ...report.blocks.flatMap((entry) => entry.declaredAcceptance),
    ...report.slots.flatMap((entry) => entry.declaredAcceptance)
  ])].sort();
  const expectedAccepted = acceptanceIdsProvenByVerificationReportsV1(fast, runtime, declaredAcceptance);
  const accepted = new Set(report.acceptancePassed);
  return CodexDevelopmentVerificationDataEqualV1(
    structuredClone(report.acceptancePassed),
    expectedAccepted
  ) &&
    report.blocks.every((entry) => entry.coveredBy.every((id) => accepted.has(id))) &&
    report.slots.every((entry) => entry.coveredBy.every((id) => accepted.has(id)));
}

export function isCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): input is CanonicalVerificationArtifactSet {
  let candidate: VerificationArtifactSet;
  try {
    const snapshot = CodexDevelopmentSnapshotVerificationDataV1(input, 'verification artifact set');
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    candidate = snapshot as unknown as VerificationArtifactSet;
  } catch {
    return false;
  }

  const acceptanceCoverage = validatedAcceptanceCoverage(candidate.acceptanceCoverage);
  const policyReport = validatedPolicyReport(candidate.policyReport);
  if (acceptanceCoverage === null || policyReport === null ||
      !exactCurrentCanonicalVerificationReport(candidate.verificationReport, acceptanceCoverage) ||
      !exactRuntimeVerificationReport(candidate.runtimeReport) ||
      !exactAcceptanceCoverage(
        candidate.acceptanceCoverage,
        candidate.verificationReport.fast,
        candidate.verificationReport.runtime
      )) {
    return false;
  }

  const reportPolicy = validatedPolicyReport(candidate.verificationReport.fast.policyReport);
  return reportPolicy !== null &&
    CodexDevelopmentVerificationDataEqualV1(candidate.verificationReport.runtime, candidate.runtimeReport) &&
    CodexDevelopmentVerificationDataEqualV1(
      structuredClone(reportPolicy),
      structuredClone(policyReport)
    ) &&
    CodexDevelopmentVerificationDataEqualV1(candidate.verificationReport.policy, {
      status: policyReport.status,
      violations: structuredClone(policyReport.violations)
    }) &&
    acceptanceCoverage.status === candidate.runtimeReport.status;
}

export function assertCanonicalVerificationArtifactSet(
  input: VerificationArtifactSet
): asserts input is CanonicalVerificationArtifactSet {
  if (!isCanonicalVerificationArtifactSet(input)) {
    throw new Error('Pipeline completion Verification artifacts do not match the exact canonical schema');
  }
}
