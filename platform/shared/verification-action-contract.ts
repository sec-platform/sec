/**
 * Content-addressed VerificationAction identity and pure scheduling contract.
 *
 * The V2 boundary is deliberately strict. Runtime callers may provide only
 * ordinary JSON-like data; no getter, proxy, symbol, custom prototype, toJSON
 * hook, or cyclic object is allowed to participate in identity or planning.
 * Execution cost/lane is plan policy, not semantic ActionKey identity.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { types as nodeTypes } from 'node:util';

import type {
  VerificationReasonCode,
  VerificationResultStatus
} from './verification-result-contract.ts';
import { CodexDevelopmentAssertVerificationStatusReasonV1 } from './verification-result-contract.ts';

export const VERIFICATION_ACTION_KEY_SCHEMA_V2 =
  'sec-verification-action-key-v2' as const;
export const VERIFICATION_ACTION_PLAN_SCHEMA_V2 =
  'sec-verification-action-plan-v2' as const;
export const VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1 =
  'sec-verification-action-plan-closure-v1' as const;
export const VERIFICATION_ACTION_EXECUTION_BINDING_SCHEMA_V1 =
  'sec-verification-action-execution-binding-v1' as const;
export const VERIFICATION_ACTION_START_RECEIPT_SCHEMA_V1 =
  'sec-verification-action-start-receipt-v1' as const;
export const VERIFICATION_ACTION_EFFECT_CAPABILITY_SCHEMA_V1 =
  'sec-verification-action-effect-capability-v1' as const;
export const VERIFICATION_ACTION_EVIDENCE_SCHEMA_V1 =
  'sec-verification-action-evidence-v1' as const;

export type VerificationActionKeyDigest = `sha256:${string}`;

export type VerificationActionOperationV2 = Readonly<{
  /** Stable producer-owned operation identity; no raw command selectors. */
  identity: string;
  /** Version of the producer's semantic operation normalizer. */
  revision: string;
  /** Digest of the canonical operation after selectors and context resolve. */
  semanticDigest: VerificationActionKeyDigest;
  /** Canonical repository-relative logical cwd; `.` is the repository root. */
  workingDirectory: string;
  declaredEnvironment: readonly VerificationActionEnvironmentBindingV2[];
}>;

export type VerificationActionExecutionClassV2 = 'cheap-preflight' | 'expensive';

/**
 * The minimum exact-tree proof a VerificationAction is allowed to consume.
 *
 * This is part of ActionKey identity (rather than a scheduler hint), because
 * a terminal receipt produced under bounded analysis must never be reusable
 * for an action whose producer contract requires the required closure.  The
 * Every producer must choose one explicitly; there is no compatibility
 * default because omission would silently lower the proof boundary.
 */
export type VerificationActionStaticProofRequirementV1 =
  | 'bounded-action-admission'
  | 'required-producer-bound';

export type VerificationActionEnvironmentBindingV2 = Readonly<{
  name: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionProducerV2 = Readonly<{
  identity: string;
  revision: string;
}>;

export type VerificationActionInputRefV2 = Readonly<{
  path: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionEnvironmentV2 = Readonly<{
  toolchainRevision: string;
  providerRevision: string;
  contractRevision: string;
  executionBudget: VerificationActionExecutionBudgetV1;
}>;

/**
 * Immutable physical Effect budget compiled by the Action producer.  These
 * values are semantic because changing any of them changes whether and how a
 * terminal can be produced.  Lease TTL and scheduler lane remain projections;
 * they cannot extend this absolute boundary.
 */
export type VerificationActionExecutionBudgetV1 = Readonly<{
  absoluteTimeoutMs: number;
  stallTimeoutMs: number;
  capabilityIssueTimeoutMs: number;
  evidenceObservationTimeoutMs: number;
  providerReleaseTimeoutMs: number;
  processTreeSettlementTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  cancellationPolicyRevision: 'process-tree-settlement-v1';
  progressPolicyRevision: 'producer-semantic-progress-v1';
}>;

export const VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1: VerificationActionExecutionBudgetV1 =
  Object.freeze({
    absoluteTimeoutMs: 5 * 60_000,
    stallTimeoutMs: 4 * 60_000,
    capabilityIssueTimeoutMs: 30_000,
    evidenceObservationTimeoutMs: 30_000,
    providerReleaseTimeoutMs: 30_000,
    processTreeSettlementTimeoutMs: 30_000,
    maxStdoutBytes: 128 * 1024 * 1024,
    maxStderrBytes: 128 * 1024 * 1024,
    cancellationPolicyRevision: 'process-tree-settlement-v1',
    progressPolicyRevision: 'producer-semantic-progress-v1'
  });

export const VERIFICATION_ACTION_EXPENSIVE_EXECUTION_BUDGET_V1: VerificationActionExecutionBudgetV1 =
  Object.freeze({
    absoluteTimeoutMs: 30 * 60_000,
    stallTimeoutMs: 10 * 60_000,
    capabilityIssueTimeoutMs: 30_000,
    evidenceObservationTimeoutMs: 30_000,
    providerReleaseTimeoutMs: 30_000,
    processTreeSettlementTimeoutMs: 60_000,
    maxStdoutBytes: 128 * 1024 * 1024,
    maxStderrBytes: 128 * 1024 * 1024,
    cancellationPolicyRevision: 'process-tree-settlement-v1',
    progressPolicyRevision: 'producer-semantic-progress-v1'
  });

export type VerificationActionKeyInputV2 = Readonly<{
  actionKind: string;
  producer: VerificationActionProducerV2;
  operation: VerificationActionOperationV2;
  inputClosure: readonly VerificationActionInputRefV2[];
  environment: VerificationActionEnvironmentV2;
  /** Producer-owned cheap preflight topology required by an expensive plan. */
  requiredCheapPreflightActionKeys: readonly VerificationActionKeyDigest[];
  upstreamActionKeys: readonly VerificationActionKeyDigest[];
  resultSchemaRevision: string;
  /** Exact-tree static proof required before journal/effect admission. */
  staticProofRequirement: VerificationActionStaticProofRequirementV1;
}>;

type CanonicalVerificationActionKeyInputV2 = Omit<
  VerificationActionKeyInputV2,
  'staticProofRequirement'
> & Readonly<{
  staticProofRequirement: VerificationActionStaticProofRequirementV1;
}>;

export type VerificationActionKeyV2 = CanonicalVerificationActionKeyInputV2 & Readonly<{
  schema: typeof VERIFICATION_ACTION_KEY_SCHEMA_V2;
  actionKey: VerificationActionKeyDigest;
}>;

export type VerificationActionTerminalV2 = Readonly<{
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  resultDigest: VerificationActionKeyDigest | null;
}>;

export type VerificationActionDependencyKindV2 = 'cheap-preflight' | 'upstream';
export type VerificationActionDependencyStateV2 =
  | 'queued'
  | 'running'
  | 'terminal-passed'
  | 'terminal-failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated'
  | 'cancelled'
  | 'unknown';

export type VerificationActionDependencyV2 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  kind: VerificationActionDependencyKindV2;
}>;

export type VerificationActionDependencyResolutionV2 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  state: VerificationActionDependencyStateV2;
  /** Latest journal event digest used to detect same-state closure replacement. */
  observationDigest?: VerificationActionKeyDigest | null;
}>;

