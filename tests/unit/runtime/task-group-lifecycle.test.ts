import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runTaskGroup } from '../../../src/execution/task-group.ts';

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

test('concurrent groups preserve their separate results', async () => {
  const values = await Promise.all([runTaskGroup([async () => 1]), runTaskGroup([async () => 2])]);
  assert.deepEqual(values, [[1], [2]]);
});
