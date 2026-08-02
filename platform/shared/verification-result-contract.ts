/**
 * Canonical Verification Result contract.
 *
 * Status, disposition and applicability are orthogonal. Aggregate truth is
 * claim-based, owning-environment-aware, order-independent and fail-closed.
 */

export const VERIFICATION_GATE_RESULT_SCHEMA_V1 = 'sec-verification-gate-result-v1' as const;

export type VerificationResultStatus =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated';

export type VerificationDisposition = 'executed' | 'reused' | 'not-executed';

export type VerificationApplicability =
  | 'required'
  | 'optional'
  | 'not-applicable'
  | 'unresolved';

export type VerificationReasonCode =
  | 'executed-success'
  | 'executed-failure'
  | 'not-applicable'
  | 'fail-fast-prerequisite-failed'
  | 'current-runner-not-owning-environment'
  | 'not-dispatched'
  | 'required-artifact-missing'
  | 'capability-unsupported'
  | 'platform-unsupported'
  | 'selection-unresolved'
  | 'input-invalidated'
  | 'evidence-stale'
  | 'superseded-revision'
  | 'cancelled'
  | 'timeout'
  | 'cleanup-failed'
  | 'process-settlement-failed';

export interface VerificationGateExecutionV1 {
  argv: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  outputDigest: string;
  failureFingerprint: string | null;
}

export interface VerificationGateEnvironmentV1 {
  runtime: string;
  os: string;
  arch: string;
  filesystem: string | null;
  capabilities: string[];
  toolchainRevision: string;
  providerRevisions: string[];
}

export interface VerificationGateResultV1 {
  schema: typeof VERIFICATION_GATE_RESULT_SCHEMA_V1;
  gateId: string;
  gateRevision: string;
  owner: string;
  requirementKey: string;
  subjectRevision: string;
  inputDigest: string;
  applicability: VerificationApplicability;
  status: VerificationResultStatus;
  disposition: VerificationDisposition;
  reasonCode: VerificationReasonCode;
  requiredForClaims: string[];
  supportedClaims: string[];
  environment: VerificationGateEnvironmentV1 | null;
  execution: VerificationGateExecutionV1 | null;
  evidenceRefs: string[];
  invalidationRules: string[];
  diagnostic: string | null;
}

export interface VerificationClaimDefinitionV1 {
  claimId: string;
  requiredGateIds: string[];
  /** Accepted owning execution identities in canonical `os-arch` form. */
  owningEnvironments: string[];
}

export interface VerificationClaimResultV1 {
  claimId: string;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  contributingGateIds: string[];
  coverageComplete: boolean;
}

export interface VerificationAggregateResultV1 {
  overallStatus: VerificationResultStatus;
  overallReasonCode: VerificationReasonCode;
  claimResults: VerificationClaimResultV1[];
}

const REASON_CODES: readonly VerificationReasonCode[] = [
  'executed-success',
  'executed-failure',
  'not-applicable',
  'fail-fast-prerequisite-failed',
  'current-runner-not-owning-environment',
  'not-dispatched',
  'required-artifact-missing',
  'capability-unsupported',
  'platform-unsupported',
  'selection-unresolved',
  'input-invalidated',
  'evidence-stale',
  'superseded-revision',
  'cancelled',
  'timeout',
  'cleanup-failed',
  'process-settlement-failed'
];

const REASON_CODE_SET: ReadonlySet<string> = new Set(REASON_CODES);
const PASSED_REASONS = new Set<VerificationReasonCode>(['executed-success']);
const FAILED_REASONS = new Set<VerificationReasonCode>([
  'executed-failure', 'timeout', 'cleanup-failed', 'process-settlement-failed'
]);
const NOT_RUN_REASONS = new Set<VerificationReasonCode>([
  'not-applicable',
  'fail-fast-prerequisite-failed',
  'current-runner-not-owning-environment',
  'not-dispatched',
  'required-artifact-missing'
]);
const UNSUPPORTED_REASONS = new Set<VerificationReasonCode>([
  'capability-unsupported', 'platform-unsupported'
]);
const INVALIDATED_REASONS = new Set<VerificationReasonCode>([
  'selection-unresolved', 'input-invalidated', 'evidence-stale',
  'superseded-revision', 'cancelled'
]);
const RESULT_STATUSES = new Set<VerificationResultStatus>([
  'passed', 'failed', 'not-run', 'unsupported', 'invalidated'
]);
const DISPOSITIONS = new Set<VerificationDisposition>([
  'executed', 'reused', 'not-executed'
]);
const APPLICABILITIES = new Set<VerificationApplicability>([
  'required', 'optional', 'not-applicable', 'unresolved'
]);

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields: ${actual.join(', ')}; expected: ${wanted.join(', ')}.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be a non-empty control-character-free string.`);
  }
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertString(value, label);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((entry, index) => assertString(entry, `${label}[${index}]`));
}

function assertUniqueStringArray(value: unknown, label: string): asserts value is string[] {
  assertStringArray(value, label);
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must not contain duplicate values.`);
  }
}

function assertEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): asserts value is T {
  assertString(value, label);
  if (!allowed.has(value as T)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(', ')}; received: ${value}.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
}

const GATE_RESULT_KEYS = [
  'schema', 'gateId', 'gateRevision', 'owner', 'requirementKey', 'subjectRevision',
  'inputDigest', 'applicability', 'status', 'disposition', 'reasonCode',
  'requiredForClaims', 'supportedClaims', 'environment', 'execution',
  'evidenceRefs', 'invalidationRules', 'diagnostic'
] as const;
const ENVIRONMENT_KEYS = [
  'runtime', 'os', 'arch', 'filesystem', 'capabilities', 'toolchainRevision',
  'providerRevisions'
] as const;
const EXECUTION_KEYS = [
  'argv', 'startedAt', 'finishedAt', 'durationMs', 'exitCode', 'outputDigest',
  'failureFingerprint'
] as const;

function assertEnvironment(value: unknown, label: string): asserts value is VerificationGateEnvironmentV1 | null {
  if (value === null) return;
  assertObject(value, label);
  assertExactKeys(value, ENVIRONMENT_KEYS, label);
  assertString(value.runtime, `${label}.runtime`);
  assertString(value.os, `${label}.os`);
  assertString(value.arch, `${label}.arch`);
  assertNullableString(value.filesystem, `${label}.filesystem`);
  assertUniqueStringArray(value.capabilities, `${label}.capabilities`);
  assertString(value.toolchainRevision, `${label}.toolchainRevision`);
  assertUniqueStringArray(value.providerRevisions, `${label}.providerRevisions`);
}

function assertExecution(value: unknown, label: string): asserts value is VerificationGateExecutionV1 | null {
  if (value === null) return;
  assertObject(value, label);
  assertExactKeys(value, EXECUTION_KEYS, label);
  assertStringArray(value.argv, `${label}.argv`);
  assertIsoDate(value.startedAt, `${label}.startedAt`);
  assertIsoDate(value.finishedAt, `${label}.finishedAt`);
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) {
    throw new Error(`${label}.durationMs must be a non-negative integer.`);
  }
  if (value.exitCode !== null && (!Number.isInteger(value.exitCode) || (value.exitCode as number) < 0)) {
    throw new Error(`${label}.exitCode must be null or a non-negative integer.`);
  }
  assertDigest(value.outputDigest, `${label}.outputDigest`);
  assertNullableString(value.failureFingerprint, `${label}.failureFingerprint`);
}

