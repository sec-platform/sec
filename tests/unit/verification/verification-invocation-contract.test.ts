import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureVerifyProjectOptions } from '../../../src/adapters/verification/verify-invocation.ts';

for (const field of ['emitTiming', 'isolated'] as const) {
  test(`${field} rejects invalid booleans without invoking caller conversion hooks`, () => {
    let coercions = 0;
    const hostile = {
      [Symbol.toPrimitive]() { coercions++; return true; },
      toString() { coercions++; return 'true'; },
      valueOf() { coercions++; return true; }
    };
    // Null, numeric, string and object inputs remain separate checked samples.
    for (const value of [null, 0, 'false', {}, hostile]) {
      assert.throws(() => captureVerifyProjectOptions({ [field]: value } as never), TypeError);
    }
    assert.equal(coercions, 0);
  });
}

test('native cancellation is not overridden by the public signal method', () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  Object.defineProperty(controller.signal, 'throwIfAborted', { value() {} }); controller.abort(reason);
  assert.throws(() => captureVerifyProjectOptions({ signal: controller.signal }), error => error === reason);
});
