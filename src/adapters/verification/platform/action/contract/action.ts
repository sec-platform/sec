/**
 * Content-addressed VerificationAction identity and pure scheduling contract.
 *
 * The V2 boundary is deliberately strict. Runtime callers may provide only
 * ordinary JSON-like data; no getter, proxy, symbol, custom prototype, toJSON
 * hook, or cyclic object is allowed to participate in identity or planning.
 * Execution cost/lane is plan policy, not semantic ActionKey identity.
 */

import path from 'node:path';
import { types as nodeTypes } from 'node:util';

import type { VerificationReasonCode, VerificationResultStatus } from '../../../../../assurance/verification/result/contract/result.ts';
import { assertVerificationStatusReason } from '../../../../../assurance/verification/result/contract/result.ts';
import { rawSha256Hex, sha256 } from '../../../../../contracts/canonical.ts';
import {
  assertDomainReadbackReceipt,
  assertOwnerTerminalJoinReceipt,
  assertProviderSettlementSet,
  assertSemanticOperationProjection,
  type BoundSemanticOperation,
  type DomainReadbackReceipt,
  type OwnerTerminalJoinReceipt,
  type ProviderSettlementSet
} from '../../../../../execution/operation/semantic.ts';
import {
  parseBoundedProcessDiagnosticObjectReceipt,
  type BoundedProcessDiagnosticObjectReadbackReceipt,
  type BoundedProcessDiagnosticPublishedObject
} from '../../../../runtime-state/workspace-state/bounded-process-diagnostic-contract.ts';

const VERIFICATION_ACTION_KEY_SCHEMA =
  'sec-verification-action-key-v2' as const;

/**
 * One Verification Action owns one bounded process attempt.  The values retain
 * the existing five-minute Action lease and the Verification local-runner's
 * existing 16 MiB per-stream command ceilings.  Stdin is intentionally absent:
 * ProcessResourceSession interprets a missing input-bytes budget as an exact
 * zero-byte allowance.
 */
export const VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY = Object.freeze({
  durationMs: 300_000,
  maxStderrBytes: 16 * 1024 * 1024,
  maxStdoutBytes: 16 * 1024 * 1024,
  processes: 1
});
const VERIFICATION_ACTION_PLAN_SCHEMA =
  'sec-verification-action-plan-v2' as const;

export type VerificationActionKeyDigest = `sha256:${string}`;

type VerificationActionOperation = Readonly<{
  /** Stable producer-owned operation identity; no raw command selectors. */
  identity: string;
  /** Version of the producer's semantic operation normalizer. */
  revision: string;
  /** Digest of the canonical operation after selectors and context resolve. */
  semanticDigest: VerificationActionKeyDigest;
  /** Canonical repository-relative logical cwd; `.` is the repository root. */
  workingDirectory: string;
  declaredEnvironment: readonly VerificationActionEnvironmentBinding[];
}>;

export type VerificationActionExecutionClass = 'cheap-preflight' | 'expensive';

type VerificationActionEnvironmentBinding = Readonly<{
  name: string;
  digest: VerificationActionKeyDigest;
}>;

type VerificationActionProducer = Readonly<{
  identity: string;
  revision: string;
}>;

export type VerificationActionInputRef = Readonly<{
  path: string;
  digest: VerificationActionKeyDigest;
}>;

type VerificationActionEnvironment = Readonly<{
  toolchainRevision: string;
  providerRevision: string;
  contractRevision: string;
}>;

export type VerificationActionKeyInput = Readonly<{
  actionKind: string;
  producer: VerificationActionProducer;
  operation: VerificationActionOperation;
  inputClosure: readonly VerificationActionInputRef[];
  environment: VerificationActionEnvironment;
  /** Producer-owned cheap preflight topology required by an expensive plan. */
  requiredCheapPreflightActionKeys: readonly VerificationActionKeyDigest[];
  upstreamActionKeys: readonly VerificationActionKeyDigest[];
  resultSchemaRevision: string;
}>;

