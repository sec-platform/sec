import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  runtimeDependencyOperationOptions
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  captureRuntimeDependencyControlInput,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation,
  type RuntimeDependencyOperationControlInput
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

const unownedFields = ['beforeCommit', 'installMode', 'sharedDepsRoot', 'rematerialize',
  'now', 'sleep', 'testCompilerPublishHook',
  'testProjectProjectionHook', 'testCompilerBridgeValidationHook',
  'testCompilerRename', 'testMaterialization', 'generatedStateLifecycle'];
function controlsOnlyInput(): RuntimeDependencyOperationControlInput {
  const input = { lockTimeoutMs: 100, monotonicNowMs: () => 0 };
  for (const name of unownedFields) {
    Object.defineProperty(input, name, { enumerable: true, get() { throw new Error(`unowned ${name}`); } });
  }
  return new Proxy(input, { ownKeys() { throw new Error('whole request enumerated'); } });
}

test('an admitted wait reads only control inputs, not install/lifecycle/test capabilities', async () => {
  // Wait adopts the shared controls capture; direct context/budget projections
  // add no separate authority input to this same hostile-source guarantee.
  let delay: number | undefined;
  await waitForRuntimeDependencyOperation(controlsOnlyInput(), 7, async (ms) => { delay = ms; }, 'test');
  assert.equal(delay, 7);
});

test('bound controls contain no request, raw clock or effect capability', () => {
  const input = { lockTimeoutMs: 100, monotonicNowMs: () => 0,
    beforeCommit() {}, generatedStateLifecycle: {}, testMaterialization: {},
    rematerialize: true };
  const controls = runtimeDependencyOperationControls(input);
  assert.deepEqual(Object.keys(controls).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  for (const name of [...unownedFields, 'monotonicNowMs']) assert.equal(name in controls, false);
  assert.ok(Object.isFrozen(controls));
  assert.ok(Object.isFrozen(runtimeDependencyOperationContext(controls)));
});

test('inherited and non-enumerable request controls stay outside the input boundary', () => {
  const inherited = Object.create({ lockTimeoutMs: 1, pollIntervalMs: 0 });
  Object.defineProperty(inherited, 'deadlineAtUnixMs', { value: 0, enumerable: false });
  const bound = runtimeDependencyOperationControls(inherited);
  const defaults = runtimeDependencyOperationControls({});
  assert.equal(bound.lockTimeoutMs, defaults.lockTimeoutMs);
  assert.equal(bound.pollIntervalMs, defaults.pollIntervalMs);
});

test('extracting controls preserves the exact bound parent ledger and telemetry identity', () => {
  let now = 0;
  const parent = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now,
    rematerialize: false });
  const context = runtimeDependencyOperationContext(parent);
  now = 30;
  const controls = runtimeDependencyOperationControls(parent);
  assert.equal(runtimeDependencyOperationContext(controls).operationId, context.operationId);
  assert.equal(runtimeDependencyOperationContext(controls).telemetryKey, context.telemetryKey);
  assert.equal(runtimeDependencyOperationRemainingMs(controls, 'extract'), 70);
  const snapshot = captureRuntimeDependencyControlInput(controls);
  const reconstructed = runtimeDependencyOperationOptions({ ...snapshot, lockTimeoutMs: 1000, rematerialize: true });
  assert.equal(runtimeDependencyOperationContext(reconstructed).operationId, context.operationId);
  assert.equal(runtimeDependencyOperationContext(reconstructed).telemetryKey, context.telemetryKey);
  assert.equal(runtimeDependencyOperationRemainingMs(reconstructed, 'rebind'), 70);
});

test('stripped controls may narrow but never renew a parent budget', () => {
  let now = 0;
  const parent = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  now = 20;
  const narrow = runtimeDependencyOperationControls({ ...parent, lockTimeoutMs: 10,
    monotonicNowMs() { assert.fail('replacement clock'); } });
  const renewed = runtimeDependencyOperationControls({ ...narrow, lockTimeoutMs: 100 });
  assert.equal(runtimeDependencyOperationContext(narrow).operationId, runtimeDependencyOperationContext(parent).operationId);
  assert.equal(runtimeDependencyOperationContext(narrow).operationId, runtimeDependencyOperationContext(renewed).operationId);
  assert.equal(runtimeDependencyOperationRemainingMs(renewed, 'remaining'), 10);
  now = 31;
  assert.throws(() => runtimeDependencyOperationRemainingMs(renewed, 'remaining'), /deadline/);
});

for (const canceller of ['parent', 'child'] as const) {
  test(`control extraction cannot drop ${canceller} cancellation`, () => {
    const parent = new AbortController(), child = new AbortController();
    const bound = runtimeDependencyOperationOptions({ signal: parent.signal, monotonicNowMs: () => 0 });
    const narrowed = runtimeDependencyOperationControls({ ...bound, signal: child.signal });
    const retained = runtimeDependencyOperationControls({ ...narrowed, signal: undefined });
    // A direct rebind of an already issued control view retains the same
    // owner operation, just like the derived/options route above.
    const rebound = runtimeDependencyOperationControls(retained);
    assert.equal(runtimeDependencyOperationContext(rebound).operationId,
      runtimeDependencyOperationContext(retained).operationId);
    const reason = Object.freeze({ canceller });
    (canceller === 'parent' ? parent : child).abort(reason);
    for (const view of [retained, rebound]) {
      assert.throws(() => runtimeDependencyOperationRemainingMs(view, 'cancel'),
        (error: unknown) => error === reason);
    }
    assert.throws(() => runtimeDependencyOperationControls(rebound),
      (error: unknown) => error === reason);
  });
}

for (const lockTimeoutMs of [undefined, 1, MAX_DEPENDENCY_OPERATION_TIMEOUT_MS]) {
  test(`control projection and install binding admit the same budget ${lockTimeoutMs}`, () => {
    const input = { lockTimeoutMs, monotonicNowMs: () => 0 };
    const control = runtimeDependencyOperationControls(input);
    const install = runtimeDependencyOperationOptions(input);
    if (lockTimeoutMs === undefined) {
      assert.ok(Number.isSafeInteger(control.lockTimeoutMs));
      assert.ok(control.lockTimeoutMs > 0 && control.lockTimeoutMs <= MAX_DEPENDENCY_OPERATION_TIMEOUT_MS);
    } else {
      assert.equal(control.lockTimeoutMs, lockTimeoutMs);
    }
    assert.equal(control.lockTimeoutMs, install.lockTimeoutMs);
    assert.equal(runtimeDependencyOperationContext(control).deadlineAtMonotonicMs,
      runtimeDependencyOperationContext(install).deadlineAtMonotonicMs);
  });
}

for (const lockTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_DEPENDENCY_OPERATION_TIMEOUT_MS + 1]) {
  test(`invalid budget ${lockTimeoutMs} cannot reach the environment clock`, () => {
    const input = { lockTimeoutMs, monotonicNowMs: () => { assert.fail('clock ran before admission'); } };
    assert.throws(() => runtimeDependencyOperationControls(input),
      (error: unknown) => (error as { code: string }).code === 'RUNTIME-DEPS-003');
    // The coordinator delegates this grammar to controls; retain its own
    // rejection-before-clock observation without repeating every input class.
    if (lockTimeoutMs === 0) {
      assert.throws(() => runtimeDependencyOperationOptions(input),
        (error: unknown) => (error as { code: string }).code === 'RUNTIME-DEPS-003');
    }
  });
}
