/**
 * Verification Result Core Contract v1
 *
 * Unified verification result model for the SEC platform. This contract establishes
 * the single source of truth for verification result status, execution disposition,
 * applicability, reason codes, gate result schema, claim-based aggregate algorithm,
 * and legacy mapping helpers.
 *
 * Slice 1 of Issue #176 (verification-result-truth). Pure additive: does NOT modify
 * any runner/CI/Product writer. All legacy models map into this contract; lossy
 * mappings surface as unresolved/invalidated rather than silently promoting to passed.
 *
 * Authority: docs/work-packages/verification-result-core-v1.md
 * Census: Issue #176 census v0.2
 */

export const VERIFICATION_GATE_RESULT_SCHEMA_V1 = 'sec-verification-gate-result-v1' as const;

/**
 * Canonical verification result status. Replaces the fragmented vocabularies:
 * - product `passed | failed | skipped`
 * - CI evidence `passed | failed | not-run`
 * - semantic mutation `passed | failed | blocked`
 * - lock pass-state `succeeded | failed | pending`
 *
 * `skipped` and `blocked` are retired. "Did not execute" is `not-run` with a
 * reasonCode; "cannot execute on this environment" is `unsupported`; "result was
 * valid but inputs changed" is `invalidated`.
 */
export type VerificationResultStatus =
  | 'passed'
  | 'failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated';

/**
 * How a gate's coverage was satisfied. Orthogonal to status:
 * - `executed`: ran fresh in this gate
 * - `reused`: bound to trusted Evidence (status must still be `passed`)
 * - `not-executed`: no physical execution and no reuse
 *
 * Note: `reused` is NOT a sixth status — it is a disposition that pairs with `passed`.
 */
export type VerificationDisposition = 'executed' | 'reused' | 'not-executed';

/**
 * Whether a gate/claim applies to the current subject. Determined by Gate/Impact/
 * Target/Platform contract, NOT by runners guessing from "no tests".
 */
export type VerificationApplicability =
  | 'required'
  | 'optional'
  | 'not-applicable'
  | 'unresolved';

/**
 * Stable reason codes for control flow. Free text is diagnostic only.
 *
 * Count: 17 (the Issue #176 census v0.2 list).
 */
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

/**
 * Execution evidence for a gate that physically ran. Null when the gate did not
 * execute. Timestamps and duration live here (Evidence), not in result identity.
 */
export interface VerificationGateExecutionV1 {
  argv: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  outputDigest: string;
  failureFingerprint: string | null;
}

/**
 * Environment identity bound to a gate execution. Required for platform ownership
 * claims (e.g., Windows AppContainer claim only supported by Windows owning result).
 */
export interface VerificationGateEnvironmentV1 {
  runtime: string;
  os: string;
  arch: string;
  filesystem: string | null;
  capabilities: string[];
  toolchainRevision: string;
  providerRevisions: string[];
}

/**
 * Canonical gate result. One gate may have multiple environment executions, but
 * claim policy specifies which environment is the owning Evidence.
 */
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

/**
 * Definition of a claim for the aggregate algorithm. A claim is a verifiable
 * statement supported by one or more required gates executing on owning environments.
 */
export interface VerificationClaimDefinitionV1 {
  claimId: string;
  requiredGateIds: string[];
  owningEnvironments: string[];
}

/**
 * Result of aggregating gates for a single claim.
 */
export interface VerificationClaimResultV1 {
  claimId: string;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  contributingGateIds: string[];
  coverageComplete: boolean;
}

/**
 * Overall aggregate result across all claims. The overall status is `passed` only
 * when every required claim is `passed`.
 */
export interface VerificationAggregateResultV1 {
  overallStatus: VerificationResultStatus;
  overallReasonCode: VerificationReasonCode;
  claimResults: VerificationClaimResultV1[];
}

// ---------------------------------------------------------------------------
// Reason code sets (for cross-field validation)
// ---------------------------------------------------------------------------

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

const PASSED_REASONS: ReadonlySet<string> = new Set(['executed-success']);
const FAILED_REASONS: ReadonlySet<string> = new Set([
  'executed-failure',
  'timeout',
  'cleanup-failed',
  'process-settlement-failed'
]);
const NOT_RUN_REASONS: ReadonlySet<string> = new Set([
  'not-applicable',
  'fail-fast-prerequisite-failed',
  'current-runner-not-owning-environment',
  'not-dispatched',
  'required-artifact-missing'
]);
const UNSUPPORTED_REASONS: ReadonlySet<string> = new Set([
  'capability-unsupported',
  'platform-unsupported'
]);
const INVALIDATED_REASONS: ReadonlySet<string> = new Set([
  'selection-unresolved',
  'input-invalidated',
  'evidence-stale',
  'superseded-revision',
  'cancelled'
]);

