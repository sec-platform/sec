import { canonicalEquals } from '../../../../../contracts/canonical.ts';

import { copyWindowsAppContainerObservedNativeHelperSettlement } from './native-helper-settlement.ts';

/**
 * Value boundary for the existing helper protocol: redacted failures, wire
 * decoding, native-receipt interpretation and worker-message classification.
 * These observations never admit execution or prove process-tree settlement.
 *
 * Keep the error class and its finite observation sidecar with the codec so
 * native producers and host consumers share one identity and redaction policy.
 * A separate transport/controller would duplicate effect ownership: filesystem
 * receipt acquisition, capability fences, native handles, worker supervision,
 * cleanup and recovery deliberately remain in the physical executor.
 */
const MAX_WINDOWS_DWORD = 0xffff_ffff;

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return canonicalEquals(Object.keys(value).sort(), [...expected].sort());
}

export type WindowsAppContainerExecutionPhase =
  | 'invalid-input'
  | 'preparation'
  | 'acl'
  | 'launch'
  | 'wait'
  | 'timeout'
  | 'cleanup';

export type WindowsAppContainerPreparationSubstage =
  | 'native-helper-entry'
  | 'native-helper-build'
  | 'native-helper-bundle-contract'
  | 'native-helper-materialization'
  | 'native-helper-invocation'
  | 'native-helper-protocol'
  | 'native-helper-diagnostic'
  | 'native-receipt'
  | 'sid-derivation'
  | 'profile-creation'
  | 'owner-publication'
  | 'runtime-identity'
  | 'system-directory'
  | 'unknown';

export type WindowsAppContainerHostToolStage =
  | 'acl-grant'
  | 'acl-remove'
  | 'acl-verify-absent'
  | 'profile-query';

export type WindowsAppContainerHostToolFailureReason =
  | 'spawn'
  | 'nonzero-exit'
  | 'timeout'
  | 'lease-loss'
  | 'lifecycle-failure'
  | 'output-limit'
  | 'aborted'
  | 'termination-unconfirmed';

export interface WindowsAppContainerHostToolFailure {
  readonly stage: WindowsAppContainerHostToolStage;
  readonly reason: WindowsAppContainerHostToolFailureReason;
  readonly termination: 'not-requested' | 'confirmed' | 'unconfirmed';
}

export type WindowsAppContainerNativeHelperMode =
  | 'derive'
  | 'create-profile'
  | 'suspended-create'
  | 'execute';

const WINDOWS_APPCONTAINER_SID_PATTERN = /^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u;

const WINDOWS_APPCONTAINER_EXECUTION_PHASE_VALUES = [
  'invalid-input',
  'preparation',
  'acl',
  'launch',
  'wait',
  'timeout',
  'cleanup'
] as const satisfies readonly WindowsAppContainerExecutionPhase[];

const WINDOWS_APPCONTAINER_EXECUTION_PHASES = new Set<WindowsAppContainerExecutionPhase>(
  WINDOWS_APPCONTAINER_EXECUTION_PHASE_VALUES
);

const WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES = new Set<WindowsAppContainerPreparationSubstage>([
  'native-helper-entry',
  'native-helper-build',
  'native-helper-bundle-contract',
  'native-helper-materialization',
  'native-helper-invocation',
  'native-helper-protocol',
  'native-helper-diagnostic',
  'native-receipt',
  'sid-derivation',
  'profile-creation',
  'owner-publication',
  'runtime-identity',
  'system-directory',
  'unknown'
]);

function isWindowsDword(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_WINDOWS_DWORD;
}

type WindowsAppContainerNativeHelperProtocolClass =
  | 'ok'
  | 'declared-failure'
  | 'invalid';

type WindowsAppContainerNativeReceiptClass =
  | 'not-applicable'
  | 'absent'
  | 'exit-code'
  | 'declared-failure'
  | 'invalid'
  | 'read-error';

type WindowsAppContainerNativeHelperExitClass = 'zero' | 'nonzero' | 'invalid';

