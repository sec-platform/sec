import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyEffectFenceOptions, runtimeDependencyOperationEffectFence } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('the effect view neither enumerates nor retains installation and lifecycle fields', () => {
  const raw = new Proxy({ lockTimeoutMs: 100, monotonicNowMs: () => 0,
    get now() { assert.fail('wall clock read'); throw new Error('unreachable'); },
    get sharedDepsRoot() { assert.fail('shared root read'); throw new Error('unreachable'); },
    get testCompilerRename() { assert.fail('rename capability read'); throw new Error('unreachable'); },
    get generatedStateLifecycle() { assert.fail('lifecycle read'); throw new Error('unreachable'); },
    get installMode() { assert.fail('install mode read'); throw new Error('unreachable'); },
    get testMaterialization() { assert.fail('test capability read'); throw new Error('unreachable'); }
  }, { ownKeys() { assert.fail('wide options enumerated'); } });
  const value = runtimeDependencyEffectFenceOptions(raw);
  assert.deepEqual(Object.keys(value).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  assert.equal(runtimeDependencyOperationRemainingMs(value, 'test'), 100);
  assert.ok(Object.isFrozen(value));
});

test('callback getter selection precedes clock callbacks and later effect dispatch', async () => {
  class Provider {
    #calls = 0;
    lockTimeoutMs = 100;
    monotonicNowMs = () => {
      callback = async () => assert.fail('clock replacement'); return 0;
    };
    async invoke() { assert.equal(this, raw); this.#calls++; }
    get calls() { return this.#calls; }
    get beforeCommit() {
      const selected = callback;
      callback = async () => assert.fail('getter reread');
      return selected;
    }
  }
  const raw = new Provider();
  let callback: () => Promise<void> = raw.invoke;
  const value = runtimeDependencyEffectFenceOptions(raw);
  Object.defineProperty(raw, 'beforeCommit', {
    value: async () => assert.fail('post-capture replacement')
  });
  await runtimeDependencyOperationEffectFence(value, 'clock');
  assert.equal(raw.calls, 1);
});

test('a fence getter cannot remove the inherited operation binding during capture', () => {
  const parent = runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: () => 0 });
  const binding = Object.getOwnPropertySymbols(parent)[0]!;
  const raw = { ...parent, get beforeCommit() { Reflect.deleteProperty(raw, binding); return undefined; } };
  assert.throws(() => runtimeDependencyEffectFenceOptions(raw), /not owner-issued/);
});
