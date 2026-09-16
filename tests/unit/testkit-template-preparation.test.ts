import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTemplatePreparation } from '../testkit/template-preparation.ts';

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
  for (const reason of [undefined, null, false, 0, new Error('prepare')]) {
    let fail = true;
    const prepare = createTemplatePreparation(async () => { if (fail) throw reason; return 'recovered'; });
    const a = prepare('kind'), b = prepare('kind'); assert.equal(a, b);
    await assert.rejects(a, error => error === reason);
    fail = false; assert.equal(await prepare('kind'), 'recovered');
  }
});

test('synchronous preparation exceptions enter the same joined failure lifecycle', async () => {
  const reason = new Error('sync');
  const prepare = createTemplatePreparation(() => { throw reason; });
  const a = prepare('kind'), b = prepare('kind'); assert.equal(a, b);
  await assert.rejects(a, error => error === reason);
});
