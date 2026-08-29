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
} from '../../result/index.ts';
import { CodexDevelopmentAssertVerificationStatusReasonV1 } from '../../result/index.ts';

export const VERIFICATION_ACTION_KEY_SCHEMA_V2 =
  'sec-verification-action-key-v2' as const;
export const VERIFICATION_ACTION_PLAN_SCHEMA_V2 =
  'sec-verification-action-plan-v2' as const;

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
}>;

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
}>;

export type VerificationActionKeyV2 = VerificationActionKeyInputV2 & Readonly<{
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

function canonicalInput(input: unknown): VerificationActionKeyInputV2 {
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
export function encodeVerificationActionDataV2(value: unknown): string {
  return encodeCanonical(value);
}

function keyDigest(input: VerificationActionKeyInputV2): VerificationActionKeyDigest {
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
    'requiredCheapPreflightActionKeys', 'upstreamActionKeys', 'resultSchemaRevision', 'actionKey'
  ], 'VerificationAction key');
  if (value.schema !== VERIFICATION_ACTION_KEY_SCHEMA_V2) {
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
