import { expect, test } from 'bun:test';
import { ResourceCompositeSettlementError } from '../../../src/execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../src/execution/stream-reader.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('EOF releases one reader without cancel and preserves undefined result', async () => {
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); }, cancel() { cancels++; } });
  expect(await withOwnedByteStreamReader(stream, async read => { expect((await read()).done).toBe(true); return undefined; })).toBe(undefined);
  expect(stream.locked).toBe(false);
  expect(cancels).toBe(0);
});
test('body rejection undefined survives successful cancellation', async () => {
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
  const outcome = await withOwnedByteStreamReader(stream, async () => { throw undefined; })
    .then(value => ({ status: 'ok', value }), error => ({ status: 'failed', error }));
  expect(outcome).toEqual({ status: 'failed', error: undefined });
  expect(stream.locked).toBe(false);
  expect(cancels).toBe(1);
});

test('early successful return waits for cancellation acknowledgement, then releases', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  let settled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { entered.resolve(); return gate.promise; } });
  const result = withOwnedByteStreamReader(stream, async () => 'partial').finally(() => { settled = true; });
  try { await entered.promise; expect(settled).toBe(false); expect(stream.locked).toBe(true); }
  finally { gate.resolve(); await result; }
  expect(await result).toBe('partial');
  expect(stream.locked).toBe(false);
});

test('simultaneous body and cancellation rejection retain both falsey payloads and release', async () => {
  const stream = new ReadableStream<Uint8Array>({ cancel() { return Promise.reject(null); } });
  const outcome = await withOwnedByteStreamReader(stream, async () => { throw undefined; }).then(() => null, error => error);
  expect(outcome).toBeInstanceOf(ResourceCompositeSettlementError);
  expect(outcome.errors).toEqual([undefined, null]);
  expect(outcome.failures.map((f: { label: string }) => f.label)).toEqual(['stream-operation', 'stream-cancel']);
  expect(stream.locked).toBe(false);
});

test('native read rejection already terminates the source and does not call cancel again', async () => {
  const reason = Object.freeze({ source: 'failed' });
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(reason); }, cancel() { cancels++; } });
  const error = await withOwnedByteStreamReader(stream, async read => { await read(); }).catch(error => error);
  expect(error).toBe(reason);
  expect(cancels).toBe(0);
  expect(stream.locked).toBe(false);
});

test('pending read and native abort join one cancellation before closeout returns', async () => {
  const controller = new AbortController();
  const entered = deferred<void>();
  const gate = deferred<void>();
  let calls = 0;
  let settled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { calls++; return gate.promise; } });
  const result = withOwnedByteStreamReader(stream, async read => { entered.resolve(); await read(); }, controller.signal)
    .then(() => ({ status: 'ok' }), error => ({ status: 'failed', error })).finally(() => { settled = true; });
  try {
    await entered.promise;
    // A synthetic event is not cancellation; the helper observes native slots.
    controller.signal.dispatchEvent(new Event('abort'));
    await tick(); expect(calls).toBe(0);
    controller.abort('cancelled');
    await tick(); expect(calls).toBe(1); expect(settled).toBe(false);
  } finally { controller.abort('test cleanup'); gate.resolve(); await result; }
  expect(await result).toEqual({ status: 'failed', error: 'cancelled' });
  expect(stream.locked).toBe(false);
});

test('already-aborted operation still closes its acquired stream without running the body', async () => {
  let calls = 0, cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
  const error = await withOwnedByteStreamReader(stream, async () => { calls++; }, AbortSignal.abort(null)).catch(error => error);
  expect(error).toBeNull(); expect(calls).toBe(0); expect(cancels).toBe(1); expect(stream.locked).toBe(false);
});

test('failed acquisition does not cancel or release another owner reader', async () => {
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
  const reader = stream.getReader();
  try {
    await expect(withOwnedByteStreamReader(stream, async () => undefined)).rejects.toBeInstanceOf(TypeError);
    expect(stream.locked).toBe(true); expect(cancels).toBe(0);
  } finally { await reader.cancel(); reader.releaseLock(); }
});
