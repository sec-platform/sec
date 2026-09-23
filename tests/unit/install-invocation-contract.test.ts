import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindCompilerInstallInvocation } from '../../src/adapters/toolchain/dependencies/runtime/install-invocation.ts';
import { issueRuntimeDependencyTestMaterialization } from '../../src/adapters/toolchain/dependencies/runtime/materialization-fixture-capability.ts';
import { runtimeDependencyOperationRemainingMs } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('the installer never enumerates unrelated lifecycle/test fields', () => {
  const raw = new Proxy({ lockTimeoutMs: 100, monotonicNowMs: () => 0,
    get generatedStateLifecycle() { assert.fail('unrelated capability'); throw new Error('unreachable'); }, get testCompilerRename() { assert.fail('unrelated test seam'); throw new Error('unreachable'); }
  }, { ownKeys() { assert.fail('enumerated request'); } });
  const bound = bindCompilerInstallInvocation(raw);
  assert.equal(runtimeDependencyOperationRemainingMs(bound.controls, 'test'), 100);
  assert.deepEqual(Object.keys(bound).sort(), ['beforeCommit', 'controls', 'isolated', 'materialization']);
});

test('prebound mode is rejected before even sampling the environment clock', () => {
  assert.throws(() => bindCompilerInstallInvocation({ installMode: 'prebound-only', monotonicNowMs: () => assert.fail('clock') }), /Prebound-only/);
});

test('an unissued fixture capability is refused before callbacks', () => {
  assert.throws(() => bindCompilerInstallInvocation({ testMaterialization: {} as never, monotonicNowMs: () => assert.fail('clock') }), /owner-issued/);
});

test('the selected commit method keeps its real receiver', async () => {
  class Provider { #calls = 0; beforeCommit = async () => { this.#calls++; }; get calls() { return this.#calls; } }
  const raw = new Provider(); const bound = bindCompilerInstallInvocation(raw);
  raw.beforeCommit = async () => assert.fail('replacement'); await bound.beforeCommit?.(); assert.equal(raw.calls, 1);
});

test('test capability issuance requires a callable materializer', () => {
  assert.throws(() => issueRuntimeDependencyTestMaterialization(undefined as never), TypeError);
});
