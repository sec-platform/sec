import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyEffectFenceOptions, runtimeDependencyOperationOptions } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationRemainingMs } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('the effect view retains only operation controls, not installation decisions', () => {
  const bound = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => 0,
    installMode: 'offline-copy-only', rematerialize: true });
  const value = runtimeDependencyEffectFenceOptions(bound);
  assert.deepEqual(Object.keys(value).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  assert.equal(runtimeDependencyOperationRemainingMs(value, 'test'), 100);
  assert.ok(Object.isFrozen(value));
});
