import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { observeOptionalDiagnostic } from '../../../src/execution/optional-diagnostic.ts';

test('synchronous diagnostic rejection cannot seize authority for any thrown-value class', () => {
  for (const reason of [undefined, new Error('display')]) {
    assert.doesNotThrow(
      () => observeOptionalDiagnostic(() => { throw reason; }),
      `rejected value: ${String(reason)}`
    );
  }
});

test('asynchronous diagnostic rejection is observed without detached unhandled failures', async () => {
  assert.equal(observeOptionalDiagnostic(() => Promise.reject('display')), undefined);
  assert.equal(observeOptionalDiagnostic(() => ({ then() { throw new Error('thenable'); } })), undefined);
  await new Promise<void>(resolve => setImmediate(resolve));
});

test('diagnostic promises never become a completion barrier', () => {
  let invoked = false;
  assert.equal(observeOptionalDiagnostic(() => { invoked = true; return new Promise<void>(() => {}); }), undefined);
  assert.equal(invoked, true);
});
