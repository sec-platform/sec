import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindCompilerInstallInvocation } from '../../../src/adapters/toolchain/dependencies/runtime/install-invocation.ts';
import { runtimeDependencyOperationRemainingMs } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('the installer never enumerates unrelated lifecycle/test fields', () => {
  const raw = new Proxy({ lockTimeoutMs: 100, monotonicNowMs: () => 0, installMode: 'allow' as const,
    get now() { assert.fail('unrelated wall clock'); throw new Error('unreachable'); },
    get sharedDepsRoot() { assert.fail('unrelated shared root'); throw new Error('unreachable'); },
    get generatedStateLifecycle() { assert.fail('unrelated capability'); throw new Error('unreachable'); }, get testCompilerRename() { assert.fail('unrelated test seam'); throw new Error('unreachable'); }
  }, { ownKeys() { assert.fail('enumerated request'); } });
  const bound = bindCompilerInstallInvocation(raw);
  assert.equal(bound.isolated, false);
  assert.equal(runtimeDependencyOperationRemainingMs(bound.controls, 'test'), 100);
});

test('prebound mode is rejected before even sampling the environment clock', () => {
  assert.throws(() => bindCompilerInstallInvocation({ installMode: 'prebound-only', monotonicNowMs: () => assert.fail('clock') }), /Prebound-only/);
});

test('an unissued fixture capability is refused before callbacks', () => {
  assert.throws(() => bindCompilerInstallInvocation({ testMaterialization: {} as never, monotonicNowMs: () => assert.fail('clock') }), /owner-issued/);
});
