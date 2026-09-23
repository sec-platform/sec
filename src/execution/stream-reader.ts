import type { ReadableStreamReadResult } from 'node:stream/web';
import { isNativeAborted, linkNativeAbortSignals, throwIfNativeAborted } from '../contracts/native-abort.ts';
import { settleResourcesAsync } from './resource-settlement.ts';

/** Own one byte-stream reader through use, cancellation acknowledgement and
 * lock release. This is not a timeout or proof that an external effect stopped.
 * The caller retains this promise until it settles, even if its observer times out.
 * Only the read operation is lent out; a late caller cannot re-use the reader. */
export async function withOwnedByteStreamReader<T>(
  stream: ReadableStream<Uint8Array>,
  operation: (read: () => Promise<ReadableStreamReadResult<Uint8Array>>) => Promise<T>,
  parentSignal?: AbortSignal
): Promise<T> {
  if (typeof operation !== 'function') throw new TypeError('Stream operation must be callable');
  const signal = linkNativeAbortSignals(parentSignal);
  const reader = stream.getReader();
  let accepting = true;
  let terminal = false;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    if (cancellation === undefined) {
      cancellation = Promise.resolve().then(() => reader.cancel('owned-stream-closeout'));
      // Observe immediately without replacing the original promise: closeout
      // still awaits it and preserves rejection, including undefined.
      void cancellation.catch(() => undefined);
    }
    return cancellation;
  };
  const abort = (): void => {
    if (isNativeAborted(signal) && !terminal) void cancel();
  };
  signal.addEventListener('abort', abort);
  const read = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (!accepting) return Promise.reject(new Error('Stream reader is no longer admitted'));
    if (pending !== undefined) return Promise.reject(new Error('Stream reader already has a pending read'));
    throwIfNativeAborted(signal);
    const selected = reader.read();
    pending = selected;
    void selected.then(
      result => { terminal = result.done; if (pending === selected) pending = undefined; },
      () => { terminal = true; if (pending === selected) pending = undefined; }
    );
    return selected;
  };
  let outcome: { status: 'succeeded'; value: T } | { status: 'failed'; error: unknown };
  try {
    throwIfNativeAborted(signal);
    const value = await operation(read);
    throwIfNativeAborted(signal);
    if (pending !== undefined) throw new Error('Stream operation returned with a read still in flight');
    outcome = { status: 'succeeded', value };
  } catch (error) {
    outcome = { status: 'failed', error };
  }
  accepting = false;
  signal.removeEventListener('abort', abort);
  const unfinishedRead = pending;
  await settleResourcesAsync({
    ...(outcome.status === 'failed' ? { primary: { label: 'stream-operation', error: outcome.error } } : {}),
    cleanup: [
      { label: 'stream-cancel', settle: async () => {
        if (cancellation !== undefined) await cancellation;
        else if (!terminal) await cancel();
      } },
      { label: 'stream-read-join', settle: async () => { await unfinishedRead; } },
      { label: 'stream-reader-release', settle: () => reader.releaseLock() }
    ]
  });
  if (outcome.status === 'failed') throw outcome.error;
  return outcome.value;
}
