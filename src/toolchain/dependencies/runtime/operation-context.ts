import crypto from 'node:crypto';

import type {
  GeneratedStateCleanupContinuationReceipt,
  GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt,
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from '../../../runtime-state/generated-state/contract.ts';
import type { GeneratedStateRetirementObservation } from '../../../runtime-state/generated-state/lifecycle.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import type { CommitFence } from '../../../workspace/files.ts';
import type { RuntimeDependencyTestMaterializationCapability } from './materialization-fixture-capability.ts';

const DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS = 300_000;
export const MAX_DEPENDENCY_OPERATION_TIMEOUT_MS = DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS;
const DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 50;
const MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 1_000;
const RUNTIME_DEPENDENCY_OPERATION_CONTEXT = Symbol('sec-runtime-dependency-operation-context-v1');

export const COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY = Object.freeze({
  maximumDurationMs: MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
});

export interface RuntimeDependencyInstallOptions {
  beforeCommit?: CommitFence;
  /** Parent absolute wall-clock deadline; the owner narrows it into its monotonic operation ledger. */
  deadlineAtUnixMs?: number;
  installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  lockTimeoutMs?: number;
  /** Monotonic source captured into one operation ledger and reused by every budget check. */
  monotonicNowMs?: () => number;
  now?: () => string;
  pollIntervalMs?: number;
  rematerialize?: boolean;
  sharedDepsRoot?: string;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  testCompilerPublishPlatform?: NodeJS.Platform;
  testCompilerPublishHook?: (stage: 'active-backed-up') => void | Promise<void>;
  testProjectProjectionHook?: (
    stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
  ) => void | Promise<void>;
  testCompilerBridgeValidationHook?: (
    stage: 'binding-observed' | 'final-binding-observed'
  ) => void | Promise<void>;
  /** Package-local fault injection for the Windows lock-file settlement owner. */
  testInstallLockDelete?: (filePath: string, attempt: number) => void | Promise<void>;
  testInstallLockDeletePlatform?: NodeJS.Platform;
  testCompilerRename?: (source: string, target: string) => Promise<void>;
  /**
   * Process-local materialization capability issued only by the dependency
   * test owner.  It can replace the install result in deterministic fixtures,
   * but it can neither choose an executable nor become a production process
   * transport.
   */
  testMaterialization?: RuntimeDependencyTestMaterializationCapability;
  generatedStateLifecycle?: Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
    /** Read-only adoption of an issuer-created active registration. */
    bind?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<GeneratedStateRegistration>;
    /** Re-activate one exact retired predecessor after owner-local rollback. */
    restore?: (
      relativePath: string,
      expectedRegistrationDigest: `sha256:${string}`,
      expectedPhysical: GeneratedStatePhysicalIdentity,
      outcome: string
    ) => Promise<GeneratedStateRegistration>;
    retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistration | void>;
    settleRetired?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<boolean>;
    observeRetirement?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<GeneratedStateRetirementObservation>;
    /** Terminalize one exact active registration after its physical root is already absent. */
    settleAbsent?: (
      relativePath: string,
      expected: Readonly<{
        owner: string;
        producer: string;
        ruleId: string;
        physical: GeneratedStatePhysicalIdentity;
      }>,
      outcome: string
    ) => Promise<Readonly<{
      schema: 'sec-generated-state-absent-registration-settlement-v1';
      relativePath: string;
      registrationDigest: `sha256:${string}`;
      retirementRef: `sha256:${string}`;
      physical: GeneratedStatePhysicalIdentity;
      outcome: string;
      terminal: 'disposed';
      receiptDigest: `sha256:${string}`;
    }>>;
    disposed(
      relativePath: string,
      request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
    ): Promise<GeneratedStateDisposalReceipt>;
    quarantine?: (
      relativePath: string,
      request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
    ) => Promise<GeneratedStateCleanupContinuationReceipt>;
  }>;
}

export type RuntimeDependencyOperationContext = Readonly<{
  deadlineAtUnixMs: number;
  deadlineAtMonotonicMs: number;
  initialBudgetMs: number;
  monotonicNowMs: () => number;
  operationId: string;
  pollIntervalMs: number;
  signal: AbortSignal | undefined;
  startedAtMonotonicMs: number;
  telemetryKey: object;
}>;

export type RuntimeDependencyOperationOptions<
  T extends RuntimeDependencyInstallOptions = RuntimeDependencyInstallOptions