export type WindowsAppContainerNativeHelperObservation = Readonly<{
  readonly mode: WindowsAppContainerNativeHelperMode;
  readonly exitClass: WindowsAppContainerNativeHelperExitClass;
  readonly diagnosticStream: 'empty' | 'present';
  readonly protocol: WindowsAppContainerNativeHelperProtocolClass;
  readonly nativeReceipt: WindowsAppContainerNativeReceiptClass;
}>;

const WINDOWS_APPCONTAINER_NATIVE_HELPER_MODES = new Set<WindowsAppContainerNativeHelperMode>([
  'derive', 'create-profile', 'suspended-create', 'execute'
]);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES =
  new Set<WindowsAppContainerNativeHelperExitClass>(['zero', 'nonzero', 'invalid']);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS = new Set(['empty', 'present'] as const);
const WINDOWS_APPCONTAINER_NATIVE_HELPER_PROTOCOL_CLASSES =
  new Set<WindowsAppContainerNativeHelperProtocolClass>(['ok', 'declared-failure', 'invalid']);
const WINDOWS_APPCONTAINER_NATIVE_RECEIPT_CLASSES =
  new Set<WindowsAppContainerNativeReceiptClass>([
    'not-applicable', 'absent', 'exit-code', 'declared-failure', 'invalid', 'read-error'
  ]);

function canonicalPreparationSubstage(
  value: unknown
): WindowsAppContainerPreparationSubstage {
  return typeof value === 'string' && WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES.has(
    value as WindowsAppContainerPreparationSubstage
  )
    ? value as WindowsAppContainerPreparationSubstage
    : 'unknown';
}

function canonicalNativeHelperObservation(
  value: unknown
): WindowsAppContainerNativeHelperObservation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!WINDOWS_APPCONTAINER_NATIVE_HELPER_MODES.has(
    record.mode as WindowsAppContainerNativeHelperMode
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES.has(
    record.exitClass as WindowsAppContainerNativeHelperExitClass
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS.has(
    record.diagnosticStream as 'empty' | 'present'
  ) || !WINDOWS_APPCONTAINER_NATIVE_HELPER_PROTOCOL_CLASSES.has(
    record.protocol as WindowsAppContainerNativeHelperProtocolClass
  ) || !WINDOWS_APPCONTAINER_NATIVE_RECEIPT_CLASSES.has(
    record.nativeReceipt as WindowsAppContainerNativeReceiptClass
  )) {
    return undefined;
  }
  return Object.freeze({
    mode: record.mode as WindowsAppContainerNativeHelperMode,
    exitClass: record.exitClass as WindowsAppContainerNativeHelperExitClass,
    diagnosticStream: record.diagnosticStream as 'empty' | 'present',
    protocol: record.protocol as WindowsAppContainerNativeHelperProtocolClass,
    nativeReceipt: record.nativeReceipt as WindowsAppContainerNativeReceiptClass
  });
}

export class WindowsAppContainerCapabilityUnavailableError extends Error {
  public readonly code = 'VERIFY-APPCONTAINER-UNAVAILABLE' as const;

  constructor() {
    super('Windows AppContainer isolated execution is unavailable');
    this.name = 'WindowsAppContainerCapabilityUnavailableError';
  }
}

export class WindowsAppContainerExecutionError extends Error {
  public readonly code = 'VERIFY-APPCONTAINER-EXECUTION' as const;
  public readonly preparationSubstage?: WindowsAppContainerPreparationSubstage;
  public readonly nativeHelperObservation?: WindowsAppContainerNativeHelperObservation;
  public readonly nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage;

  constructor(
    public readonly phase: WindowsAppContainerExecutionPhase,
    public readonly nativeCode?: number,
    public readonly hostToolFailure?: WindowsAppContainerHostToolFailure,
    preparationSubstage?: WindowsAppContainerPreparationSubstage,
    nativeHelperObservation?: WindowsAppContainerNativeHelperObservation,
    nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage
  ) {
    super(`Windows AppContainer isolated execution failed during ${phase}`);
    this.name = 'WindowsAppContainerExecutionError';
    this.preparationSubstage = phase === 'preparation'
      ? canonicalPreparationSubstage(preparationSubstage)
      : undefined;
    this.nativeHelperObservation = canonicalNativeHelperObservation(nativeHelperObservation);
    this.nativeWorkerProgressStage = phase === 'timeout'
      ? canonicalNativeWorkerProgressStage(nativeWorkerProgressStage)
      : undefined;
  }
}