export type VerificationActionKey = VerificationActionKeyInput & Readonly<{
  schema: typeof VERIFICATION_ACTION_KEY_SCHEMA;
  actionKey: VerificationActionKeyDigest;
}>;

type VerificationActionDecisionReceipt = Readonly<{
  actionKey: VerificationActionKeyDigest;
  operationIdentityDigest: VerificationActionKeyDigest;
  executionPlanDigest: VerificationActionKeyDigest;
  bindingSetIdentityDigest: VerificationActionKeyDigest;
  decisionReceiptDigest: VerificationActionKeyDigest;
}>;

type VerificationActionAttemptReceipt = Readonly<{
  decisionReceiptDigest: VerificationActionKeyDigest;
  boundAttemptDigest: VerificationActionKeyDigest;
  attemptReceiptDigest: VerificationActionKeyDigest;
}>;

type VerificationActionProviderSetReceipt = Readonly<{
  attemptReceiptDigest: VerificationActionKeyDigest;
  providerProjectionDigest: VerificationActionKeyDigest;
  providerReceiptDigests: readonly VerificationActionKeyDigest[];
  providerSetReceiptDigest: VerificationActionKeyDigest;
}>;

type VerificationActionReadbackReceipt = Readonly<{
  attemptReceiptDigest: VerificationActionKeyDigest;
  providerSetReceiptDigest: VerificationActionKeyDigest;
  readbackProjectionDigest: VerificationActionKeyDigest;
  disposition: 'applied' | 'not-applied' | 'unknown';
  readbackReceiptDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionOwnerTerminalReceipt = Readonly<{
  decision: VerificationActionDecisionReceipt;
  attempt: VerificationActionAttemptReceipt;
  providerSet: VerificationActionProviderSetReceipt;
  readback: VerificationActionReadbackReceipt;
  ownerTerminalProjectionDigest: VerificationActionKeyDigest;
  ownerTerminalContractDigest: VerificationActionKeyDigest;
  ownerTerminalReferenceDigest: VerificationActionKeyDigest;
  terminalReceiptDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionTerminal = Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionKind: 'process' | 'non-process';
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  boundAttemptDigest: VerificationActionKeyDigest;
  ownerTerminalReceiptDigest: VerificationActionKeyDigest;
  diagnosticObjects: readonly BoundedProcessDiagnosticPublishedObject[];
  resultDigest: VerificationActionKeyDigest;
}>;

/**
 * Verification-owned projection of an operation owner's terminal join.
 * Semantic operation infrastructure proves only exact provider/readback/join
 * closure; it never chooses a Verification business status.
 */
export type VerificationActionTerminalSettlement = Readonly<{
  terminal: VerificationActionTerminal;
  ownerTerminalReceipt: VerificationActionOwnerTerminalReceipt;
}>;

const ISSUED_VERIFICATION_ACTION_TERMINAL_SETTLEMENTS = new WeakSet<object>();
const ISSUED_VERIFICATION_ACTION_DECISIONS = new WeakSet<object>();
const ISSUED_VERIFICATION_ACTION_ATTEMPTS = new WeakSet<object>();
const ISSUED_VERIFICATION_ACTION_PROVIDER_SETS = new WeakSet<object>();
const ISSUED_VERIFICATION_ACTION_READBACKS = new WeakSet<object>();
const ISSUED_VERIFICATION_ACTION_OWNER_TERMINALS = new WeakSet<object>();

type VerificationActionDependencyKind = 'cheap-preflight' | 'upstream';
export type VerificationActionDependencyState =
  | 'queued'
  | 'running'
  | 'terminal-passed'
  | 'terminal-failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated'
  | 'cancelled'
  | 'unknown';

export type VerificationActionDependency = Readonly<{
  actionKey: VerificationActionKeyDigest;
  kind: VerificationActionDependencyKind;
}>;

export type VerificationActionDependencyResolution = Readonly<{
  actionKey: VerificationActionKeyDigest;
  state: VerificationActionDependencyState;
  /** Latest journal event digest used to detect same-state closure replacement. */
  observationDigest?: VerificationActionKeyDigest | null;
}>;

export type VerificationActionPlan = Readonly<{
  schema: typeof VERIFICATION_ACTION_PLAN_SCHEMA;
  action: VerificationActionKey;
  /** Scheduler lane policy; never included in ActionKey identity. */
  executionClass: VerificationActionExecutionClass;
  dependencies: readonly VerificationActionDependency[];
}>;

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

function executionClass(value: unknown, label: string): VerificationActionExecutionClass {
  if (value !== 'cheap-preflight' && value !== 'expensive') {
    fail(label, 'must be `cheap-preflight` or `expensive`.');
  }
  return value;
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
    assertVerificationStatusReason(
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
): readonly VerificationActionEnvironmentBinding[] {
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
): readonly VerificationActionInputRef[] {
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

function canonicalInput(input: unknown): VerificationActionKeyInput {
  const value = ordinaryRecord(input, 'VerificationAction key input');
  assertNoIdentityKey(value, 'VerificationAction key input');
  exactKeys(value, [
    'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision'
  ], 'VerificationAction key input');
  const producer = ordinaryRecord(value.producer, 'producer');
  exactKeys(producer, ['identity', 'revision'], 'producer');
  const operation = ordinaryRecord(value.operation, 'operation');
  exactKeys(operation, [
    'identity', 'revision', 'semanticDigest', 'workingDirectory', 'declaredEnvironment'
  ], 'operation');
  const environment = ordinaryRecord(value.environment, 'environment');
  exactKeys(environment, ['toolchainRevision', 'providerRevision', 'contractRevision'], 'environment');
  const declaredEnvironment = ordinaryArray(operation.declaredEnvironment, 'operation.declaredEnvironment');
  const inputClosure = ordinaryArray(value.inputClosure, 'inputClosure');
  const requiredCheapPreflightActionKeys = ordinaryArray(
    value.requiredCheapPreflightActionKeys,
    'requiredCheapPreflightActionKeys'
  );
  const upstreamActionKeys = ordinaryArray(value.upstreamActionKeys, 'upstreamActionKeys');
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
      contractRevision: text(environment.contractRevision, 'environment.contractRevision')
    }),
    requiredCheapPreflightActionKeys: canonicalCheap,
    upstreamActionKeys: canonicalUpstream,
    resultSchemaRevision: text(value.resultSchemaRevision, 'resultSchemaRevision')
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
export function encodeVerificationActionData(value: unknown): string {
  return encodeCanonical(value);
}

function keyDigest(input: VerificationActionKeyInput): VerificationActionKeyDigest {
  return `sha256:${rawSha256Hex(encodeCanonical({
    schema: VERIFICATION_ACTION_KEY_SCHEMA,
    ...input
  }))}`;
}

export function createVerificationActionKey(input: unknown): VerificationActionKey {
  const canonical = canonicalInput(input);
  return Object.freeze({
    schema: VERIFICATION_ACTION_KEY_SCHEMA,
    ...canonical,
    actionKey: keyDigest(canonical)
  });
}

export function parseVerificationActionKey(source: string): VerificationActionKey {
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
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision', 'actionKey'
  ], 'VerificationAction key');
  if (value.schema !== VERIFICATION_ACTION_KEY_SCHEMA) {
    fail('VerificationAction key', 'schema mismatch.');
  }
  const withoutDigest: OrdinaryRecord = {};
  for (const key of [
    'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision'
  ]) {
    withoutDigest[key] = value[key];
  }
  const canonical = canonicalInput(withoutDigest);
  const expected = keyDigest(canonical);
  if (value.actionKey !== expected) fail('VerificationAction key', 'digest mismatch.');
  return createVerificationActionKey(canonical);
}

