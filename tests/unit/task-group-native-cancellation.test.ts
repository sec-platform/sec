import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mapTaskGroup, runTaskGroup } from '../../src/execution/task-group.ts';

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
  tasks[Symbol.iterator] = () => [async () => assert.fail('substituted task')].values();
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

for (const [cancelled, cleanup] of [
  [Object.freeze({ cancelled: true }), undefined],
  [null, false],
  [false, null],
  [0, NaN],
  [NaN, 0]
] as const) {
  test(`parent cancellation survives independent cleanup failure (${String(cancelled)})`, async () => {
    const controller = new AbortController();
    const active = deferred(), release = deferred();
    const running = runTaskGroup([
      async () => { active.resolve(); await release.promise; throw cleanup; },
      async () => assert.fail('cancelled queue started')
    ], { concurrency: 1, signal: controller.signal });
    const checked = assert.rejects(running, error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [cancelled, cleanup]);
      assert.ok(Object.is(error.cause, cancelled));
      return true;
    });
    await active.promise;
    controller.abort(cancelled);
    release.resolve();
    await checked;
  });
}

test('parent cancellation joins started mappers and retains input failure order', async () => {
  const controller = new AbortController(), cancelled = Object.freeze({ cancelled: true });
  const firstFailure = Object.freeze({ cleanup: 0 }), secondFailure = Object.freeze({ cleanup: 1 });
  const active = deferred(), first = deferred(), second = deferred();
  const started: number[] = [];
  let returned = false;
  const running = mapTaskGroup([0, 1, 2], async (item, _index, signal) => {
    started.push(item);
    // Visible properties must not replace the true cancellation payload.
    Object.defineProperty(signal, 'reason', { value: 'forged' });
    if (item === 0) { active.resolve(); await first.promise; throw firstFailure; }
    if (item === 1) { await second.promise; throw secondFailure; }
    assert.fail('cancelled queue started');
  }, { concurrency: 2, signal: controller.signal }).finally(() => { returned = true; });
  const checked = assert.rejects(running, error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [cancelled, firstFailure, secondFailure]);
    assert.equal(error.cause, cancelled);
    return true;
  });
  try {
    await active.promise;
    controller.abort(cancelled);
    second.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(returned, false);
    assert.deepEqual(started, [0, 1]);
  } finally { first.resolve(); second.resolve(); }
  await checked;
});

test('a task echoing the native cancellation reason does not duplicate its failure', async () => {
  const controller = new AbortController(), active = deferred(), release = deferred();
  const running = mapTaskGroup([0], async (_item, _index, signal) => {
    active.resolve(); await release.promise; signal.throwIfAborted();
  }, { signal: controller.signal });
  const checked = assert.rejects(running, error => Object.is(error, NaN));
  await active.promise;
  controller.abort(NaN);
  release.resolve();
  await checked;
});

test('task failure remains primary when the parent cancels during sibling drain', async () => {
  const controller = new AbortController();
  const primary = Object.freeze({ task: 0 }), secondary = Object.freeze({ task: 1 });
  const parentCancellation = Object.freeze({ cancelled: true });
  await assert.rejects(runTaskGroup([
    async () => { await Promise.resolve(); throw primary; },
    async signal => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      controller.abort(parentCancellation);
      throw secondary;
    }
  ], { signal: controller.signal }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, secondary]);
    assert.equal(error.cause, primary);
    return true;
  });
});