const RESULT_STATUSES: readonly VerificationResultStatus[] = [
  'passed', 'failed', 'not-run', 'unsupported', 'invalidated'
];
const DISPOSITIONS: readonly VerificationDisposition[] = [
  'executed', 'reused', 'not-executed'
];
const APPLICABILITIES: readonly VerificationApplicability[] = [
  'required', 'optional', 'not-applicable', 'unresolved'
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

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

function assertStringSet(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is string {
  assertString(value, label);
  if (!allowed.has(value)) {
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
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp.`);
}

// ---------------------------------------------------------------------------
// Gate result validator
// ---------------------------------------------------------------------------

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
  assertStringArray(value.capabilities, `${label}.capabilities`);
  assertString(value.toolchainRevision, `${label}.toolchainRevision`);
  assertStringArray(value.providerRevisions, `${label}.providerRevisions`);
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

/**
 * Validate the cross-field invariants of a VerificationGateResultV1:
 * - status/disposition/reasonCode/applicability combinations
 * - execution nullness matches disposition
 * - evidenceRefs required for reused disposition
 * - environment required for executed disposition
 */
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
  assertStringSet(value.applicability, new Set(APPLICABILITIES), `${label}.applicability`);
  assertStringSet(value.status, new Set(RESULT_STATUSES), `${label}.status`);
  assertStringSet(value.disposition, new Set(DISPOSITIONS), `${label}.disposition`);
  assertStringSet(value.reasonCode, REASON_CODE_SET, `${label}.reasonCode`);
  assertStringArray(value.requiredForClaims, `${label}.requiredForClaims`);
  assertStringArray(value.supportedClaims, `${label}.supportedClaims`);
  assertEnvironment(value.environment, `${label}.environment`);
  assertExecution(value.execution, `${label}.execution`);
  assertStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  assertStringArray(value.invalidationRules, `${label}.invalidationRules`);
  assertNullableString(value.diagnostic, `${label}.diagnostic`);

  // Cross-field invariants
  const status = value.status as VerificationResultStatus;
  const disposition = value.disposition as VerificationDisposition;
  const applicability = value.applicability as VerificationApplicability;
  const reasonCode = value.reasonCode as VerificationReasonCode;

  // status ↔ reasonCode
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

  // status ↔ disposition
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

  // disposition ↔ execution / environment
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
    if (value.execution !== null) {
      throw new Error(`${label} reused disposition must have null execution.`);
    }
  }
  if (disposition === 'not-executed' && value.execution !== null) {
    throw new Error(`${label} not-executed disposition must have null execution.`);
  }

  // applicability ↔ status
  if (applicability === 'unresolved' && status !== 'invalidated') {
    throw new Error(`${label} unresolved applicability requires invalidated status.`);
  }
  if (applicability === 'not-applicable' && status !== 'not-run') {
    throw new Error(`${label} not-applicable applicability requires not-run status.`);
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

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

/**
 * Build a VerificationGateResultV1 from typed input. Validates the result before
 * returning. Use this instead of constructing the object literal directly to
 * guarantee cross-field invariants.
 */
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

// ---------------------------------------------------------------------------
// Aggregate algorithm (6-step, claim-based)
// ---------------------------------------------------------------------------

export interface VerificationAggregateInputV1 {
  claims: readonly VerificationClaimDefinitionV1[];
  gateResults: readonly VerificationGateResultV1[];
  /**
   * Callback to determine whether coverage is complete for a claim given its
   * contributing gates. Defaults to "all required gates are present and passed/reused".
   * Callers with richer coverage semantics (e.g., scope inventory) should override.
   */
  isCoverageComplete?: (
    claim: VerificationClaimDefinitionV1,
    contributingGates: VerificationGateResultV1[]
  ) => boolean;
}

function defaultCoverageComplete(
  claim: VerificationClaimDefinitionV1,
  contributingGates: VerificationGateResultV1[]
): boolean {
  // Default: all required gates must be present and passed/reused.
  if (contributingGates.length !== claim.requiredGateIds.length) return false;
  return contributingGates.every((gate) => gate.status === 'passed');
}

/**
 * Aggregate gate results into per-claim results and an overall status.
 *
 * 6-step algorithm (per claim):
 * 1. Resolve required gates and owning environments.
 * 2. Any required gate failed → claim failed.
 * 3. No failed but invalidated/unresolved → claim invalidated.
 * 4. No above but owning required gate unsupported → claim unsupported.
 * 5. No above but owning required gate not-run/missing → claim not-run.
 * 6. All required gates passed/reused with coverage complete → claim passed.
 *
 * Overall: `passed` only when every required claim is `passed`.
 */
export function CodexDevelopmentAggregateVerificationClaimsV1(
  input: VerificationAggregateInputV1
): VerificationAggregateResultV1 {
  const gateMap = new Map<string, VerificationGateResultV1>();
  for (const gate of input.gateResults) {
    gateMap.set(gate.gateId, gate);
  }
  const isCoverageComplete = input.isCoverageComplete ?? defaultCoverageComplete;
  const claimResults: VerificationClaimResultV1[] = input.claims.map((claim) => {
    const contributingGates = claim.requiredGateIds
      .map((id) => gateMap.get(id))
      .filter((gate): gate is VerificationGateResultV1 => gate !== undefined);
    return aggregateClaim(claim, contributingGates, isCoverageComplete);
  });

  // Overall: passed only when every required claim is passed.
  // Priority: failed (immediate break) > invalidated > unsupported > not-run > passed.
  // Once a non-passed status is set, it is never downgraded (except to failed which breaks).
  let overallStatus: VerificationResultStatus = 'passed';
  let overallReasonCode: VerificationReasonCode = 'executed-success';
  for (const result of claimResults) {
    if (result.status === 'failed') {
      overallStatus = 'failed';
      overallReasonCode = 'executed-failure';
      break;
    }
    if (overallStatus !== 'passed') continue; // already at a higher priority non-passed status
    if (result.status === 'invalidated') {
      overallStatus = 'invalidated';
      overallReasonCode = result.reasonCode;
    } else if (result.status === 'unsupported') {
      overallStatus = 'unsupported';
      overallReasonCode = result.reasonCode;
    } else if (result.status === 'not-run') {
      overallStatus = 'not-run';
      overallReasonCode = result.reasonCode;
    }
  }
  return { overallStatus, overallReasonCode, claimResults };
}

function aggregateClaim(
  claim: VerificationClaimDefinitionV1,
  contributingGates: VerificationGateResultV1[],
  isCoverageComplete: (
    claim: VerificationClaimDefinitionV1,
    gates: VerificationGateResultV1[]
  ) => boolean
): VerificationClaimResultV1 {
  const coverageComplete = isCoverageComplete(claim, contributingGates);

  // Step 2: any required gate failed → claim failed
  const failedGate = contributingGates.find((gate) => gate.status === 'failed');
  if (failedGate) {
    return {
      claimId: claim.claimId,
      status: 'failed',
      reasonCode: failedGate.reasonCode,
      contributingGateIds: contributingGates.map((gate) => gate.gateId),
      coverageComplete
    };
  }

  // Step 3: no failed but invalidated/unresolved → claim invalidated
  const invalidatedGate = contributingGates.find((gate) => gate.status === 'invalidated');
  if (invalidatedGate) {
    return {
      claimId: claim.claimId,
      status: 'invalidated',
      reasonCode: invalidatedGate.reasonCode,
      contributingGateIds: contributingGates.map((gate) => gate.gateId),
      coverageComplete
    };
  }

  // Step 4: owning required gate unsupported → claim unsupported
  const unsupportedGate = contributingGates.find((gate) => gate.status === 'unsupported');
  if (unsupportedGate) {
    return {
      claimId: claim.claimId,
      status: 'unsupported',
      reasonCode: unsupportedGate.reasonCode,
      contributingGateIds: contributingGates.map((gate) => gate.gateId),
      coverageComplete
    };
  }

  // Step 5: owning required gate not-run/missing → claim not-run
  const notRunGate = contributingGates.find((gate) => gate.status === 'not-run');
  const hasMissing = contributingGates.length < claim.requiredGateIds.length;
  if (notRunGate || hasMissing) {
    return {
      claimId: claim.claimId,
      status: 'not-run',
      reasonCode: notRunGate?.reasonCode ?? 'not-dispatched',
      contributingGateIds: contributingGates.map((gate) => gate.gateId),
      coverageComplete
    };
  }

  // Step 6: all passed/reused with coverage complete → claim passed
  if (coverageComplete) {
    return {
      claimId: claim.claimId,
      status: 'passed',
      reasonCode: 'executed-success',
      contributingGateIds: contributingGates.map((gate) => gate.gateId),
      coverageComplete
    };
  }

  // Coverage incomplete → invalidated (selection-unresolved)
  return {
    claimId: claim.claimId,
    status: 'invalidated',
    reasonCode: 'selection-unresolved',
    contributingGateIds: contributingGates.map((gate) => gate.gateId),
    coverageComplete
  };
}

// ---------------------------------------------------------------------------
// Legacy mapping helpers
// ---------------------------------------------------------------------------

/**
 * Context for mapping product `VerificationStatus` (passed/failed/skipped) to the
 * unified model. `skipped` is ambiguous and requires context to resolve.
 */
export interface ProductVerificationMappingContext {
  /** The lane that was requested. */
  requestedLane: 'fast' | 'runtime' | 'all';
  /** The lane this status belongs to. */
  lane: 'fast' | 'runtime';
  /** Whether the fast lane failed (causing runtime to be skipped). */
  fastFailed?: boolean;
  /** Whether the current runner is the owning environment for this lane. */
  currentRunnerOwning?: boolean;
}

export interface LegacyMappingResult {
  status: VerificationResultStatus;
  disposition: VerificationDisposition;
  reasonCode: VerificationReasonCode;
}

/**
 * Map product `VerificationStatus` (passed/failed/skipped) to the unified model.
 *
 * `skipped` is the ambiguous legacy state. It maps to `not-run` with a reasonCode
 * determined by context:
 * - fast failed → `fail-fast-prerequisite-failed`
 * - current runner not owning → `current-runner-not-owning-environment`
 * - lane not requested → `not-applicable`
 *
 * If context is insufficient to disambiguate, maps to `invalidated` with
 * `selection-unresolved` (lossy, never silently promoted to passed).
 */
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
  // status === 'skipped' — disambiguate by context
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
  // Lane not requested → not-applicable
  const laneRequested =
    context.requestedLane === 'all' ||
    context.requestedLane === context.lane;
  if (!laneRequested) {
    return {
      status: 'not-run',
      disposition: 'not-executed',
      reasonCode: 'not-applicable'
    };
  }
  // Insufficient context → lossy, surface as invalidated
  return {
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved'
  };
}

/**
 * Map CI evidence V2 status (passed/failed/not-run) to the unified model.
 * V2 `not-run` carries a `notRunReason` text; if it matches a known reason,
 * map to the corresponding reasonCode; otherwise `selection-unresolved`.
 */
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
  // status === 'not-run' — try to recover reasonCode from notRunReason text
  const reason = notRunReason ?? '';
  const lower = reason.toLowerCase();
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
  // Lossy: cannot determine exact reason
  return {
    status: 'invalidated',
    disposition: 'not-executed',
    reasonCode: 'selection-unresolved'
  };
}

/**
 * Context for mapping semantic mutation `blocked` status.
 * Semantic mutation uses `passed | failed | blocked` where `blocked` conflates
 * multiple distinct conditions.
 */
export interface SemanticMutationMappingContext {
  /** Why the mutation was blocked. */
  blockedReason?:
    | 'capability' // capability/owning platform not supported
    | 'authorization' // authorization/precondition failed
    | 'precondition' // precondition failed
    | 'plan-changed' // plan/input already changed
    | 'not-reached' // not reached due to prior failure
    | 'unknown';
}

/**
 * Map semantic mutation status (passed/failed/blocked) to the unified model.
 * `blocked` is disambiguated by `blockedReason`:
 * - capability → unsupported
 * - authorization/precondition → failed
 * - not-reached → not-run
 * - plan-changed → invalidated
 * - unknown → invalidated (lossy)
 */
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
  // status === 'blocked'
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
      // Lossy: cannot determine exact reason
      return {
        status: 'invalidated',
        disposition: 'not-executed',
        reasonCode: 'selection-unresolved'
      };
  }
}

/**
 * Map evidence composition disposition (executed/reused/delta) to the unified
 * execution plan disposition. Note: this is NOT a result status — `delta` means
 * "a fresh delta gate needs to execute", not "completed".
 */
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
        note: 'Scope bound to trusted legacy Evidence; result status must still be passed.'
      };
    case 'delta':
      return {
        disposition: 'not-executed',
        note: 'Delta scope requires a fresh refining gate; not a completion status.'
      };
  }
}