export type VerificationActionPlanV2 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PLAN_SCHEMA_V2;
  action: VerificationActionKeyV2;
  /** Scheduler lane policy; never included in ActionKey identity. */
  executionClass: VerificationActionExecutionClassV2;
  dependencies: readonly VerificationActionDependencyV2[];
}>;

export type VerificationActionPlanClosureV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1;
  producer: Readonly<{ identity: string; revision: string }>;
  plans: readonly VerificationActionPlanV2[];
  closureDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionPhysicalDirectoryIdentityV1 = Readonly<{
  schema: 'sec-physical-no-follow-v1';
  path: string;
  finalPath: string;
  device: string;
  inode: string;
  objectId: string;
}>;

/**
 * One immutable identity for the three non-interchangeable physical roots and
 * every semantic input that authorizes one VerificationAction Effect.
 */
export type VerificationActionExecutionBindingV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_EXECUTION_BINDING_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  actionPlanClosureDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  staticGenerationDigest: VerificationActionKeyDigest;
  runtimeStateRoot: VerificationActionPhysicalDirectoryIdentityV1;
  staticAuthorityRoot: Readonly<{
    physical: VerificationActionPhysicalDirectoryIdentityV1;
    headSha: string;
    headTreeSha: string;
  }>;
  physicalExecutionRoot: Readonly<{
    physical: VerificationActionPhysicalDirectoryIdentityV1;
    headSha: string;
    headTreeSha: string;
  }>;
  providerRevision: string;
  bindingDigest: VerificationActionKeyDigest;
}>;

/**
 * Durable start authority.  A provider Effect may not be issued until this
 * record has been published and read back.  The receipt deliberately binds
 * the producer Action, its exact plan and the static closure used for the
 * admission decision; a timestamp or caller token is never an identity.
 */
export type VerificationActionStartReceiptV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_START_RECEIPT_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  providerRevision: string;
  startedAt: string;
  startDigest: VerificationActionKeyDigest;
}>;

/**
 * One-shot provider capability.  This is an opaque Effect grant issued by
 * the provider after the durable start receipt exists.  The runner may pass
 * it back only to the same provider and never derives one from caller data.
 */
export type VerificationActionEffectCapabilityDescriptorV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_EFFECT_CAPABILITY_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  providerRevision: string;
  issuedAt: string;
  expiresAt: string;
  oneShot: true;
  capabilityDigest: VerificationActionKeyDigest;
}>;

declare const verificationActionEffectCapabilityBrandV1: unique symbol;

/**
 * Opaque provider handle.  Its descriptor is inspectable binding metadata;
 * the handle itself is issued and recognized by provider module identity and
 * is never parsed, reconstructed or accepted from ordinary caller data.
 */
export type VerificationActionEffectCapabilityV1 = Readonly<{
  readonly descriptor: VerificationActionEffectCapabilityDescriptorV1;
  readonly [verificationActionEffectCapabilityBrandV1]: true;
}>;

/**
 * Provider-issued terminal Evidence.  It is a separate durable fact from
 * the local journal terminal projection.  The local journal may be promoted
 * only after this object has been persisted and read back byte-for-byte.
 */
export type VerificationActionEvidenceV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_EVIDENCE_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  providerRevision: string;
  capabilityDigest: VerificationActionKeyDigest;
  terminal: VerificationActionTerminalV2;
  evidenceRefs: readonly string[];
  startedAt: string;
  finishedAt: string;
  evidenceDigest: VerificationActionKeyDigest;
}>;

/**
 * Narrow durable publication capability supplied by the Runtime State owner
 * to the selected Effect provider.  The provider must publish and read back
 * its Evidence through this port before returning it to the runner.  Keeping
 * this transport out of the provider DTO makes restart-safe observation
 * possible without giving the runner a second producer implementation.
 */
export type VerificationActionEvidencePublicationPortV1 = Readonly<{
  publish: (evidence: VerificationActionEvidenceV1) => Promise<VerificationActionEvidenceV1>;
  read: () => Promise<VerificationActionEvidenceV1 | null>;
}>;

/**
 * The only execution seam the VerificationAction runner accepts as a
 * production authority.  Provider modules outside this envelope implement
 * this interface; a missing provider is a typed blocker, never a reason to
 * fall back to caller-supplied executor/runGate callbacks.
 */
export interface VerificationActionEffectProviderV1 {
  readonly providerRevision: string;
  readonly issue: (input: Readonly<{
    action: VerificationActionKeyV2;
    actionPlanDigest: VerificationActionKeyDigest;
    executionBindingDigest: VerificationActionKeyDigest;
    staticClosureDigest: VerificationActionKeyDigest;
    start: VerificationActionStartReceiptV1;
    signal: AbortSignal;
  }>) => Promise<VerificationActionEffectCapabilityV1>;
  readonly execute: (input: Readonly<{
    action: VerificationActionKeyV2;
    capability: VerificationActionEffectCapabilityV1;
    /** Runner-owned cancellation; providers must forward it to every physical child. */
    signal: AbortSignal;
    evidencePublication: VerificationActionEvidencePublicationPortV1;
  }>) => Promise<VerificationActionEvidenceV1>;
  /** Observe provider Evidence during reuse/join/reconcile. */
  readonly observe: (input: Readonly<{
    actionKey: VerificationActionKeyDigest;
    actionPlanDigest: VerificationActionKeyDigest;
    executionBindingDigest: VerificationActionKeyDigest;
    staticClosureDigest: VerificationActionKeyDigest;
    readPublishedEvidence: () => Promise<VerificationActionEvidenceV1 | null>;
    signal: AbortSignal;
  }>) => Promise<VerificationActionEvidenceV1 | null>;
  /** Release provider resources only after Evidence/journal consistency. */
  readonly release: (input: Readonly<{
    action: VerificationActionKeyV2;
    /**
     * Present on the original execution path.  After a process crash the
     * opaque Effect handle is deliberately unrecoverable; the provider must
     * instead authorize idempotent settlement from its exact durable Evidence
     * observation.  Null never authorizes another physical execution.
     */
    capability: VerificationActionEffectCapabilityV1 | null;
    evidence: VerificationActionEvidenceV1;
    signal: AbortSignal;
  }>) => Promise<void>;
}

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'branch',
  'branchName',
  'headRef',
  'pullRequest',
  'prNumber',
  'wallClock',
  'timestamp',
  'pid',
  'processId',
  'tempPath',
  'temporaryPath',
  'absoluteTempPath',
  'chat',
  'argv',
  'runtime',
  'absoluteWorkingDirectory',
  'configPath'
]);

