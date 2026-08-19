import { isProxy } from 'node:util/types';

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
// Strict verification-data boundary
// ---------------------------------------------------------------------------

type VerificationDataSnapshotV1 =
  | null
  | boolean
  | number
  | string
  | VerificationDataSnapshotV1[]
  | { [key: string]: VerificationDataSnapshotV1 };

type OrdinaryDataDescriptor = PropertyDescriptor & { value: unknown };

const VERIFICATION_PROXY_ERROR = 'Verification data must not contain Proxy values.';

function assertNotVerificationProxy(value: unknown): void {
  if (isProxy(value)) throw new Error(VERIFICATION_PROXY_ERROR);
}

function assertCanonicalVerificationDataPrototype(
  value: object,
  label: string,
  isArray: boolean
): void {
  const prototype = Object.getPrototypeOf(value) as object | null;
  const canonicalPrototype = isArray ? Array.prototype : Object.prototype;
  if (prototype !== canonicalPrototype) {
    throw new Error(
      `${label} must use the canonical ${isArray ? 'Array' : 'Object'} prototype.`
    );
  }

  // The candidate's immediate prototype identity is proven before any descriptor
  // operation can reach candidate-controlled prototype state. Never traverse a
  // candidate-supplied prototype chain: only the candidate and the two trusted
  // intrinsic prototypes are relevant to the supported ordinary-data shape.
  if (Object.getOwnPropertyDescriptor(value, 'toJSON') !== undefined ||
    (isArray && Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON') !== undefined) ||
    Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') !== undefined) {
    throw new Error(`${label} must not define or inherit toJSON.`);
  }
}

function ordinaryDataDescriptor(
  value: object,
  key: PropertyKey,
  label: string
): OrdinaryDataDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error(`${label} must be an ordinary own data field.`);
  }
  if (!descriptor.enumerable) {
    throw new Error(`${label} must be an enumerable own data field.`);
  }
  return descriptor as OrdinaryDataDescriptor;
}

function snapshotStrictVerificationData(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>
): VerificationDataSnapshotV1 {
  assertNotVerificationProxy(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} must contain only JSON-compatible data fields.`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must not contain a cycle.`);
  ancestors.add(value);
  try {
    const isArray = Array.isArray(value);
    assertCanonicalVerificationDataPrototype(value, label, isArray);
    if (isArray) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new Error(`${label} must not contain symbol fields.`);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
        lengthDescriptor.enumerable || lengthDescriptor.configurable ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw new Error(`${label}.length must be the canonical array length field.`);
      }
      const length = lengthDescriptor.value as number;
      if (ownKeys.length !== length + 1) {
        throw new Error(`${label} must be dense and contain no extra own fields.`);
      }
      const descriptors: OrdinaryDataDescriptor[] = [];
      for (let index = 0; index < length; index += 1) {
        descriptors.push(ordinaryDataDescriptor(value, String(index), `${label}[${index}]`));
      }
      const snapshot: VerificationDataSnapshotV1[] = [];
      for (let index = 0; index < length; index += 1) {
        snapshot.push(snapshotStrictVerificationData(
          descriptors[index]!.value,
          `${label}[${index}]`,
          ancestors
        ));
      }
      return snapshot;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new Error(`${label} must not contain symbol fields.`);
    }
    const descriptors = ownKeys.map((key) => ({
      key: key as string,
      descriptor: ordinaryDataDescriptor(value, key, `${label}.${String(key)}`)
    }));
    const snapshot: { [key: string]: VerificationDataSnapshotV1 } = {};
    for (const { key, descriptor } of descriptors) {
      Object.defineProperty(snapshot, key, {
        value: snapshotStrictVerificationData(descriptor.value, `${label}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Validate and snapshot one untrusted verification-data graph without invoking
 * candidate getters, array methods, or serialization hooks.
 */
export function CodexDevelopmentSnapshotVerificationDataV1(
  value: unknown,
  label: string = 'verification data'
): unknown {
  return snapshotStrictVerificationData(value, label, new WeakSet<object>());
}

function verificationDataSnapshotsEqual(
  left: VerificationDataSnapshotV1,
  right: VerificationDataSnapshotV1
): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const leftArray = left as VerificationDataSnapshotV1[];
    const rightArray = right as VerificationDataSnapshotV1[];
    if (leftArray.length !== rightArray.length) return false;
    for (let index = 0; index < leftArray.length; index += 1) {
      if (!verificationDataSnapshotsEqual(leftArray[index]!, rightArray[index]!)) return false;
    }
    return true;
  }
  const leftRecord = left as { [key: string]: VerificationDataSnapshotV1 };
  const rightRecord = right as { [key: string]: VerificationDataSnapshotV1 };
  const leftKeys = Reflect.ownKeys(leftRecord).map(String).sort();
  const rightKeys = Reflect.ownKeys(rightRecord).map(String).sort();
  if (leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false;
  }
  return leftKeys.every((key) => verificationDataSnapshotsEqual(leftRecord[key]!, rightRecord[key]!));
}

/** Compare two values only after both cross the same strict data boundary. */
export function CodexDevelopmentVerificationDataEqualV1(
  left: unknown,
  right: unknown
): boolean {
  const leftSnapshot = CodexDevelopmentSnapshotVerificationDataV1(
    left,
    'left verification data'
  ) as VerificationDataSnapshotV1;
  const rightSnapshot = CodexDevelopmentSnapshotVerificationDataV1(
    right,
    'right verification data'
  ) as VerificationDataSnapshotV1;
  return verificationDataSnapshotsEqual(leftSnapshot, rightSnapshot);
}

// ---------------------------------------------------------------------------
// Validation helpers (only consume strict snapshots)
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
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${label} must be a non-empty control-character-free string.`);
  }
}

function assertIdentity(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (value.trim() !== value) {
    throw new Error(`${label} must not have leading or trailing whitespace.`);
  }
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertString(value, label);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((entry, index) => assertString(entry, `${label}[${index}]`));
}

function assertUniqueIdentityArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const identities = new Set<string>();
  value.forEach((entry, index) => {
    assertIdentity(entry, `${label}[${index}]`);
    if (identities.has(entry)) {
      throw new Error(`${label} must not contain duplicate identity ${entry}.`);
    }
    identities.add(entry);
  });
}

