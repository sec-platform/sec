import {
  deepFreeze,
  rawSha256,
  sha256
} from '../../../../contracts/canonical.ts';
import {
  consumeOperationRequirementBindingContext,
  type OperationRequirementBindingContext,
  type OperationRequirementBindingProjection
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { assertIndependentProviderProcessCapabilityForSession } from './independent-provider-process.ts';
import {
  openObservedNativeProcessResourceLedger,
  type ObservedNativeProcessResourceLedgerSnapshot
} from './observed-process.ts';
import {
  runRetainedCommandObservedBytes,
  type ByteCommandResult,
  type RunRetainedCommandOptions
} from './process.ts';
import type { ObservedCommandOutcome } from './observed-process.ts';
import type { RetainedCommandBoundary } from './retained-command-boundary.ts';

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
  outcome: ObservedCommandOutcome;
}>;

export type ProcessResourceSessionReceipt = Readonly<{
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  requirementId: string;
  providerBindingDigest: OperationDigest;
  resourceCeilingIdentityDigest: OperationDigest;
  requirementBindingContextDigest: OperationDigest;
  processCount: number;
  settledProcessCount: number;
  successfulProcessRecordCount: number;
  failedProcessCount: number;
  admittedNativeResourceCount: number;
  startedNativeResourceCount: number;
  rootProcessCount: number;
  stdinWorkerCount: number;
  helperProcessCount: number;
  settledNativeResourceCount: number;
  failedNativeAdmissionCount: number;
  inputBytes: number;
  outputBytes: number;
  deadlineAtUnixMs: number;
  receiptDigest: OperationDigest;
}>;

export interface ProcessResourceSession {
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly requirementId: string;
  readonly resourceCeilingIdentityDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  /** The monotonic counterpart of deadlineAtUnixMs, fixed at admission. */
  readonly deadlineAtMonotonicMs: number;
  /** Aborts on caller cancellation, the fixed deadline, or session close. */
  readonly signal: AbortSignal;
  readonly processCount: number;
  /** Live physical ledger readback; no authority or reservation is issued. */
  observeNativeResourceCapacity(this: ProcessResourceSession): Readonly<{
    maximum: number;
    admitted: number;
    remaining: number;
    root: number;
    stdinWorker: number;
    helper: number;
  }>;
  /** Terminal child settlements observed by this session. */
  readonly settledProcessCount: number;
  /** Successful immutable command result records issued by this session. */
  readonly successfulProcessRecordCount: number;
  readonly inputBytes: number;
  /** Aggregate output budget irrevocably admitted to process attempts. */
  readonly outputBytes: number;
  /**
   * Latest child-owned cooperative deadline that still leaves one complete
   * grace interval before this session's forced-execution deadline.
   */
  cooperativeDeadlineAtUnixMs(
    this: ProcessResourceSession,
    options?: Readonly<{ terminationGraceMs?: number }>
  ): number;
  run(
    this: ProcessResourceSession,
    boundary: RetainedCommandBoundary,
    args: readonly string[],
    options: ProcessResourceRunOptions
  ): Promise<ProcessResourceRunResult>;
  close(this: ProcessResourceSession): ProcessResourceSessionReceipt;
}