export function createVerificationActionTerminal(
  input: unknown
): VerificationActionTerminal {
  const value = ordinaryRecord(input, 'VerificationAction terminal');
  exactKeys(value, [
    'actionKey', 'executionKind', 'status', 'reasonCode', 'boundAttemptDigest',
    'ownerTerminalReceiptDigest',
    'diagnosticObjects', 'resultDigest'
  ], 'VerificationAction terminal');
  assertCanonicalStatusReason(value.status, value.reasonCode);
  const actionKey = digest(value.actionKey, 'VerificationAction terminal.actionKey');
  const boundAttemptDigest = digest(
    value.boundAttemptDigest,
    'VerificationAction terminal.boundAttemptDigest'
  );
  const ownerTerminalReceiptDigest = digest(
    value.ownerTerminalReceiptDigest,
    'VerificationAction terminal.ownerTerminalReceiptDigest'
  );
  const diagnosticObjects = ordinaryArray(
    value.diagnosticObjects,
    'VerificationAction terminal.diagnosticObjects'
  ).map((candidate, index) => canonicalDiagnosticObject(
    candidate,
    `VerificationAction terminal.diagnosticObjects[${index}]`
  )).sort((left, right) => left.receipt.stream.localeCompare(right.receipt.stream));
  if (value.executionKind !== 'process' && value.executionKind !== 'non-process') {
    fail('VerificationAction terminal.executionKind', 'must be process or non-process.');
  }
  if (value.executionKind === 'process' && diagnosticObjects.length === 0) {
    fail(
      'VerificationAction terminal.diagnosticObjects',
      'must contain owner-issued diagnostic evidence for a process terminal.'
    );
  }
  if (value.executionKind === 'non-process' && diagnosticObjects.length !== 0) {
    fail(
      'VerificationAction terminal.diagnosticObjects',
      'must be empty for an explicitly non-process terminal.'
    );
  }
  if (new Set(diagnosticObjects.map(({ receipt }) => receipt.stream)).size
      !== diagnosticObjects.length) {
    fail('VerificationAction terminal.diagnosticObjects', 'contains duplicate stream objects.');
  }
  if (diagnosticObjects.some(({ receipt }) => receipt.boundAttemptDigest !== boundAttemptDigest)) {
    fail(
      'VerificationAction terminal.diagnosticObjects',
      'contains a diagnostic object from a different operation attempt.'
    );
  }
  const diagnosticSubjects = new Set(
    diagnosticObjects.map(({ receipt }) => receipt.subjectDigest)
  );
  const diagnosticSettlements = new Set(
    diagnosticObjects.map(({ receipt }) => receipt.settlementDigest)
  );
  if (diagnosticSubjects.size > 1 || diagnosticSettlements.size > 1) {
    fail(
      'VerificationAction terminal.diagnosticObjects',
      'does not bind one subject and one process settlement.'
    );
  }
  const resultDigest = digest(value.resultDigest, 'VerificationAction terminal.resultDigest');
  if (resultDigest !== sha256({
    actionKey,
    executionKind: value.executionKind,
    status: value.status,
    reasonCode: value.reasonCode,
    boundAttemptDigest,
    ownerTerminalReceiptDigest,
    diagnosticObjects: diagnosticObjects.map(({ receipt, readback }) => ({
      objectDigest: receipt.objectDigest,
      readbackDigest: readback.readbackDigest
    }))
  })) {
    fail('VerificationAction terminal.resultDigest', 'does not bind the terminal attempt and diagnostics.');
  }
  return Object.freeze({
    actionKey,
    executionKind: value.executionKind,
    status: value.status as VerificationResultStatus,
    reasonCode: value.reasonCode as VerificationReasonCode,
    boundAttemptDigest,
    ownerTerminalReceiptDigest,
    diagnosticObjects: Object.freeze(diagnosticObjects),
    resultDigest
  });
}

