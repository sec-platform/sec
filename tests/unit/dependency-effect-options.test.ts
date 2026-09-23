import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyEffectFenceOptions, runtimeDependencyOperationEffectFence } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationContext, runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('the effect view neither enumerates nor retains installation and lifecycle fields', () => {
  const raw = new Proxy({ lockTimeoutMs: 100, monotonicNowMs: () => 0,
    get generatedStateLifecycle() { assert.fail('lifecycle read'); throw new Error('unreachable'); },
    get installMode() { assert.fail('install mode read'); throw new Error('unreachable'); },
    get testMaterialization() { assert.fail('test capability read'); throw new Error('unreachable'); }
  }, { ownKeys() { assert.fail('wide options enumerated'); } });
  const value = runtimeDependencyEffectFenceOptions(raw);
  assert.deepEqual(Object.keys(value).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  assert.equal(runtimeDependencyOperationRemainingMs(value, 'test'), 100);
  assert.ok(Object.isFrozen(value));
});

test('original receiver survives capture and public method replacement', async () => {
  class Provider {
    #calls = 0;
    lockTimeoutMs = 100;
    monotonicNowMs = () => 0;
    async beforeCommit() { this.#calls++; }
    get calls() { return this.#calls; }
  }
  const raw = new Provider();
  const value = runtimeDependencyEffectFenceOptions(raw);
  raw.beforeCommit = async () => assert.fail('replacement called');
  await runtimeDependencyOperationEffectFence(value, 'provider');
  assert.equal(raw.calls, 1);
});

test('callback selection precedes clock callbacks', async () => {
  let called = 0;
  const raw = { lockTimeoutMs: 100, monotonicNowMs: () => {
    raw.beforeCommit = async () => assert.fail('clock replacement'); return 0;
  }, beforeCommit: async () => { called++; } };
  await runtimeDependencyOperationEffectFence(runtimeDependencyEffectFenceOptions(raw), 'clock');
  assert.equal(called, 1);
});

test('a narrow child keeps the exact parent operation and cannot renew its deadline', () => {
  let now = 0;
  const parent = runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  const parentContext = runtimeDependencyOperationContext(parent);
  now = 25;
  const child = runtimeDependencyEffectFenceOptions({ ...parent, lockTimeoutMs: 1000 });
  const childContext = runtimeDependencyOperationContext(child);
  assert.equal(childContext.operationId, parentContext.operationId);
  assert.equal(childContext.telemetryKey, parentContext.telemetryKey);
  assert.equal(childContext.deadlineAtMonotonicMs, parentContext.deadlineAtMonotonicMs);
  assert.equal(runtimeDependencyOperationRemainingMs(child, 'remaining'), 75);
});

test('a fence getter cannot remove the inherited operation binding during capture', () => {
  const parent = runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: () => 0 });
  const binding = Object.getOwnPropertySymbols(parent)[0]!;
  const raw = { ...parent, get beforeCommit() { Reflect.deleteProperty(raw, binding); return undefined; } };
  assert.throws(() => runtimeDependencyEffectFenceOptions(raw), /not owner-issued/);
});

for (const callback of [null, false, 0, 'callback']) {
  test(`invalid effect callback ${String(callback)} is rejected before clock sampling`, () => {
    assert.throws(() => runtimeDependencyEffectFenceOptions({ beforeCommit: callback as never,
      monotonicNowMs: () => assert.fail('invalid input sampled clock') }), TypeError);
  });
}

test('all selected control and callback getters are captured only once', async () => {
  const reads = new Map<string, number>();
  const raw = {};
  for (const [key, value] of Object.entries({ lockTimeoutMs: 100, pollIntervalMs: 2,
    monotonicNowMs: (): number => 0, beforeCommit: async () => {} })) {
    Object.defineProperty(raw, key, { enumerable: true, get() { reads.set(key, (reads.get(key) ?? 0) + 1); return value; } });
  }
  await runtimeDependencyOperationEffectFence(runtimeDependencyEffectFenceOptions(raw), 'getters');
  assert.deepEqual([...reads.values()], [1, 1, 1, 1]);
});
