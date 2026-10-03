const MAXIMUM_CLEANUP_ENTRIES = 100_000;
const MAXIMUM_CLEANUP_BYTES = 2 * 1024 * 1024 * 1024;

export interface GeneratedStateCleanupOperationSession {
  readonly deadlineAtMonotonicMs: number;
}

export type GeneratedStateCleanupOperationState = {
  readonly deadlineAtMonotonicMs: number;
  readonly maximumBytes: number;
  readonly maximumEntries: number;
  readonly monotonicNowMs: () => number;
  readonly signal: AbortSignal | undefined;
  readonly observedBytes: number;
  readonly observedEntries: number;
};

type MutableCleanupBudget = Omit<GeneratedStateCleanupOperationState, 'observedBytes' | 'observedEntries'> & {
  observedBytes: number; observedEntries: number;
};
const generatedStateCleanupOperationStates = new WeakMap<object, MutableCleanupBudget>();
const generatedStateCleanupBudgetViews = new WeakMap<object, MutableCleanupBudget>();

export function createGeneratedStateCleanupOperationSession(input: Readonly<{
  deadlineAtMonotonicMs: number;
  maximumBytes?: number;
  maximumEntries?: number;
  monotonicNowMs?: () => number;
  signal?: AbortSignal;
}>): GeneratedStateCleanupOperationSession {
  const maximumBytes = input.maximumBytes ?? MAXIMUM_CLEANUP_BYTES;
  const maximumEntries = input.maximumEntries ?? MAXIMUM_CLEANUP_ENTRIES;
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  if (!Number.isFinite(input.deadlineAtMonotonicMs) ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > MAXIMUM_CLEANUP_BYTES ||
      !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > MAXIMUM_CLEANUP_ENTRIES) {
    throw new Error('Generated-state cleanup operation bounds are invalid.');
  }
  const session = Object.freeze({
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs
  });
  generatedStateCleanupOperationStates.set(session, {
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    maximumBytes,
    maximumEntries,
    monotonicNowMs,
    signal: input.signal,
    observedBytes: 0,
    observedEntries: 0
  });
  return session;
}

export class GeneratedStateCleanupOperationExhaustedError extends Error {}

export function generatedStateCleanupOperationState(
  session: GeneratedStateCleanupOperationSession | undefined
): GeneratedStateCleanupOperationState | null {
  if (session === undefined) return null;
  const state = generatedStateCleanupOperationStates.get(session);
  if (state === undefined) throw new Error('Generated-state cleanup operation session is not owner-issued.');
  const view = Object.freeze({
    deadlineAtMonotonicMs: state.deadlineAtMonotonicMs,
    maximumBytes: state.maximumBytes, maximumEntries: state.maximumEntries,
    monotonicNowMs: state.monotonicNowMs, signal: state.signal,
    get observedBytes() { return state.observedBytes; },
    get observedEntries() { return state.observedEntries; }
  });
  generatedStateCleanupBudgetViews.set(view, state);
  return view;
}

export function assertGeneratedStateCleanupOperation(
  state: GeneratedStateCleanupOperationState | null,
  label: string
): void {
  if (state === null) return;
  if (!generatedStateCleanupBudgetViews.has(state)) throw new Error('Generated-state cleanup budget was not issued by execution.');
  if (state.signal?.aborted === true || state.monotonicNowMs() >= state.deadlineAtMonotonicMs) {
    throw new GeneratedStateCleanupOperationExhaustedError(`${label} exceeded the cleanup operation budget.`);
  }
}
export function consumeGeneratedStateCleanupObservation(
  state: GeneratedStateCleanupOperationState,
  entries: number,
  bytes: number
): void {
  assertGeneratedStateCleanupOperation(state, 'Generated-state observation consumption');
  const budget = generatedStateCleanupBudgetViews.get(state)!;
  if (!Number.isSafeInteger(entries) || entries < 0 || !Number.isSafeInteger(bytes) || bytes < 0 ||
      entries > budget.maximumEntries - budget.observedEntries || bytes > budget.maximumBytes - budget.observedBytes) {
    throw new GeneratedStateCleanupOperationExhaustedError('Generated-state observation exceeds its original aggregate budget.');
  }
  budget.observedEntries += entries;
  budget.observedBytes += bytes;
}
