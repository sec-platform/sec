import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationContext, runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs } from '../../src/toolchain/dependencies/runtime/operation-controls.ts';

for (const configured of [undefined, 20, 1000, 600000]) {
  test(`wall deadline describes the admitted budget, not a longer caller ceiling: ${configured}`, () => {
    const nativeNow = Date.now; Date.now = () => 1000000;
    try {
      const options = runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: () => 10,
        ...(configured === undefined ? {} : { deadlineAtUnixMs: 1000000 + configured }) });
      const context = runtimeDependencyOperationContext(options);
      assert.equal(context.deadlineAtUnixMs - 1000000, context.deadlineAtMonotonicMs - 10);
      assert.equal(context.initialBudgetMs, Math.min(100, configured ?? Infinity));
      assert.equal(options.deadlineAtUnixMs, context.deadlineAtUnixMs);
    } finally { Date.now = nativeNow; }
  });
}

test('effective wall deadline stays captured across parent rebinding and wall-clock corrections', () => {
  const nativeNow = Date.now; let wall = 1000000, monotonic = 10;
  Date.now = () => wall;
  try {
    const parent = runtimeDependencyOperationControls({ lockTimeoutMs: 100, deadlineAtUnixMs: wall + 600000, monotonicNowMs: () => monotonic });
    const context = runtimeDependencyOperationContext(parent);
    wall += 100000; monotonic += 20;
    const child = runtimeDependencyOperationControls(parent);
    assert.equal(runtimeDependencyOperationContext(child), context);
    assert.equal(runtimeDependencyOperationRemainingMs(child, 'parent'), 80);
    assert.equal(child.deadlineAtUnixMs, 1000100);
  } finally { Date.now = nativeNow; }
});
