import crypto from 'node:crypto';
import { assertNativeAbortSignal, linkNativeAbortSignals, throwIfNativeAborted } from '../../../../contracts/native-abort.ts';

import { FailureError } from '../../../../contracts/failure.ts';

// A default and a ceiling are independent decisions, even when equal today.
const DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS = 300_000;
export const MAX_DEPENDENCY_OPERATION_TIMEOUT_MS = 300_000;
const DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 50;
const MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 1_000;
const RUNTIME_DEPENDENCY_OPERATION_CONTEXT = Symbol('sec-runtime-dependency-operation-context-v1');
// A discoverable symbol is a carrier, not proof that the owner issued a ledger.
const issuedOperationContexts = new WeakSet<object>();
const issuedControlViews = new WeakSet<object>();
// Capture provenance for immutable raw views and clock wrappers only. Neither
// set authenticates a caller ledger or skips normal budget/cancellation checks.
const capturedControlInputs = new WeakSet<object>();
const capturedClockMethods = new WeakSet<object>();

function captureMonotonicSource(
  source: RuntimeDependencyOperationControlInput['monotonicNowMs'],
  receiver: object
): RuntimeDependencyOperationControlInput['monotonicNowMs'] {
  // Preserve invalid values for the existing owner validation. A derived
  // operation still uses its parent's checked ledger, never a replacement clock.
  if (typeof source !== 'function' || capturedClockMethods.has(source)) return source;
  const selected = () => Reflect.apply(source, receiver, []);
  capturedClockMethods.add(selected);
  return selected;
}

/** Control inputs, not installation requests or effect capabilities. */
export interface RuntimeDependencyOperationControlInput {
  /** Parent wall-clock deadline is captured once into the monotonic ledger. */
  deadlineAtUnixMs?: number;
  lockTimeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** Environment input; only its checked ledger survives in the bound context. */
  monotonicNowMs?: () => number;
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

/** Runtime projection contains no install, lifecycle, publication or test capability. */
export type BoundRuntimeDependencyOperationControls = Readonly<{
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
  const value = configured === undefined ? fallback : configured;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new FailureError(
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
      throw new FailureError(
        'RUNTIME-DEPS-003',
        'Runtime dependency operation monotonic clock is invalid or moved backwards',
        { observed, previous }
      );
    }
    previous = observed;
    return observed;
  };
}

/** Preserve the existing own-enumerable request boundary without enumerating unrelated fields. */
function ownControl<K extends keyof RuntimeDependencyOperationControlInput>(
  options: RuntimeDependencyOperationControlInput,
  key: K
): RuntimeDependencyOperationControlInput[K] {
  return Object.getOwnPropertyDescriptor(options, key)?.enumerable ? options[key] : undefined;
}

function invalidBinding(): never {
  throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency operation binding is not owner-issued');
}

function assertIssuedContext(value: unknown): asserts value is RuntimeDependencyOperationContext {
  if (typeof value !== 'object' || value === null || !issuedOperationContexts.has(value)) invalidBinding();
}

function existingContext(options: RuntimeDependencyOperationControlInput): RuntimeDependencyOperationContext | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, RUNTIME_DEPENDENCY_OPERATION_CONTEXT);
  if (descriptor === undefined) return undefined;
  // Do not invoke a forged binding accessor. Copies must carry the same exact
  // issued object, not a shape-compatible clone or a proxy-selected substitute.
  if (!descriptor.enumerable || !('value' in descriptor)) invalidBinding();
  const value = (options as Partial<BoundRuntimeDependencyOperationControls>)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
  if (value !== descriptor.value) invalidBinding();
  assertIssuedContext(value);
  return value;
}

/** Keep the same parent across a compatibility boundary that copies caller getters. */
export function captureRuntimeDependencyBindingGuard(
  options: RuntimeDependencyOperationControlInput
): (captured: RuntimeDependencyOperationControlInput) => void {
  const expected = existingContext(options);
  return (captured) => { if (existingContext(captured) !== expected) invalidBinding(); };
}

function validateSignal(signal: AbortSignal | undefined): void {
  if (signal === undefined) return;
  try {
    // Native brand checking does not use instanceof; supplied aborted getters and
    // throwIfAborted methods are not evidence that this is an AbortSignal.
    assertNativeAbortSignal(signal);
  } catch {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency signal must be a native AbortSignal');
  }
}