function canonicalDiagnosticObject(
  input: unknown,
  label: string
): BoundedProcessDiagnosticPublishedObject {
  const value = ordinaryRecord(input, label);
  exactKeys(value, ['receipt', 'readback'], label);
  const receipt = parseBoundedProcessDiagnosticObjectReceipt(
    encodeCanonical(value.receipt)
  );
  const readback = ordinaryRecord(value.readback, `${label}.readback`);
  exactKeys(readback, [
    'disposition', 'objectDigest', 'physicalIdentityDigest', 'contentDigest',
    'byteLength', 'readbackDigest'
  ], `${label}.readback`);
  if (readback.disposition !== 'current'
      || !Number.isSafeInteger(readback.byteLength) || Number(readback.byteLength) < 0) {
    fail(`${label}.readback`, 'has invalid disposition or byte length.');
  }
  const unsigned = Object.freeze({
    disposition: 'current' as const,
    objectDigest: digest(readback.objectDigest, `${label}.readback.objectDigest`),
    physicalIdentityDigest: digest(
      readback.physicalIdentityDigest,
      `${label}.readback.physicalIdentityDigest`
    ),
    contentDigest: digest(readback.contentDigest, `${label}.readback.contentDigest`),
    byteLength: Number(readback.byteLength)
  });
  const canonicalReadback = Object.freeze({
    ...unsigned,
    readbackDigest: digest(readback.readbackDigest, `${label}.readback.readbackDigest`)
  }) as BoundedProcessDiagnosticObjectReadbackReceipt;
  if (canonicalReadback.objectDigest !== receipt.objectDigest
      || canonicalReadback.contentDigest !== receipt.contentDigest
      || canonicalReadback.byteLength !== receipt.byteLength
      || canonicalReadback.readbackDigest !== sha256(unsigned)) {
    fail(`${label}.readback`, 'does not bind the exact diagnostic object.');
  }
  return Object.freeze({ receipt, readback: canonicalReadback });
}

