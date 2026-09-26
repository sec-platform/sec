import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation
} from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { FailureError } from '../../src/contracts/failure.ts';

const deadlineFailure = (error: unknown): boolean =>
  error instanceof FailureError && error.code === 'RUNTIME-DEPS-003';

test('invalid dependency delay never reaches the sleep effect through coercion or NaN', async () => {
  for (const delay of [NaN, '5', null, undefined, {}]) {
    let started = false;
    await assert.rejects(waitForRuntimeDependencyOperation({ monotonicNowMs: () => 0 },
      delay as number, async () => { started = true; }, 'invalid-delay'), deadlineFailure);
    assert.equal(started, false);
  }
});

test('dependency delay preserves saturating clamps for numeric extremes', async () => {
  for (const [requested, expected] of [[Infinity, 100], [-Infinity, 1], [-10, 1], [0, 1], [1.5, 1.5]]) {
    let delay = -1;
    await waitForRuntimeDependencyOperation({ lockTimeoutMs: 100, monotonicNowMs: () => 0 },
      requested!, async (value) => { delay = value; }, 'numeric-delay');
    assert.equal(delay, expected);
  }
});

test('invalid minimum budgets cannot disable deadline admission', () => {
  const options = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => 0 });
  for (const minimum of [NaN, -1, Infinity, -Infinity, '1', null]) {
    assert.throws(() => runtimeDependencyOperationRemainingMs(options, 'invalid-minimum', minimum as number), deadlineFailure);
  }
  assert.equal(runtimeDependencyOperationRemainingMs(options, 'zero-minimum', 0), 100);
});