export interface WindowsAppContainerExecutionResult {
  readonly exitCode: number;
}

export type WindowsAppContainerNativeHelperWirePayload = string & Readonly<{
  __windowsAppContainerNativeHelperWirePayload: 'v1';
}>;

function encodeWindowsAppContainerNativeHelperWireValue(
  value: Readonly<Record<string, unknown>>
): WindowsAppContainerNativeHelperWirePayload {
  return JSON.stringify(value) as WindowsAppContainerNativeHelperWirePayload;
}

/** Canonical redacted wire producer shared by the native helper and its host decoder. */
export function encodeWindowsAppContainerNativeFailure(
  error: unknown
): WindowsAppContainerNativeHelperWirePayload {
  if (!(error instanceof WindowsAppContainerExecutionError) ||
    !WINDOWS_APPCONTAINER_EXECUTION_PHASES.has(error.phase) ||
    (error.nativeCode !== undefined && !isWindowsDword(error.nativeCode)) ||
    (error.nativeWorkerProgressStage !== undefined &&
      canonicalNativeWorkerProgressStage(error.nativeWorkerProgressStage) !==
        error.nativeWorkerProgressStage)) {
    return encodeWindowsAppContainerNativeHelperWireValue({
      status: 'failed',
      phase: 'preparation',
      substage: 'unknown'
    });
  }
  return encodeWindowsAppContainerNativeHelperWireValue({
    status: 'failed',
    phase: error.phase,
    ...(error.nativeCode === undefined ? {} : { nativeCode: error.nativeCode }),
    ...(error.phase === 'preparation'
      ? { substage: canonicalPreparationSubstage(error.preparationSubstage) }
      : {}),
    ...(error.phase === 'timeout' && error.nativeWorkerProgressStage !== undefined
      ? { workerStage: error.nativeWorkerProgressStage }
      : {})
  });
}

export function encodeWindowsAppContainerNativeOk(): WindowsAppContainerNativeHelperWirePayload {
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok' });
}

export function encodeWindowsAppContainerNativeDerivedSid(
  appContainerSid: string
): WindowsAppContainerNativeHelperWirePayload {
  if (!WINDOWS_APPCONTAINER_SID_PATTERN.test(appContainerSid)) {
    throw executionError('preparation', undefined, undefined, 'sid-derivation');
  }
  return encodeWindowsAppContainerNativeHelperWireValue({ status: 'ok', appContainerSid });
}

const nativeHelperObservations = new WeakMap<Error, WindowsAppContainerNativeHelperObservation>();

/** Test-only redacted helper observation; raw helper output is never retained here. */
export function windowsAppContainerNativeHelperObservationForTests(
  error: Error
): WindowsAppContainerNativeHelperObservation | undefined {
  return nativeHelperObservations.get(error);
}

export function executionError(
  phase: WindowsAppContainerExecutionPhase,
  nativeCode?: number,
  hostToolFailure?: WindowsAppContainerHostToolFailure,
  preparationSubstage?: WindowsAppContainerPreparationSubstage,
  nativeHelperObservation?: WindowsAppContainerNativeHelperObservation,
  nativeWorkerProgressStage?: WindowsAppContainerNativeWorkerProgressStage
): WindowsAppContainerExecutionError {
  return new WindowsAppContainerExecutionError(
    phase,
    nativeCode,
    hostToolFailure,
    preparationSubstage,
    nativeHelperObservation,
    nativeWorkerProgressStage
  );
}

export type WindowsAppContainerNativeWorkerSettlement =
  | Readonly<{ kind: 'completed'; exitCode: number }>
  | Readonly<{ kind: 'suspended-created' }>
  | Readonly<{
      kind: 'failed';
      payload: WindowsAppContainerNativeHelperWirePayload;
    }>;

export type WindowsAppContainerNativeWorkerProgressStage =
  | 'not-observed'
  | 'create-entered'
  | 'create-returned'
  | 'job-settled';

type WindowsAppContainerNativeWorkerProgress = Readonly<{
  kind: 'progress';
  stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>;
}>;

