import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runTaskGroup } from '../../src/system-architecture/foundation/runtime/concurrency.ts';

function held() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }

test('a failed group stops accepting queued tasks but joins every started task', async () => {
  const hold = held(), started: number[] = []; const primary = new Error('primary'); let settled = false;
  const running = runTaskGroup([
    async () => { started.push(0); await Promise.resolve(); throw primary; },
    async signal => { started.push(1); await hold.promise; assert.equal(signal.aborted, true); },
    async () => { assert.fail('queued task started after failure'); }
  ], { concurrency: 2 }).then(() => assert.fail('unexpected success'), e => { settled = true; assert.equal(e, primary); });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false); assert.deepEqual(started, [0, 1]);
  hold.release(); await running; assert.equal(settled, true);
});

test('active concurrency is bounded and results retain input order', async () => {
  let active = 0, maximum = 0;
  const result = await runTaskGroup(Array.from({ length: 51 }, (_, i) => async () => {
    maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; return i;
  }), { concurrency: 3 });
  assert.equal(maximum, 3); assert.deepEqual(result, Array.from({ length: 51 }, (_, i) => i));
});

test('concurrent failures retain every cause after joining, including undefined', async () => {
  const secondary = new Error('secondary');
  await assert.rejects(runTaskGroup([async () => { throw undefined; }, async () => { throw secondary; }], { concurrency: 2 }), e => {
    assert.ok(e instanceof AggregateError); assert.deepEqual(e.errors, [undefined, secondary]);
    assert.equal(e.cause, undefined); return true;
  });
});

test('parent cancellation prevents new acceptance and is not reported as success', async () => {
  const c = new AbortController(), reason = { cancelled: true };
  await assert.rejects(runTaskGroup([async () => { c.abort(reason); return 7; }, async () => assert.fail('cancelled queue')],
    { concurrency: 1, signal: c.signal }), e => e === reason);
});

test('two groups cannot clear or cancel one another', async () => {
  const values = await Promise.all([runTaskGroup([async () => 1]), runTaskGroup([async () => 2])]);
  assert.deepEqual(values, [[1], [2]]);
});

for (const concurrency of [0, -1, 0.5, Infinity, NaN]) test(`invalid concurrency ${concurrency} runs no task`, async () => {
  await assert.rejects(runTaskGroup([async () => assert.fail('invalid admission')], { concurrency }), TypeError);
});
