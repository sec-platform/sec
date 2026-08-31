import { deepFreeze, sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  assertSecBoundSemanticOperation,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../../system-architecture/operation/semantic.ts';
import {
  runRetainedCommandBytes,
  type ByteCommandResult,
  type RetainedCommandBoundary,
  type RunRetainedCommandOptions
} from './process.ts';

export type ProcessResourceRunOptions = Omit<
  RunRetainedCommandOptions,
  'maxStderrBytes' | 'maxStdoutBytes' | 'signal' | 'terminationDeadlineMs' | 'timeoutMs'
> & Readonly<{
  maxStderrBytes: number;
  maxStdoutBytes: number;
}>;

export type ProcessResourceRunResult = Readonly<{
  ordinal: number;
  result: ByteCommandResult;
}>;

export type ProcessResourceSessionReceipt = Readonly<{
  operationIdentityDigest: SecOperationDigest;
  boundAttemptDigest: SecOperationDigest;
  processCount: number;
  failedProcessCount: number;
  inputBytes: number;
  outputBytes: number;
  deadlineAtUnixMs: number;
  receiptDigest: SecOperationDigest;
}>;

export interface ProcessResourceSession {
  readonly operationIdentityDigest: SecOperationDigest;
  readonly boundAttemptDigest: SecOperationDigest;
  readonly deadlineAtUnixMs: number;
  /** The monotonic counterpart of deadlineAtUnixMs, fixed at admission. */
  readonly deadlineAtMonotonicMs: number;
  /** Aborts on caller cancellation, the fixed deadline, or session close. */
  readonly signal: AbortSignal;
  readonly processCount: number;
  readonly inputBytes: number;
  /** Aggregate output budget irrevocably admitted to process attempts. */
  readonly outputBytes: number;
  run(
    this: ProcessResourceSession,
    boundary: RetainedCommandBoundary,
    args: readonly string[],
    options: ProcessResourceRunOptions
  ): Promise<ProcessResourceRunResult>;
  close(this: ProcessResourceSession): ProcessResourceSessionReceipt;
}

const ISSUED_PROCESS_RESOURCE_SESSIONS = new WeakSet<object>();
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

function budget(
  operation: SecBoundSemanticOperation,
  resource: 'duration-ms' | 'input-bytes' | 'output-bytes' | 'processes'
): number | null {
  return operation.plan.identity.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum ?? null;
}

function requirePositiveBudget(value: number | null, resource: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Process resource session requires one positive ${resource} aggregate budget.`);
  }
  return value;
}

function byteLength(value: Uint8Array | undefined): number {
  return value?.byteLength ?? 0;
}

export function openProcessResourceSession(input: Readonly<{
  operation: SecBoundSemanticOperation;
  signal?: AbortSignal;
}>): ProcessResourceSession {
  assertSecBoundSemanticOperation(input.operation);
  if (!input.operation.plan.identity.requirements.some(({ effectKinds }) => (
    effectKinds.includes('process')
  ))) {
    throw new Error('Process resource session requires a bound process Effect requirement.');
  }
  const maximumDurationMs = requirePositiveBudget(
    budget(input.operation, 'duration-ms'),
    'duration-ms'
  );
  const maximumProcesses = requirePositiveBudget(
    budget(input.operation, 'processes'),
    'processes'
  );
  const maximumOutputBytes = requirePositiveBudget(
    budget(input.operation, 'output-bytes'),
    'output-bytes'
  );
  const maximumInputBytes = budget(input.operation, 'input-bytes') ?? 0;
  if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 0) {
    throw new Error('Process resource session input-bytes aggregate budget is invalid.');
  }
  const startedAtUnixMs = Date.now();
  const startedAtMonotonicMs = performance.now();
  const durationUntilAttemptDeadlineMs =
    input.operation.plan.attempt.deadlineAtUnixMs - startedAtUnixMs;
  const admittedDurationMs = Math.min(
    maximumDurationMs,
    durationUntilAttemptDeadlineMs,
    MAX_TIMER_DELAY_MS
  );
  if (!Number.isSafeInteger(admittedDurationMs)
      || admittedDurationMs < 1
      || input.signal?.aborted === true) {
    throw new Error('Process resource session admission deadline is exhausted.');
  }
  const deadlineAtUnixMs = startedAtUnixMs + admittedDurationMs;
  const deadlineAtMonotonicMs = startedAtMonotonicMs + admittedDurationMs;
  const sessionController = new AbortController();
  const abortFromCaller = (): void => sessionController.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const deadlineTimer = setTimeout(() => {
    input.signal?.removeEventListener('abort', abortFromCaller);
    sessionController.abort(new Error('Process resource session deadline is exhausted.'));
  }, admittedDurationMs);
  deadlineTimer.unref();
  let processCount = 0;
  let failedProcessCount = 0;
  let inputBytes = 0;
  let outputBytes = 0;
  let active = false;
  let receipt: ProcessResourceSessionReceipt | null = null;

  const remainingMs = (): number => Math.max(0, Math.floor(Math.min(
    deadlineAtUnixMs - Date.now(),
    deadlineAtMonotonicMs - performance.now()
  )));
  const assertLive = (): void => {
    if (receipt !== null) throw new Error('Process resource session is closed.');
    if (sessionController.signal.aborted) {
      throw new Error('Process resource session is cancelled.');
    }
    if (remainingMs() < 1) throw new Error('Process resource session deadline is exhausted.');
  };

  const assertIssuedReceiver = (receiver: unknown, action: string): void => {
    if (receiver === null || typeof receiver !== 'object'
        || !ISSUED_PROCESS_RESOURCE_SESSIONS.has(receiver)) {
      throw new Error(`Process resource ${action} requires an owner-issued session.`);
    }
  };

  const session: ProcessResourceSession = {
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    deadlineAtUnixMs,
    deadlineAtMonotonicMs,
    signal: sessionController.signal,
    get processCount() { return processCount; },
    get inputBytes() { return inputBytes; },
    get outputBytes() { return outputBytes; },
    async run(boundary, args, options) {
      assertIssuedReceiver(this, 'execution');
      assertLive();
      if (active) throw new Error('Process resource session is single-flight.');
      if (processCount >= maximumProcesses) {
        throw new Error('Process resource session process budget is exhausted.');
      }
      const commandInputBytes = byteLength(options.input);
      if (options.maxStdinBytes !== undefined
          && (!Number.isSafeInteger(options.maxStdinBytes) || options.maxStdinBytes < 0)) {
        throw new Error('Process resource session stdin bound is invalid.');
      }
      if (options.input !== undefined
          && (options.maxStdinBytes === undefined
            || options.maxStdinBytes < commandInputBytes)) {
        throw new Error('Process resource session input requires an exact enclosing stdin bound.');
      }
      if (commandInputBytes > maximumInputBytes - inputBytes) {
        throw new Error('Process resource session input-byte budget is exhausted.');
      }
      const remainingOutputBytes = maximumOutputBytes - outputBytes;
      if (!Number.isSafeInteger(options.maxStdoutBytes) || options.maxStdoutBytes < 0
          || !Number.isSafeInteger(options.maxStderrBytes) || options.maxStderrBytes < 0
          || options.maxStderrBytes > remainingOutputBytes
          || options.maxStdoutBytes > remainingOutputBytes - options.maxStderrBytes) {
        throw new Error('Process resource session output-byte admission exceeds the remaining budget.');
      }
      const totalRemainingMs = remainingMs();
      if (totalRemainingMs < 2) {
        throw new Error('Process resource session deadline cannot admit child execution and settlement.');
      }
      const terminationGraceMs = options.terminationGraceMs ?? Math.min(
        DEFAULT_TERMINATION_GRACE_MS,
        // Preserve most of the absolute budget for execution while retaining
        // four escalation/grace intervals for a physically settled child.
        Math.max(1, Math.floor((totalRemainingMs - 1) / 20))
      );
      if (!Number.isSafeInteger(terminationGraceMs)
          || terminationGraceMs < 1
          || terminationGraceMs >= totalRemainingMs) {
        throw new Error('Process resource session termination grace exceeds the remaining deadline.');
      }
      const terminationDeadlineMs = Math.min(
        totalRemainingMs - 1,
        terminationGraceMs <= Math.floor((totalRemainingMs - 1) / 4)
          ? terminationGraceMs * 4
          : totalRemainingMs - 1
      );
      const timeoutMs = totalRemainingMs - terminationDeadlineMs;
      if (options.stallTimeoutMs !== undefined && (
        !Number.isSafeInteger(options.stallTimeoutMs)
        || options.stallTimeoutMs < 1
        || options.stallTimeoutMs >= timeoutMs
        || options.admitProgress === undefined
      )) {
        throw new Error(
          'Process resource session stall deadline must be shorter than the admitted execution window.'
        );
      }
      const ordinal = processCount + 1;
      const admittedOutputBytes = options.maxStdoutBytes + options.maxStderrBytes;
      active = true;
      processCount = ordinal;
      inputBytes += commandInputBytes;
      outputBytes += admittedOutputBytes;
      try {
        const result = await runRetainedCommandBytes(boundary, [...args], {
          ...options,
          signal: sessionController.signal,
          terminationDeadlineMs,
          terminationGraceMs,
          timeoutMs
        });
        const immutableResult: ByteCommandResult = Object.freeze({
          code: result.code,
          stdout: new Uint8Array(result.stdout),
          stderr: result.stderr
        });
        return Object.freeze({ ordinal, result: immutableResult });
      } catch (error) {
        failedProcessCount += 1;
        throw error;
      } finally {
        active = false;
      }
    },
    close() {
      assertIssuedReceiver(this, 'close');
      if (active) throw new Error('Process resource session cannot close with an active child.');
      if (receipt !== null) return receipt;
      const withoutDigest = deepFreeze({
        operationIdentityDigest: input.operation.plan.identity.identityDigest,
        boundAttemptDigest: input.operation.boundAttemptDigest,
        processCount,
        failedProcessCount,
        inputBytes,
        outputBytes,
        deadlineAtUnixMs
      });
      receipt = deepFreeze({
        ...withoutDigest,
        receiptDigest: sha256({
          domain: 'sec.process-resource-session.receipt',
          receipt: withoutDigest
        }) as SecOperationDigest
      });
      clearTimeout(deadlineTimer);
      input.signal?.removeEventListener('abort', abortFromCaller);
      sessionController.abort(new Error('Process resource session is closed.'));
      return receipt;
    }
  };
  ISSUED_PROCESS_RESOURCE_SESSIONS.add(session);
  return Object.freeze(session);
}