export const WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE = Object.freeze([
  'create-entered',
  'create-returned',
  'job-settled'
] as const);

function canonicalNativeWorkerProgressStage(
  value: unknown
): WindowsAppContainerNativeWorkerProgressStage | undefined {
  return value === 'not-observed' ||
    WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE.includes(
      value as typeof WINDOWS_APPCONTAINER_NATIVE_WORKER_PROGRESS_SEQUENCE[number]
    )
    ? value as WindowsAppContainerNativeWorkerProgressStage
    : undefined;
}

export function decodeWindowsAppContainerNativeWorkerSettlement(
  value: unknown
): WindowsAppContainerNativeWorkerSettlement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === 'completed' && exactObjectKeys(record, ['exitCode', 'kind']) &&
    isWindowsDword(record.exitCode)) {
    return Object.freeze({ kind: 'completed', exitCode: Number(record.exitCode) });
  }
  if (record.kind === 'suspended-created' && exactObjectKeys(record, ['kind'])) {
    return Object.freeze({ kind: 'suspended-created' });
  }
  if (record.kind !== 'failed' || !exactObjectKeys(record, ['kind', 'payload']) ||
    typeof record.payload !== 'string' ||
    decodeNativeHelperOutput('execute', 1, record.payload).classification !== 'declared-failure') {
    return undefined;
  }
  return Object.freeze({
    kind: 'failed',
    payload: record.payload as WindowsAppContainerNativeHelperWirePayload
  });
}

export function decodeWindowsAppContainerNativeWorkerProgress(
  value: unknown
): WindowsAppContainerNativeWorkerProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const stage = canonicalNativeWorkerProgressStage(record.stage);
  if (record.kind !== 'progress' || !exactObjectKeys(record, ['kind', 'stage']) ||
    stage === undefined || stage === 'not-observed') {
    return undefined;
  }
  return Object.freeze({ kind: 'progress', stage });
}

export function normalizeExecutionError(
  error: unknown,
  fallback: WindowsAppContainerExecutionPhase,
  fallbackPreparationSubstage: WindowsAppContainerPreparationSubstage = 'unknown'
): WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError {
  if (error instanceof WindowsAppContainerCapabilityUnavailableError) {
    return error;
  }
  if (error instanceof WindowsAppContainerExecutionError) {
    if (fallback === 'preparation' && fallbackPreparationSubstage !== 'unknown' &&
      error.phase === 'preparation' && error.preparationSubstage === 'unknown') {
      const observation = error.nativeHelperObservation ?? nativeHelperObservations.get(error);
      const normalized = executionError(
        error.phase,
        error.nativeCode,
        error.hostToolFailure,
        fallbackPreparationSubstage,
        observation,
        error.nativeWorkerProgressStage
      );
      if (observation) nativeHelperObservations.set(normalized, observation);
      copyWindowsAppContainerObservedNativeHelperSettlement(error, normalized);
      return normalized;
    }
    return error;
  }
  return executionError(
    fallback,
    undefined,
    undefined,
    fallback === 'preparation' ? fallbackPreparationSubstage : undefined
  );
}

/** Pure test seam for the fail-closed unknown preparation normalization boundary. */
export function normalizeWindowsAppContainerPreparationErrorForTests(
  error: unknown,
  substage: WindowsAppContainerPreparationSubstage = 'unknown'
): WindowsAppContainerCapabilityUnavailableError | WindowsAppContainerExecutionError {
  return normalizeExecutionError(error, 'preparation', substage);
}

type DecodedNativeHelperOutput =
  | Readonly<{ classification: 'ok'; appContainerSid: string | null }>
  | Readonly<{
      classification: 'declared-failure';
      failure: DecodedNativeFailure;
    }>
  | Readonly<{ classification: 'invalid' }>;

type DecodedNativeFailure = Readonly<{
  phase: WindowsAppContainerExecutionPhase;
  nativeCode: number | null;
  preparationSubstage: WindowsAppContainerPreparationSubstage | null;
  nativeWorkerProgressStage: WindowsAppContainerNativeWorkerProgressStage | null;
}>;

