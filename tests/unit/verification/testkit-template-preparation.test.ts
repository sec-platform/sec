import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTemplatePreparation } from '../../testkit/template-preparation.ts';

test('template kinds remain independent while same-kind requests share only in-flight preparation', async () => {
  let finish!: () => void, calls = 0;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const prepare = createTemplatePreparation(async (kind: string) => {
    calls++; if (kind === 'composed') await held; return kind;
  });
  const a = prepare('composed'), b = prepare('composed');
  try {
    await Promise.resolve(); assert.equal(calls, 1);
    assert.equal(await prepare('other'), 'other');
    assert.equal(calls, 2);
  } finally {
    finish();
    await Promise.allSettled([a, b]);
  }
  assert.deepEqual(await Promise.all([a, b]), ['composed', 'composed']);
  assert.equal(await prepare('composed'), 'composed'); assert.equal(calls, 3);
});

test('failure is shared exactly and retired so an explicitly retried preparation may succeed', async () => {
  const cases = [
    { reason: undefined, synchronous: false },
    { reason: new Error('sync'), synchronous: true }
  ];
  for (const { reason, synchronous } of cases) {
    let fail = true, calls = 0;
    const prepare = createTemplatePreparation(synchronous
      ? () => { calls++; throw reason; }
      : async () => { calls++; if (fail) throw reason; return 'recovered'; });
    const a = prepare('kind'), b = prepare('kind');
    const context = `${synchronous ? 'synchronous' : 'asynchronous'}: ${String(reason)}`;
    await Promise.all([a, b].map(p => assert.rejects(p, error => error === reason, context)));
    assert.equal(calls, 1, context);
    if (!synchronous) {
      fail = false;
      assert.equal(await prepare('kind'), 'recovered', context);
      assert.equal(calls, 2, context);
    }
  }
});
