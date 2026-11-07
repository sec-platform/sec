import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTaskGroupEffectFence, mapTaskGroup } from '../../../src/execution/task-group.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test('a mapping failure stops acceptance but still joins a suspended mapper', async () => {
  const gate = deferred(), started = deferred(); const failure = new Error('failed'); let settled = false;
  const result = mapTaskGroup([0, 1, 2], async (value, _index, signal) => {
    if (value === 0) { await started.promise; throw failure; }
    if (value === 1) { started.resolve(); await gate.promise; assert.equal(signal.aborted, true); return value; }
    assert.fail('queued item ran after failure');
  }, { concurrency: 2 }).then(() => assert.fail('unexpected success'), error => { settled = true; assert.equal(error, failure); });
  try {
    await started.promise; await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { gate.resolve(); await result; }
});

test('parent cancellation prevents later acceptance even when current mapper succeeds', async () => {
  const controller = new AbortController(), reason = new Error('cancelled');
  await assert.rejects(mapTaskGroup([1, 2], value => {
    assert.equal(value, 1); controller.abort(reason); return value;
  }, { concurrency: 1, signal: controller.signal }), error => error === reason);
});

test('effect fence checks cancellation both before and after the original admission', async () => {
  const first = new AbortController(), failure = new Error('cancel'); first.abort(failure);
  await assert.rejects(createTaskGroupEffectFence(first.signal, () => assert.fail('cancelled owner ran'))(), error => error === failure);
  const second = new AbortController(); let calls = 0;
  await assert.rejects(createTaskGroupEffectFence(second.signal, async () => { calls++; second.abort(failure); })(), error => error === failure);
  assert.equal(calls, 1);
});

test('owner fence rejection is preserved rather than converted into cancellation', async () => {
  const controller = new AbortController(), reason = Object.freeze({ fence: 'failed' });
  await assert.rejects(createTaskGroupEffectFence(controller.signal, () => { throw reason; })(), error => error === reason);
});