/**
 * Verification Action owner cut: generic semantic receipts contribute only
 * correlation digests.  This function issues the non-forgeable Action-owned
 * decision -> attempt -> provider set -> readback -> terminal chain.
 */
export function issueVerificationActionOwnerTerminalReceipt(input: Readonly<{
  action: VerificationActionKey;
  operation: BoundSemanticOperation;
  providerSettlementSet: ProviderSettlementSet;
  readback: DomainReadbackReceipt;
  ownerTerminalProjection: OwnerTerminalJoinReceipt;
}>): VerificationActionOwnerTerminalReceipt {
  const action = parseVerificationActionKey(encodeCanonical(input.action));
  assertSemanticOperationProjection(input.operation);
  assertProviderSettlementSet(input.providerSettlementSet);
  assertDomainReadbackReceipt(input.readback);
  assertOwnerTerminalJoinReceipt(input.ownerTerminalProjection);
  const operation = input.operation;
  const operationBindsAction = operation.plan.identity.intentDigest === action.actionKey
    || action.operation.semanticDigest === operation.plan.identity.identityDigest;
  if (!operationBindsAction) {
    fail('VerificationAction owner terminal', 'operation does not bind the exact Action identity.');
  }
  if (input.providerSettlementSet.operationIdentityDigest
        !== operation.plan.identity.identityDigest
      || input.providerSettlementSet.executionPlanDigest
        !== operation.plan.execution.executionPlanDigest
      || input.providerSettlementSet.bindingSetIdentityDigest
        !== operation.bindingSetIdentityDigest
      || input.providerSettlementSet.boundAttemptDigest !== operation.boundAttemptDigest
      || input.readback.operationIdentityDigest !== operation.plan.identity.identityDigest
      || input.readback.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || input.readback.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || input.readback.boundAttemptDigest !== operation.boundAttemptDigest
      || input.readback.providerSettlementSetDigest
        !== input.providerSettlementSet.providerSettlementSetDigest
      || input.ownerTerminalProjection.operationIdentityDigest
        !== operation.plan.identity.identityDigest
      || input.ownerTerminalProjection.executionPlanDigest
        !== operation.plan.execution.executionPlanDigest
      || input.ownerTerminalProjection.bindingSetIdentityDigest
        !== operation.bindingSetIdentityDigest
      || input.ownerTerminalProjection.boundAttemptDigest !== operation.boundAttemptDigest
      || input.ownerTerminalProjection.providerSettlementSetDigest
        !== input.providerSettlementSet.providerSettlementSetDigest
      || input.ownerTerminalProjection.readbackReceiptDigest
        !== input.readback.readbackReceiptDigest) {
    fail('VerificationAction owner terminal', 'correlation projections do not bind one Action attempt.');
  }
  const decisionWithoutDigest = Object.freeze({
    actionKey: action.actionKey,
    operationIdentityDigest: operation.plan.identity.identityDigest,
    executionPlanDigest: operation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: operation.bindingSetIdentityDigest
  });
  const decision = Object.freeze({
    ...decisionWithoutDigest,
    decisionReceiptDigest: sha256({
      domain: 'verification.action.decision',
      receipt: decisionWithoutDigest
    }) as VerificationActionKeyDigest
  });
  ISSUED_VERIFICATION_ACTION_DECISIONS.add(decision);
  const attemptWithoutDigest = Object.freeze({
    decisionReceiptDigest: decision.decisionReceiptDigest,
    boundAttemptDigest: operation.boundAttemptDigest
  });
  const attempt = Object.freeze({
    ...attemptWithoutDigest,
    attemptReceiptDigest: sha256({
      domain: 'verification.action.attempt',
      receipt: attemptWithoutDigest
    }) as VerificationActionKeyDigest
  });
  ISSUED_VERIFICATION_ACTION_ATTEMPTS.add(attempt);
  const providerSetWithoutDigest = Object.freeze({
    attemptReceiptDigest: attempt.attemptReceiptDigest,
    providerProjectionDigest: input.providerSettlementSet.providerSettlementSetDigest,
    providerReceiptDigests: Object.freeze([
      ...input.providerSettlementSet.providerReceiptDigests
    ])
  });
  const providerSet = Object.freeze({
    ...providerSetWithoutDigest,
    providerSetReceiptDigest: sha256({
      domain: 'verification.action.provider-set',
      receipt: providerSetWithoutDigest
    }) as VerificationActionKeyDigest
  });
  ISSUED_VERIFICATION_ACTION_PROVIDER_SETS.add(providerSet);
  const readbackWithoutDigest = Object.freeze({
    attemptReceiptDigest: attempt.attemptReceiptDigest,
    providerSetReceiptDigest: providerSet.providerSetReceiptDigest,
    readbackProjectionDigest: input.readback.readbackReceiptDigest,
    disposition: input.readback.disposition
  });
  const readback = Object.freeze({
    ...readbackWithoutDigest,
    readbackReceiptDigest: sha256({
      domain: 'verification.action.readback',
      receipt: readbackWithoutDigest
    }) as VerificationActionKeyDigest
  });
  ISSUED_VERIFICATION_ACTION_READBACKS.add(readback);
  const terminalWithoutDigest = Object.freeze({
    decision,
    attempt,
    providerSet,
    readback,
    ownerTerminalProjectionDigest: input.ownerTerminalProjection.joinReceiptDigest,
    ownerTerminalContractDigest: input.ownerTerminalProjection.ownerTerminalContractDigest,
    ownerTerminalReferenceDigest: input.ownerTerminalProjection.ownerTerminalReferenceDigest
  });
  const terminal = Object.freeze({
    ...terminalWithoutDigest,
    terminalReceiptDigest: sha256({
      domain: 'verification.action.owner-terminal',
      receipt: terminalWithoutDigest
    }) as VerificationActionKeyDigest
  });
  ISSUED_VERIFICATION_ACTION_OWNER_TERMINALS.add(terminal);
  return terminal;
}

