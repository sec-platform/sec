import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bindCompilerInstallInvocation } from '../../../src/adapters/toolchain/dependencies/runtime/install-invocation.ts';
import { consumeRuntimeDependencyTestMaterialization, issueRuntimeDependencyTestMaterialization } from '../../../src/adapters/toolchain/dependencies/runtime/materialization-fixture-capability.ts';
import {
  runtimeDependencyOperationOptions as bind, runtimeDependencyEffectFenceOptions as effect,
  runtimeDependencyOperationEffectFence as fence
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationContext as context, runtimeDependencyOperationRemainingMs as remaining } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { captureRuntimeDependencyInstallRequest as capture } from '../../../src/execution/dependency-install-request.ts';

const controls=()=>({lockTimeoutMs:1000,monotonicNowMs:()=>0});

test('public request, coordinator, process binder and effect use one captured provider receiver', async()=>{
  const controller=new AbortController();
  class Provider {
    #calls=0;
    signal=controller.signal;
    async beforeCommit(){assert.equal(this,provider);this.#calls++;}
    installMode='offline-copy-only' as const;
    get calls(){return this.#calls;}
  }
  const provider=new Provider();const request=capture(provider);
  // The public request is a bounded decision snapshot, not a vehicle for
  // coordinator-only clock providers or a writable signal replacement.
  const signal = new AbortController().signal;
  const selected = capture({
    deadlineAtUnixMs: 5000, installMode: 'offline-copy-only' as const,
    lockTimeoutMs: 100, rematerialize: true, signal,
    monotonicNowMs: () => 0
  });
  assert.deepEqual(selected, {
    beforeCommit: undefined, deadlineAtUnixMs: 5000,
    installMode: 'offline-copy-only', lockTimeoutMs: 100, rematerialize: true, signal
  });
  assert.strictEqual(selected.signal, signal);
  assert.ok(Object.isFrozen(selected));

  // The effect-only boundary strips install decisions before executing the
  // shared admitted effect. Check its entire key set, not only missing keys.
  const stripped = effect(bind({ ...controls(), installMode: 'offline-copy-only', rematerialize: true }));
  assert.deepEqual(Object.keys(stripped).sort(), ['deadlineAtUnixMs', 'lockTimeoutMs', 'pollIntervalMs', 'signal']);
  assert.equal(remaining(stripped, 'test'), 1000);
  assert.ok(Object.isFrozen(stripped));
  let now=0;
  const bound=bind({...controls(),monotonicNowMs:()=>now,...request});const process=bindCompilerInstallInvocation(bound);
  const parent=context(bound);
  assert.equal(process.isolated,true);assert.equal(context(process.controls).operationId,parent.operationId);
  provider.beforeCommit=()=>assert.fail('replacement');
  now=25;
  const effects=effect(effect({...bound,lockTimeoutMs:10_000}));assert.equal(context(effects).operationId,context(bound).operationId);
  await process.beforeCommit?.();await fence(effects,'effect');assert.equal(provider.calls,2);
  const after=context(effects);
  assert.equal(after.operationId,parent.operationId);assert.equal(after.telemetryKey,parent.telemetryKey);
  assert.equal(after.deadlineAtMonotonicMs,parent.deadlineAtMonotonicMs);
  assert.equal(remaining(effects,'remaining'),975);
  assert.equal(bound.signal,controller.signal);assert.equal(effects.signal,controller.signal);
});

test('coordinator transmission does not turn an unissued materialization object into an authority',()=>{
  const value=bind({...controls(),testMaterialization:{} as never});
  assert.throws(()=>bindCompilerInstallInvocation(value),error=>{
    assert.equal((error as {code:string}).code,'RUNTIME-DEPS-004');
    assert.match((error as Error).message,/owner-issued/);return true;
  });
});

test('issued fixture remains the exact issued object across public-to-process control binding',async()=>{
  let calls=0;
  const token=issueRuntimeDependencyTestMaterialization(async request=>{calls++;assert.deepEqual(request,{args:['install'],cwd:'fixture-root',timeoutMs:5});return {code:0,stdout:'ok',stderr:''};});
  const invocation=bindCompilerInstallInvocation(bind({...controls(),testMaterialization:token}));
  assert.equal(invocation.materialization,token);assert.equal(calls,0);
  const result=await consumeRuntimeDependencyTestMaterialization(invocation.materialization!,{args:['install'],cwd:'fixture-root',timeoutMs:5});
  assert.deepEqual(result,{code:0,stdout:'ok',stderr:''});assert.equal(calls,1);
});

test('same parent cancellation survives every projection, including a newly supplied child signal',()=>{
  const parent=new AbortController(),child=new AbortController(),reason=Object.freeze({cancel:true});
  const bound=bind({...controls(),signal:parent.signal});
  const process=bindCompilerInstallInvocation({...bound,signal:child.signal});
  const effects=effect(process.controls);parent.abort(reason);
  assert.throws(()=>remaining(effects,'effects'),e=>e===reason);
});