export function CodexDevelopmentAssertVerificationGateResultV1(
  value: unknown
): asserts value is VerificationGateResultV1 {
  const label = 'verification gate result';
  assertObject(value, label);
  assertExactKeys(value, GATE_RESULT_KEYS, label);
  if (value.schema !== VERIFICATION_GATE_RESULT_SCHEMA_V1) {
    throw new Error(`${label}.schema must be ${VERIFICATION_GATE_RESULT_SCHEMA_V1}.`);
  }
  assertString(value.gateId, `${label}.gateId`);
  assertString(value.gateRevision, `${label}.gateRevision`);
  assertString(value.owner, `${label}.owner`);
  assertString(value.requirementKey, `${label}.requirementKey`);
  assertString(value.subjectRevision, `${label}.subjectRevision`);
  assertDigest(value.inputDigest, `${label}.inputDigest`);
  assertEnum(value.applicability, APPLICABILITIES, `${label}.applicability`);
  assertEnum(value.status, RESULT_STATUSES, `${label}.status`);
  assertEnum(value.disposition, DISPOSITIONS, `${label}.disposition`);
  assertEnum(value.reasonCode, REASON_CODE_SET as ReadonlySet<VerificationReasonCode>, `${label}.reasonCode`);
  assertUniqueStringArray(value.requiredForClaims, `${label}.requiredForClaims`);
  assertUniqueStringArray(value.supportedClaims, `${label}.supportedClaims`);
  assertEnvironment(value.environment, `${label}.environment`);
  assertExecution(value.execution, `${label}.execution`);
  assertUniqueStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  assertUniqueStringArray(value.invalidationRules, `${label}.invalidationRules`);
  assertNullableString(value.diagnostic, `${label}.diagnostic`);

  const status = value.status;
  const disposition = value.disposition;
  const applicability = value.applicability;
  const reasonCode = value.reasonCode;

  if (status === 'passed' && !PASSED_REASONS.has(reasonCode)) {
    throw new Error(`${label} passed status requires reasonCode executed-success.`);
  }
  if (status === 'failed' && !FAILED_REASONS.has(reasonCode)) {
    throw new Error(`${label} failed status requires an execution-failure reasonCode.`);
  }
  if (status === 'not-run' && !NOT_RUN_REASONS.has(reasonCode)) {
    throw new Error(`${label} not-run status requires a not-run reasonCode.`);
  }
  if (status === 'unsupported' && !UNSUPPORTED_REASONS.has(reasonCode)) {
    throw new Error(`${label} unsupported status requires capability-unsupported or platform-unsupported.`);
  }
  if (status === 'invalidated' && !INVALIDATED_REASONS.has(reasonCode)) {
    throw new Error(`${label} invalidated status requires an invalidation reasonCode.`);
  }

  if (status === 'passed' && disposition === 'not-executed') {
    throw new Error(`${label} passed status cannot pair with not-executed disposition.`);
  }
  if (status === 'failed' && disposition !== 'executed') {
    throw new Error(`${label} failed status requires executed disposition.`);
  }
  if (status === 'not-run' && disposition !== 'not-executed') {
    throw new Error(`${label} not-run status requires not-executed disposition.`);
  }
  if (disposition === 'reused' && status !== 'passed') {
    throw new Error(`${label} reused disposition requires passed status.`);
  }

  if (disposition === 'executed') {
    if (value.execution === null) {
      throw new Error(`${label} executed disposition requires non-null execution.`);
    }
    if (value.environment === null) {
      throw new Error(`${label} executed disposition requires non-null environment.`);
    }
  }
  if (disposition === 'reused') {
    if (value.evidenceRefs.length === 0) {
      throw new Error(`${label} reused disposition requires non-empty evidenceRefs.`);
    }
    if (value.environment === null) {
      throw new Error(`${label} reused disposition requires non-null environment identity.`);
    }
    if (value.execution !== null) {
      throw new Error(`${label} reused disposition must have null execution.`);
    }
  }
  if (disposition === 'not-executed' && value.execution !== null) {
    throw new Error(`${label} not-executed disposition must have null execution.`);
  }

  if (applicability === 'unresolved' && status !== 'invalidated') {
    throw new Error(`${label} unresolved applicability requires invalidated status.`);
  }
  if (applicability === 'not-applicable' && status !== 'not-run') {
    throw new Error(`${label} not-applicable applicability requires not-run status.`);
  }

  if (value.supportedClaims.some((claimId) => !value.requiredForClaims.includes(claimId))) {
    throw new Error(`${label}.supportedClaims must be a subset of requiredForClaims.`);
  }
  if (status === 'passed' && value.requiredForClaims.some(
    (claimId) => !value.supportedClaims.includes(claimId)
  )) {
    throw new Error(`${label} passed status must support every required claim.`);
  }
  if (status !== 'passed' && value.supportedClaims.length > 0) {
    throw new Error(`${label} non-passed status cannot support claims.`);
  }
}

export interface VerificationGateResultBuilderInput {
  gateId: string;
  gateRevision: string;
  owner: string;
  requirementKey: string;
  subjectRevision: string;
  inputDigest: string;
  applicability: VerificationApplicability;
  status: VerificationResultStatus;
  disposition: VerificationDisposition;
  reasonCode: VerificationReasonCode;
  requiredForClaims: string[];
  supportedClaims: string[];
  environment: VerificationGateEnvironmentV1 | null;
  execution: VerificationGateExecutionV1 | null;
  evidenceRefs: string[];
  invalidationRules: string[];
  diagnostic: string | null;
}