function assertVerificationActionOwnerTerminalReceipt(
  value: unknown
): asserts value is VerificationActionOwnerTerminalReceipt {
  if (value === null || typeof value !== 'object'
      || !ISSUED_VERIFICATION_ACTION_OWNER_TERMINALS.has(value)) {
    fail('VerificationAction owner terminal', 'receipt is not Action-owner-issued.');
  }
  const receipt = value as VerificationActionOwnerTerminalReceipt;
  if (!ISSUED_VERIFICATION_ACTION_DECISIONS.has(receipt.decision)
      || !ISSUED_VERIFICATION_ACTION_ATTEMPTS.has(receipt.attempt)
      || !ISSUED_VERIFICATION_ACTION_PROVIDER_SETS.has(receipt.providerSet)
      || !ISSUED_VERIFICATION_ACTION_READBACKS.has(receipt.readback)) {
    fail('VerificationAction owner terminal', 'receipt chain is not Action-owner-issued.');
  }
}

function issueVerificationActionTerminalSettlement(
  ownerTerminalReceipt: VerificationActionOwnerTerminalReceipt,
  input: Readonly<{
    executionKind: 'process' | 'non-process';
    status: VerificationResultStatus;
    reasonCode: VerificationReasonCode;
    diagnosticObjects: readonly BoundedProcessDiagnosticPublishedObject[];
  }>
): VerificationActionTerminalSettlement {
  assertVerificationActionOwnerTerminalReceipt(ownerTerminalReceipt);
  const diagnosticObjects = Object.freeze(
    [...input.diagnosticObjects]
      .map((value, index) => canonicalDiagnosticObject(value, `diagnosticObjects[${index}]`))
      .sort((left, right) => left.receipt.stream.localeCompare(right.receipt.stream))
  );
  if (diagnosticObjects.some(({ receipt }) => (
    receipt.boundAttemptDigest !== ownerTerminalReceipt.attempt.boundAttemptDigest
    || receipt.operationIdentityDigest !== ownerTerminalReceipt.decision.operationIdentityDigest
    || receipt.executionPlanDigest !== ownerTerminalReceipt.decision.executionPlanDigest
  ))) {
    fail(
      'diagnosticObjects',
      'must bind the exact owner terminal operation attempt.'
    );
  }
  const settlement = Object.freeze({
    terminal: createVerificationActionTerminal({
      actionKey: ownerTerminalReceipt.decision.actionKey,
      executionKind: input.executionKind,
      status: input.status,
      reasonCode: input.reasonCode,
      boundAttemptDigest: ownerTerminalReceipt.attempt.boundAttemptDigest,
      ownerTerminalReceiptDigest: ownerTerminalReceipt.terminalReceiptDigest,
      diagnosticObjects,
      resultDigest: sha256({
        actionKey: ownerTerminalReceipt.decision.actionKey,
        executionKind: input.executionKind,
        status: input.status,
        reasonCode: input.reasonCode,
        boundAttemptDigest: ownerTerminalReceipt.attempt.boundAttemptDigest,
        ownerTerminalReceiptDigest: ownerTerminalReceipt.terminalReceiptDigest,
        diagnosticObjects: diagnosticObjects.map(({ receipt, readback }) => ({
          objectDigest: receipt.objectDigest,
          readbackDigest: readback.readbackDigest
        }))
      })
    }),
    ownerTerminalReceipt
  });
  ISSUED_VERIFICATION_ACTION_TERMINAL_SETTLEMENTS.add(settlement);
  return settlement;
}