export type DecodedNativeReceipt =
  | Readonly<{ classification: 'not-applicable' }>
  | Readonly<{ classification: 'absent' }>
  | Readonly<{
      classification: 'exit-code';
      result: WindowsAppContainerExecutionResult;
    }>
  | Readonly<{
      classification: 'declared-failure';
      failure: DecodedNativeFailure;
    }>
  | Readonly<{ classification: 'invalid' | 'read-error' }>;

function decodeNativeFailureRecord(value: unknown): DecodedNativeFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.status !== 'failed') return undefined;
  const preparationSubstage = record.phase === 'preparation'
    ? canonicalPreparationSubstage(record.substage)
    : null;
  const nativeWorkerProgressStage = record.phase === 'timeout' && record.workerStage !== undefined
    ? canonicalNativeWorkerProgressStage(record.workerStage) ?? null
    : null;
  const expectedKeys = [
    'phase',
    'status',
    ...(record.nativeCode === undefined ? [] : ['nativeCode']),
    ...(record.phase === 'preparation' ? ['substage'] : []),
    ...(record.workerStage === undefined ? [] : ['workerStage'])
  ].sort();
  if (!exactObjectKeys(record, expectedKeys) ||
    !WINDOWS_APPCONTAINER_EXECUTION_PHASES.has(record.phase as WindowsAppContainerExecutionPhase) ||
    (record.phase === 'preparation' &&
      (!WINDOWS_APPCONTAINER_PREPARATION_SUBSTAGES.has(
        record.substage as WindowsAppContainerPreparationSubstage
      ) || preparationSubstage !== record.substage)) ||
    (record.workerStage !== undefined &&
      (record.phase !== 'timeout' || nativeWorkerProgressStage !== record.workerStage)) ||
    (record.nativeCode !== undefined && !isWindowsDword(record.nativeCode))) {
    return undefined;
  }
  return Object.freeze({
    phase: record.phase as WindowsAppContainerExecutionPhase,
    nativeCode: record.nativeCode === undefined ? null : Number(record.nativeCode),
    preparationSubstage,
    nativeWorkerProgressStage
  });
}

function decodeNativeHelperOutput(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string
): DecodedNativeHelperOutput {
  if (!isWindowsDword(exitCode)) return Object.freeze({ classification: 'invalid' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(protocolOutput);
  } catch {
    return Object.freeze({ classification: 'invalid' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.freeze({ classification: 'invalid' });
  }
  const record = parsed as Record<string, unknown>;
  if (record.status === 'failed') {
    const failure = decodeNativeFailureRecord(parsed);
    return failure && exitCode !== 0
      ? Object.freeze({ classification: 'declared-failure', failure })
      : Object.freeze({ classification: 'invalid' });
  }
  if (exitCode !== 0 || record.status !== 'ok') {
    return Object.freeze({ classification: 'invalid' });
  }
  if (mode === 'derive') {
    if (!exactObjectKeys(record, ['appContainerSid', 'status'])) {
      return Object.freeze({ classification: 'invalid' });
    }
    const sid = record.appContainerSid;
    if (typeof sid !== 'string' || !WINDOWS_APPCONTAINER_SID_PATTERN.test(sid)) {
      return Object.freeze({ classification: 'invalid' });
    }
    return Object.freeze({ classification: 'ok', appContainerSid: sid });
  }
  return exactObjectKeys(record, ['status'])
    ? Object.freeze({ classification: 'ok', appContainerSid: null })
    : Object.freeze({ classification: 'invalid' });
}

export function decodeNativeReceiptValue(value: unknown): DecodedNativeReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ classification: 'invalid' });
  }
  const record = value as Record<string, unknown>;
  if (record.status === 'failed') {
    const failure = decodeNativeFailureRecord(value);
    return failure
      ? Object.freeze({ classification: 'declared-failure', failure })
      : Object.freeze({ classification: 'invalid' });
  }
  if (!exactObjectKeys(record, ['exitCode']) ||
    !isWindowsDword(record.exitCode)) {
    return Object.freeze({ classification: 'invalid' });
  }
  return Object.freeze({
    classification: 'exit-code',
    result: Object.freeze({ exitCode: Number(record.exitCode) })
  });
}

