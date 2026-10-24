import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTemplatePreparation } from '../../testkit/template-preparation.ts';

test('concurrent requests for one kind share only the in-flight preparation', async () => {
  let finish!: () => void, calls = 0;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const prepare = createTemplatePreparation(async (kind: string) => { calls++; await held; return kind; });
  const a = prepare('composed'), b = prepare('composed');
  assert.equal(a, b); await Promise.resolve(); assert.equal(calls, 1);
  finish(); assert.deepEqual(await Promise.all([a, b]), ['composed', 'composed']);
  assert.equal(await prepare('composed'), 'composed'); assert.equal(calls, 2);
});

test('independent template kinds do not block one another', async () => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const prepare = createTemplatePreparation(async (kind: string) => { if (kind === 'slow') await held; return kind; });
  const slow = prepare('slow');
  try { assert.equal(await prepare('other'), 'other'); } finally { finish(); }
  assert.equal(await slow, 'slow');
});

test('failure is shared exactly and retired so an explicitly retried preparation may succeed', async () => {
  const cases = [
    { reason: undefined, synchronous: false },
    { reason: new Error('sync'), synchronous: true }
  ];
  for (const { reason, synchronous } of cases) {
    let fail = true;
    const prepare = createTemplatePreparation(synchronous
      ? () => { throw reason; }
      : async () => { if (fail) throw reason; return 'recovered'; });
    const a = prepare('kind'), b = prepare('kind');
    const context = `${synchronous ? 'synchronous' : 'asynchronous'}: ${String(reason)}`;
    assert.equal(a, b, context);
    await assert.rejects(a, error => error === reason, context);
    if (!synchronous) {
      fail = false;
      assert.equal(await prepare('kind'), 'recovered', context);
    }
  }
});
