import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureVerifyProjectOptions } from '../../../src/adapters/verification/verify-invocation.ts';

for (const value of [null, 0, 'false', {}]) {
  test('emitTiming rejects a non-boolean without coercion', () => {
    assert.throws(() => captureVerifyProjectOptions({ emitTiming: value } as never), TypeError);
  });
}

test('native cancellation is not overridden by the public signal method', () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  Object.defineProperty(controller.signal, 'throwIfAborted', { value() {} }); controller.abort(reason);
  assert.throws(() => captureVerifyProjectOptions({ signal: controller.signal }), error => error === reason);
});