> = Readonly<Omit<T, 'deadlineAtUnixMs' | 'lockTimeoutMs' | 'pollIntervalMs' | 'signal'>> & Readonly<{
  deadlineAtUnixMs: number;
  lockTimeoutMs: number;
  pollIntervalMs: number;
  signal: AbortSignal | undefined;
  [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: RuntimeDependencyOperationContext;
}>;

function runtimeDependencyPositiveBoundedInteger(
  field: 'lockTimeoutMs' | 'pollIntervalMs',
  configured: number | undefined,
  fallback: number,
  maximum: number
): number {
  const value = configured ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new SecError(
      'RUNTIME-DEPS-003',
      `Runtime dependency ${field} must be a positive safe integer within its canonical ceiling`,
      { field, maximum, value }
    );
  }
  return value;
}

function defaultRuntimeDependencyMonotonicNowMs(): number {
  return performance.now();
}

function createRuntimeDependencyMonotonicLedger(source: () => number): () => number {
  let previous = Number.NEGATIVE_INFINITY;
  return () => {
    const observed = source();
    if (!Number.isFinite(observed) || observed < previous) {
      throw new SecError(
        'RUNTIME-DEPS-003',
        'Runtime dependency operation monotonic clock is invalid or moved backwards',
        { observed, previous }
      );
    }
    previous = observed;
    return observed;
  };
}

export function runtimeDependencyOperationOptions<T extends RuntimeDependencyInstallOptions>(
  options: T
): RuntimeDependencyOperationOptions<T> {
  // Capture input before invoking clock/provider callbacks. The returned
  // options and their operation ledger must describe the same admitted input.
  const captured = { ...options };
  const existing = (captured as unknown as Partial<RuntimeDependencyOperationOptions<T>>)
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
  const lockBudgetMs = runtimeDependencyPositiveBoundedInteger(
    'lockTimeoutMs',
    captured.lockTimeoutMs,
    DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const pollIntervalMs = runtimeDependencyPositiveBoundedInteger(
    'pollIntervalMs',
    captured.pollIntervalMs,
    DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS,
    MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS
  );
  const requestedDeadline = captured.deadlineAtUnixMs;
  if (requestedDeadline !== undefined && !Number.isSafeInteger(requestedDeadline)) {
    throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is invalid', {
      deadlineAtUnixMs: requestedDeadline
    });
  }
  const monotonicNowMs = existing?.monotonicNowMs ?? createRuntimeDependencyMonotonicLedger(
    captured.monotonicNowMs ?? defaultRuntimeDependencyMonotonicNowMs
  );
  const nowMonotonicMs = monotonicNowMs();
  const nowUnixMs = Date.now();
  // Once captured, a parent deadline is monotonic. Sampling the same wall
  // deadline again would let clock corrections change an existing operation.
  const hasNewAbsoluteBound = requestedDeadline !== undefined &&
    (existing === undefined || requestedDeadline !== existing.deadlineAtUnixMs);
  const absoluteDeadlineBudgetMs = hasNewAbsoluteBound
    ? requestedDeadline - nowUnixMs
    : Number.POSITIVE_INFINITY;
  if (absoluteDeadlineBudgetMs < 1) {
    throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is exhausted');
  }
  const initialBudgetMs = Math.min(
    lockBudgetMs,
    absoluteDeadlineBudgetMs,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const deadlineAtMonotonicMs = Math.min(
    existing?.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY,
    nowMonotonicMs + initialBudgetMs
  );
  const deadlineAtUnixMs = existing === undefined
    ? requestedDeadline ?? nowUnixMs + initialBudgetMs
    : Math.min(
        existing.deadlineAtUnixMs,
        hasNewAbsoluteBound ? requestedDeadline : Number.POSITIVE_INFINITY,
        deadlineAtMonotonicMs < existing.deadlineAtMonotonicMs
          ? nowUnixMs + initialBudgetMs
          : Number.POSITIVE_INFINITY
      );
  const signal = existing?.signal === undefined || captured.signal === existing.signal
    ? captured.signal
    : captured.signal === undefined
      ? existing.signal
      : AbortSignal.any([existing.signal, captured.signal]);
  const existingContextIsStillCanonical = existing !== undefined &&
    deadlineAtUnixMs === existing.deadlineAtUnixMs &&
    deadlineAtMonotonicMs === existing.deadlineAtMonotonicMs &&
    pollIntervalMs === existing.pollIntervalMs &&
    signal === existing.signal;
  const context = existing !== undefined && existingContextIsStillCanonical
    ? existing
    : Object.freeze({
        deadlineAtUnixMs,
        deadlineAtMonotonicMs,
        initialBudgetMs: existing?.initialBudgetMs ?? initialBudgetMs,
        monotonicNowMs,
        operationId: existing?.operationId ?? crypto.randomUUID(),
        pollIntervalMs,
        signal,
        startedAtMonotonicMs: existing?.startedAtMonotonicMs ?? nowMonotonicMs,
        telemetryKey: existing?.telemetryKey ?? Object.freeze({})
      });
  context.signal?.throwIfAborted();
  return Object.freeze({
    ...captured,
    deadlineAtUnixMs,
    lockTimeoutMs: Math.min(initialBudgetMs, context.initialBudgetMs),
    pollIntervalMs,
    signal,
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: context
  });
}

