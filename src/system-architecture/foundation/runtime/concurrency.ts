import pLimit, { type LimitFunction } from 'p-limit';

const DEFAULT_CONCURRENCY = 10;

export function createConcurrencyLimit(concurrency: number = DEFAULT_CONCURRENCY): LimitFunction {
  return pLimit(concurrency);
}

// Retained provider API. A batch does not share this mutable queue.
export const defaultLimit: LimitFunction = createConcurrencyLimit();
export function getDefaultLimit(): LimitFunction { return defaultLimit; }

export interface TaskGroupOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** A bounded group owns acceptance, cancellation and joining, not physical
 * termination. No task remains queued or running when this promise settles.
 * A provider ignoring cancellation is still joined; never return early into
 * a caller's rollback while that provider may still write. */
export async function runTaskGroup<T>(
  tasks: readonly ((signal: AbortSignal) => T | PromiseLike<T>)[],
  options: TaskGroupOptions = {}
): Promise<T[]> {
  const configuredConcurrency = options.concurrency;
  const concurrency = configuredConcurrency === undefined ? DEFAULT_CONCURRENCY : configuredConcurrency;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('Task group concurrency must be a positive safe integer');
  const captured = Array.from(tasks);
  if (captured.some(task => typeof task !== 'function')) throw new TypeError('Task group entries must be callable');
  const parent = options.signal;
  const controller = new AbortController();
  const signal = parent === undefined ? controller.signal : AbortSignal.any([parent, controller.signal]);
  signal.throwIfAborted();
  const results: T[] = new Array(captured.length);
  const failures: Array<{ index: number; reason: unknown }> = [];
  let primary: { reason: unknown } | undefined;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (primary === undefined && !signal.aborted && next < captured.length) {
      const index = next++;
      try { results[index] = await captured[index]!(signal); }
      catch (reason) {
        failures.push({ index, reason });
        if (primary === undefined) { primary = { reason }; controller.abort(reason); }
      }
    }
  };
  // O(concurrency) promises, rather than one queued promise per task.
  await Promise.all(Array.from({ length: Math.min(concurrency, captured.length) }, worker));
  if (failures.length === 1) throw failures[0]!.reason;
  if (failures.length > 1) {
    failures.sort((a, b) => a.index - b.index);
    throw new AggregateError(failures.map(f => f.reason), 'Task group failed after joining all started work', { cause: primary!.reason });
  }
  signal.throwIfAborted();
  return results;
}