type OrdinaryRecord = Record<string, unknown>;

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descriptorMap(value: object, label: string): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    throw new Error(`${label} cannot be inspected as ordinary data.`, { cause: error });
  }
}

function assertNotProxy(value: object, label: string): void {
  try {
    if (nodeTypes.isProxy(value)) fail(label, 'proxies are forbidden.');
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('proxies are forbidden.')) throw error;
    throw new Error(`${label} cannot be inspected as ordinary data.`, { cause: error });
  }
}

function assertDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
  label: string,
  enumerable: boolean | null = true
): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    fail(label, 'must use a data property; accessors are forbidden.');
  }
  if (enumerable !== null && descriptor.enumerable !== enumerable) {
    fail(label, enumerable ? 'must be enumerable.' : 'must be non-enumerable.');
  }
}

function assertOrdinaryData(
  value: unknown,
  label: string,
  ancestors = new WeakSet<object>()
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(label, 'must be a finite number.');
    return;
  }
  if (typeof value !== 'object') fail(label, 'must be ordinary JSON-like data.');
  assertNotProxy(value, label);
  if (ancestors.has(value)) fail(label, 'contains a cyclic reference.');
  ancestors.add(value);
  try {
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch (error) {
      throw new Error(`${label} prototype cannot be inspected.`, { cause: error });
    }
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) fail(label, 'array prototype is noncanonical.');
      const descriptors = descriptorMap(value, label);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== 'string')) {
        fail(label, 'symbol properties are forbidden.');
      }
      const lengthDescriptor = descriptors.length;
      assertDataDescriptor(lengthDescriptor, `${label}.length`, false);
      const length = lengthDescriptor.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 4096) {
        fail(label, 'length is not a bounded canonical array length.');
      }
      if (keys.length !== length + 1 || !keys.includes('length')) {
        fail(label, 'must not contain holes or extra properties.');
      }
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = descriptors[key];
        assertDataDescriptor(descriptor, `${label}[${index}]`);
        assertOrdinaryData(descriptor.value, `${label}[${index}]`, ancestors);
      }
      return;
    }
    if (prototype !== Object.prototype) fail(label, 'object prototype is noncanonical.');
    const descriptors = descriptorMap(value, label);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') fail(label, 'symbol properties are forbidden.');
      if (key === 'toJSON') fail(label, 'toJSON is forbidden.');
      const descriptor = descriptors[key];
      assertDataDescriptor(descriptor, `${label}.${key}`);
      assertOrdinaryData(descriptor.value, `${label}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function ordinaryRecord(value: unknown, label: string): OrdinaryRecord {
  assertOrdinaryData(value, label);
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    fail(label, 'must be a canonical ordinary object.');
  }
  const descriptors = descriptorMap(value, label);
  const snapshot = Object.create(null) as OrdinaryRecord;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail(label, 'symbol properties are forbidden.');
    const descriptor = descriptors[key];
    assertDataDescriptor(descriptor, `${label}.${key}`);
    Object.defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  return snapshot;
}

function ordinaryArray(value: unknown, label: string): readonly unknown[] {
  assertOrdinaryData(value, label);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(label, 'must be a canonical ordinary array.');
  }
  const descriptors = descriptorMap(value, label);
  const lengthDescriptor = descriptors.length;
  assertDataDescriptor(lengthDescriptor, `${label}.length`, false);
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 4096) {
    fail(label, 'length is not bounded.');
  }
  return Object.freeze(Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    assertDataDescriptor(descriptor, `${label}[${index}]`);
    return descriptor.value;
  }));
}

function exactKeys(value: OrdinaryRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(label, `must contain exactly: ${expected.join(', ')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    fail(label, 'must be a bounded non-empty text value.');
  }
  return value;
}

function digest(value: unknown, label: string): VerificationActionKeyDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(label, 'must be a SHA-256 content digest.');
  }
  return value as VerificationActionKeyDigest;
}

function relativeInputPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
    path.posix.normalize(value) !== value || value === '.' || value === '..' ||
    value.startsWith('../') || path.posix.isAbsolute(value)) {
    fail(label, 'must be one canonical repository-relative path.');
  }
  return value;
}

function relativeWorkingDirectory(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
    path.posix.normalize(value) !== value || value === '..' || value.startsWith('../') ||
    path.posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.startsWith('//') ||
    (value !== '.' && value.endsWith('/'))) {
    fail(label, 'must be a canonical repository-relative directory or `.` repository-root sentinel.');
  }
  return value;
}

function executionClass(value: unknown, label: string): VerificationActionExecutionClassV2 {
  if (value !== 'cheap-preflight' && value !== 'expensive') {
    fail(label, 'must be `cheap-preflight` or `expensive`.');
  }
  return value;
}

function staticProofRequirement(
  value: unknown,
  label: string
): VerificationActionStaticProofRequirementV1 {
  if (value !== 'bounded-action-admission' && value !== 'required-producer-bound') {
    fail(label, 'must be `bounded-action-admission` or `required-producer-bound`.');
  }
  return value;
}

function positiveBudgetInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(label, 'must be a positive bounded safe integer.');
  }
  return value as number;
}