export function runtimeDependencyOperationContext(
  options: RuntimeDependencyInstallOptions
): RuntimeDependencyOperationContext {
  return (options as Partial<RuntimeDependencyOperationOptions>)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT]
    ?? runtimeDependencyOperationOptions(options)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
}

export function runtimeDependencyOperationRemainingMs(
  options: RuntimeDependencyInstallOptions,
  label: string,
  minimumMs = 1
): number {
  if (!Number.isFinite(minimumMs) || minimumMs < 0) {
    throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency minimum budget must be finite and non-negative', {
      minimumMs
    });
  }
  const context = runtimeDependencyOperationContext(options);
  context.signal?.throwIfAborted();
  const observedAtMonotonicMs = context.monotonicNowMs();
  // Injected clock sources can synchronously cancel the operation while
  // sampling its budget. Do not admit an effect using that stale check.
  context.signal?.throwIfAborted();
  const remainingMs = context.deadlineAtMonotonicMs - observedAtMonotonicMs;
  if (!Number.isFinite(remainingMs) || remainingMs < minimumMs) {
    throw new SecError('RUNTIME-DEPS-003', `${label} exceeded the runtime dependency operation deadline`,
      {
        initialBudgetMs: context.initialBudgetMs,
        minimumMs,
        observedAtMonotonicMs,
        remainingMs: Math.max(0, Math.floor(remainingMs))
      });
  }
  return remainingMs;
}

/** Own the deadline/cancellation lifecycle of one await, not the provider's work. */
async function awaitRuntimeDependencyOperation(
  operationOptions: RuntimeDependencyOperationOptions,
  label: string,
  start: (remainingMs: number) => Promise<void> | void
): Promise<void> {
  const context = runtimeDependencyOperationContext(operationOptions);
  // The observer is private: third-party abort listeners cannot suppress its
  // event, and dispatchEvent('abort') on the public signal is not cancellation.
  // Native dependent signals observe abort state, not synthetic source events.
  const signal = context.signal === undefined ? undefined : AbortSignal.any([context.signal]);
  const remainingMs = runtimeDependencyOperationRemainingMs(operationOptions, label);
  let abortListener: (() => void) | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const aborted = signal === undefined
      ? null
      : new Promise<never>((_resolve, reject) => {
          abortListener = () => reject(signal.reason);
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        });
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => reject(new SecError(
        'RUNTIME-DEPS-003',
        `${label} exceeded the runtime dependency operation deadline`,
        { initialBudgetMs: context.initialBudgetMs }
      )), Math.max(1, Math.ceil(remainingMs)));
    });
    await Promise.race([
      // Attach handlers before provider code starts, including synchronous
      // throws and rejections that arrive after cancellation or timeout.
      Promise.resolve().then(() => start(
        runtimeDependencyOperationRemainingMs(operationOptions, label)
      )),
      deadline,
      ...(aborted === null ? [] : [aborted])
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener);
  }
  runtimeDependencyOperationRemainingMs(operationOptions, label);
}

export async function waitForRuntimeDependencyOperation(
  options: RuntimeDependencyInstallOptions,
  requestedDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<void> {
  // Infinite delays retain the saturating clamp; unordered inputs must not
  // reach provider work. Keep one captured ledger throughout the await.
  if (typeof requestedDelayMs !== 'number' || Number.isNaN(requestedDelayMs)) {
    throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency wait delay must be an ordered number', {
      requestedDelayMs
    });
  }
  const operationOptions = runtimeDependencyOperationOptions(options);
  const remainingMs = runtimeDependencyOperationRemainingMs(operationOptions, label);
  const boundedDelayMs = Math.max(1, Math.min(requestedDelayMs, Math.floor(remainingMs)));
  await awaitRuntimeDependencyOperation(operationOptions, label, (admittedRemainingMs) =>
    sleep(Math.min(boundedDelayMs, Math.floor(admittedRemainingMs)))
  );
}

export async function runtimeDependencyOperationEffectFence(
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  // A never-settling fence must not hold the caller beyond cancellation or
  // its operation deadline. Rejection is not a claim that provider work stopped.
  await awaitRuntimeDependencyOperation(options, `${label} effect`, () => options.beforeCommit?.());
}

export function runtimeDependencyOperationDeadlineAt(
  options: RuntimeDependencyOperationOptions,
  label: string
): number {
  runtimeDependencyOperationRemainingMs(options, label);
  return runtimeDependencyOperationContext(options).deadlineAtMonotonicMs;
}
