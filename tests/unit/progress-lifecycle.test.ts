import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { withProgressLifecycle, type ProgressObserver } from '../../src/execution/progress-lifecycle.ts';

function observer(events: string[], broken?: string, reason: unknown = new Error('display')): ProgressObserver {
  const handle = {
    start(text: string) { assert.equal(this, handle); events.push(`start:${text}`); if (broken === 'start') throw reason; return handle; },
    succeed(text: string) { assert.equal(this, handle); events.push(`succeed:${text}`); if (broken === 'succeed') throw reason; return handle; },
    fail(text: string) { assert.equal(this, handle); events.push(`fail:${text}`); if (broken === 'fail') throw reason; return handle; },
    stop() { assert.equal(this, handle); events.push('stop'); if (broken === 'stop') throw reason; return handle; }
  };
  return handle;
}

for (const broken of [undefined, 'factory', 'start', 'succeed', 'stop']) {
  test(`successful action remains successful with ${broken ?? 'healthy'} presentation`, async () => {
    const events: string[] = [], value = Object.freeze({ value: 7 }); let calls = 0;
    const result = await withProgressLifecycle('task', () => { events.push('factory'); if (broken === 'factory') throw new Error('factory'); return observer(events, broken); },
      async () => { events.push('action'); calls += 1; return value; });
    assert.equal(result, value); assert.equal(calls, 1);
    assert.deepEqual(events, broken === 'factory' ? ['factory', 'action'] : ['factory', 'start:task', 'action', 'succeed:task', 'stop']);
  });
}

for (const broken of [undefined, 'factory', 'start', 'fail', 'stop']) {
  test(`failed action retains its primary reason with ${broken ?? 'healthy'} presentation`, async () => {
    const events: string[] = [], primary = Object.freeze({ origin: 'action' }); let calls = 0;
    await assert.rejects(withProgressLifecycle('task', () => { events.push('factory'); if (broken === 'factory') throw new Error('factory'); return observer(events, broken); },
      async () => { events.push('action'); calls += 1; throw primary; }), (error) => error === primary);
    assert.equal(calls, 1);
    assert.deepEqual(events, broken === 'factory' ? ['factory', 'action'] : ['factory', 'start:task', 'action', 'fail:task', 'stop']);
  });
}

for (const reason of [undefined, null, false, 0, Symbol('reason')]) {
  test(`arbitrary thrown value ${String(reason)} survives fail and cleanup failures`, async () => {
    const handle = { start() {}, succeed() { assert.fail('success on failed action'); }, fail() { throw new Error('fail'); }, stop() { throw new Error('stop'); } };
    await assert.rejects(withProgressLifecycle('task', () => handle, async () => { throw reason; }), (error) => error === reason);
  });
}

test('a synchronously throwing action still owns failure and cleanup once', async () => {
  const events: string[] = [], primary = new Error('sync');
  await assert.rejects(withProgressLifecycle('task', () => observer(events), () => { throw primary; }), (error) => error === primary);
  assert.deepEqual(events, ['start:task', 'fail:task', 'stop']);
});

test('accessor failures in every UI method cannot reach or replace the action', async () => {
  const handle = Object.defineProperties({}, Object.fromEntries(['start', 'succeed', 'fail', 'stop'].map((key) => [key, { get() { throw new Error(key); } }])));
  assert.equal(await withProgressLifecycle('task', () => handle as ProgressObserver, async () => 7), 7);
  const primary = new Error('action');
  await assert.rejects(withProgressLifecycle('task', () => handle as ProgressObserver, async () => { throw primary; }), (error) => error === primary);
});

test('unexpected asynchronous observer rejections are observed without delaying execution', async () => {
  const handle = { start: () => Promise.reject('start'), succeed: () => Promise.reject('succeed'), fail: () => Promise.reject('fail'), stop: () => Promise.reject('stop') };
  assert.equal(await withProgressLifecycle('task', () => handle, async () => 7), 7);
  await assert.rejects(withProgressLifecycle('task', () => handle, async () => { throw 'primary'; }), (error) => error === 'primary');
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('an observer returning a never-settling promise does not become an execution budget', async () => {
  const never = new Promise<void>(() => {});
  assert.equal(await withProgressLifecycle('task', () => ({ start: () => never, succeed: () => never, fail: () => never, stop: () => never }), async () => 7), 7);
});

test('the cleanup opportunity follows an action that suspends; not its initial Promise creation', async () => {
  const events: string[] = []; let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const pending = withProgressLifecycle('task', () => observer(events), async () => { events.push('begin'); await held; events.push('end'); return 7; });
  assert.deepEqual(events, ['start:task', 'begin']); finish(); assert.equal(await pending, 7);
  assert.deepEqual(events, ['start:task', 'begin', 'end', 'succeed:task', 'stop']);
});

test('parallel invocations never share observer handles or results', async () => {
  const first: string[] = [], second: string[] = [];
  assert.deepEqual(await Promise.all([withProgressLifecycle('one', () => observer(first), async () => 1), withProgressLifecycle('two', () => observer(second), async () => 2)]), [1, 2]);
  assert.deepEqual(first, ['start:one', 'succeed:one', 'stop']); assert.deepEqual(second, ['start:two', 'succeed:two', 'stop']);
});