function canonicalExecutionBudget(value: unknown): VerificationActionExecutionBudgetV1 {
  const budget = ordinaryRecord(value, 'environment.executionBudget');
  exactKeys(budget, [
    'absoluteTimeoutMs', 'stallTimeoutMs', 'capabilityIssueTimeoutMs',
    'evidenceObservationTimeoutMs', 'providerReleaseTimeoutMs',
    'processTreeSettlementTimeoutMs', 'maxStdoutBytes', 'maxStderrBytes',
    'cancellationPolicyRevision', 'progressPolicyRevision'
  ], 'environment.executionBudget');
  const absoluteTimeoutMs = positiveBudgetInteger(
    budget.absoluteTimeoutMs,
    'environment.executionBudget.absoluteTimeoutMs',
    24 * 60 * 60_000
  );
  const stallTimeoutMs = positiveBudgetInteger(
    budget.stallTimeoutMs,
    'environment.executionBudget.stallTimeoutMs',
    24 * 60 * 60_000
  );
  if (stallTimeoutMs >= absoluteTimeoutMs) {
    fail('environment.executionBudget.stallTimeoutMs', 'must be shorter than the absolute timeout.');
  }
  const capabilityIssueTimeoutMs = positiveBudgetInteger(
    budget.capabilityIssueTimeoutMs,
    'environment.executionBudget.capabilityIssueTimeoutMs',
    10 * 60_000
  );
  const evidenceObservationTimeoutMs = positiveBudgetInteger(
    budget.evidenceObservationTimeoutMs,
    'environment.executionBudget.evidenceObservationTimeoutMs',
    10 * 60_000
  );
  const providerReleaseTimeoutMs = positiveBudgetInteger(
    budget.providerReleaseTimeoutMs,
    'environment.executionBudget.providerReleaseTimeoutMs',
    10 * 60_000
  );
  const processTreeSettlementTimeoutMs = positiveBudgetInteger(
    budget.processTreeSettlementTimeoutMs,
    'environment.executionBudget.processTreeSettlementTimeoutMs',
    10 * 60_000
  );
  const maxStdoutBytes = positiveBudgetInteger(
    budget.maxStdoutBytes,
    'environment.executionBudget.maxStdoutBytes',
    1024 * 1024 * 1024
  );
  const maxStderrBytes = positiveBudgetInteger(
    budget.maxStderrBytes,
    'environment.executionBudget.maxStderrBytes',
    1024 * 1024 * 1024
  );
  if (budget.cancellationPolicyRevision !== 'process-tree-settlement-v1' ||
      budget.progressPolicyRevision !== 'producer-semantic-progress-v1') {
    fail('environment.executionBudget', 'contains an unsupported cancellation or progress policy.');
  }
  return Object.freeze({
    absoluteTimeoutMs,
    stallTimeoutMs,
    capabilityIssueTimeoutMs,
    evidenceObservationTimeoutMs,
    providerReleaseTimeoutMs,
    processTreeSettlementTimeoutMs,
    maxStdoutBytes,
    maxStderrBytes,
    cancellationPolicyRevision: 'process-tree-settlement-v1',
    progressPolicyRevision: 'producer-semantic-progress-v1'
  });
}

function assertNoIdentityKey(value: unknown, label: string): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, child] of ordinaryArray(value, label).entries()) {
      assertNoIdentityKey(child, `${label}[${index}]`);
    }
    return;
  }
  const record = Object.getPrototypeOf(value) === null
    ? value as OrdinaryRecord
    : ordinaryRecord(value, label);
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) {
      fail(label, `contains forbidden semantic identity field ${key}.`);
    }
    assertNoIdentityKey(record[key], `${label}.${key}`);
  }
}