function assertStringSet(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is string {
  assertString(value, label);
  if (!allowed.has(value)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(', ')}; received: ${value}.`);
  }
}

export function CodexDevelopmentAssertVerificationStatusReasonV1(
  statusValue: unknown,
  reasonCodeValue: unknown,
  label = 'Verification result'
): { status: VerificationResultStatus; reasonCode: VerificationReasonCode } {
  assertStringSet(statusValue, new Set(RESULT_STATUSES), `${label}.status`);
  assertStringSet(reasonCodeValue, REASON_CODE_SET, `${label}.reasonCode`);
  const status = statusValue as VerificationResultStatus;
  const reasonCode = reasonCodeValue as VerificationReasonCode;

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

  return { status, reasonCode };
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
  const candidate = CodexDevelopmentSnapshotVerificationDataV1(value, label);
  assertObject(candidate, label);
  assertExactKeys(candidate, GATE_RESULT_KEYS, label);
  if (candidate.schema !== VERIFICATION_GATE_RESULT_SCHEMA_V1) {
    throw new Error(`${label}.schema must be ${VERIFICATION_GATE_RESULT_SCHEMA_V1}.`);
  }
  assertIdentity(candidate.gateId, `${label}.gateId`);
  assertString(candidate.gateRevision, `${label}.gateRevision`);
  assertString(candidate.owner, `${label}.owner`);
  assertString(candidate.requirementKey, `${label}.requirementKey`);
  assertString(candidate.subjectRevision, `${label}.subjectRevision`);
  assertDigest(candidate.inputDigest, `${label}.inputDigest`);
  assertStringSet(candidate.applicability, new Set(APPLICABILITIES), `${label}.applicability`);
  assertStringSet(candidate.disposition, new Set(DISPOSITIONS), `${label}.disposition`);
  const { status, reasonCode } = CodexDevelopmentAssertVerificationStatusReasonV1(
    candidate.status,
    candidate.reasonCode,
    label
  );
  assertUniqueIdentityArray(candidate.requiredForClaims, `${label}.requiredForClaims`);
  assertUniqueIdentityArray(candidate.supportedClaims, `${label}.supportedClaims`);
  assertEnvironment(candidate.environment, `${label}.environment`);
  assertExecution(candidate.execution, `${label}.execution`);
  assertStringArray(candidate.evidenceRefs, `${label}.evidenceRefs`);
  assertStringArray(candidate.invalidationRules, `${label}.invalidationRules`);
  assertNullableString(candidate.diagnostic, `${label}.diagnostic`);

  // Cross-field invariants
  const disposition = candidate.disposition as VerificationDisposition;
  const applicability = candidate.applicability as VerificationApplicability;

  // status ↔ disposition
  if (status === 'passed' && disposition === 'not-executed') {
    throw new Error(`${label} passed status cannot pair with not-executed disposition.`);
  }
  if (status === 'failed' && disposition !== 'executed' && disposition !== 'reused') {
    throw new Error(`${label} failed status requires executed or reused disposition.`);
  }
  if (status === 'not-run' && disposition !== 'not-executed') {
    throw new Error(`${label} not-run status requires not-executed disposition.`);
  }
  if (disposition === 'reused' && status !== 'passed' && status !== 'failed') {
    throw new Error(`${label} reused disposition requires passed or failed status.`);
  }

  // disposition ↔ execution / environment
  if (disposition === 'executed') {
    if (candidate.execution === null) {
      throw new Error(`${label} executed disposition requires non-null execution.`);
    }
    if (candidate.environment === null) {
      throw new Error(`${label} executed disposition requires non-null environment.`);
    }
  }
  if (disposition === 'reused') {
    if (candidate.evidenceRefs.length === 0) {
      throw new Error(`${label} reused disposition requires non-empty evidenceRefs.`);
    }
    if (candidate.environment === null) {
      throw new Error(`${label} reused disposition requires a non-null environment identity.`);
    }
    if (candidate.execution !== null) {
      throw new Error(`${label} reused disposition must have null execution.`);
    }
  }
  if (disposition === 'not-executed' && candidate.execution !== null) {
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
  const snapshot = CodexDevelopmentSnapshotVerificationDataV1(
    input,
    'verification gate builder input'
  ) as VerificationGateResultBuilderInput;
  const result: VerificationGateResultV1 = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
    ...snapshot
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
   * applicable observations. Defaults to "every required gate has at least one
   * applicable passed observation with exact claim linkage".
   * Callers with richer coverage semantics (e.g., scope inventory) should override.
   */
  isCoverageComplete?: (
    claim: VerificationClaimDefinitionV1,
    observations: VerificationGateResultV1[]
  ) => boolean;
}

/**
 * Canonical owning-environment identity for one gate observation.
 *
 * The current projection is `<os>-<arch>`, byte-compatible with the product
 * claim plan already on `main`. Any future projection change must update every
 * producer of `owningEnvironments` in the same lockstep Work Package; the
 * aggregate treats the strings as opaque canonical identities and never parses
 * or reconstructs them.
 */
export function CodexDevelopmentVerificationEnvironmentIdentityV1(
  os: string,
  arch: string
): string {
  assertString(os, 'verification environment os');
  assertString(arch, 'verification environment arch');
  return `${os}-${arch}`;
}

/**
 * Order-independent status lattice: `failed > invalidated > unsupported >
 * not-run > passed`. Later observations never override earlier ones by
 * position; the highest competing status is decisive.
 */
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

/**
 * Logical proof identity binds gate revision, owner, requirement, subject,
 * input digest, sorted claim bindings and canonical invalidation rules. Two
 * owning observations with different proof identity cannot jointly authorize
 * a pass; the mixed identity is itself invalidated.
 */
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

/**
 * A gate observation applies to a claim only when its environment is one of the
 * claim's owning environments, or when it carries no environment and is
 * not-executed (a not-run/unsupported/invalidated observation is a legitimate
 * non-owning-agnostic fact). Non-owning observations never poison status or
 * proof identity for an owning claim.
 */
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

function snapshotVerificationAggregateInputV1(
  input: VerificationAggregateInputV1
): VerificationAggregateInputV1 {
  const label = 'verification aggregate input';
  assertNotVerificationProxy(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object.`);
  }
  assertCanonicalVerificationDataPrototype(input, label, false);
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new Error(`${label} must not contain symbol fields.`);
  }
  const actualKeys = (ownKeys as string[]).slice().sort();
  const expectedKeys = actualKeys.includes('isCoverageComplete')
    ? ['claims', 'gateResults', 'isCoverageComplete']
    : ['claims', 'gateResults'];
  const sortedExpectedKeys = expectedKeys.slice().sort();
  if (actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])) {
    throw new Error(
      `${label} has unknown or missing fields: ${actualKeys.join(', ')}; ` +
      `expected: ${sortedExpectedKeys.join(', ')}.`
    );
  }
  const claimsDescriptor = ordinaryDataDescriptor(input, 'claims', `${label}.claims`);
  const gatesDescriptor = ordinaryDataDescriptor(input, 'gateResults', `${label}.gateResults`);
  const coverageDescriptor = actualKeys.includes('isCoverageComplete')
    ? ordinaryDataDescriptor(input, 'isCoverageComplete', `${label}.isCoverageComplete`)
    : undefined;
  if (coverageDescriptor) assertNotVerificationProxy(coverageDescriptor.value);
  if (coverageDescriptor?.value !== undefined && typeof coverageDescriptor.value !== 'function') {
    throw new Error(`${label}.isCoverageComplete must be a function when present.`);
  }

  const claims = CodexDevelopmentSnapshotVerificationDataV1(
    claimsDescriptor.value,
    `${label}.claims`
  );
  if (!Array.isArray(claims)) throw new Error(`${label}.claims must be an array.`);
  const gateResults = CodexDevelopmentSnapshotVerificationDataV1(
    gatesDescriptor.value,
    `${label}.gateResults`
  );
  if (!Array.isArray(gateResults)) throw new Error(`${label}.gateResults must be an array.`);

  const claimPlan = new Map<string, VerificationClaimDefinitionV1>();
  claims.forEach((claim, index) => {
    const claimLabel = `${label}.claims[${index}]`;
    assertVerificationClaimDefinitionV1(claim, claimLabel);
    if (claimPlan.has(claim.claimId)) {
      throw new Error(`${label}.claims must not contain duplicate claimId ${claim.claimId}.`);
    }
    claimPlan.set(claim.claimId, claim);
  });

  const canonicalGates: VerificationGateResultV1[] = [];
  const gateMap = new Map<string, VerificationGateResultV1>();
  const observations = new Set<string>();
  gateResults.forEach((gateResult) => {
    CodexDevelopmentAssertVerificationGateResultV1(gateResult);
    const observation = observationIdentity(gateResult);
    if (observations.has(observation)) {
      throw new Error(
        `${label}.gateResults must not contain duplicate gate observation ${observation}.`
      );
    }
    observations.add(observation);
    if (!gateMap.has(gateResult.gateId)) {
      gateMap.set(gateResult.gateId, gateResult);
    }
    canonicalGates.push(gateResult);
  });

  for (const gate of canonicalGates) {
    for (const claimId of gate.requiredForClaims) {
      const selectedClaim = claimPlan.get(claimId);
      if (selectedClaim && !selectedClaim.requiredGateIds.includes(gate.gateId)) {
        throw new Error(
          `${label} gate ${gate.gateId} requiredForClaims linkage to ${claimId} ` +
          'is absent from the trusted claim plan.'
        );
      }
    }
  }
  for (const claim of claimPlan.values()) {
    for (const gateId of claim.requiredGateIds) {
      const gatesForGateId = canonicalGates.filter((gate) => gate.gateId === gateId);
      if (gatesForGateId.length === 0) continue;
      for (const gate of gatesForGateId) {
        if (!gate.requiredForClaims.includes(claim.claimId)) {
          throw new Error(
            `${label} required gate ${gateId} lacks requiredForClaims linkage to ${claim.claimId}.`
          );
        }
        if (gate.status === 'passed' && !gate.supportedClaims.includes(claim.claimId)) {
          throw new Error(
            `${label} passed required gate ${gateId} lacks supportedClaims linkage to ${claim.claimId}.`
          );
        }
      }
    }
  }

  const snapshot: VerificationAggregateInputV1 = {
    claims: claims as VerificationClaimDefinitionV1[],
    gateResults: canonicalGates
  };
  if (coverageDescriptor?.value !== undefined) {
    snapshot.isCoverageComplete = coverageDescriptor.value as NonNullable<
      VerificationAggregateInputV1['isCoverageComplete']
    >;
  }
  return snapshot;
}