const ISSUED_PROCESS_RESOURCE_SESSIONS = new WeakSet<object>();
type ProcessResourceSessionBindingState = {
  semanticOperation: string;
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  requirementId: string;
  providerIdentityDigest: OperationDigest;
  maximumDurationMs: number;
  maximumInputBytes: number;
  maximumOutputBytes: number;
  maximumProcesses: number;
  deadlineAtUnixMs: number;
  deadlineAtMonotonicMs: number;
  signal: AbortSignal;
  closed: boolean;
};
const PROCESS_RESOURCE_SESSION_BINDINGS = new WeakMap<object, ProcessResourceSessionBindingState>();
const ISSUED_PROCESS_RESOURCE_SESSION_RECEIPTS = new WeakSet<object>();
type ProcessResourceRunResultBinding = Readonly<{
  session: ProcessResourceSession;
  commandResult: ByteCommandResult;
  boundary: RetainedCommandBoundary;
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  requirementId: string;
  ordinal: number;
  argvBytes: number;
  argvDigest: OperationDigest;
  hasStdin: boolean;
  stdinBytes: number;
  stdinDigest: OperationDigest | null;
  environmentMode: 'inherit' | 'replace';
  environmentEntryCount: number;
  environmentDigest: OperationDigest;
  exitCode: number;
  stdoutBytes: number;
  stdoutDigest: OperationDigest;
  stderrBytes: number;
  stderrDigest: OperationDigest;
}>;
const PROCESS_RESOURCE_RUN_RESULT_BINDINGS = new WeakMap<
  object,
  ProcessResourceRunResultBinding
>();
const PROCESS_RESOURCE_SESSION_RECEIPT_BINDINGS = new WeakMap<
  object,
  ProcessResourceSession
>();
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