/** Route terminal status/reason validation through the existing result owner. */
function assertCanonicalStatusReason(
  status: unknown,
  reasonCode: unknown
): asserts status is VerificationResultStatus {
  try {
    CodexDevelopmentAssertVerificationStatusReasonV1(
      status,
      reasonCode,
      'VerificationAction terminal'
    );
  } catch (error) {
    throw new Error(
      `VerificationAction terminal status/reason is not canonical: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

function canonicalEnvironmentBindings(
  input: readonly unknown[]
): readonly VerificationActionEnvironmentBindingV2[] {
  const bindings = input.map((candidate, index) => {
    const value = ordinaryRecord(candidate, `operation.declaredEnvironment[${index}]`);
    exactKeys(value, ['name', 'digest'], `operation.declaredEnvironment[${index}]`);
    return Object.freeze({
      name: text(value.name, `operation.declaredEnvironment[${index}].name`),
      digest: digest(value.digest, `operation.declaredEnvironment[${index}].digest`)
    });
  });
  bindings.sort((left, right) => compareCanonicalText(left.name, right.name));
  for (let index = 1; index < bindings.length; index += 1) {
    if (bindings[index - 1]!.name === bindings[index]!.name) {
      fail('operation.declaredEnvironment', `contains duplicate name ${bindings[index]!.name}.`);
    }
  }
  return Object.freeze(bindings);
}

function canonicalInputClosure(
  input: readonly unknown[]
): readonly VerificationActionInputRefV2[] {
  const refs = input.map((candidate, index) => {
    const value = ordinaryRecord(candidate, `inputClosure[${index}]`);
    exactKeys(value, ['path', 'digest'], `inputClosure[${index}]`);
    return Object.freeze({
      path: relativeInputPath(value.path, `inputClosure[${index}].path`),
      digest: digest(value.digest, `inputClosure[${index}].digest`)
    });
  });
  refs.sort((left, right) => compareCanonicalText(left.path, right.path));
  for (let index = 1; index < refs.length; index += 1) {
    if (refs[index - 1]!.path === refs[index]!.path) {
      fail('inputClosure', `contains duplicate path ${refs[index]!.path}.`);
    }
  }
  return Object.freeze(refs);
}

function canonicalActionKeys(
  input: readonly unknown[],
  label: string
): readonly VerificationActionKeyDigest[] {
  const keys = input.map((candidate, index) => digest(candidate, `${label}[${index}]`));
  keys.sort();
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index - 1] === keys[index]) fail(label, 'contains a duplicate key.');
  }
  return Object.freeze(keys);
}

function canonicalInput(input: unknown): CanonicalVerificationActionKeyInputV2 {
  const value = ordinaryRecord(input, 'VerificationAction key input');
  assertNoIdentityKey(value, 'VerificationAction key input');
  exactKeys(value, [
    'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision',
    'staticProofRequirement'
  ], 'VerificationAction key input');
  const producer = ordinaryRecord(value.producer, 'producer');
  exactKeys(producer, ['identity', 'revision'], 'producer');
  const operation = ordinaryRecord(value.operation, 'operation');
  exactKeys(operation, [
    'identity', 'revision', 'semanticDigest', 'workingDirectory', 'declaredEnvironment'
  ], 'operation');
  const environment = ordinaryRecord(value.environment, 'environment');
  exactKeys(environment, [
    'toolchainRevision', 'providerRevision', 'contractRevision', 'executionBudget'
  ], 'environment');
  const declaredEnvironment = ordinaryArray(operation.declaredEnvironment, 'operation.declaredEnvironment');
  const inputClosure = ordinaryArray(value.inputClosure, 'inputClosure');
  const requiredCheapPreflightActionKeys = ordinaryArray(
    value.requiredCheapPreflightActionKeys,
    'requiredCheapPreflightActionKeys'
  );
  const upstreamActionKeys = ordinaryArray(value.upstreamActionKeys, 'upstreamActionKeys');
  const canonicalStaticProofRequirement = staticProofRequirement(
    value.staticProofRequirement,
    'staticProofRequirement'
  );
  const canonicalCheap = canonicalActionKeys(
    requiredCheapPreflightActionKeys,
    'requiredCheapPreflightActionKeys'
  );
  const canonicalUpstream = canonicalActionKeys(upstreamActionKeys, 'upstreamActionKeys');
  if (canonicalUpstream.some((key) => canonicalCheap.includes(key))) {
    fail('VerificationAction key input', 'required cheap-preflight and upstream ActionKey sets cannot overlap.');
  }
  return Object.freeze({
    actionKind: text(value.actionKind, 'actionKind'),
    producer: Object.freeze({
      identity: text(producer.identity, 'producer.identity'),
      revision: text(producer.revision, 'producer.revision')
    }),
    operation: Object.freeze({
      identity: text(operation.identity, 'operation.identity'),
      revision: text(operation.revision, 'operation.revision'),
      semanticDigest: digest(operation.semanticDigest, 'operation.semanticDigest'),
      workingDirectory: relativeWorkingDirectory(operation.workingDirectory, 'operation.workingDirectory'),
      declaredEnvironment: canonicalEnvironmentBindings(declaredEnvironment)
    }),
    inputClosure: canonicalInputClosure(inputClosure),
    environment: Object.freeze({
      toolchainRevision: text(environment.toolchainRevision, 'environment.toolchainRevision'),
      providerRevision: text(environment.providerRevision, 'environment.providerRevision'),
      contractRevision: text(environment.contractRevision, 'environment.contractRevision'),
      executionBudget: canonicalExecutionBudget(environment.executionBudget)
    }),
    requiredCheapPreflightActionKeys: canonicalCheap,
    upstreamActionKeys: canonicalUpstream,
    resultSchemaRevision: text(value.resultSchemaRevision, 'resultSchemaRevision'),
    staticProofRequirement: canonicalStaticProofRequirement
  });
}

function encodeString(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const character = value[index]!;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += character + value[index + 1]!;
        index += 1;
      } else {
        result += `\\u${code.toString(16).padStart(4, '0')}`;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (character === '"') result += '\\"';
    else if (character === '\\') result += '\\\\';
    else if (character === '\b') result += '\\b';
    else if (character === '\f') result += '\\f';
    else if (character === '\n') result += '\\n';
    else if (character === '\r') result += '\\r';
    else if (character === '\t') result += '\\t';
    else if (code < 0x20) result += `\\u${code.toString(16).padStart(4, '0')}`;
    else result += character;
  }
  return `${result}"`;
}

function encodeCanonical(value: unknown): string {
  assertOrdinaryData(value, 'canonical serialization');
  if (value === null) return 'null';
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return value === 0 ? '0' : String(value);
  if (Array.isArray(value)) {
    return `[${ordinaryArray(value, 'canonical serialization array').map(encodeCanonical).join(',')}]`;
  }
  const record = ordinaryRecord(value, 'canonical serialization object');
  const fields = Object.keys(record).sort().map((key) => (
    `${encodeString(key)}:${encodeCanonical(record[key])}`
  ));
  return `{${fields.join(',')}}`;
}

/** Serialize validated ordinary data without invoking JSON hooks. */
export function encodeVerificationActionDataV2(value: unknown): string {
  return encodeCanonical(value);
}

function keyDigest(input: CanonicalVerificationActionKeyInputV2): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeCanonical({
    schema: VERIFICATION_ACTION_KEY_SCHEMA_V2,
    ...input
  })).digest('hex')}`;
}

export function createVerificationActionKeyV2(input: unknown): VerificationActionKeyV2 {
  const canonical = canonicalInput(input);
  return Object.freeze({
    schema: VERIFICATION_ACTION_KEY_SCHEMA_V2,
    ...canonical,
    actionKey: keyDigest(canonical)
  });
}

export function parseVerificationActionKeyV2(source: string): VerificationActionKeyV2 {
  if (typeof source !== 'string') fail('VerificationAction key', 'source must be text.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('VerificationAction key is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction key');
  exactKeys(value, [
    'schema', 'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision',
    'staticProofRequirement', 'actionKey'
  ], 'VerificationAction key');
  if (value.schema !== VERIFICATION_ACTION_KEY_SCHEMA_V2) {
    fail('VerificationAction key', 'schema mismatch; V1 journals/keys are not reusable.');
  }
  const withoutDigest: OrdinaryRecord = {};
  for (const key of [
    'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision',
    'staticProofRequirement'
  ]) {
    withoutDigest[key] = value[key];
  }
  const canonical = canonicalInput(withoutDigest);
  const expected = keyDigest(canonical);
  if (value.actionKey !== expected) fail('VerificationAction key', 'digest mismatch.');
  return createVerificationActionKeyV2(canonical);
}

export function createVerificationActionTerminalV2(
  input: unknown
): VerificationActionTerminalV2 {
  const value = ordinaryRecord(input, 'VerificationAction terminal');
  exactKeys(value, ['status', 'reasonCode', 'resultDigest'], 'VerificationAction terminal');
  assertCanonicalStatusReason(value.status, value.reasonCode);
  const resultDigest = value.resultDigest === null
    ? null
    : digest(value.resultDigest, 'VerificationAction terminal.resultDigest');
  return Object.freeze({
    status: value.status as VerificationResultStatus,
    reasonCode: value.reasonCode as VerificationReasonCode,
    resultDigest
  });
}

function instant(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    fail(label, 'must be a canonical ISO timestamp.');
  }
  return result;
}

function boundedEvidenceRefs(value: unknown, label: string): readonly string[] {
  const entries = ordinaryArray(value, label).map((entry, index) => {
    const result = text(entry, `${label}[${index}]`);
    if (result.length > 2048) fail(`${label}[${index}]`, 'is too long.');
    return result;
  });
  if (entries.length === 0) fail(label, 'must contain at least one provider Evidence reference.');
  if (new Set(entries).size !== entries.length) fail(label, 'must not contain duplicate references.');
  return Object.freeze(entries);
}

function contentDigest(value: unknown): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeCanonical(value)).digest('hex')}`;
}

