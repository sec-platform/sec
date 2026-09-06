import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { runTaskGroup } from '../../src/system-architecture/foundation/runtime/concurrency.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('task mutation of visible signal fields cannot reopen a cancelled queue', async () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  await assert.rejects(runTaskGroup([
    async signal => {
      Object.defineProperties(signal, { aborted: { value: false }, throwIfAborted: { value() {} } });
      controller.abort(reason);
      return 1;
    },
    async () => assert.fail('work admitted after real cancellation')
  ], { concurrency: 1, signal: controller.signal }), error => error === reason);
});

test('already cancelled admission executes no task-array getter or iterator', async () => {
  const controller = new AbortController(); controller.abort('stop');
  const tasks: (() => Promise<void>)[] = [];
  Object.defineProperty(tasks, Symbol.iterator, { get() { assert.fail('iterator read'); } });
  await assert.rejects(runTaskGroup(tasks, { signal: controller.signal }), error => error === 'stop');
});

test('dense task identity is captured independently of a replacement iterator', async () => {
  const tasks = [async () => 7];
  tasks[Symbol.iterator] = function* () { yield async () => assert.fail('substituted task'); };
  assert.deepEqual(await runTaskGroup(tasks), [7]);
});

test('all tasks are admitted before any task executes and accessors are not invoked', async () => {
  const tasks = [async () => assert.fail('partially admitted group ran')];
  Object.defineProperty(tasks, 1, { get() { assert.fail('task getter'); } });
  await assert.rejects(runTaskGroup(tasks), TypeError);
  await assert.rejects(runTaskGroup(new Array(1)), TypeError);
});

test('synthetic abort events leave later tasks eligible', async () => {
  const result = await runTaskGroup([
    async signal => { signal.dispatchEvent(new Event('abort')); return 1; }, async () => 2
  ], { concurrency: 1 });
  assert.deepEqual(result, [1, 2]);
});

test('cancellation waits for an uncooperative started task and rejects only after it settles', async () => {
  const controller = new AbortController(), active = deferred(), release = deferred();
  let returned = false;
  const result = runTaskGroup([async () => { active.resolve(); await release.promise; return 7; }],
    { signal: controller.signal }).finally(() => { returned = true; });
  const rejected = assert.rejects(result, error => error === 'cancelled');
  try {
    await active.promise; controller.abort('cancelled'); await Promise.resolve();
    assert.equal(returned, false);
  } finally { release.resolve(); }
  await rejected;
});

test('failure still joins peers and preserves concurrently thrown values', async () => {
  const second = new Error('second');
  await assert.rejects(runTaskGroup([async () => { throw undefined; }, async () => { throw second; }]), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [undefined, second]);
    assert.equal(error.cause, undefined); return true;
  });
});

test('a structural signal cannot impersonate cancellation state', async () => {
  await assert.rejects(runTaskGroup([async () => assert.fail('invalid signal ran')],
    { signal: { aborted: false, throwIfAborted() {} } as never }), TypeError);
});
