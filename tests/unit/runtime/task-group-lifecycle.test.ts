import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mapTaskGroup, runTaskGroup } from '../../../src/execution/task-group.ts';

test('concurrent task and mapper groups preserve separate ordered results and bound active work', async () => {
  let active = 0, maximum = 0;
  const [result, peer] = await Promise.all([
    runTaskGroup(Array.from({ length: 7 }, (_, i) => async () => {
      maximum = Math.max(maximum, ++active); await Promise.resolve(); active--; return i;
    }), { concurrency: 3 }),
    mapTaskGroup([0, 1], (value, index) => { assert.equal(value, index); return value * 2; })
  ]);
  assert.equal(maximum, 3); assert.deepEqual(result, Array.from({ length: 7 }, (_, i) => i));
  assert.deepEqual(peer, [0, 2]);
});

test('concurrent failures retain every cause after joining, including undefined', async () => {
  const secondary = new Error('secondary');
  await assert.rejects(runTaskGroup([async () => { throw undefined; }, async () => { throw secondary; }], { concurrency: 2 }), e => {
    assert.ok(e instanceof AggregateError); assert.deepEqual(e.errors, [undefined, secondary]);
    assert.equal(e.cause, undefined); return true;
  });
});
