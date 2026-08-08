/**
 * Content-addressed VerificationAction identity and pure scheduling contract.
 *
 * This module deliberately does not create a second verification-result model.
 * Terminal actions carry the existing VerificationResult status/reason vocabulary;
 * reuse/join are execution observations, not result statuses.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  VerificationReasonCode,
  VerificationResultStatus
} from '../../platform/shared/verification-result-contract.ts';
import {
  CodexDevelopmentAssertVerificationGateResultV1,
  VERIFICATION_GATE_RESULT_SCHEMA_V1
} from '../../platform/shared/verification-result-contract.ts';

export const VERIFICATION_ACTION_KEY_SCHEMA_V1 =
  'sec-verification-action-key-v1' as const;
export const VERIFICATION_ACTION_PLAN_SCHEMA_V1 =
  'sec-verification-action-plan-v1' as const;

export type VerificationActionKeyDigest = `sha256:${string}`;

export type VerificationActionOperationV1 = Readonly<{
  /** Stable producer-owned operation identity; no raw command selectors. */
  identity: string;
  /** Version of the producer's semantic operation normalizer. */
  revision: string;
  /**
   * Digest of the canonical operation after ephemeral selectors, logical cwd,
   * and configuration-discovery context resolve to content identities.
   */
  semanticDigest: VerificationActionKeyDigest;
  declaredEnvironment: readonly VerificationActionEnvironmentBindingV1[];
}>;

