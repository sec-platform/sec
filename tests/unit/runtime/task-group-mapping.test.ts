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

test('mapping captures own item slots without invoking a replacement iterator or cloning domain objects', async () => {
  const first = { id: 1 }, second = { id: 2 }, items = [first, second];
  items[Symbol.iterator] = function* () { assert.fail('iterator invoked'); };
  const results = await mapTaskGroup(items, (item, index) => {
    if (index === 0) items[1] = { id: 99 }; return item;
  }, { concurrency: 1 });
  assert.equal(results[0], first); assert.equal(results[1], second);
});

test('group options are sampled before any item observation and stay fixed', async () => {
  const options = { concurrency: 1, signal: undefined as AbortSignal | undefined };
  const controller = new AbortController(); controller.abort('late replacement');
  const items = new Proxy([1, 2], { getOwnPropertyDescriptor(target, key) {
    options.signal = controller.signal; options.concurrency = 0;
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.deepEqual(await mapTaskGroup(items, item => item, options), [1, 2]);
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

test('invalid mapper, item slots and concurrency run no domain code', async () => {
  await assert.rejects(mapTaskGroup([1], null as never), TypeError);
  for (const items of [new Array(1), Object.defineProperty([1], 0, { get() { assert.fail('input getter invoked'); } })]) {
    await assert.rejects(mapTaskGroup(items, () => assert.fail('mapper invoked')), TypeError);
  }
  for (const concurrency of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(mapTaskGroup([1], () => assert.fail('invalid group ran'), { concurrency }), TypeError);
  }
});
