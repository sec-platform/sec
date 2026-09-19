import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { withLeaseObservationMonitor } from '../../src/execution/lease-observation-monitor.ts';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function rejectsWith(promise: Promise<unknown>, reason: unknown) {
  let rejected = false;
  try { await promise; } catch (actual) { rejected = true; assert.equal(actual, reason); }
  assert.equal(rejected, true);
}

for (const reason of [undefined, null, false, 0, Object.freeze({ failure: 'lease' })]) {
  test(`initial lease rejection preserves ${typeof reason} and never starts the operation`, async () => {
    let called = false;
    await rejectsWith(withLeaseObservationMonitor(async () => { throw reason; }, async () => { called = true; }), reason);
    assert.equal(called, false);
  });
}

test('admission and final validation bracket one execution and preserve its identity', async () => {
  const order: string[] = [];
  const value = Object.freeze({ result: 7 });
  const result = await withLeaseObservationMonitor(async () => { order.push('assert'); }, async (signal) => {
    assert.equal(signal.aborted, false); order.push('execute'); return value;
  });
  assert.equal(result, value); assert.deepEqual(order, ['assert', 'execute', 'assert']);
});

test('a slow initial assertion cannot overlap with periodic observation', async () => {
  const held = deferred(); let calls = 0, executed = false;
  const run = withLeaseObservationMonitor(async () => { calls++; if (calls === 1) await held.promise; }, async () => { executed = true; });
  await delay(300);
  assert.equal(calls, 1); assert.equal(executed, false);
  held.resolve(); await run; assert.equal(calls, 2);
});

test('a successful callback drains the pending check before fresh final validation', async () => {
  const held = deferred(), started = deferred(); let calls = 0, inFlight = 0, maximum = 0;
  let returned = false;
  const run = withLeaseObservationMonitor(async () => {
    calls++; inFlight++; maximum = Math.max(maximum, inFlight);
    if (calls === 2) { started.resolve(); await held.promise; }
    inFlight--;
  }, async () => { await started.promise; return 7; }).then((result) => { returned = true; return result; });
  await started.promise; await delay(300);
  assert.equal(returned, false); assert.equal(calls, 2);
  held.resolve(); assert.equal(await run, 7);
  assert.equal(calls, 3); assert.equal(maximum, 1);
});

for (const reason of [undefined, Object.freeze({ failure: 'periodic' })]) {
  test(`periodic ${typeof reason} rejection aborts cooperatively and cannot become success`, async () => {
    let calls = 0;
    const run = withLeaseObservationMonitor(async () => { calls++; if (calls === 2) throw reason; }, async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return 'not a successful operation';
    });
    await rejectsWith(run, reason); assert.equal(calls, 2);
  });
}

test('an observed lease failure retains precedence over the callback cancellation error', async () => {
  const reason = Object.freeze({ lease: 'lost' }); let calls = 0;
  const run = withLeaseObservationMonitor(async () => { if (++calls === 2) throw reason; }, async (signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new Error('callback observed cancellation');
  });
  await rejectsWith(run, reason);
});

test('failure return retires observation and late rejection cannot abort the retired signal', async () => {
  const held = deferred(), started = deferred(); const reason = Object.freeze({ callback: 'failed' });
  let calls = 0, signal!: AbortSignal;
  const run = withLeaseObservationMonitor(async () => { if (++calls === 2) { started.resolve(); await held.promise; } }, async (observed) => {
    signal = observed; await started.promise; throw reason;
  });
  await rejectsWith(run, reason); assert.equal(signal.aborted, false);
  held.reject(new Error('late check rejection'));
  await delay(300);
  assert.equal(signal.aborted, false); assert.equal(calls, 2);
});

test('final validation failure, including undefined, is never returned as callback success', async () => {
  let calls = 0;
  await rejectsWith(withLeaseObservationMonitor(async () => { if (++calls === 2) throw undefined; }, async () => 7), undefined);
  assert.equal(calls, 2);
});

test('a synchronous assertion throw is preserved without acquiring a periodic timer', async () => {
  const reason = Object.freeze({ synchronous: true });
  await rejectsWith(withLeaseObservationMonitor(() => { throw reason; }, async () => assert.fail('not admitted')), reason);
});

test('independent monitor invocations never share signals or failure state', async () => {
  const signals: AbortSignal[] = [];
  for (const value of [undefined, null, false, 0, 7]) {
    assert.equal(await withLeaseObservationMonitor(async () => {}, async (signal) => { signals.push(signal); return value; }), value);
  }
  assert.equal(new Set(signals).size, signals.length);
  assert.ok(signals.every((signal) => !signal.aborted));
});