export type VerificationActionEnvironmentBindingV1 = Readonly<{
  name: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionProducerV1 = Readonly<{
  identity: string;
  revision: string;
}>;

export type VerificationActionInputRefV1 = Readonly<{
  path: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionEnvironmentV1 = Readonly<{
  toolchainRevision: string;
  providerRevision: string;
  contractRevision: string;
}>;

export type VerificationActionKeyInputV1 = Readonly<{
  actionKind: string;
  producer: VerificationActionProducerV1;
  operation: VerificationActionOperationV1;
  inputClosure: readonly VerificationActionInputRefV1[];
  environment: VerificationActionEnvironmentV1;
  upstreamActionKeys: readonly VerificationActionKeyDigest[];
  resultSchemaRevision: string;
}>;

export type VerificationActionKeyV1 = VerificationActionKeyInputV1 & Readonly<{
  schema: typeof VERIFICATION_ACTION_KEY_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
}>;

export type VerificationActionTerminalV1 = Readonly<{
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  resultDigest: VerificationActionKeyDigest | null;
}>;

export type VerificationActionDependencyKindV1 = 'cheap-preflight' | 'upstream';
export type VerificationActionDependencyStateV1 =
  | 'running'
  | 'terminal-passed'
  | 'terminal-failed'
  | 'not-run'
  | 'unsupported'
  | 'invalidated'
  | 'unknown';

export type VerificationActionDependencyV1 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  kind: VerificationActionDependencyKindV1;
  state: VerificationActionDependencyStateV1;
}>;

export type VerificationActionPlanV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PLAN_SCHEMA_V1;
  action: VerificationActionKeyV1;
  expensive: boolean;
  dependencies: readonly VerificationActionDependencyV1[];
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
  'chat'
]);

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(label, `must contain exactly: ${expected.join(', ')}.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(label, 'must be an object.');
  }
  return value as Record<string, unknown>;
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

function assertNoIdentityKey(value: unknown, label: string): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoIdentityKey(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) {
      fail(label, `contains forbidden semantic identity field ${key}.`);
    }
    assertNoIdentityKey(child, `${label}.${key}`);
  }
}

/**
 * Route status/reason validation through the existing Verification Result
 * authority. The action terminal is an execution projection, not a second
 * result vocabulary, so it must accept exactly the same status/reason pairs
 * (including timeout, cleanup-failed and process-settlement-failed).
 */
function assertCanonicalStatusReason(
  status: unknown,
  reasonCode: unknown
): asserts status is VerificationResultStatus {
  const executed = status === 'passed' || status === 'failed';
  const applicability = status === 'invalidated' ? 'unresolved' : 'required';
  try {
    CodexDevelopmentAssertVerificationGateResultV1({
      schema: VERIFICATION_GATE_RESULT_SCHEMA_V1,
      gateId: 'verification-action-terminal',
      gateRevision: 'verification-action-terminal-v1',
      owner: 'verification-action-runner',
      requirementKey: 'verification-action-terminal',
      subjectRevision: 'verification-action-terminal-v1',
      inputDigest: `sha256:${'0'.repeat(64)}`,
      applicability,
      status,
      disposition: executed ? 'executed' : 'not-executed',
      reasonCode,
      requiredForClaims: [],
      supportedClaims: [],
      environment: executed
        ? {
          runtime: 'verification-action',
          os: 'verification-action',
          arch: 'verification-action',
          filesystem: null,
          capabilities: [],
          toolchainRevision: 'verification-action-terminal-v1',
          providerRevisions: []
        }
        : null,
      execution: executed
        ? {
          argv: [],
          startedAt: '1970-01-01T00:00:00.000Z',
          finishedAt: '1970-01-01T00:00:00.000Z',
          durationMs: 0,
          exitCode: status === 'failed' ? 1 : 0,
          outputDigest: `sha256:${'0'.repeat(64)}`,
          failureFingerprint: null
        }
        : null,
      evidenceRefs: [],
      invalidationRules: [],
      diagnostic: null
    });
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
  input: readonly VerificationActionEnvironmentBindingV1[]
): readonly VerificationActionEnvironmentBindingV1[] {
  const bindings = input.map((candidate, index) => {
    const value = record(candidate, `operation.declaredEnvironment[${index}]`);
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
  input: readonly VerificationActionInputRefV1[]
): readonly VerificationActionInputRefV1[] {
  const refs = input.map((candidate, index) => {
    const value = record(candidate, `inputClosure[${index}]`);
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

function canonicalUpstreamKeys(
  input: readonly VerificationActionKeyDigest[]
): readonly VerificationActionKeyDigest[] {
  const keys = input.map((candidate, index) => digest(candidate, `upstreamActionKeys[${index}]`));
  keys.sort();
  for (let index = 1; index < keys.length; index += 1) {
    if (keys[index - 1] === keys[index]) fail('upstreamActionKeys', 'contains a duplicate key.');
  }
  return Object.freeze(keys);
}

function canonicalInput(input: VerificationActionKeyInputV1): VerificationActionKeyInputV1 {
  const value = record(input, 'VerificationAction key input');
  assertNoIdentityKey(value, 'VerificationAction key input');
  exactKeys(value, [
    'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'upstreamActionKeys', 'resultSchemaRevision'
  ], 'VerificationAction key input');
  const producer = record(value.producer, 'producer');
  exactKeys(producer, ['identity', 'revision'], 'producer');
  const operation = record(value.operation, 'operation');
  exactKeys(operation, ['identity', 'revision', 'semanticDigest', 'declaredEnvironment'], 'operation');
  if (!Array.isArray(operation.declaredEnvironment)) {
    fail('operation.declaredEnvironment', 'must be an array.');
  }
  const environment = record(value.environment, 'environment');
  exactKeys(environment, ['toolchainRevision', 'providerRevision', 'contractRevision'], 'environment');
  if (!Array.isArray(value.inputClosure)) fail('inputClosure', 'must be an array.');
  if (!Array.isArray(value.upstreamActionKeys)) fail('upstreamActionKeys', 'must be an array.');
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
      declaredEnvironment: canonicalEnvironmentBindings(operation.declaredEnvironment as readonly VerificationActionEnvironmentBindingV1[])
    }),
    inputClosure: canonicalInputClosure(value.inputClosure as readonly VerificationActionInputRefV1[]),
    environment: Object.freeze({
      toolchainRevision: text(environment.toolchainRevision, 'environment.toolchainRevision'),
      providerRevision: text(environment.providerRevision, 'environment.providerRevision'),
      contractRevision: text(environment.contractRevision, 'environment.contractRevision')
    }),
    upstreamActionKeys: canonicalUpstreamKeys(value.upstreamActionKeys as readonly VerificationActionKeyDigest[]),
    resultSchemaRevision: text(value.resultSchemaRevision, 'resultSchemaRevision')
  });
}

function keyDigest(input: VerificationActionKeyInputV1): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    schema: VERIFICATION_ACTION_KEY_SCHEMA_V1,
    ...input
  })).digest('hex')}`;
}

export function createVerificationActionKeyV1(
  input: VerificationActionKeyInputV1
): VerificationActionKeyV1 {
  const canonical = canonicalInput(input);
  return Object.freeze({
    schema: VERIFICATION_ACTION_KEY_SCHEMA_V1,
    ...canonical,
    actionKey: keyDigest(canonical)
  });
}

export function parseVerificationActionKeyV1(source: string): VerificationActionKeyV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error('VerificationAction key is not valid JSON.', { cause: error });
  }
  const value = record(parsed, 'VerificationAction key');
  exactKeys(value, [
    'schema', 'actionKind', 'producer', 'operation', 'inputClosure', 'environment',
    'upstreamActionKeys', 'resultSchemaRevision', 'actionKey'
  ], 'VerificationAction key');
  if (value.schema !== VERIFICATION_ACTION_KEY_SCHEMA_V1) {
    fail('VerificationAction key', 'schema mismatch.');
  }
  const { actionKey, schema: _schema, ...withoutDigest } = value;
  const canonical = canonicalInput(withoutDigest as VerificationActionKeyInputV1);
  const expected = keyDigest(canonical);
  if (actionKey !== expected) fail('VerificationAction key', 'digest mismatch.');
  return createVerificationActionKeyV1(canonical);
}