function executionTiming(
  totalRemainingMs: number,
  requestedTerminationGraceMs?: number
): Readonly<{
  terminationGraceMs: number;
  terminationDeadlineMs: number;
  timeoutMs: number;
}> {
  if (totalRemainingMs < 2) {
    throw new Error('Process resource session deadline cannot admit child execution and settlement.');
  }
  const terminationGraceMs = requestedTerminationGraceMs ?? Math.min(
    DEFAULT_TERMINATION_GRACE_MS,
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
  return Object.freeze({
    terminationGraceMs,
    terminationDeadlineMs,
    timeoutMs: totalRemainingMs - terminationDeadlineMs
  });
}

function ceiling(
  projection: OperationRequirementBindingProjection,
  resource: 'duration-ms' | 'input-bytes' | 'output-bytes' | 'processes'
): number | null {
  return projection.resourceCeilings
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

function argvIdentity(args: readonly string[]): Readonly<{
  bytes: number;
  digest: OperationDigest;
}> {
  const bytes = Buffer.from(JSON.stringify([...args]), 'utf8');
  return Object.freeze({
    bytes: bytes.byteLength,
    digest: rawSha256(bytes)
  });
}

function environmentIdentity(input: Readonly<{
  env?: NodeJS.ProcessEnv;
  envMode?: 'inherit' | 'replace';
}>): Readonly<{
  mode: 'inherit' | 'replace';
  entries: Readonly<NodeJS.ProcessEnv>;
  entryCount: number;
  digest: OperationDigest;
}> {
  const mode = input.envMode ?? 'inherit';
  const entries = Object.freeze(Object.fromEntries(
    Object.entries(input.env ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
  ));
  return Object.freeze({
    mode,
    entries,
    entryCount: Object.keys(entries).length,
    digest: sha256({
      domain: 'sec.process-resource-session.environment',
      mode,
      entries
    }) as OperationDigest
  });
}

export function openProcessResourceSession(input: Readonly<{
  operation: BoundSemanticOperation;
  requirementBindingContext: OperationRequirementBindingContext;
  signal?: AbortSignal;
}>): ProcessResourceSession {
  // This session only meters a caller's already-retained command capability.
  // The semantic operation is correlation/budget input, never Effect grant.
  assertSemanticOperationProjection(input.operation);
  const bindingProjection = consumeOperationRequirementBindingContext(
    input.requirementBindingContext
  );
  if (bindingProjection.operationIdentityDigest
        !== input.operation.plan.identity.identityDigest
      || bindingProjection.executionPlanDigest
        !== input.operation.plan.execution.executionPlanDigest
      || bindingProjection.boundAttemptDigest !== input.operation.boundAttemptDigest) {
    throw new Error('Process resource session rejected an operation binding context transplant.');
  }
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === bindingProjection.requirementId
  );
  const providerBinding = input.operation.bindings.find(
    ({ requirementId }) => requirementId === bindingProjection.requirementId
  );
  if (requirement === undefined || providerBinding === undefined
      || requirement.contractDigest !== bindingProjection.requirementContractDigest
      || providerBinding.contractDigest !== bindingProjection.requirementContractDigest
      || providerBinding.providerIdentityDigest !== bindingProjection.providerIdentityDigest
      || providerBinding.bindingDigest !== bindingProjection.providerBindingDigest) {
    throw new Error('Process resource session rejected a requirement or provider binding transplant.');
  }
  if (!requirement.effectKinds.includes('process')) {
    throw new Error('Process resource session requires a bound process Effect requirement.');
  }
  const expectedProcessResources = [
    'duration-ms',
    'input-bytes',
    'output-bytes',
    'processes'
  ] as const;
  if (bindingProjection.resourceCeilings.length !== expectedProcessResources.length
      || expectedProcessResources.some((resource) => (
        !bindingProjection.resourceCeilings.some((candidate) => candidate.resource === resource)
      ))) {
    throw new Error('Process resource session requires one complete process resource ceiling set.');
  }
  const maximumDurationMs = requirePositiveBudget(
    ceiling(bindingProjection, 'duration-ms'),
    'duration-ms'
  );
  const maximumProcesses = requirePositiveBudget(
    ceiling(bindingProjection, 'processes'),
    'processes'
  );
  const maximumOutputBytes = requirePositiveBudget(
    ceiling(bindingProjection, 'output-bytes'),
    'output-bytes'
  );
  const maximumInputBytes = ceiling(bindingProjection, 'input-bytes');
  if (maximumInputBytes === null
      || !Number.isSafeInteger(maximumInputBytes)
      || maximumInputBytes < 0) {
    throw new Error('Process resource session input-bytes aggregate budget is invalid.');
  }
  const startedAtUnixMs = Date.now();
  const startedAtMonotonicMs = performance.now();
  const durationUntilAttemptDeadlineMs =
    input.operation.plan.attempt.deadlineAtUnixMs - startedAtUnixMs;
  const durationUntilBindingDeadlineMs =
    bindingProjection.absoluteDeadlineAtUnixMs - startedAtUnixMs;
  const admittedDurationMs = Math.min(
    maximumDurationMs,
    durationUntilAttemptDeadlineMs,
    durationUntilBindingDeadlineMs,
    MAX_TIMER_DELAY_MS
  );
  if (input.signal?.aborted === true) {
    throw new Error('Process resource session is cancelled.');
  }
  if (!Number.isSafeInteger(admittedDurationMs) || admittedDurationMs < 1) {
    throw new Error('Process resource session admission deadline is exhausted.');
  }
  const deadlineAtUnixMs = startedAtUnixMs + admittedDurationMs;
  const deadlineAtMonotonicMs = startedAtMonotonicMs + admittedDurationMs;
  const nativeResourceLedger = openObservedNativeProcessResourceLedger({
    maximumResources: maximumProcesses,
    deadlineAtMonotonicMs
  });
  const sessionController = new AbortController();
  const abortFromCaller = (): void => sessionController.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const deadlineTimer = setTimeout(() => {
    input.signal?.removeEventListener('abort', abortFromCaller);
    sessionController.abort(new Error('Process resource session deadline is exhausted.'));
  }, admittedDurationMs);
  deadlineTimer.unref();
  let processCount = 0;
  let settledProcessCount = 0;
  let successfulProcessRecordCount = 0;
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
    requirementId: requirement.id,
    resourceCeilingIdentityDigest: bindingProjection.resourceCeilingIdentityDigest,
    deadlineAtUnixMs,
    deadlineAtMonotonicMs,
    signal: sessionController.signal,
    get processCount() { return processCount; },
    observeNativeResourceCapacity() {
      assertIssuedReceiver(this, 'native resource capacity');
      assertLive();
      const usage = nativeResourceLedger.snapshot();
      return Object.freeze({
        maximum: maximumProcesses,
        admitted: usage.admittedResourceCount,
        remaining: Math.max(0, maximumProcesses - usage.admittedResourceCount),
        root: usage.rootProcessCount,
        stdinWorker: usage.stdinWorkerCount,
        helper: usage.helperProcessCount
      });
    },
    get settledProcessCount() { return settledProcessCount; },
    get successfulProcessRecordCount() { return successfulProcessRecordCount; },
    get inputBytes() { return inputBytes; },
    get outputBytes() { return outputBytes; },
    cooperativeDeadlineAtUnixMs(options = {}) {
      assertIssuedReceiver(this, 'cooperative deadline');
      assertLive();
      if (active) throw new Error('Process resource session cannot issue a deadline during execution.');
      const timing = executionTiming(remainingMs(), options.terminationGraceMs);
      const cooperativeDurationMs = timing.timeoutMs - timing.terminationGraceMs;
      if (cooperativeDurationMs < 1) {
        throw new Error('Process resource session has no cooperative child deadline remaining.');
      }
      return Math.min(deadlineAtUnixMs - 1, Date.now() + cooperativeDurationMs);
    },
    async run(boundary, args, options) {
      assertIssuedReceiver(this, 'execution');
      assertLive();
      if (active) throw new Error('Process resource session is single-flight.');
      if (options.independentProvider !== undefined) {
        if (!requirement.effectKinds.includes('provider')) {
          throw new Error('Process resource session has no bound provider identity.');
        }
        assertIndependentProviderProcessCapabilityForSession(options.independentProvider, {
          operationIdentityDigest: input.operation.plan.identity.identityDigest,
          boundAttemptDigest: input.operation.boundAttemptDigest,
          boundary
        });
      }
      const commandInput = options.input === undefined
        ? undefined
        : new Uint8Array(options.input);
      const commandInputBytes = byteLength(commandInput);
      const invocationArgv = argvIdentity(args);
      const invocationEnvironment = environmentIdentity(options);
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
      const { terminationDeadlineMs, terminationGraceMs, timeoutMs } = executionTiming(
        remainingMs(),
        options.terminationGraceMs
      );
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
      const requiredNativeResources = 1 + (
        process.platform === 'win32' && options.input !== undefined ? 1 : 0
      );
      const nativeUsage = nativeResourceLedger.snapshot();
      if (nativeUsage.admittedResourceCount + requiredNativeResources > maximumProcesses) {
        throw new Error(
          'Process resource session process budget is exhausted: '
          + `native=${nativeUsage.admittedResourceCount}/${maximumProcesses}, `
          + `root=${nativeUsage.rootProcessCount}, stdinWorker=${nativeUsage.stdinWorkerCount}, `
          + `helper=${nativeUsage.helperProcessCount}, next=${requiredNativeResources}.`
        );
      }
      const ordinal = processCount + 1;
      const admittedOutputBytes = options.maxStdoutBytes + options.maxStderrBytes;
      active = true;
      processCount = ordinal;
      inputBytes += commandInputBytes;
      outputBytes += admittedOutputBytes;
      try {
        const observed = await runRetainedCommandObservedBytes(boundary, [...args], {
          ...options,
          env: invocationEnvironment.entries,
          envMode: invocationEnvironment.mode,
          input: commandInput,
          signal: sessionController.signal,
          terminationDeadlineMs,
          terminationGraceMs,
          timeoutMs
        }, nativeResourceLedger);
        const immutableResult: ByteCommandResult = Object.freeze({
          code: observed.result.code,
          stdout: new Uint8Array(observed.result.stdout),
          stderr: observed.result.stderr
        });
        const observedOutputBytes = immutableResult.stdout.byteLength
          + Buffer.byteLength(immutableResult.stderr, 'utf8');
        if (observedOutputBytes > admittedOutputBytes) {
          throw new Error('Process resource session observed output exceeds its admitted command bound.');
        }
        // The command bound is a live reservation, not historical usage. The
        // session is single-flight, so after settlement the unused reservation
        // can be released without admitting overlapping output. Aggregate
        // receipts record bytes actually observed; failed settlements retain
        // the full reservation conservatively because their final byte count
        // is not trustworthy.
        outputBytes -= admittedOutputBytes - observedOutputBytes;
        successfulProcessRecordCount += 1;
        const runResult: ProcessResourceRunResult = Object.freeze({
          ordinal,
          result: immutableResult,
          outcome: observed.outcome
        });
        PROCESS_RESOURCE_RUN_RESULT_BINDINGS.set(runResult, Object.freeze({
          session,
          commandResult: immutableResult,
          boundary,
          operationIdentityDigest: input.operation.plan.identity.identityDigest,
          boundAttemptDigest: input.operation.boundAttemptDigest,
          requirementId: requirement.id,
          ordinal,
          argvBytes: invocationArgv.bytes,
          argvDigest: invocationArgv.digest,
          hasStdin: commandInput !== undefined,
          stdinBytes: commandInputBytes,
          stdinDigest: commandInput === undefined ? null : rawSha256(commandInput),
          environmentMode: invocationEnvironment.mode,
          environmentEntryCount: invocationEnvironment.entryCount,
          environmentDigest: invocationEnvironment.digest,
          exitCode: immutableResult.code,
          stdoutBytes: immutableResult.stdout.byteLength,
          stdoutDigest: rawSha256(immutableResult.stdout),
          stderrBytes: Buffer.byteLength(immutableResult.stderr, 'utf8'),
          stderrDigest: rawSha256(immutableResult.stderr)
        }));
        return runResult;
      } catch (error) {
        failedProcessCount += 1;
        throw error;
      } finally {
        settledProcessCount += 1;
        active = false;
      }
    },
    close() {
      assertIssuedReceiver(this, 'close');
      if (active) throw new Error('Process resource session cannot close with an active child.');
      if (receipt !== null) return receipt;
      const nativeResources: ObservedNativeProcessResourceLedgerSnapshot = nativeResourceLedger.close();
      const withoutDigest = deepFreeze({
        operationIdentityDigest: input.operation.plan.identity.identityDigest,
        boundAttemptDigest: input.operation.boundAttemptDigest,
        requirementId: requirement.id,
        providerBindingDigest: providerBinding.bindingDigest,
        resourceCeilingIdentityDigest: bindingProjection.resourceCeilingIdentityDigest,
        requirementBindingContextDigest: bindingProjection.contextDigest,
        processCount,
        settledProcessCount,
        successfulProcessRecordCount,
        failedProcessCount,
        admittedNativeResourceCount: nativeResources.admittedResourceCount,
        startedNativeResourceCount: nativeResources.startedResourceCount,
        rootProcessCount: nativeResources.rootProcessCount,
        stdinWorkerCount: nativeResources.stdinWorkerCount,
        helperProcessCount: nativeResources.helperProcessCount,
        settledNativeResourceCount: nativeResources.settledResourceCount,
        failedNativeAdmissionCount: nativeResources.failedAdmissionCount,
        inputBytes,
        outputBytes,
        deadlineAtUnixMs
      });
      receipt = deepFreeze({
        ...withoutDigest,
        receiptDigest: sha256({
          domain: 'sec.process-resource-session.receipt',
          receipt: withoutDigest
        }) as OperationDigest
      });
      ISSUED_PROCESS_RESOURCE_SESSION_RECEIPTS.add(receipt);
      PROCESS_RESOURCE_SESSION_RECEIPT_BINDINGS.set(receipt, session);
      clearTimeout(deadlineTimer);
      input.signal?.removeEventListener('abort', abortFromCaller);
      const bindingState = PROCESS_RESOURCE_SESSION_BINDINGS.get(session);
      if (bindingState !== undefined) bindingState.closed = true;
      sessionController.abort(new Error('Process resource session is closed.'));
      return receipt;
    }
  };
  ISSUED_PROCESS_RESOURCE_SESSIONS.add(session);
  PROCESS_RESOURCE_SESSION_BINDINGS.set(session, {
    semanticOperation: input.operation.plan.identity.operation,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    requirementId: requirement.id,
    providerIdentityDigest: providerBinding.providerIdentityDigest,
    maximumDurationMs,
    maximumInputBytes,
    maximumOutputBytes,
    maximumProcesses,
    deadlineAtUnixMs,
    deadlineAtMonotonicMs,
    signal: sessionController.signal,
    closed: false
  });
  return Object.freeze(session);
}

/**
 * Mechanical origin and exact live-binding gate for a physical process
 * capability. Structural objects, spread clones and sessions issued for a
 * different semantic operation, provider or resource envelope are rejected
 * before a consumer performs any provider/filesystem admission.
 */
export function assertProcessResourceSession(
  session: ProcessResourceSession,
  expected: Readonly<{
    semanticOperation: string;
    requirementId: string;
    operationIdentityDigest?: OperationDigest;
    boundAttemptDigest?: OperationDigest;
    providerIdentityDigest?: OperationDigest;
    maximumDurationMs: number;
    maximumInputBytes: number;
    maximumOutputBytes: number;
    maximumProcesses: number;
  }>
): void {
  const binding = session !== null && typeof session === 'object'
    ? PROCESS_RESOURCE_SESSION_BINDINGS.get(session)
    : undefined;
  if (binding === undefined || !ISSUED_PROCESS_RESOURCE_SESSIONS.has(session)) {
    throw new Error('Process resource execution requires an owner-issued live session.');
  }
  if (binding.closed || binding.signal.aborted
      || Date.now() >= binding.deadlineAtUnixMs
      || performance.now() >= binding.deadlineAtMonotonicMs) {
    throw new Error('Process resource execution requires a current live session.');
  }
  if (binding.semanticOperation !== expected.semanticOperation
      || binding.requirementId !== expected.requirementId
      || (expected.operationIdentityDigest !== undefined
        && binding.operationIdentityDigest !== expected.operationIdentityDigest)
      || (expected.boundAttemptDigest !== undefined
        && binding.boundAttemptDigest !== expected.boundAttemptDigest)
      || (expected.providerIdentityDigest !== undefined
        && binding.providerIdentityDigest !== expected.providerIdentityDigest)
      || binding.maximumDurationMs !== expected.maximumDurationMs
      || binding.maximumInputBytes !== expected.maximumInputBytes
      || binding.maximumOutputBytes !== expected.maximumOutputBytes
      || binding.maximumProcesses !== expected.maximumProcesses) {
    throw new Error('Process resource session binding differs from the consumer contract.');
  }
}

/**
 * Mechanical origin and identity gate for a terminal physical-process receipt.
 * Serialized or structurally copied bytes are evidence only and cannot be
 * promoted back into a settlement capability.
 */
export function assertProcessResourceSessionReceipt(
  receipt: ProcessResourceSessionReceipt,
  expected?: Readonly<{
    readonly operationIdentityDigest: OperationDigest;
    readonly boundAttemptDigest: OperationDigest;
    readonly requirementId: string;
  }>
): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_PROCESS_RESOURCE_SESSION_RECEIPTS.has(receipt)) {
    throw new Error('Process resource settlement requires an owner-issued terminal receipt.');
  }
  if (receipt.settledProcessCount !== receipt.processCount
      || receipt.successfulProcessRecordCount + receipt.failedProcessCount
        !== receipt.settledProcessCount
      || receipt.settledNativeResourceCount !== receipt.admittedNativeResourceCount
      || receipt.rootProcessCount + receipt.stdinWorkerCount + receipt.helperProcessCount
        !== receipt.admittedNativeResourceCount
      || receipt.startedNativeResourceCount > receipt.admittedNativeResourceCount
      || receipt.failedNativeAdmissionCount
        !== receipt.admittedNativeResourceCount - receipt.startedNativeResourceCount) {
    throw new Error('Process resource terminal receipt has inconsistent settlement counters.');
  }
  if (expected !== undefined
      && (receipt.operationIdentityDigest !== expected.operationIdentityDigest
        || receipt.boundAttemptDigest !== expected.boundAttemptDigest
        || receipt.requirementId !== expected.requirementId)) {
    throw new Error('Process resource terminal receipt does not match the expected operation requirement.');
  }
}