export function CodexDevelopmentBuildVerificationGateResultV1(
  input: VerificationGateResultBuilderInput
): VerificationGateResultV1 {
  const result: VerificationGateResultV1 = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...input
  };
  CodexDevelopmentAssertVerificationGateResultV1(result);
  return result;
}

export interface VerificationAggregateInputV1 {
  claims: readonly VerificationClaimDefinitionV1[];
  gateResults: readonly VerificationGateResultV1[];
  isCoverageComplete?: (
    claim: VerificationClaimDefinitionV1,
    contributingGates: VerificationGateResultV1[]
  ) => boolean;
}

const STATUS_PRIORITY: Readonly<Record<VerificationResultStatus, number>> = Object.freeze({
  passed: 0,
  'not-run': 1,
  unsupported: 2,
  invalidated: 3,
  failed: 4
});

function environmentKey(gate: VerificationGateResultV1): string | null {
  return gate.environment ? `${gate.environment.os}-${gate.environment.arch}` : null;
}

function observationKey(gate: VerificationGateResultV1): string {
  return `${gate.gateId}@${environmentKey(gate) ?? 'none'}`;
}

function isOwningObservation(
  claim: VerificationClaimDefinitionV1,
  gate: VerificationGateResultV1
): boolean {
  if (claim.owningEnvironments.length === 0) return gate.environment !== null;
  const key = environmentKey(gate);
  return key !== null && claim.owningEnvironments.includes(key);
}

function assertAggregateInput(input: VerificationAggregateInputV1): void {
  const claimIds = new Set<string>();
  for (const claim of input.claims) {
    assertString(claim.claimId, 'verification claim definition.claimId');
    assertUniqueStringArray(claim.requiredGateIds, `verification claim ${claim.claimId}.requiredGateIds`);
    assertUniqueStringArray(claim.owningEnvironments, `verification claim ${claim.claimId}.owningEnvironments`);
    if (claimIds.has(claim.claimId)) {
      throw new Error(`verification aggregate contains duplicate claimId ${claim.claimId}.`);
    }
    claimIds.add(claim.claimId);
  }

  const observationIds = new Set<string>();
  for (const gate of input.gateResults) {
    CodexDevelopmentAssertVerificationGateResultV1(gate);
    const key = observationKey(gate);
    if (observationIds.has(key)) {
      throw new Error(`verification aggregate contains duplicate gate observation ${key}.`);
    }
    observationIds.add(key);
  }
}

function defaultCoverageComplete(
  claim: VerificationClaimDefinitionV1,
  gates: VerificationGateResultV1[]
): boolean {
  const gateIds = new Set(gates.map((gate) => gate.gateId));
  if (gateIds.size !== claim.requiredGateIds.length ||
    claim.requiredGateIds.some((gateId) => !gateIds.has(gateId))) {
    return false;
  }
  return claim.requiredGateIds.every((gateId) => gates.some((gate) => (
    gate.gateId === gateId &&
    gate.status === 'passed' &&
    gate.requiredForClaims.includes(claim.claimId) &&
    gate.supportedClaims.includes(claim.claimId) &&
    isOwningObservation(claim, gate)
  )));
}

interface GateDecision {
  gateId: string;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  observations: VerificationGateResultV1[];
}