function projectNativeHelperObservation(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocol: DecodedNativeHelperOutput,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): WindowsAppContainerNativeHelperObservation {
  return Object.freeze({
    mode,
    exitClass: !isWindowsDword(exitCode) ? 'invalid' : exitCode === 0 ? 'zero' : 'nonzero',
    diagnosticStream: diagnosticStreamPresent ? 'present' : 'empty',
    protocol: protocol.classification,
    nativeReceipt: nativeReceipt.classification
  });
}

export function settleNativeHelperInvocation(
  mode: 'derive',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): string;
export function settleNativeHelperInvocation(
  mode: 'create-profile',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): void;
export function settleNativeHelperInvocation(
  mode: 'suspended-create',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): void;
export function settleNativeHelperInvocation(
  mode: 'execute',
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): WindowsAppContainerExecutionResult;
export function settleNativeHelperInvocation(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  nativeReceipt: DecodedNativeReceipt
): string | WindowsAppContainerExecutionResult | undefined {
  const protocol = decodeNativeHelperOutput(mode, exitCode, protocolOutput);
  const observation = projectNativeHelperObservation(
    mode,
    exitCode,
    protocol,
    diagnosticStreamPresent,
    nativeReceipt
  );
  try {
    if (diagnosticStreamPresent || protocol.classification === 'invalid') {
      throw executionError(
        'preparation',
        undefined,
        undefined,
        diagnosticStreamPresent ? 'native-helper-diagnostic' : 'native-helper-protocol',
        observation
      );
    }
    if (protocol.classification === 'declared-failure') {
      throw executionError(
        protocol.failure.phase,
        protocol.failure.nativeCode ?? undefined,
        undefined,
        protocol.failure.preparationSubstage ?? undefined,
        observation,
        protocol.failure.nativeWorkerProgressStage ?? undefined
      );
    }
    if (mode === 'execute') {
      if (nativeReceipt.classification === 'declared-failure') {
        throw executionError(
          nativeReceipt.failure.phase,
          nativeReceipt.failure.nativeCode ?? undefined,
          undefined,
          nativeReceipt.failure.preparationSubstage ?? undefined,
          observation,
          nativeReceipt.failure.nativeWorkerProgressStage ?? undefined
        );
      }
      if (nativeReceipt.classification !== 'exit-code') {
        throw executionError('wait', undefined, undefined, undefined, observation);
      }
      return nativeReceipt.result;
    }
    if (nativeReceipt.classification !== 'not-applicable') {
      throw executionError(
        'preparation', undefined, undefined, 'native-receipt', observation
      );
    }
    if (mode === 'derive') {
      if (!protocol.appContainerSid) {
        throw executionError(
          'preparation', undefined, undefined, 'native-helper-protocol', observation
        );
      }
      return protocol.appContainerSid;
    }
    return undefined;
  } catch (error) {
    if (error instanceof Error) nativeHelperObservations.set(error, observation);
    throw error;
  }
}

type WindowsAppContainerNativeReceiptReadForTests =
  | 'not-applicable'
  | 'absent'
  | 'read-error'
  | Readonly<{ value: unknown }>;

/** Pure settlement seam; it accepts wire values and never spawns an AppContainer. */
export function settleWindowsAppContainerNativeHelperInvocationForTests(
  mode: WindowsAppContainerNativeHelperMode,
  exitCode: number,
  protocolOutput: string,
  diagnosticStreamPresent: boolean,
  receiptRead: WindowsAppContainerNativeReceiptReadForTests
): string | WindowsAppContainerExecutionResult | undefined {
  const nativeReceipt: DecodedNativeReceipt = typeof receiptRead === 'string'
    ? Object.freeze({ classification: receiptRead })
    : decodeNativeReceiptValue(receiptRead.value);
  if (mode === 'derive') {
    return settleNativeHelperInvocation(
      'derive', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
  }
  if (mode === 'create-profile') {
    settleNativeHelperInvocation(
      'create-profile', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
    return undefined;
  }
  if (mode === 'suspended-create') {
    settleNativeHelperInvocation(
      'suspended-create', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
    );
    return undefined;
  }
  return settleNativeHelperInvocation(
    'execute', exitCode, protocolOutput, diagnosticStreamPresent, nativeReceipt
  );
}
