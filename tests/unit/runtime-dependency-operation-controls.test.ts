import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationOptions
} from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation,
  type RuntimeDependencyOperationControlInput
} from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import {
  measureRuntimeDependencyOperationPhase,
  readRuntimeDependencyOperationTelemetry
} from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';

const unownedFields = ['beforeCommit', 'installMode', 'rematerialize', 'runtimeStateEnvironment',
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

for (const consumer of ['bind', 'context', 'remaining', 'wait'] as const) {
  test(`${consumer} reads only control inputs, not install/lifecycle/test capabilities`, async () => {
    const input = controlsOnlyInput();
    switch (consumer) {
      case 'bind': assert.equal(runtimeDependencyOperationControls(input).lockTimeoutMs, 100); break;
      case 'context': assert.equal(runtimeDependencyOperationContext(input).initialBudgetMs, 100); break;
      case 'remaining': assert.equal(runtimeDependencyOperationRemainingMs(input, 'test'), 100); break;
      case 'wait': {
        let delay: number | undefined;
        await waitForRuntimeDependencyOperation(input, 7, async (ms) => { delay = ms; }, 'test');
        assert.equal(delay, 7); break;
      }
    }
  });
}

test('bound controls contain no request, raw clock or effect capability', () => {
  const input = { lockTimeoutMs: 100, monotonicNowMs: () => 0,
    beforeCommit() {}, generatedStateLifecycle: {}, testMaterialization: {} };
  const controls = runtimeDependencyOperationControls(input);
  assert.deepEqual(Object.keys(controls).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  for (const name of [...unownedFields, 'monotonicNowMs']) assert.equal(name in controls, false);
  assert.ok(Object.isFrozen(controls));
  assert.ok(Object.isFrozen(runtimeDependencyOperationContext(controls)));
});

test('each control getter is read once before executing the captured clock', () => {
  const reads = new Map<string, number>();
  const controller = new AbortController();
  const values: Record<string, unknown> = { deadlineAtUnixMs: Date.now() + 100_000,
    lockTimeoutMs: 100, pollIntervalMs: 7, signal: controller.signal,
    monotonicNowMs: () => { values.lockTimeoutMs = 1; values.pollIntervalMs = 99; return 0; } };
  const input: RuntimeDependencyOperationControlInput = {};
  for (const name of Object.keys(values)) Object.defineProperty(input, name, {
    enumerable: true, get() { reads.set(name, (reads.get(name) ?? 0) + 1); return values[name]; }
  });
  const bound = runtimeDependencyOperationControls(input);
  assert.equal(bound.lockTimeoutMs, 100); assert.equal(bound.pollIntervalMs, 7);
  assert.equal(bound.signal, controller.signal);
  assert.deepEqual([...reads.values()], [1, 1, 1, 1, 1]);
});

test('inherited and non-enumerable request controls stay outside the input boundary', () => {
  const inherited = Object.create({ lockTimeoutMs: 1, pollIntervalMs: 0,
    monotonicNowMs() { throw new Error('inherited clock'); } });
  Object.defineProperty(inherited, 'deadlineAtUnixMs', { value: 0, enumerable: false });
  const bound = runtimeDependencyOperationControls(inherited);
  assert.equal(bound.lockTimeoutMs, MAX_DEPENDENCY_OPERATION_TIMEOUT_MS);
  assert.equal(bound.pollIntervalMs, 50);
});

test('extracting controls preserves the exact bound parent ledger and telemetry identity', () => {
  let now = 0;
  const parent = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  const context = runtimeDependencyOperationContext(parent);
  now = 30;
  const controls = runtimeDependencyOperationControls(parent);
  assert.equal(runtimeDependencyOperationContext(controls), context);
  assert.equal(runtimeDependencyOperationRemainingMs(controls, 'extract'), 70);
  const reconstructed = runtimeDependencyOperationOptions({ ...controls, rematerialize: true });
  assert.equal(runtimeDependencyOperationContext(reconstructed), context);
  assert.equal(runtimeDependencyOperationRemainingMs(reconstructed, 'rebind'), 70);
});

test('stripped controls may narrow but never renew a parent budget', () => {
  let now = 0;
  const parent = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  now = 20;
  const narrow = runtimeDependencyOperationControls({ ...parent, lockTimeoutMs: 10 });
  const renewed = runtimeDependencyOperationControls({ ...narrow, lockTimeoutMs: 100 });
  assert.equal(runtimeDependencyOperationContext(narrow), runtimeDependencyOperationContext(renewed));
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
    const reason = Object.freeze({ canceller });
    (canceller === 'parent' ? parent : child).abort(reason);
    assert.throws(() => runtimeDependencyOperationRemainingMs(retained, 'cancel'), (error: unknown) => error === reason);
  });
}

test('coordinator excludes undeclared capabilities and preserves the true callback receiver', async () => {
  const capability = Object.freeze({ owner: 'install' });
  let reads = 0, calls = 0;
  const raw = { lockTimeoutMs: 100, rematerialize: false, monotonicNowMs: () => 0,
    get customCapability() { reads += 1; return capability; },
    async beforeCommit() { assert.equal(this, raw); assert.equal(this.rematerialize, true); calls += 1; } };
  const bound = runtimeDependencyOperationOptions(raw);
  assert.equal(reads, 0);
  // @ts-expect-error Coordinator inputs no longer forward arbitrary extensions.
  assert.equal(bound.customCapability, undefined);
  assert.equal(bound.rematerialize, false);
  raw.rematerialize = true;
  await runtimeDependencyOperationEffectFence(bound, 'fence');
  assert.equal(calls, 1); assert.equal(reads, 0); assert.ok(Object.isFrozen(bound));
});

test('telemetry can consume stripped controls without a second operation identity', () => {
  let now = 0;
  const parent = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  const controls = runtimeDependencyOperationControls(parent);
  measureRuntimeDependencyOperationPhase(controls, 'identity', () => { now = 3; });
  const first = readRuntimeDependencyOperationTelemetry(parent);
  const second = readRuntimeDependencyOperationTelemetry(controls);
  assert.deepEqual(first, second); assert.equal(second.phases[0]?.durationMs, 3);
});

for (const lockTimeoutMs of [undefined, 1, MAX_DEPENDENCY_OPERATION_TIMEOUT_MS]) {
  test(`control projection and install binding admit the same budget ${lockTimeoutMs}`, () => {
    const input = { lockTimeoutMs, monotonicNowMs: () => 0 };
    const control = runtimeDependencyOperationControls(input);
    const install = runtimeDependencyOperationOptions(input);
    assert.equal(control.lockTimeoutMs, install.lockTimeoutMs);
    assert.equal(runtimeDependencyOperationContext(control).deadlineAtMonotonicMs,
      runtimeDependencyOperationContext(install).deadlineAtMonotonicMs);
  });
}

for (const lockTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_DEPENDENCY_OPERATION_TIMEOUT_MS + 1]) {
  test(`invalid budget ${lockTimeoutMs} cannot reach the environment clock`, () => {
    const input = { lockTimeoutMs, monotonicNowMs: () => { assert.fail('clock ran before admission'); } };
    for (const bind of [runtimeDependencyOperationControls, runtimeDependencyOperationOptions]) {
      assert.throws(() => bind(input), (error: unknown) => (error as { code: string }).code === 'RUNTIME-DEPS-003');
    }
  });
}