function decideRequiredGate(
  claim: VerificationClaimDefinitionV1,
  gateId: string,
  observations: VerificationGateResultV1[]
): GateDecision {
  if (observations.length === 0) {
    return { gateId, status: 'not-run', reasonCode: 'not-dispatched', observations };
  }
  if (observations.some((gate) => !gate.requiredForClaims.includes(claim.claimId))) {
    return { gateId, status: 'invalidated', reasonCode: 'selection-unresolved', observations };
  }

  const invalidated = observations
    .filter((gate) => gate.status === 'invalidated')
    .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode))[0];
  if (invalidated) {
    return {
      gateId,
      status: 'invalidated',
      reasonCode: invalidated.reasonCode,
      observations
    };
  }

  const owningPhysical = observations.filter((gate) => (
    (gate.disposition === 'executed' || gate.disposition === 'reused') &&
    isOwningObservation(claim, gate)
  ));
  const failed = owningPhysical
    .filter((gate) => gate.status === 'failed')
    .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode))[0];
  if (failed) {
    return { gateId, status: 'failed', reasonCode: failed.reasonCode, observations };
  }

  const unsupported = observations
    .filter((gate) => gate.status === 'unsupported')
    .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode))[0];
  if (unsupported) {
    return {
      gateId,
      status: 'unsupported',
      reasonCode: unsupported.reasonCode,
      observations
    };
  }

  const owningPassed = owningPhysical.filter((gate) => gate.status === 'passed');
  if (owningPassed.length > 0) {
    if (owningPassed.some((gate) => !gate.supportedClaims.includes(claim.claimId))) {
      return { gateId, status: 'invalidated', reasonCode: 'selection-unresolved', observations };
    }
    return { gateId, status: 'passed', reasonCode: 'executed-success', observations };
  }

  const notRun = observations
    .filter((gate) => gate.status === 'not-run')
    .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode))[0];
  if (notRun) {
    return { gateId, status: 'not-run', reasonCode: notRun.reasonCode, observations };
  }

  if (observations.some((gate) => gate.disposition !== 'not-executed')) {
    return {
      gateId,
      status: 'not-run',
      reasonCode: 'current-runner-not-owning-environment',
      observations
    };
  }

  return { gateId, status: 'invalidated', reasonCode: 'selection-unresolved', observations };
}

function chooseHighestStatus<T extends { status: VerificationResultStatus; reasonCode: VerificationReasonCode }>(
  values: readonly T[]
): T | null {
  return [...values].sort((left, right) => {
    const priority = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];
    if (priority !== 0) return priority;
    const reason = left.reasonCode.localeCompare(right.reasonCode);
    if (reason !== 0) return reason;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  })[0] ?? null;
}

function aggregateClaim(
  claim: VerificationClaimDefinitionV1,
  gateGroups: ReadonlyMap<string, VerificationGateResultV1[]>,
  isCoverageComplete: (
    claim: VerificationClaimDefinitionV1,
    gates: VerificationGateResultV1[]
  ) => boolean
): VerificationClaimResultV1 {
  const decisions = claim.requiredGateIds.map((gateId) =>
    decideRequiredGate(claim, gateId, gateGroups.get(gateId) ?? [])
  );
  const observations = decisions.flatMap((decision) => decision.observations);
  const contributingGateIds = [...new Set(observations.map((gate) => gate.gateId))]
    .sort((left, right) => left.localeCompare(right));
  const coverageComplete = isCoverageComplete(claim, observations);
  const decisive = chooseHighestStatus(decisions);

  if (!decisive) {
    return {
      claimId: claim.claimId,
      status: 'invalidated',
      reasonCode: 'selection-unresolved',
      contributingGateIds,
      coverageComplete: false
    };
  }
  if (decisive.status === 'passed' && !coverageComplete) {
    return {
      claimId: claim.claimId,
      status: 'invalidated',
      reasonCode: 'selection-unresolved',
      contributingGateIds,
      coverageComplete: false
    };
  }
  return {
    claimId: claim.claimId,
    status: decisive.status,
    reasonCode: decisive.reasonCode,
    contributingGateIds,
    coverageComplete
  };
}

export function CodexDevelopmentAggregateVerificationClaimsV1(
  input: VerificationAggregateInputV1
): VerificationAggregateResultV1 {
  assertAggregateInput(input);

  const gateGroups = new Map<string, VerificationGateResultV1[]>();
  for (const gate of input.gateResults) {
    const group = gateGroups.get(gate.gateId) ?? [];
    group.push(gate);
    gateGroups.set(gate.gateId, group);
  }

  const isCoverageComplete = input.isCoverageComplete ?? defaultCoverageComplete;
  const claimResults = input.claims
    .map((claim) => aggregateClaim(claim, gateGroups, isCoverageComplete))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));

  if (claimResults.length === 0) {
    return {
      overallStatus: 'passed',
      overallReasonCode: 'executed-success',
      claimResults
    };
  }

  const decisive = chooseHighestStatus(claimResults)!;
  return {
    overallStatus: decisive.status,
    overallReasonCode: decisive.reasonCode,
    claimResults
  };
}