function defaultCoverageComplete(
  claim: VerificationClaimDefinitionV1,
  observations: VerificationGateResultV1[]
): boolean {
  return claim.requiredGateIds.every((gateId) => observations.some((gate) => (
    gate.gateId === gateId
    && gate.status === 'passed'
    && gate.requiredForClaims.includes(claim.claimId)
    && gate.supportedClaims.includes(claim.claimId)
    && observationAppliesToClaim(claim, gate)
  )));
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

/**
 * Aggregate gate results into per-claim results and an overall status.
 *
 * Order-independent, owning-environment-aware lattice:
 * `failed > invalidated > unsupported > not-run > passed`.
 *
 * - Duplicate claim IDs and duplicate gate observations fail closed.
 * - Non-owning observations never change an owning claim's status.
 * - Mixed logical proof identity among owning observations invalidates the
 *   gate unless a real owning failure outranks it.
 * - Empty claims and empty required gates fail closed (`invalidated` /
 *   input rejection); no test truth can ever manufacture a `passed`.
 * - Claim results are emitted in deterministic claimId order so input order
 *   cannot change the canonical projection.
 */
export function CodexDevelopmentAggregateVerificationClaimsV1(
  input: VerificationAggregateInputV1
): VerificationAggregateResultV1 {
  const snapshot = snapshotVerificationAggregateInputV1(input);
  if (snapshot.claims.length === 0) {
    return {
      overallStatus: 'invalidated',
      overallReasonCode: 'selection-unresolved',
      claimResults: []
    };
  }

  const gateGroups = new Map<string, VerificationGateResultV1[]>();
  for (const gate of snapshot.gateResults) {
    const group = gateGroups.get(gate.gateId) ?? [];
    group.push(gate);
    gateGroups.set(gate.gateId, group);
  }

  const customCoverageComplete = snapshot.isCoverageComplete;
  const isCoverageComplete = (
    claim: VerificationClaimDefinitionV1,
    observations: VerificationGateResultV1[]
  ): boolean => {
    const builtInCoverageComplete = defaultCoverageComplete(claim, observations);
    if (!customCoverageComplete) return builtInCoverageComplete;
    const callbackClaim = CodexDevelopmentSnapshotVerificationDataV1(
      claim,
      'verification coverage callback claim'
    ) as VerificationClaimDefinitionV1;
    const callbackObservations = CodexDevelopmentSnapshotVerificationDataV1(
      observations,
      'verification coverage callback observations'
    ) as VerificationGateResultV1[];
    return builtInCoverageComplete &&
      customCoverageComplete(callbackClaim, callbackObservations) === true;
  };
  const claimResults = snapshot.claims
    .map((claim) => aggregateClaim(claim, gateGroups, isCoverageComplete))
    .sort((left, right) => (
      left.claimId < right.claimId ? -1 : left.claimId > right.claimId ? 1 : 0
    ));
  const decisive = chooseHighestStatus(claimResults);
  return {
    overallStatus: decisive?.status ?? 'invalidated',
    overallReasonCode: decisive?.reasonCode ?? 'selection-unresolved',
    claimResults
  };
}

function aggregateClaim(
  claim: VerificationClaimDefinitionV1,
  gateGroups: ReadonlyMap<string, VerificationGateResultV1[]>,
  isCoverageComplete: (
    claim: VerificationClaimDefinitionV1,
    observations: VerificationGateResultV1[]
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

// ---------------------------------------------------------------------------
// Aggregate result validator
// ---------------------------------------------------------------------------

const AGGREGATE_RESULT_KEYS = [
  'overallStatus', 'overallReasonCode', 'claimResults'
] as const;

const CLAIM_RESULT_KEYS = [
  'claimId', 'status', 'reasonCode', 'contributingGateIds', 'coverageComplete'
] as const;

const CLAIM_DEFINITION_KEYS = [
  'claimId', 'requiredGateIds', 'owningEnvironments'
] as const;

function assertVerificationClaimResultV1(
  value: unknown,
  label: string
): asserts value is VerificationClaimResultV1 {
  assertObject(value, label);
  assertExactKeys(value, CLAIM_RESULT_KEYS, label);
  assertIdentity(value.claimId, `${label}.claimId`);
  CodexDevelopmentAssertVerificationStatusReasonV1(value.status, value.reasonCode, label);
  assertUniqueIdentityArray(value.contributingGateIds, `${label}.contributingGateIds`);
  if (typeof value.coverageComplete !== 'boolean') {
    throw new Error(`${label}.coverageComplete must be a boolean.`);
  }
  if (value.status === 'passed' && !value.coverageComplete) {
    throw new Error(`${label} passed status requires coverageComplete=true.`);
  }
  if (value.status === 'passed' && value.contributingGateIds.length === 0) {
    throw new Error(`${label} passed status requires non-empty contributingGateIds.`);
  }
}

function assertVerificationClaimDefinitionV1(
  value: unknown,
  label: string
): asserts value is VerificationClaimDefinitionV1 {
  assertObject(value, label);
  assertExactKeys(value, CLAIM_DEFINITION_KEYS, label);
  assertIdentity(value.claimId, `${label}.claimId`);
  assertUniqueIdentityArray(value.requiredGateIds, `${label}.requiredGateIds`);
  assertUniqueIdentityArray(value.owningEnvironments, `${label}.owningEnvironments`);
  if (value.requiredGateIds.length === 0) {
    throw new Error(`${label}.requiredGateIds must not be empty.`);
  }
  if (value.owningEnvironments.length === 0) {
    throw new Error(`${label}.owningEnvironments must not be empty.`);
  }
}

/**
 * Assert one serialized aggregate against a trusted claim plan and gate set.
 * The serialized aggregate never selects its own claims: after validating the
 * plan and linkage, this assertion invokes the canonical writer and requires
 * exact serialized equality with that output.
 */
export function CodexDevelopmentAssertVerificationAggregateResultV1(
  value: unknown,
  input: VerificationAggregateInputV1
): asserts value is VerificationAggregateResultV1 {
  const label = 'verification aggregate result';
  const candidate = CodexDevelopmentSnapshotVerificationDataV1(value, label);
  assertObject(candidate, label);
  assertExactKeys(candidate, AGGREGATE_RESULT_KEYS, label);
  CodexDevelopmentAssertVerificationStatusReasonV1(
    candidate.overallStatus,
    candidate.overallReasonCode,
    `${label}.overall`
  );

  if (!Array.isArray(candidate.claimResults)) {
    throw new Error(`${label}.claimResults must be an array.`);
  }
  const claimIds = new Set<string>();
  candidate.claimResults.forEach((claimResult, index) => {
    const claimLabel = `${label}.claimResults[${index}]`;
    assertVerificationClaimResultV1(claimResult, claimLabel);
    if (claimIds.has(claimResult.claimId)) {
      throw new Error(`${label}.claimResults must not contain duplicate claimId ${claimResult.claimId}.`);
    }
    claimIds.add(claimResult.claimId);
  });

  const canonicalInput = snapshotVerificationAggregateInputV1(input);
  const gateMap = new Map<string, VerificationGateResultV1>();
  canonicalInput.gateResults.forEach((gateResult) => {
    gateMap.set(gateResult.gateId, gateResult);
  });

  candidate.claimResults.forEach((claimResult, index) => {
    const claimLabel = `${label}.claimResults[${index}]`;
    claimResult.contributingGateIds.forEach((gateId: string) => {
      if (!gateMap.has(gateId)) {
        throw new Error(`${claimLabel} references unknown contributing gateId ${gateId}.`);
      }
    });
  });

  const expected = CodexDevelopmentAggregateVerificationClaimsV1(canonicalInput);
  if (!CodexDevelopmentVerificationDataEqualV1(candidate, expected)) {
    throw new Error(`${label} does not exactly match the canonical aggregate writer output.`);
  }
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
export function mapCiEvidenceStatus(
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
