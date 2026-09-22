import pLimit, { type LimitFunction } from 'p-limit';
import { isNativeAborted, linkNativeAbortSignals, throwIfNativeAborted } from '../contracts/native-abort.ts';

const DEFAULT_CONCURRENCY = 10;

export function createConcurrencyLimit(concurrency: number = DEFAULT_CONCURRENCY): LimitFunction {
  return pLimit(concurrency);
}

// Retained provider API. Structured groups never share this mutable queue.
export const defaultLimit: LimitFunction = createConcurrencyLimit();
export function getDefaultLimit(): LimitFunction { return defaultLimit; }

export interface TaskGroupOptions {
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

type GroupAdmission = Readonly<{ concurrency: number; signal: AbortSignal | undefined }>;
function captureGroupOptions(options: TaskGroupOptions): GroupAdmission {
  const { concurrency: configured, signal } = options;
  throwIfNativeAborted(signal);
  const concurrency = configured === undefined ? DEFAULT_CONCURRENCY : configured;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('Task group concurrency must be a positive safe integer');
  return Object.freeze({ concurrency, signal });
}

function captureGroupItems<T>(items: readonly T[]): readonly T[] {
  if (!Array.isArray(items)) throw new TypeError('Task group input must be an array');
  const result: T[] = [];
  const length = items.length;
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(items, index);
    if (!slot || !('value' in slot)) throw new TypeError('Task group input must contain dense own data slots');
    result.push(slot.value);
  }
  return result;
}

/** Both APIs use this one acceptance/cancellation/join lifecycle. A mapper
 * avoids one closure per item. Item identity is captured, not deep-frozen. */
async function runCapturedGroup<Input, Output>(
  items: readonly Input[],
  execute: (item: Input, index: number, signal: AbortSignal) => Output | PromiseLike<Output>,
  options: GroupAdmission
): Promise<Output[]> {
  const controller = new AbortController();
  const signal = linkNativeAbortSignals(options.signal, controller.signal);
  throwIfNativeAborted(signal);
  const results: Output[] = new Array(items.length);
  const failures: Array<{ index: number; reason: unknown }> = [];
  let primary: { reason: unknown } | undefined;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (primary === undefined && !isNativeAborted(signal) && next < items.length) {
      const index = next++;
      try { results[index] = await execute(items[index]!, index, signal); }
      catch (reason) {
        failures.push({ index, reason });
        if (primary === undefined) { primary = { reason }; controller.abort(reason); }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, worker));
  if (failures.length === 1) throw failures[0]!.reason;
  if (failures.length > 1) {
    failures.sort((a, b) => a.index - b.index);
    throw new AggregateError(failures.map(f => f.reason), 'Task group failed after joining all started work', { cause: primary!.reason });
  }
  throwIfNativeAborted(signal);
  return results;
}

/** A group joins every started callback before settling. It does not terminate
 * uncooperative providers or claim ownership of detached work they create. */
export async function runTaskGroup<T>(
  tasks: readonly ((signal: AbortSignal) => T | PromiseLike<T>)[],
  options: TaskGroupOptions = {}
): Promise<T[]> {
  const admitted = captureGroupOptions(options);
  const captured = captureGroupItems(tasks);
  if (captured.some(task => typeof task !== 'function')) throw new TypeError('Task group entries must be callable');
  return runCapturedGroup(captured, (task, _index, signal) => task(signal), admitted);
}

export async function mapTaskGroup<Input, Output>(
  items: readonly Input[],
  execute: (item: Input, index: number, signal: AbortSignal) => Output | PromiseLike<Output>,
  options: TaskGroupOptions = {}
): Promise<Output[]> {
  if (typeof execute !== 'function') throw new TypeError('Task group mapper must be callable');
  const admitted = captureGroupOptions(options);
  return runCapturedGroup(captureGroupItems(items), execute, admitted);
}

/** Add cooperative cancellation around an existing effect-admission callback.
 * This grants no permission and does not swallow or time out the owner's fence. */
export function createTaskGroupEffectFence(
  signal: AbortSignal,
  beforeEffect?: () => void | PromiseLike<void>
): () => Promise<void> {
  if (beforeEffect !== undefined && typeof beforeEffect !== 'function') throw new TypeError('Task group effect fence must be callable');
  return async () => {
    throwIfNativeAborted(signal);
    await beforeEffect?.();
    throwIfNativeAborted(signal);
  };
}