/** Issue a Verification terminal for an operation that settled a real process. */
export function issueProcessVerificationActionTerminalSettlement(
  ownerTerminalReceipt: VerificationActionOwnerTerminalReceipt,
  input: Readonly<{
    status: VerificationResultStatus;
    reasonCode: VerificationReasonCode;
    diagnosticObjects: readonly BoundedProcessDiagnosticPublishedObject[];
  }>
): VerificationActionTerminalSettlement {
  if (input.diagnosticObjects.length === 0) {
    fail(
      'diagnosticObjects',
      'must contain owner-issued diagnostic evidence for a process terminal.'
    );
  }
  return issueVerificationActionTerminalSettlement(ownerTerminalReceipt, {
    ...input,
    executionKind: 'process'
  });
}

/** Issue a Verification terminal only when the operation did not start a process. */
export function issueNonProcessVerificationActionTerminalSettlement(
  ownerTerminalReceipt: VerificationActionOwnerTerminalReceipt,
  input: Readonly<{
    status: VerificationResultStatus;
    reasonCode: VerificationReasonCode;
  }>
): VerificationActionTerminalSettlement {
  return issueVerificationActionTerminalSettlement(ownerTerminalReceipt, {
    ...input,
    executionKind: 'non-process',
    diagnosticObjects: Object.freeze([])
  });
}

