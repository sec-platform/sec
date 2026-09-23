import { expect, test } from 'bun:test';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../src/execution/stream-reader.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

for (const value of [undefined, null, false, 0, ''] as const) {
  test(`EOF releases one reader without cancel and preserves ${String(value)} result`, async () => {
    let cancels = 0;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); }, cancel() { cancels++; } });
    expect(await withOwnedByteStreamReader(stream, async read => { expect((await read()).done).toBe(true); return value; })).toBe(value);
    expect(stream.locked).toBe(false);
    expect(cancels).toBe(0);
  });
  test(`body rejection ${String(value)} survives successful cancellation`, async () => {
    let cancels = 0;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
    const outcome = await withOwnedByteStreamReader(stream, async () => { throw value; })
      .then(value => ({ status: 'ok', value }), error => ({ status: 'failed', error }));
    expect(outcome).toEqual({ status: 'failed', error: value });
    expect(stream.locked).toBe(false);
    expect(cancels).toBe(1);
  });
}

test('early successful return waits for cancellation acknowledgement, then releases', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  let settled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { entered.resolve(); return gate.promise; } });
  const result = withOwnedByteStreamReader(stream, async () => 'partial').finally(() => { settled = true; });
  try { await entered.promise; expect(settled).toBe(false); expect(stream.locked).toBe(true); }
  finally { gate.resolve(); }
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
  } finally { gate.resolve(); }
  expect(await result).toEqual({ status: 'failed', error: 'cancelled' });
  expect(stream.locked).toBe(false);
});

test('already-aborted operation still closes its acquired stream without running the body', async () => {
  let calls = 0, cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
  const error = await withOwnedByteStreamReader(stream, async () => { calls++; }, AbortSignal.abort(null)).catch(error => error);
  expect(error).toBeNull(); expect(calls).toBe(0); expect(cancels).toBe(1); expect(stream.locked).toBe(false);
});

test('unjoined read prevents successful return and is drained before lock release', async () => {
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancels++; } });
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  await expect(withOwnedByteStreamReader(stream, async read => { pending = read(); return 'not joined'; }))
    .rejects.toThrow('read still in flight');
  expect((await pending)!.done).toBe(true);
  expect(cancels).toBe(1); expect(stream.locked).toBe(false);
});

test('borrowed read cannot be used after the scope ends or race another read', async () => {
  const stream = new ReadableStream<Uint8Array>();
  let saved: (() => Promise<ReadableStreamReadResult<Uint8Array>>) | undefined;
  await expect(withOwnedByteStreamReader(stream, async read => {
    saved = read;
    void read();
    await expect(read()).rejects.toThrow('pending read');
    throw new Error('close the first read');
  })).rejects.toThrow('close the first read');
  await expect(saved!()).rejects.toThrow('no longer admitted');
  expect(stream.locked).toBe(false);
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