/**
 * Proves that one exact successful process result was issued by the same
 * physical session that issued the supplied terminal receipt. The visible
 * record and receipt remain evidence projections: origin lives only in these
 * owner-held bindings, and exact output bytes are read back on every use.
 */
export function assertProcessResourceRunResult(
  runResult: ProcessResourceRunResult,
  receipt: ProcessResourceSessionReceipt,
  expected: Readonly<{
    readonly operationIdentityDigest: OperationDigest;
    readonly boundAttemptDigest: OperationDigest;
    readonly requirementId: string;
    readonly boundary: RetainedCommandBoundary;
    readonly args: readonly string[];
    readonly input?: Uint8Array;
    readonly env?: NodeJS.ProcessEnv;
    readonly envMode?: 'inherit' | 'replace';
    readonly ordinal?: number;
  }>
): void {
  const binding = runResult !== null && typeof runResult === 'object'
    ? PROCESS_RESOURCE_RUN_RESULT_BINDINGS.get(runResult)
    : undefined;
  if (binding === undefined) {
    throw new Error('Process run result requires an owner-issued exact result.');
  }
  assertProcessResourceSessionReceipt(receipt);
  const receiptSession = PROCESS_RESOURCE_SESSION_RECEIPT_BINDINGS.get(receipt);
  if (receiptSession === undefined || receiptSession !== binding.session) {
    throw new Error('Process run result and terminal receipt were issued by different sessions.');
  }
  assertProcessResourceSessionReceipt(receipt, expected);
  if (binding.operationIdentityDigest !== expected.operationIdentityDigest
      || binding.boundAttemptDigest !== expected.boundAttemptDigest
      || binding.requirementId !== expected.requirementId
      || (expected.ordinal !== undefined && binding.ordinal !== expected.ordinal)) {
    throw new Error('Process run result does not match the expected operation requirement.');
  }
  const expectedArgv = argvIdentity(expected.args);
  const expectedEnvironment = environmentIdentity(expected);
  const expectedInput = expected.input;
  if (binding.boundary !== expected.boundary
      || binding.argvBytes !== expectedArgv.bytes
      || binding.argvDigest !== expectedArgv.digest
      || binding.hasStdin !== (expectedInput !== undefined)
      || binding.stdinBytes !== byteLength(expectedInput)
      || binding.stdinDigest !== (expectedInput === undefined ? null : rawSha256(expectedInput))
      || binding.environmentMode !== expectedEnvironment.mode
      || binding.environmentEntryCount !== expectedEnvironment.entryCount
      || binding.environmentDigest !== expectedEnvironment.digest) {
    throw new Error('Process run result invocation differs from the expected retained execution.');
  }
  if (runResult.ordinal !== binding.ordinal
      || runResult.result !== binding.commandResult
      || binding.ordinal < 1
      || binding.ordinal > receipt.processCount
      || receipt.successfulProcessRecordCount < 1) {
    throw new Error('Process run result does not match its issued process record.');
  }
  if (!(runResult.result.stdout instanceof Uint8Array)
      || runResult.result.code !== binding.exitCode
      || runResult.result.stdout.byteLength !== binding.stdoutBytes
      || rawSha256(runResult.result.stdout) !== binding.stdoutDigest
      || typeof runResult.result.stderr !== 'string'
      || Buffer.byteLength(runResult.result.stderr, 'utf8') !== binding.stderrBytes
      || rawSha256(runResult.result.stderr) !== binding.stderrDigest) {
    throw new Error('Process run result output identity changed after settlement.');
  }
}