function physicalDirectoryIdentityV1(
  value: unknown,
  label: string
): VerificationActionPhysicalDirectoryIdentityV1 {
  const input = ordinaryRecord(value, label);
  exactKeys(input, ['schema', 'path', 'finalPath', 'device', 'inode', 'objectId'], label);
  if (input.schema !== 'sec-physical-no-follow-v1') fail(label, 'schema mismatch.');
  const lexicalPath = text(input.path, `${label}.path`);
  const finalPath = text(input.finalPath, `${label}.finalPath`);
  if (!path.isAbsolute(lexicalPath) || !path.isAbsolute(finalPath)) {
    fail(label, 'paths must be absolute.');
  }
  return Object.freeze({
    schema: 'sec-physical-no-follow-v1' as const,
    path: lexicalPath,
    finalPath,
    device: text(input.device, `${label}.device`),
    inode: text(input.inode, `${label}.inode`),
    objectId: text(input.objectId, `${label}.objectId`)
  });
}

function exactGitRevision(value: unknown, label: string): string {
  const revision = text(value, label);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)) {
    fail(label, 'must be one full lowercase Git object ID.');
  }
  return revision;
}

export function createVerificationActionExecutionBindingV1(
  input: Omit<VerificationActionExecutionBindingV1, 'schema' | 'bindingDigest'>
): VerificationActionExecutionBindingV1 {
  const staticAuthorityInput = ordinaryRecord(input.staticAuthorityRoot, 'execution binding.staticAuthorityRoot');
  exactKeys(staticAuthorityInput, ['physical', 'headSha', 'headTreeSha'], 'execution binding.staticAuthorityRoot');
  const physicalExecutionInput = ordinaryRecord(
    input.physicalExecutionRoot,
    'execution binding.physicalExecutionRoot'
  );
  exactKeys(physicalExecutionInput, ['physical', 'headSha', 'headTreeSha'], 'execution binding.physicalExecutionRoot');
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_EXECUTION_BINDING_SCHEMA_V1,
    actionKey: digest(input.actionKey, 'execution binding.actionKey'),
    actionPlanDigest: digest(input.actionPlanDigest, 'execution binding.actionPlanDigest'),
    actionPlanClosureDigest: digest(
      input.actionPlanClosureDigest,
      'execution binding.actionPlanClosureDigest'
    ),
    staticClosureDigest: digest(input.staticClosureDigest, 'execution binding.staticClosureDigest'),
    staticGenerationDigest: digest(
      input.staticGenerationDigest,
      'execution binding.staticGenerationDigest'
    ),
    runtimeStateRoot: physicalDirectoryIdentityV1(
      input.runtimeStateRoot,
      'execution binding.runtimeStateRoot'
    ),
    staticAuthorityRoot: Object.freeze({
      physical: physicalDirectoryIdentityV1(
        staticAuthorityInput.physical,
        'execution binding.staticAuthorityRoot.physical'
      ),
      headSha: exactGitRevision(staticAuthorityInput.headSha, 'execution binding.staticAuthorityRoot.headSha'),
      headTreeSha: exactGitRevision(
        staticAuthorityInput.headTreeSha,
        'execution binding.staticAuthorityRoot.headTreeSha'
      )
    }),
    physicalExecutionRoot: Object.freeze({
      physical: physicalDirectoryIdentityV1(
        physicalExecutionInput.physical,
        'execution binding.physicalExecutionRoot.physical'
      ),
      headSha: exactGitRevision(
        physicalExecutionInput.headSha,
        'execution binding.physicalExecutionRoot.headSha'
      ),
      headTreeSha: exactGitRevision(
        physicalExecutionInput.headTreeSha,
        'execution binding.physicalExecutionRoot.headTreeSha'
      )
    }),
    providerRevision: text(input.providerRevision, 'execution binding.providerRevision')
  });
  return Object.freeze({ ...material, bindingDigest: contentDigest(material) });
}

export function parseVerificationActionExecutionBindingV1(
  source: string
): VerificationActionExecutionBindingV1 {
  if (typeof source !== 'string') fail('execution binding', 'source must be text.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('VerificationAction execution binding is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction execution binding');
  exactKeys(value, [
    'schema', 'actionKey', 'actionPlanDigest', 'actionPlanClosureDigest', 'staticClosureDigest',
    'staticGenerationDigest', 'runtimeStateRoot', 'staticAuthorityRoot', 'physicalExecutionRoot',
    'providerRevision', 'bindingDigest'
  ], 'VerificationAction execution binding');
  if (value.schema !== VERIFICATION_ACTION_EXECUTION_BINDING_SCHEMA_V1) {
    fail('VerificationAction execution binding', 'schema mismatch.');
  }
  const { bindingDigest: _ignored, ...withoutDigest } = value;
  void _ignored;
  const rebuilt = createVerificationActionExecutionBindingV1(withoutDigest as Omit<
    VerificationActionExecutionBindingV1,
    'schema' | 'bindingDigest'
  >);
  if (rebuilt.bindingDigest !== value.bindingDigest) {
    fail('VerificationAction execution binding', 'digest mismatch.');
  }
  return rebuilt;
}

export function createVerificationActionStartReceiptV1(
  input: Omit<VerificationActionStartReceiptV1, 'schema' | 'startDigest'>
): VerificationActionStartReceiptV1 {
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_START_RECEIPT_SCHEMA_V1,
    actionKey: digest(input.actionKey, 'start receipt.actionKey'),
    actionPlanDigest: digest(input.actionPlanDigest, 'start receipt.actionPlanDigest'),
    executionBindingDigest: digest(input.executionBindingDigest, 'start receipt.executionBindingDigest'),
    staticClosureDigest: digest(input.staticClosureDigest, 'start receipt.staticClosureDigest'),
    providerRevision: text(input.providerRevision, 'start receipt.providerRevision'),
    startedAt: instant(input.startedAt, 'start receipt.startedAt')
  });
  return Object.freeze({ ...material, startDigest: contentDigest(material) });
}

