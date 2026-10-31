import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { withProgressLifecycle, type ProgressObserver } from '../../../src/execution/progress-lifecycle.ts';

function observer(events: string[], broken = false, reason: unknown = new Error('display')): ProgressObserver {
  const handle = {
    start(text: string) { assert.equal(this, handle); events.push(`start:${text}`); if (broken) throw reason; return handle; },
    succeed(text: string) { assert.equal(this, handle); events.push(`succeed:${text}`); if (broken) throw reason; return handle; },
    fail(text: string) { assert.equal(this, handle); events.push(`fail:${text}`); if (broken) throw reason; return handle; },
    stop() { assert.equal(this, handle); events.push('stop'); if (broken) throw reason; return handle; }
  };
  return handle;
}

for (const broken of ['factory', 'methods']) {
  test(`successful action remains successful with ${broken} presentation`, async () => {
    const events: string[] = [], value = Object.freeze({ value: 7 });
    const result = await withProgressLifecycle('task', () => { events.push('factory'); if (broken === 'factory') throw new Error('factory'); return observer(events, broken === 'methods'); },
      async () => { events.push('action'); return value; });
    assert.equal(result, value);
    assert.deepEqual(events, broken === 'factory' ? ['factory', 'action'] : ['factory', 'start:task', 'action', 'succeed:task', 'stop']);
  });
}

for (const reason of [undefined, Symbol('reason')]) {
  test(`arbitrary thrown value ${String(reason)} survives fail and cleanup failures`, async () => {
    const events: string[] = [];
    const handle = { start() { events.push('start'); }, succeed() { assert.fail('success on failed action'); }, fail() { events.push('fail'); throw new Error('fail'); }, stop() { events.push('stop'); throw new Error('stop'); } };
    await assert.rejects(withProgressLifecycle('task', () => handle, async () => { throw reason; }), (error) => error === reason);
    assert.deepEqual(events, ['start', 'fail', 'stop']);
  });
}

test('a synchronously throwing action still owns failure and cleanup once', async () => {
  const events: string[] = [], primary = new Error('sync');
  await assert.rejects(withProgressLifecycle('task', () => observer(events), () => { throw primary; }), (error) => error === primary);
  assert.deepEqual(events, ['start:task', 'fail:task', 'stop']);
});

test('the cleanup opportunity follows an action that suspends; not its initial Promise creation', async () => {
  const events: string[] = []; let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const pending = withProgressLifecycle('task', () => observer(events), async () => { events.push('begin'); await held; events.push('end'); return 7; });
  try {
    assert.deepEqual(events, ['start:task', 'begin']);
  } finally {
    // Even a failed pre-resumption assertion must release and join the action
    // before the test owns its final outcome.
    finish();
    await pending;
  }
  assert.equal(await pending, 7);
  assert.deepEqual(events, ['start:task', 'begin', 'end', 'succeed:task', 'stop']);
});

test('parallel invocations never share observer handles or results', async () => {
  const first: string[] = [], second: string[] = [];
  const firstObserver = observer(first), secondObserver = observer(second);
  firstObserver.start = (text) => { first.push(`start:${text}`); return Promise.reject('display'); };
  firstObserver.stop = () => { first.push('stop'); return new Promise<void>(() => {}); };
  secondObserver.start = (text) => {
    second.push(`start:${text}`);
    return { then() { throw new Error('thenable'); } };
  };
  assert.deepEqual(await Promise.all([
    withProgressLifecycle('one', () => firstObserver, async () => 1),
    withProgressLifecycle('two', () => secondObserver, async () => 2)
  ]), [1, 2]);
  assert.deepEqual(first, ['start:one', 'succeed:one', 'stop']);
  assert.deepEqual(second, ['start:two', 'succeed:two', 'stop']);
  // Let rejected presentation promises surface if their consumer missed them.
  await new Promise<void>(resolve => setImmediate(resolve));
});
