import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureVerifyProjectOptions } from '../../../src/adapters/verification/verify-invocation.ts';

test('native cancellation is not overridden by the public signal method', () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  Object.defineProperty(controller.signal, 'throwIfAborted', { value() {} }); controller.abort(reason);
  assert.throws(() => captureVerifyProjectOptions({ signal: controller.signal }), error => error === reason);
});
