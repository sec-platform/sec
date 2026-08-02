import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { PolicyReport } from './policy-types.ts';
import {
  CodexDevelopmentAggregateVerificationClaimsV1,
  CodexDevelopmentAssertVerificationGateResultV1,
  type VerificationAggregateResultV1,
  type VerificationClaimDefinitionV1,
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

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    uniqueStrings(left) && uniqueStrings(right) &&
    left.every((value) => right.includes(value));
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

function exactVerificationClaimResultShape(value: unknown): value is VerificationClaimResultV1 {
  return exactKeys(value, [
    'claimId', 'status', 'reasonCode', 'contributingGateIds', 'coverageComplete'
  ]) && typeof value.claimId === 'string' && value.claimId.length > 0 &&
    typeof value.status === 'string' && typeof value.reasonCode === 'string' &&
    exactStringArray(value.contributingGateIds) &&
    uniqueStrings(value.contributingGateIds) &&
    typeof value.coverageComplete === 'boolean';
}

function exactVerificationAggregateShape(value: unknown): value is VerificationAggregateResultV1 {
  return exactKeys(value, ['overallStatus', 'overallReasonCode', 'claimResults']) &&
    typeof value.overallStatus === 'string' && typeof value.overallReasonCode === 'string' &&
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

function environmentKey(gate: VerificationGateResultV1): string | null {
  return gate.environment ? `${gate.environment.os}-${gate.environment.arch}` : null;
}

function deriveClaimDefinitions(
  claimResults: readonly VerificationClaimResultV1[],
  gates: readonly VerificationGateResultV1[]
): VerificationClaimDefinitionV1[] | null {
  const claimIds = new Set(claimResults.map((claim) => claim.claimId));
  const definitions: VerificationClaimDefinitionV1[] = [];

  for (const gate of gates) {
    if (!uniqueStrings(gate.requiredForClaims) ||
      !uniqueStrings(gate.supportedClaims) ||
      gate.requiredForClaims.length === 0 ||
      gate.requiredForClaims.some((claimId) => !claimIds.has(claimId)) ||
      gate.supportedClaims.some((claimId) => (
        !claimIds.has(claimId) || !gate.requiredForClaims.includes(claimId)
      ))) {
      return null;
    }
  }

  for (const claim of claimResults) {
    const requiredGates = gates.filter((gate) => gate.requiredForClaims.includes(claim.claimId));
    const requiredGateIds = requiredGates.map((gate) => gate.gateId);
    if (requiredGateIds.length === 0 ||
      !sameStringSet(requiredGateIds, claim.contributingGateIds)) {
      return null;
    }
    const owningEnvironments = requiredGates
      .map(environmentKey)
      .filter((value): value is string => value !== null)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => left.localeCompare(right));
    definitions.push({
      claimId: claim.claimId,
      requiredGateIds,
      owningEnvironments
    });
  }

  return definitions;
}

function sameClaimResult(
  actual: VerificationClaimResultV1,
  expected: VerificationClaimResultV1
): boolean {
  return actual.claimId === expected.claimId &&
    actual.status === expected.status &&
    actual.reasonCode === expected.reasonCode &&
    actual.coverageComplete === expected.coverageComplete &&
    sameStringSet(actual.contributingGateIds, expected.contributingGateIds);
}

function sameAggregateResult(
  actual: VerificationAggregateResultV1,
  expected: VerificationAggregateResultV1
): boolean {
  return actual.overallStatus === expected.overallStatus &&
    actual.overallReasonCode === expected.overallReasonCode &&
    actual.claimResults.length === expected.claimResults.length &&
    actual.claimResults.every((claim, index) => (
      sameClaimResult(claim, expected.claimResults[index]!)
    ));
}

function exactVerificationClaimSummary(value: unknown): value is VerificationClaimSummary {
  if (!exactKeys(value, ['overall', 'gates']) ||
    !exactVerificationAggregateShape(value.overall) ||
    !Array.isArray(value.gates) || value.gates.length === 0 ||
    !value.gates.every(exactVerificationGateResult)) {
    return false;
  }

  const summary = value as unknown as VerificationClaimSummary;
  const gates = [...summary.gates];
  if (!uniqueStrings(gates.map((gate) => gate.gateId))) return false;

  const claims = deriveClaimDefinitions(summary.overall.claimResults, gates);
  if (claims === null) return false;

  const canonical = CodexDevelopmentAggregateVerificationClaimsV1({
    claims,
    gateResults: gates
  });
  return sameAggregateResult(summary.overall, canonical);
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