/** Project only a Verification-owner-issued settlement into durable state. */
export function projectVerificationActionTerminal(
  settlement: unknown
): VerificationActionTerminal {
  if (settlement === null || typeof settlement !== 'object'
      || !ISSUED_VERIFICATION_ACTION_TERMINAL_SETTLEMENTS.has(settlement)) {
    throw new Error('VerificationAction terminal settlement is not Verification-owner-issued.');
  }
  return (settlement as VerificationActionTerminalSettlement).terminal;
}

export function createVerificationActionPlan(input: unknown): VerificationActionPlan {
  const value = ordinaryRecord(input, 'VerificationAction plan');
  exactKeys(value, ['action', 'executionClass', 'dependencies'], 'VerificationAction plan');
  const action = parseVerificationActionKey(encodeCanonical(value.action));
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
      kind: kind as VerificationActionDependencyKind
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
    schema: VERIFICATION_ACTION_PLAN_SCHEMA,
    action,
    executionClass: scheduledClass,
    dependencies: Object.freeze(dependencies)
  });
}

export function parseVerificationActionPlan(source: string): VerificationActionPlan {
  if (typeof source !== 'string') fail('VerificationAction plan', 'source must be text.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('VerificationAction plan is not valid JSON.', { cause: error });
  }
  const value = ordinaryRecord(parsed, 'VerificationAction plan');
  exactKeys(value, ['schema', 'action', 'executionClass', 'dependencies'], 'VerificationAction plan');
  if (value.schema !== VERIFICATION_ACTION_PLAN_SCHEMA) {
    fail('VerificationAction plan', 'schema mismatch; V1 plans are not reusable.');
  }
  return createVerificationActionPlan({
    action: value.action,
    executionClass: value.executionClass,
    dependencies: value.dependencies
  });
}

const DEPENDENCY_STATES = new Set<VerificationActionDependencyState>([
  'queued', 'running', 'terminal-passed', 'terminal-failed', 'not-run', 'unsupported',
  'invalidated', 'cancelled', 'unknown'
]);

export function isVerificationActionRunnable(
  plan: VerificationActionPlan,
  resolutions: readonly VerificationActionDependencyResolution[] = []
): { readonly runnable: boolean; readonly reason: string | null } {
  const resolved = new Map<VerificationActionKeyDigest, VerificationActionDependencyState>();
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

export function verificationActionDependsOnChangedInputs(
  action: VerificationActionKey,
  changedInputPaths: readonly string[] | null,
  changedUpstreamActionKeys: readonly VerificationActionKeyDigest[] = []
): boolean {
  if (changedInputPaths === null) return true;
  const changedPaths = new Set(changedInputPaths.map((value) => relativeInputPath(value, 'changedInputPaths')));
  if (action.inputClosure.some(({ path: inputPath }) => changedPaths.has(inputPath))) return true;
  const changedUpstream = new Set(changedUpstreamActionKeys.map((value) => digest(value, 'changedUpstreamActionKeys')));
  return action.upstreamActionKeys.some((upstream) => changedUpstream.has(upstream));
}