export function parseVerificationActionStartReceiptV1(source: string): VerificationActionStartReceiptV1 {
  if (typeof source !== 'string') fail('start receipt', 'source must be text.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('VerificationAction start receipt is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction start receipt');
  exactKeys(value, [
    'schema', 'actionKey', 'actionPlanDigest', 'executionBindingDigest', 'staticClosureDigest', 'providerRevision', 'startedAt', 'startDigest'
  ], 'VerificationAction start receipt');
  if (value.schema !== VERIFICATION_ACTION_START_RECEIPT_SCHEMA_V1) {
    fail('VerificationAction start receipt', 'schema mismatch.');
  }
  const { startDigest: _ignored, ...withoutDigest } = value;
  void _ignored;
  const rebuilt = createVerificationActionStartReceiptV1(withoutDigest as Omit<
    VerificationActionStartReceiptV1, 'schema' | 'startDigest'
  >);
  if (rebuilt.startDigest !== value.startDigest) fail('VerificationAction start receipt', 'digest mismatch.');
  return rebuilt;
}

export function createVerificationActionEffectCapabilityDescriptorV1(
  input: Omit<VerificationActionEffectCapabilityDescriptorV1, 'schema' | 'capabilityDigest'>
): VerificationActionEffectCapabilityDescriptorV1 {
  const issuedAt = instant(input.issuedAt, 'Effect capability.issuedAt');
  const expiresAt = instant(input.expiresAt, 'Effect capability.expiresAt');
  if (expiresAt <= issuedAt) fail('Effect capability', 'expiresAt must be after issuedAt.');
  if (input.oneShot !== true) fail('Effect capability', 'oneShot must be true.');
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_EFFECT_CAPABILITY_SCHEMA_V1,
    actionKey: digest(input.actionKey, 'Effect capability.actionKey'),
    actionPlanDigest: digest(input.actionPlanDigest, 'Effect capability.actionPlanDigest'),
    executionBindingDigest: digest(
      input.executionBindingDigest,
      'Effect capability.executionBindingDigest'
    ),
    staticClosureDigest: digest(input.staticClosureDigest, 'Effect capability.staticClosureDigest'),
    providerRevision: text(input.providerRevision, 'Effect capability.providerRevision'),
    issuedAt,
    expiresAt,
    oneShot: true as const
  });
  return Object.freeze({ ...material, capabilityDigest: contentDigest(material) });
}

export function parseVerificationActionEffectCapabilityDescriptorV1(
  source: string
): VerificationActionEffectCapabilityDescriptorV1 {
  if (typeof source !== 'string') fail('Effect capability', 'source must be text.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('VerificationAction Effect capability is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction Effect capability');
  exactKeys(value, [
    'schema', 'actionKey', 'actionPlanDigest', 'executionBindingDigest', 'staticClosureDigest', 'providerRevision',
    'issuedAt', 'expiresAt', 'oneShot', 'capabilityDigest'
  ], 'VerificationAction Effect capability');
  if (value.schema !== VERIFICATION_ACTION_EFFECT_CAPABILITY_SCHEMA_V1) {
    fail('VerificationAction Effect capability', 'schema mismatch.');
  }
  const { capabilityDigest: _ignored, ...withoutDigest } = value;
  void _ignored;
  const rebuilt = createVerificationActionEffectCapabilityDescriptorV1(withoutDigest as Omit<
    VerificationActionEffectCapabilityDescriptorV1, 'schema' | 'capabilityDigest'
  >);
  if (rebuilt.capabilityDigest !== value.capabilityDigest) {
    fail('VerificationAction Effect capability', 'digest mismatch.');
  }
  return rebuilt;
}

export function createVerificationActionEvidenceV1(
  input: Omit<VerificationActionEvidenceV1, 'schema' | 'evidenceDigest'>
): VerificationActionEvidenceV1 {
  const startedAt = instant(input.startedAt, 'Action Evidence.startedAt');
  const finishedAt = instant(input.finishedAt, 'Action Evidence.finishedAt');
  if (finishedAt < startedAt) fail('Action Evidence', 'finishedAt must not precede startedAt.');
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_EVIDENCE_SCHEMA_V1,
    actionKey: digest(input.actionKey, 'Action Evidence.actionKey'),
    actionPlanDigest: digest(input.actionPlanDigest, 'Action Evidence.actionPlanDigest'),
    executionBindingDigest: digest(input.executionBindingDigest, 'Action Evidence.executionBindingDigest'),
    staticClosureDigest: digest(input.staticClosureDigest, 'Action Evidence.staticClosureDigest'),
    providerRevision: text(input.providerRevision, 'Action Evidence.providerRevision'),
    capabilityDigest: digest(input.capabilityDigest, 'Action Evidence.capabilityDigest'),
    terminal: createVerificationActionTerminalV2(input.terminal),
    evidenceRefs: boundedEvidenceRefs(input.evidenceRefs, 'Action Evidence.evidenceRefs'),
    startedAt,
    finishedAt
  });
  return Object.freeze({ ...material, evidenceDigest: contentDigest(material) });
}