export interface ProductVerificationMappingContext {
  requestedLane: 'fast' | 'runtime' | 'all';
  lane: 'fast' | 'runtime';
  fastFailed?: boolean;
  currentRunnerOwning?: boolean;
}

export interface LegacyMappingResult {
  status: VerificationResultStatus;
  disposition: VerificationDisposition;
  reasonCode: VerificationReasonCode;
}

export function mapProductVerificationStatus(
  status: 'passed' | 'failed' | 'skipped',
  context: ProductVerificationMappingContext
): LegacyMappingResult {
  if (status === 'passed') {
    return { status: 'passed', disposition: 'executed', reasonCode: 'executed-success' };
  }
  if (status === 'failed') {
    return { status: 'failed', disposition: 'executed', reasonCode: 'executed-failure' };
  }
  if (context.fastFailed && context.lane === 'runtime') {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'fail-fast-prerequisite-failed'
    };
  }
  if (context.currentRunnerOwning === false) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'current-runner-not-owning-environment'
    };
  }
  const laneRequested = context.requestedLane === 'all' || context.requestedLane === context.lane;
  if (!laneRequested) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'not-applicable'
    };
  }
  return {
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved'
  };
}

export function mapCiEvidenceV2Status(
  status: 'passed' | 'failed' | 'not-run',
  notRunReason: string | null
): LegacyMappingResult {
  if (status === 'passed') {
    return { status: 'passed', disposition: 'executed', reasonCode: 'executed-success' };
  }
  if (status === 'failed') {
    return { status: 'failed', disposition: 'executed', reasonCode: 'executed-failure' };
  }
  const lower = (notRunReason ?? '').toLowerCase();
  if (lower.includes('not-applicable') || lower.includes('not applicable')) {
    return { status: 'not-run', disposition: 'not-executed', reasonCode: 'not-applicable' };
  }
  if (lower.includes('prerequisite') || lower.includes('fail-fast')) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'fail-fast-prerequisite-failed'
    };
  }
  if (lower.includes('owning') || lower.includes('environment')) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'current-runner-not-owning-environment'
    };
  }
  if (lower.includes('artifact')) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'required-artifact-missing'
    };
  }
  return {
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved'
  };
}

export interface SemanticMutationMappingContext {
  blockedReason?:
    | 'capability'
    | 'authorization'
    | 'precondition'
    | 'plan-changed'
    | 'not-reached'
    | 'unknown';
}

export function mapSemanticMutationBlocked(
  status: 'passed' | 'failed' | 'blocked',
  context: SemanticMutationMappingContext
): LegacyMappingResult {
  if (status === 'passed') {
    return { status: 'passed', disposition: 'executed', reasonCode: 'executed-success' };
  }
  if (status === 'failed') {
    return { status: 'failed', disposition: 'executed', reasonCode: 'executed-failure' };
  }
  switch (context.blockedReason) {
    case 'capability':
      return {
        status: 'unsupported',
        disposition: 'not-executed',
        reasonCode: 'capability-unsupported'
      };
    case 'authorization':
    case 'precondition':
      return {
        status: 'failed',
        disposition: 'executed',
        reasonCode: 'executed-failure'
      };
    case 'not-reached':
      return {
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'fail-fast-prerequisite-failed'
      };
    case 'plan-changed':
      return {
        status: 'invalidated',
        disposition: 'not-executed',
        reasonCode: 'input-invalidated'
      };
    case 'unknown':
    default:
      return {
        status: 'invalidated',
        disposition: 'not-executed',
        reasonCode: 'selection-unresolved'
      };
  }
}

export interface EvidenceDispositionMappingResult {
  disposition: VerificationDisposition;
  note: string;
}

export function mapEvidenceDisposition(
  disposition: 'executed' | 'reused' | 'delta'
): EvidenceDispositionMappingResult {
  switch (disposition) {
    case 'executed':
      return {
        disposition: 'executed',
        note: 'Scope ran fresh in this gate.'
      };
    case 'reused':
      return {
        disposition: 'reused',
        note: 'Scope bound to trusted Evidence; result status must still be passed.'
      };
    case 'delta':
      return {
        disposition: 'not-executed',
        note: 'Delta scope requires a fresh refining gate; not a completion status.'
      };
  }
}
