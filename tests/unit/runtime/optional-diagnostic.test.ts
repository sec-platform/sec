import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { observeOptionalDiagnostic } from '../../../src/execution/optional-diagnostic.ts';

test('synchronous diagnostic rejection cannot seize authority for any thrown-value class', () => {
  for (const reason of [undefined, null, false, 0, new Error('display')]) {
    assert.doesNotThrow(
      () => observeOptionalDiagnostic(() => { throw reason; }),
      `rejected value: ${String(reason)}`
    );
  }
});

test('asynchronous diagnostic rejection is observed without detached unhandled failures', async () => {
  observeOptionalDiagnostic(() => Promise.reject('display'));
  observeOptionalDiagnostic(() => ({ then() { throw new Error('thenable'); } }));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('diagnostic promises never become a completion barrier', () => {
  let invoked = false;
  assert.equal(observeOptionalDiagnostic(() => { invoked = true; return new Promise<void>(() => {}); }), undefined);
  assert.equal(invoked, true);
});