export function parseVerificationActionEvidenceV1(source: string): VerificationActionEvidenceV1 {
  if (typeof source !== 'string') fail('Action Evidence', 'source must be text.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('VerificationAction Evidence is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction Evidence');
  exactKeys(value, [
    'schema', 'actionKey', 'actionPlanDigest', 'executionBindingDigest', 'staticClosureDigest', 'providerRevision',
    'capabilityDigest', 'terminal', 'evidenceRefs', 'startedAt', 'finishedAt', 'evidenceDigest'
  ], 'VerificationAction Evidence');
  if (value.schema !== VERIFICATION_ACTION_EVIDENCE_SCHEMA_V1) {
    fail('VerificationAction Evidence', 'schema mismatch.');
  }
  const { evidenceDigest: _ignored, ...withoutDigest } = value;
  void _ignored;
  const rebuilt = createVerificationActionEvidenceV1(withoutDigest as Omit<
    VerificationActionEvidenceV1, 'schema' | 'evidenceDigest'
  >);
  if (rebuilt.evidenceDigest !== value.evidenceDigest) fail('VerificationAction Evidence', 'digest mismatch.');
  return rebuilt;
}

export function createVerificationActionPlanV2(input: unknown): VerificationActionPlanV2 {
  const value = ordinaryRecord(input, 'VerificationAction plan');
  exactKeys(value, ['action', 'executionClass', 'dependencies'], 'VerificationAction plan');
  const action = parseVerificationActionKeyV2(encodeCanonical(value.action));
  const scheduledClass = executionClass(value.executionClass, 'executionClass');
  const rawDependencies = ordinaryArray(value.dependencies, 'dependencies');
  const dependencies = rawDependencies.map((candidate, index) => {
    const dependency = ordinaryRecord(candidate, `dependency[${index}]`);
    exactKeys(dependency, ['actionKey', 'kind'], `dependency[${index}]`);
    const kind = dependency.kind;
    if (kind !== 'cheap-preflight' && kind !== 'upstream') {
      fail(`dependency[${index}].kind`, 'is invalid.');
    }
    return Object.freeze({
      actionKey: digest(dependency.actionKey, `dependency[${index}].actionKey`),
      kind: kind as VerificationActionDependencyKindV2
    });
  }).sort((left, right) => compareCanonicalText(
    `${left.kind}\0${left.actionKey}`,
    `${right.kind}\0${right.actionKey}`
  ));
  const duplicateKeys = new Set<VerificationActionKeyDigest>();
  const declaredUpstreamKeys = new Set(action.upstreamActionKeys);
  const declaredCheapPreflightKeys = new Set(action.requiredCheapPreflightActionKeys);
  const plannedCheapPreflightKeys = new Set<VerificationActionKeyDigest>();
  const plannedUpstreamKeys = new Set<VerificationActionKeyDigest>();
  for (const dependency of dependencies) {
    if (duplicateKeys.has(dependency.actionKey)) {
      fail('dependencies', 'cannot declare one ActionKey under multiple dependency kinds or duplicate it.');
    }
    duplicateKeys.add(dependency.actionKey);
    if (dependency.actionKey === action.actionKey) {
      fail('dependencies', 'cannot contain the action itself as a dependency.');
    }
    if (dependency.kind === 'upstream') plannedUpstreamKeys.add(dependency.actionKey);
    else plannedCheapPreflightKeys.add(dependency.actionKey);
  }
  if (plannedUpstreamKeys.size !== declaredUpstreamKeys.size ||
    [...plannedUpstreamKeys].some((key) => !declaredUpstreamKeys.has(key))) {
    fail('dependencies', 'upstream dependencies must exactly match action.upstreamActionKeys.');
  }
  if (plannedCheapPreflightKeys.size !== declaredCheapPreflightKeys.size ||
    [...plannedCheapPreflightKeys].some((key) => !declaredCheapPreflightKeys.has(key))) {
    fail('dependencies', 'cheap-preflight dependencies must exactly match action.requiredCheapPreflightActionKeys.');
  }
  const derivedClass = declaredCheapPreflightKeys.size > 0 ? 'expensive' : 'cheap-preflight';
  if (scheduledClass !== derivedClass) {
    fail('executionClass', `must match required cheap-preflight topology (${derivedClass}).`);
  }
  return Object.freeze({
    schema: VERIFICATION_ACTION_PLAN_SCHEMA_V2,
    action,
    executionClass: scheduledClass,
    dependencies: Object.freeze(dependencies)
  });
}

export function parseVerificationActionPlanV2(source: string): VerificationActionPlanV2 {
  if (typeof source !== 'string') fail('VerificationAction plan', 'source must be text.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('VerificationAction plan is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction plan');
  exactKeys(value, ['schema', 'action', 'executionClass', 'dependencies'], 'VerificationAction plan');
  if (value.schema !== VERIFICATION_ACTION_PLAN_SCHEMA_V2) {
    fail('VerificationAction plan', 'schema mismatch; V1 plans are not reusable.');
  }
  return createVerificationActionPlanV2({
    action: value.action,
    executionClass: value.executionClass,
    dependencies: value.dependencies
  });
}

export function createVerificationActionPlanClosureV1(input: Readonly<{
  producer: Readonly<{ identity: string; revision: string }>;
  plans: readonly unknown[];
}>): VerificationActionPlanClosureV1 {
  const producer = ordinaryRecord(input.producer, 'VerificationAction plan closure.producer');
  exactKeys(producer, ['identity', 'revision'], 'VerificationAction plan closure.producer');
  const plans = ordinaryArray(input.plans, 'VerificationAction plan closure.plans')
    .map((plan) => parseVerificationActionPlanV2(encodeCanonical(plan)))
    .sort((left, right) => compareCanonicalText(left.action.actionKey, right.action.actionKey));
  if (plans.length === 0 || new Set(plans.map(({ action }) => action.actionKey)).size !== plans.length) {
    fail('VerificationAction plan closure.plans', 'must contain one or more unique Action plans.');
  }
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1,
    producer: Object.freeze({
      identity: text(producer.identity, 'VerificationAction plan closure.producer.identity'),
      revision: text(producer.revision, 'VerificationAction plan closure.producer.revision')
    }),
    plans: Object.freeze(plans)
  });
  return Object.freeze({ ...material, closureDigest: contentDigest(material) });
}

export function parseVerificationActionPlanClosureV1(source: string): VerificationActionPlanClosureV1 {
  if (typeof source !== 'string') fail('VerificationAction plan closure', 'source must be text.');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('VerificationAction plan closure is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction plan closure');
  exactKeys(value, ['schema', 'producer', 'plans', 'closureDigest'], 'VerificationAction plan closure');
  if (value.schema !== VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1) {
    fail('VerificationAction plan closure', 'schema mismatch.');
  }
  const rebuilt = createVerificationActionPlanClosureV1({
    producer: value.producer as Readonly<{ identity: string; revision: string }>,
    plans: ordinaryArray(value.plans, 'VerificationAction plan closure.plans')
  });
  if (value.closureDigest !== rebuilt.closureDigest) {
    fail('VerificationAction plan closure', 'digest mismatch.');
  }
  return rebuilt;
}

const DEPENDENCY_STATES = new Set<VerificationActionDependencyStateV2>([
  'queued', 'running', 'terminal-passed', 'terminal-failed', 'not-run', 'unsupported',
  'invalidated', 'cancelled', 'unknown'
]);

export function isVerificationActionRunnableV2(
  plan: VerificationActionPlanV2,
  resolutions: readonly VerificationActionDependencyResolutionV2[] = []
): { readonly runnable: boolean; readonly reason: string | null } {
  const resolved = new Map<VerificationActionKeyDigest, VerificationActionDependencyStateV2>();
  for (const resolution of resolutions) {
    const actionKey = digest(resolution.actionKey, 'dependency resolution actionKey');
    if (resolved.has(actionKey)) {
      return Object.freeze({
        runnable: false,
        reason: `duplicate machine state for dependency ${actionKey}`
      });
    }
    const state = resolution.state;
    if (!DEPENDENCY_STATES.has(state)) {
      return Object.freeze({
        runnable: false,
        reason: `dependency ${actionKey} has an invalid machine state`
      });
    }
    resolved.set(actionKey, state);
  }
  for (const dependency of plan.dependencies) {
    const state = resolved.get(dependency.actionKey) ?? 'unknown';
    if (state !== 'terminal-passed') {
      return Object.freeze({
        runnable: false,
        reason: `${dependency.kind} dependency ${dependency.actionKey} is ${state}`
      });
    }
  }
  return Object.freeze({ runnable: true, reason: null });
}

export function verificationActionDependsOnChangedInputsV2(
  action: VerificationActionKeyV2,
  changedInputPaths: readonly string[] | null,
  changedUpstreamActionKeys: readonly VerificationActionKeyDigest[] = []
): boolean {
  if (changedInputPaths === null) return true;
  const changedPaths = new Set(changedInputPaths.map((value) => relativeInputPath(value, 'changedInputPaths')));
  if (action.inputClosure.some(({ path: inputPath }) => changedPaths.has(inputPath))) return true;
  const changedUpstream = new Set(changedUpstreamActionKeys.map((value) => digest(value, 'changedUpstreamActionKeys')));
  return action.upstreamActionKeys.some((upstream) => changedUpstream.has(upstream));
}
