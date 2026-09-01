import crypto from 'node:crypto';

import type {
  GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt,
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from '../../../runtime-state/generated-state/contract.ts';
import type { GeneratedStateRetirementObservation } from '../../../runtime-state/generated-state/lifecycle.ts';
import { runCommand } from '../../../runtime-state/physical/runtime/process.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import type { CommitFence } from '../../../workspace/files.ts';

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
  commandRunner?: typeof runCommand;
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
> = T & Readonly<{
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
  const lockBudgetMs = runtimeDependencyPositiveBoundedInteger(
    'lockTimeoutMs',
    options.lockTimeoutMs,
    DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  let absoluteDeadlineBudgetMs = Number.POSITIVE_INFINITY;
  if (options.deadlineAtUnixMs !== undefined) {
    if (!Number.isSafeInteger(options.deadlineAtUnixMs)) {
      throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is invalid', {
        deadlineAtUnixMs: options.deadlineAtUnixMs
      });
    }
    absoluteDeadlineBudgetMs = options.deadlineAtUnixMs - Date.now();
    if (absoluteDeadlineBudgetMs < 1) {
      throw new SecError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is exhausted');
    }
  }
  const initialBudgetMs = Math.min(
    lockBudgetMs,
    absoluteDeadlineBudgetMs,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const pollIntervalMs = runtimeDependencyPositiveBoundedInteger(
    'pollIntervalMs',
    options.pollIntervalMs,
    DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS,
    MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS
  );
  const existing = (options as unknown as Partial<RuntimeDependencyOperationOptions<T>>)
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
  const monotonicNowMs = existing?.monotonicNowMs ?? createRuntimeDependencyMonotonicLedger(
    options.monotonicNowMs ?? defaultRuntimeDependencyMonotonicNowMs
  );
  const nowMonotonicMs = monotonicNowMs();
  const nowUnixMs = Date.now();
  const deadlineAtUnixMs = Math.min(
    existing?.deadlineAtUnixMs ?? Number.POSITIVE_INFINITY,
    options.deadlineAtUnixMs ?? nowUnixMs + initialBudgetMs
  );
  const existingContextIsStillCanonical = existing !== undefined &&
    deadlineAtUnixMs === existing.deadlineAtUnixMs &&
    lockBudgetMs >= existing.initialBudgetMs &&
    pollIntervalMs === existing.pollIntervalMs &&
    (options.signal === undefined || options.signal === existing.signal);
  const deadlineAtMonotonicMs = existingContextIsStillCanonical
    ? existing.deadlineAtMonotonicMs
    : Math.min(
        existing?.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY,
        nowMonotonicMs + initialBudgetMs,
        nowMonotonicMs + Math.max(0, deadlineAtUnixMs - nowUnixMs)
      );
  const context = existing !== undefined
      && existingContextIsStillCanonical
    ? existing
    : Object.freeze({
        deadlineAtUnixMs,
        deadlineAtMonotonicMs,
        initialBudgetMs: existing?.initialBudgetMs ?? initialBudgetMs,
        monotonicNowMs,
        operationId: existing?.operationId ?? crypto.randomUUID(),
        pollIntervalMs,
        signal: options.signal ?? existing?.signal,
        startedAtMonotonicMs: existing?.startedAtMonotonicMs ?? nowMonotonicMs,
        telemetryKey: existing?.telemetryKey ?? Object.freeze({})
      });
  context.signal?.throwIfAborted();
  return {
    ...options,
    lockTimeoutMs: Math.min(initialBudgetMs, context.initialBudgetMs),
    pollIntervalMs,
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: context
  };
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
  const context = runtimeDependencyOperationContext(options);
  context.signal?.throwIfAborted();
  const observedAtMonotonicMs = context.monotonicNowMs();
  const remainingMs = context.deadlineAtMonotonicMs - observedAtMonotonicMs;
  if (!Number.isFinite(remainingMs) || remainingMs < minimumMs) {
    throw new SecError('RUNTIME-DEPS-003', `${label} exceeded the runtime dependency operation deadline`, {
      initialBudgetMs: context.initialBudgetMs,
      minimumMs,
      observedAtMonotonicMs,
      remainingMs: Math.max(0, Math.floor(remainingMs))
    });
  }
  return remainingMs;
}

export async function waitForRuntimeDependencyOperation(
  options: RuntimeDependencyInstallOptions,
  requestedDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<void> {
  const context = runtimeDependencyOperationContext(options);
  const remainingMs = runtimeDependencyOperationRemainingMs(options, label);
  const boundedDelayMs = Math.max(1, Math.min(requestedDelayMs, Math.floor(remainingMs)));
  let abortListener: (() => void) | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const aborted = context.signal === undefined
    ? null
    : new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(context.signal?.reason ?? new Error(`${label} was aborted`));
        context.signal?.addEventListener('abort', abortListener, { once: true });
      });
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => reject(new SecError(
      'RUNTIME-DEPS-003',
      `${label} exceeded the runtime dependency operation deadline`,
      { initialBudgetMs: context.initialBudgetMs }
    )), Math.max(1, Math.ceil(remainingMs)));
  });
  try {
    await Promise.race([
      sleep(boundedDelayMs),
      deadline,
      ...(aborted === null ? [] : [aborted])
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (abortListener !== undefined) context.signal?.removeEventListener('abort', abortListener);
  }
  runtimeDependencyOperationRemainingMs(options, label);
}

export async function runtimeDependencyOperationEffectFence(
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(options, `${label} effect`);
}

export function runtimeDependencyOperationDeadlineAt(
  options: RuntimeDependencyOperationOptions,
  label: string
): number {
  runtimeDependencyOperationRemainingMs(options, label);
  return runtimeDependencyOperationContext(options).deadlineAtMonotonicMs;
}
