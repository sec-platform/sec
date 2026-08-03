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
  /** Canonical identities returned by CodexDevelopmentVerificationEnvironmentIdentityV1. */
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

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(
      `${label} has unknown or missing fields: ${actual.join(', ')}; expected: ${wanted.join(', ')}.`
    );
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

function assertEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): asserts value is T {
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

function assertEnvironment(
  value: unknown,
  label: string
): asserts value is VerificationGateEnvironmentV1 | null {
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

function assertExecution(
  value: unknown,
  label: string
): asserts value is VerificationGateExecutionV1 | null {
  if (value === null) return;
  assertObject(value, label);
  assertExactKeys(value, EXECUTION_KEYS, label);
  assertStringArray(value.argv, `${label}.argv`);
  assertIsoDate(value.startedAt, `${label}.startedAt`);
  assertIsoDate(value.finishedAt, `${label}.finishedAt`);
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) {
    throw new Error(`${label}.durationMs must be a non-negative integer.`);
  }
  if (
    value.exitCode !== null
    && (!Number.isInteger(value.exitCode) || (value.exitCode as number) < 0)
  ) {
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
  assertEnum(
    value.reasonCode,
    REASON_CODE_SET as ReadonlySet<VerificationReasonCode>,
    `${label}.reasonCode`
  );
  assertUniqueStringArray(value.requiredForClaims, `${label}.requiredForClaims`);
  assertUniqueStringArray(value.supportedClaims, `${label}.supportedClaims`);
  assertEnvironment(value.environment, `${label}.environment`);
  assertExecution(value.execution, `${label}.execution`);
  assertUniqueStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  assertUniqueStringArray(value.invalidationRules, `${label}.invalidationRules`);
  assertNullableString(value.diagnostic, `${label}.diagnostic`);

  const result = value as unknown as VerificationGateResultV1;
  const status = result.status;
  const disposition = result.disposition;
  const applicability = result.applicability;
  const reasonCode = result.reasonCode;

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
    throw new Error(
      `${label} unsupported status requires capability-unsupported or platform-unsupported.`
    );
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
  if (disposition === 'executed' && (result.execution === null || result.environment === null)) {
    throw new Error(`${label} executed disposition requires execution and environment.`);
  }
  if (disposition === 'reused') {
    if (result.evidenceRefs.length === 0 || result.environment === null) {
      throw new Error(`${label} reused disposition requires Evidence and environment identity.`);
    }
    if (result.execution !== null) {
      throw new Error(`${label} reused disposition must have null execution.`);
    }
  }
  if (disposition === 'not-executed' && result.execution !== null) {
    throw new Error(`${label} not-executed disposition must have null execution.`);
  }
  if (applicability === 'unresolved' && status !== 'invalidated') {
    throw new Error(`${label} unresolved applicability requires invalidated status.`);
  }
  if (applicability === 'not-applicable' && status !== 'not-run') {
    throw new Error(`${label} not-applicable applicability requires not-run status.`);
  }
  if (result.supportedClaims.some((claimId) => !result.requiredForClaims.includes(claimId))) {
    throw new Error(`${label}.supportedClaims must be a subset of requiredForClaims.`);
  }
  if (
    status === 'passed'
    && result.requiredForClaims.some((claimId) => !result.supportedClaims.includes(claimId))
  ) {
    throw new Error(`${label} passed status must support every required claim.`);
  }
  if (status !== 'passed' && result.supportedClaims.length > 0) {
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

export function CodexDevelopmentVerificationEnvironmentIdentityV1(
  os: string,
  arch: string
): string {
  assertString(os, 'verification environment os');
  assertString(arch, 'verification environment arch');
  return JSON.stringify([os, arch]);
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

function environmentIdentity(gate: VerificationGateResultV1): string | null {
  return gate.environment === null
    ? null
    : CodexDevelopmentVerificationEnvironmentIdentityV1(
        gate.environment.os,
        gate.environment.arch
      );
}

function observationIdentity(gate: VerificationGateResultV1): string {
  return JSON.stringify([gate.gateId, environmentIdentity(gate)]);
}

function logicalProofIdentity(gate: VerificationGateResultV1): string {
  return JSON.stringify({
    gateRevision: gate.gateRevision,
    owner: gate.owner,
    requirementKey: gate.requirementKey,
    subjectRevision: gate.subjectRevision,
    inputDigest: gate.inputDigest,
    requiredForClaims: [...gate.requiredForClaims].sort(),
    invalidationRules: [...gate.invalidationRules].sort()
  });
}

function observationAppliesToClaim(
  claim: VerificationClaimDefinitionV1,
  gate: VerificationGateResultV1
): boolean {
  if (gate.environment === null) {
    return gate.disposition === 'not-executed';
  }
  if (claim.owningEnvironments.length === 0) return true;
  return claim.owningEnvironments.includes(environmentIdentity(gate)!);
}

function assertAggregateInput(input: VerificationAggregateInputV1): void {
  const claimIds = new Set<string>();
  for (const claim of input.claims) {
    assertString(claim.claimId, 'verification claim definition.claimId');
    assertUniqueStringArray(
      claim.requiredGateIds,
      `verification claim ${claim.claimId}.requiredGateIds`
    );
    if (claim.requiredGateIds.length === 0) {
      throw new Error(`verification claim ${claim.claimId}.requiredGateIds must not be empty.`);
    }
    assertUniqueStringArray(
      claim.owningEnvironments,
      `verification claim ${claim.claimId}.owningEnvironments`
    );
    if (claimIds.has(claim.claimId)) {
      throw new Error(`verification aggregate contains duplicate claimId ${claim.claimId}.`);
    }
    claimIds.add(claim.claimId);
  }

  const observations = new Set<string>();
  for (const gate of input.gateResults) {
    CodexDevelopmentAssertVerificationGateResultV1(gate);
    const observation = observationIdentity(gate);
    if (observations.has(observation)) {
      throw new Error(`verification aggregate contains duplicate gate observation ${observation}.`);
    }
    observations.add(observation);
  }
}

function defaultCoverageComplete(
  claim: VerificationClaimDefinitionV1,
  gates: VerificationGateResultV1[]
): boolean {
  return claim.requiredGateIds.every((gateId) => gates.some((gate) => (
    gate.gateId === gateId
    && gate.status === 'passed'
    && gate.requiredForClaims.includes(claim.claimId)
    && gate.supportedClaims.includes(claim.claimId)
    && observationAppliesToClaim(claim, gate)
  )));
}

interface GateDecision {
  gateId: string;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  observations: VerificationGateResultV1[];
}

interface StatusDecision {
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
}

function chooseHighestStatus<
  T extends { status: VerificationResultStatus; reasonCode: VerificationReasonCode }
>(values: readonly T[]): T | null {
  return [...values].sort((left, right) => {
    const priority = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status];
    if (priority !== 0) return priority;
    return left.reasonCode < right.reasonCode ? -1 : left.reasonCode > right.reasonCode ? 1 : 0;
  })[0] ?? null;
}

function observationDecision(
  claim: VerificationClaimDefinitionV1,
  gate: VerificationGateResultV1
): StatusDecision {
  if (!gate.requiredForClaims.includes(claim.claimId)) {
    return { status: 'invalidated', reasonCode: 'selection-unresolved' };
  }
  if (gate.status === 'passed' && !gate.supportedClaims.includes(claim.claimId)) {
    return { status: 'invalidated', reasonCode: 'selection-unresolved' };
  }
  return { status: gate.status, reasonCode: gate.reasonCode };
}

function decideRequiredGate(
  claim: VerificationClaimDefinitionV1,
  gateId: string,
  observations: VerificationGateResultV1[]
): GateDecision {
  if (observations.length === 0) {
    return { gateId, status: 'not-run', reasonCode: 'not-dispatched', observations: [] };
  }

  const applicable = observations.filter((gate) => observationAppliesToClaim(claim, gate));
  if (applicable.length === 0) {
    return {
      gateId,
      status: 'not-run',
      reasonCode: 'current-runner-not-owning-environment',
      observations: []
    };
  }

  const decisions: StatusDecision[] = applicable.map((gate) =>
    observationDecision(claim, gate)
  );
  if (new Set(applicable.map(logicalProofIdentity)).size > 1) {
    decisions.push({ status: 'invalidated', reasonCode: 'selection-unresolved' });
  }

  const decisive = chooseHighestStatus(decisions);
  if (!decisive) {
    return {
      gateId,
      status: 'invalidated',
      reasonCode: 'selection-unresolved',
      observations: applicable
    };
  }
  return {
    gateId,
    status: decisive.status,
    reasonCode: decisive.reasonCode,
    observations: applicable
  };
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
  const contributingGateIds = [...new Set(observations.map((gate) => gate.gateId))].sort();
  const coverageComplete = isCoverageComplete(claim, observations);
  const decisive = chooseHighestStatus(decisions);

  if (!decisive || (decisive.status === 'passed' && !coverageComplete)) {
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
  if (input.claims.length === 0) {
    return {
      overallStatus: 'invalidated',
      overallReasonCode: 'selection-unresolved',
      claimResults: []
    };
  }

  const gateGroups = new Map<string, VerificationGateResultV1[]>();
  for (const gate of input.gateResults) {
    const group = gateGroups.get(gate.gateId) ?? [];
    group.push(gate);
    gateGroups.set(gate.gateId, group);
  }

  const isCoverageComplete = input.isCoverageComplete ?? defaultCoverageComplete;
  const claimResults = input.claims
    .map((claim) => aggregateClaim(claim, gateGroups, isCoverageComplete))
    .sort((left, right) => (
      left.claimId < right.claimId ? -1 : left.claimId > right.claimId ? 1 : 0
    ));
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
  const laneRequested =
    context.requestedLane === 'all' || context.requestedLane === context.lane;
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