/** Capture the owner's raw control fields and exact parent binding without
 * sampling a clock. Coordinator admission can validate its selected request
 * before starting the same ledger; no arbitrary caller symbols are copied.
 */
export function captureRuntimeDependencyControlInput(
  options: RuntimeDependencyOperationControlInput
): Readonly<RuntimeDependencyOperationControlInput> {
  if (options === null || typeof options !== 'object') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency controls must be an object');
  }
  if (issuedControlViews.has(options) || capturedControlInputs.has(options)) return options;
  const existing = existingContext(options);
  const deadlineAtUnixMs = ownControl(options, 'deadlineAtUnixMs');
  const lockTimeoutMs = ownControl(options, 'lockTimeoutMs');
  const pollIntervalMs = ownControl(options, 'pollIntervalMs');
  const source = ownControl(options, 'monotonicNowMs');
  const signal = ownControl(options, 'signal');
  if (existingContext(options) !== existing) invalidBinding();
  const captured = Object.freeze({ deadlineAtUnixMs, lockTimeoutMs, pollIntervalMs,
    monotonicNowMs: captureMonotonicSource(source, options), signal,
    ...(existing === undefined ? {} : { [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: existing }) });
  capturedControlInputs.add(captured);
  return captured;
}

export function runtimeDependencyOperationControls(
  options: RuntimeDependencyOperationControlInput
): BoundRuntimeDependencyOperationControls {
  const captured = captureRuntimeDependencyControlInput(options);
  const existing = existingContext(captured);
  const { deadlineAtUnixMs: requestedDeadline, lockTimeoutMs,
    pollIntervalMs: requestedPollIntervalMs, monotonicNowMs: requestedMonotonicNowMs,
    signal: requestedSignal } = captured;
  validateSignal(requestedSignal);
  if (existing === undefined && requestedMonotonicNowMs !== undefined && typeof requestedMonotonicNowMs !== 'function') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency monotonic clock must be callable');
  }
  const lockBudgetMs = runtimeDependencyPositiveBoundedInteger(
    'lockTimeoutMs',
    lockTimeoutMs,
    DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const pollIntervalMs = runtimeDependencyPositiveBoundedInteger(
    'pollIntervalMs',
    requestedPollIntervalMs,
    DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS,
    MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS
  );
  if (requestedDeadline !== undefined && !Number.isSafeInteger(requestedDeadline)) {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is invalid', {
      deadlineAtUnixMs: requestedDeadline
    });
  }
  const monotonicNowMs = existing?.monotonicNowMs ?? createRuntimeDependencyMonotonicLedger(
    requestedMonotonicNowMs ?? defaultRuntimeDependencyMonotonicNowMs
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
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency absolute deadline is exhausted');
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
    ? Math.min(requestedDeadline ?? Number.POSITIVE_INFINITY, nowUnixMs + initialBudgetMs)
    : Math.min(
        existing.deadlineAtUnixMs,
        hasNewAbsoluteBound ? requestedDeadline : Number.POSITIVE_INFINITY,
        deadlineAtMonotonicMs < existing.deadlineAtMonotonicMs
          ? nowUnixMs + initialBudgetMs
          : Number.POSITIVE_INFINITY
      );
  const signal = existing?.signal === undefined || requestedSignal === existing.signal
    ? requestedSignal
    : requestedSignal === undefined
      ? existing.signal
      : linkNativeAbortSignals(existing.signal, requestedSignal);
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
  throwIfNativeAborted(context.signal);
  issuedOperationContexts.add(context);
  const effectiveLockTimeoutMs = Math.min(initialBudgetMs, context.initialBudgetMs);
  if (issuedControlViews.has(options) && existingContextIsStillCanonical &&
      options.lockTimeoutMs === effectiveLockTimeoutMs) return options as BoundRuntimeDependencyOperationControls;
  const view = Object.freeze({
    deadlineAtUnixMs,
    lockTimeoutMs: effectiveLockTimeoutMs,
    pollIntervalMs,
    signal,
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: context
  });
  issuedControlViews.add(view);
  return view;
}

export function runtimeDependencyOperationContext(
  options: RuntimeDependencyOperationControlInput
): RuntimeDependencyOperationContext {
  return existingContext(options)
    ?? runtimeDependencyOperationControls(options)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
}