export function createVerificationActionTerminalV1(
  input: VerificationActionTerminalV1
): VerificationActionTerminalV1 {
  const value = record(input, 'VerificationAction terminal');
  exactKeys(value, ['status', 'reasonCode', 'resultDigest'], 'VerificationAction terminal');
  assertCanonicalStatusReason(value.status, value.reasonCode);
  if (value.resultDigest !== null) digest(value.resultDigest, 'VerificationAction terminal.resultDigest');
  return Object.freeze({
    status: value.status as VerificationResultStatus,
    reasonCode: value.reasonCode as VerificationReasonCode,
    resultDigest: value.resultDigest === null
      ? null
      : digest(value.resultDigest, 'VerificationAction terminal.resultDigest')
  });
}

export function createVerificationActionPlanV1(input: {
  action: VerificationActionKeyV1;
  expensive: boolean;
  dependencies: readonly VerificationActionDependencyV1[];
}): VerificationActionPlanV1 {
  const action = parseVerificationActionKeyV1(JSON.stringify(input.action));
  if (typeof input.expensive !== 'boolean') {
    fail('expensive', 'must be a boolean.');
  }
  const dependencies = input.dependencies.map((candidate, index) => {
    const value = record(candidate, `dependency[${index}]`);
    exactKeys(value, ['actionKey', 'kind', 'state'], `dependency[${index}]`);
    const kind = value.kind;
    if (kind !== 'cheap-preflight' && kind !== 'upstream') {
      fail(`dependency[${index}].kind`, 'is invalid.');
    }
    const state = value.state;
    if (![
      'running', 'terminal-passed', 'terminal-failed', 'not-run', 'unsupported',
      'invalidated', 'unknown'
    ].includes(String(state))) {
      fail(`dependency[${index}].state`, 'is invalid.');
    }
    return Object.freeze({
      actionKey: digest(value.actionKey, `dependency[${index}].actionKey`),
      kind: kind as VerificationActionDependencyKindV1,
      state: state as VerificationActionDependencyStateV1
    });
  }).sort((left, right) => compareCanonicalText(
    `${left.kind}\0${left.actionKey}`,
    `${right.kind}\0${right.actionKey}`
  ));
  const duplicateKeys = new Set<string>();
  const declaredUpstreamKeys = new Set(action.upstreamActionKeys);
  const plannedUpstreamKeys = new Set<VerificationActionKeyDigest>();
  for (const dependency of dependencies) {
    const identity = `${dependency.kind}\0${dependency.actionKey}`;
    if (duplicateKeys.has(identity)) fail('dependencies', 'contains a duplicate dependency.');
    duplicateKeys.add(identity);
    if (dependency.actionKey === action.actionKey) {
      fail('dependencies', 'cannot contain the action itself as a dependency.');
    }
    if (dependency.kind === 'upstream') plannedUpstreamKeys.add(dependency.actionKey);
  }
  if (plannedUpstreamKeys.size !== declaredUpstreamKeys.size ||
    [...plannedUpstreamKeys].some((key) => !declaredUpstreamKeys.has(key))) {
    fail('dependencies', 'upstream dependencies must exactly match action.upstreamActionKeys.');
  }
  if (input.expensive === true && !dependencies.some(({ kind }) => kind === 'cheap-preflight')) {
    fail('expensive plan', 'requires at least one cheap-preflight dependency.');
  }
  return Object.freeze({
    schema: VERIFICATION_ACTION_PLAN_SCHEMA_V1,
    action,
    expensive: input.expensive === true,
    dependencies: Object.freeze(dependencies)
  });
}

export function isVerificationActionRunnableV1(
  plan: VerificationActionPlanV1
): { readonly runnable: boolean; readonly reason: string | null } {
  for (const dependency of plan.dependencies) {
    if (dependency.state !== 'terminal-passed') {
      return Object.freeze({
        runnable: false,
        reason: `${dependency.kind} dependency ${dependency.actionKey} is ${dependency.state}`
      });
    }
  }
  return Object.freeze({ runnable: true, reason: null });
}

export function verificationActionDependsOnChangedInputsV1(
  action: VerificationActionKeyV1,
  changedInputPaths: readonly string[] | null,
  changedUpstreamActionKeys: readonly VerificationActionKeyDigest[] = []
): boolean {
  if (changedInputPaths === null) return true;
  const changedPaths = new Set(changedInputPaths.map((value) => relativeInputPath(value, 'changedInputPaths')));
  if (action.inputClosure.some(({ path: inputPath }) => changedPaths.has(inputPath))) return true;
  const changedUpstream = new Set(changedUpstreamActionKeys.map((value) => digest(value, 'changedUpstreamActionKeys')));
  return action.upstreamActionKeys.some((upstream) => changedUpstream.has(upstream));
}