export function runtimeDependencyOperationRemainingMs(
  options: RuntimeDependencyOperationControlInput,
  label: string,
  minimumMs = 1
): number {
  if (!Number.isFinite(minimumMs) || minimumMs < 0) {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency minimum budget must be finite and non-negative', {
      minimumMs
    });
  }
  return remainingFromContext(runtimeDependencyOperationContext(options), label, minimumMs);
}

function remainingFromContext(
  context: RuntimeDependencyOperationContext,
  label: string,
  minimumMs = 1
): number {
  assertIssuedContext(context);
  throwIfNativeAborted(context.signal);
  const observedAtMonotonicMs = context.monotonicNowMs();
  // Injected clock sources can synchronously cancel the operation while
  // sampling its budget. Do not admit an effect using that stale check.
  throwIfNativeAborted(context.signal);
  const remainingMs = context.deadlineAtMonotonicMs - observedAtMonotonicMs;
  if (!Number.isFinite(remainingMs) || remainingMs < minimumMs) {
    throw new FailureError('RUNTIME-DEPS-003', `${label} exceeded the runtime dependency operation deadline`,
      {
        initialBudgetMs: context.initialBudgetMs,
        minimumMs,
        observedAtMonotonicMs,
        remainingMs: Math.max(0, Math.floor(remainingMs))
      });
  }
  return remainingMs;
}

/** Validate an already-issued ledger without reconstructing raw options.
 * Context-owning scans use the same cancellation, clock and deadline decision
 * as effects; a matching structural object is not an issued operation.
 */
export function assertRuntimeDependencyOperationActive(
  context: RuntimeDependencyOperationContext,
  label: string
): void {
  remainingFromContext(context, label);
}

/** Own the deadline/cancellation lifecycle of one await, not the provider's work. */
export async function awaitRuntimeDependencyOperation(
  context: RuntimeDependencyOperationContext,
  label: string,
  start: (remainingMs: number) => Promise<void> | void
): Promise<void> {
  // The observer is private: third-party abort listeners cannot suppress its
  // event, and dispatchEvent('abort') on the public signal is not cancellation.
  // Native dependent signals observe abort state, not synthetic source events.
  assertIssuedContext(context);
  const signal = context.signal === undefined ? undefined : linkNativeAbortSignals(context.signal);
  const remainingMs = remainingFromContext(context, label);
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
      deadlineTimer = setTimeout(() => reject(new FailureError(
        'RUNTIME-DEPS-003',
        `${label} exceeded the runtime dependency operation deadline`,
        { initialBudgetMs: context.initialBudgetMs }
      )), Math.max(1, Math.ceil(remainingMs)));
    });
    await Promise.race([
      // Attach handlers before provider code starts, including synchronous
      // throws and rejections that arrive after cancellation or timeout.
      Promise.resolve().then(() => start(
        remainingFromContext(context, label)
      )),
      deadline,
      ...(aborted === null ? [] : [aborted])
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener);
  }
  remainingFromContext(context, label);
}

export async function waitForRuntimeDependencyOperation(
  options: RuntimeDependencyOperationControlInput,
  requestedDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<void> {
  // Infinite delays retain the saturating clamp; unordered inputs must not
  // reach provider work. Keep one captured ledger throughout the await.
  if (typeof requestedDelayMs !== 'number' || Number.isNaN(requestedDelayMs)) {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency wait delay must be an ordered number', {
      requestedDelayMs
    });
  }
  const context = runtimeDependencyOperationContext(runtimeDependencyOperationControls(options));
  const remainingMs = remainingFromContext(context, label);
  const boundedDelayMs = Math.max(1, Math.min(requestedDelayMs, Math.floor(remainingMs)));
  await awaitRuntimeDependencyOperation(context, label, (admittedRemainingMs) =>
    sleep(Math.min(boundedDelayMs, Math.floor(admittedRemainingMs)))
  );
}

export function runtimeDependencyOperationDeadlineAt(
  options: BoundRuntimeDependencyOperationControls,
  label: string
): number {
  runtimeDependencyOperationRemainingMs(options, label);
  return runtimeDependencyOperationContext(options).deadlineAtMonotonicMs;
}
