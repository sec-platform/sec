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
  const selectedInput = {
    deadlineAtUnixMs: 5000, installMode: 'offline-copy-only' as const,
    lockTimeoutMs: 100, rematerialize: true, signal,
    monotonicNowMs: () => 0
  };
  const selected = capture(selectedInput);
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
  // Other selected runtime callbacks preserve their provider receiver and arguments.
  {
    class Provider {
      #events: unknown[][] = [];
      lockTimeoutMs = 1000;
      rematerialize = false;
      monotonicNowMs = () => 0;
      beforeCommit = async function(this: Provider) { this.#events.push(['fence', this.rematerialize]); };
      now = function(this: Provider) { this.#events.push(['now']); return 'time'; };
      sleep = async function(this: Provider, ms: number) { this.#events.push(['sleep', ms]); };
      testCompilerRename = async function(this: Provider, from: string, to: string) { this.#events.push(['rename', from, to]); };
      testInstallLockDelete = async function(this: Provider, file: string, attempt: number) { this.#events.push(['delete', file, attempt]); };
      testCompilerPublishHook = function(this: Provider, stage: 'active-backed-up') { this.#events.push(['publish', stage]); };
      testProjectProjectionHook = function(this: Provider, stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback') { this.#events.push(['project', stage]); };
      testCompilerBridgeValidationHook = function(this: Provider, stage: 'binding-observed' | 'final-binding-observed') { this.#events.push(['bridge', stage]); };
      get events() { return this.#events; }
    }
    const provider = new Provider(); const bound = bind(provider);
    assert.equal(bound.rematerialize, false);
    await fence(bound, 'private'); assert.equal(bound.now?.(), 'time');
    await bound.sleep?.(4); await bound.testCompilerRename?.('a','b'); await bound.testInstallLockDelete?.('p',3);
    await bound.testCompilerPublishHook?.('active-backed-up'); await bound.testProjectProjectionHook?.('published');
    await bound.testCompilerBridgeValidationHook?.('binding-observed');
    assert.deepEqual(provider.events, [['fence',false],['now'],['sleep',4],['rename','a','b'],
      ['delete','p',3],['publish','active-backed-up'],['project','published'],['bridge','binding-observed']]);
  }
  // All three install modes preserve the public-to-coordinator decision.
  {
    for(const mode of ['allow','offline-copy-only','prebound-only'] as const){
      const request=capture({installMode:mode});
      assert.equal(request.installMode,mode);assert.equal(request.rematerialize,undefined);
      const bound=bind({...request,...controls()});assert.equal(bound.installMode,mode);assert.equal(bound.rematerialize,undefined);
      assert.equal(bound.lockTimeoutMs,1000);
    }
    assert.equal(bind(controls()).installMode,undefined);
  }
});

test('coordinator transmission does not turn an unissued materialization object into an authority',async()=>{
  const value=bind({...controls(),testMaterialization:{} as never});
  assert.throws(()=>bindCompilerInstallInvocation(value),error=>{
    assert.equal((error as {code:string}).code,'RUNTIME-DEPS-004');
    assert.match((error as Error).message,/owner-issued/);return true;
  });
  // Bound callback failures retain arbitrary original rejection values.
  {
    let selected: unknown;
    const bound=bind({...controls(),beforeCommit(){throw selected;},sleep:async()=>{throw selected;}});
    for(const reason of [undefined,null,false,0,Object.freeze({error:true})]){
      selected=reason;
      await assert.rejects(fence(bound,'failure'),e=>e===reason);
      // Both methods use the same argument/receiver-preserving binder; retain
      // the async method's own wiring without crossing every payload again.
      if(reason===undefined)await assert.rejects(bound.sleep!(1),e=>e===reason);
    }
  }
});

test('issued fixture remains the exact issued object across public-to-process control binding',async()=>{
  let calls=0;
  const token=issueRuntimeDependencyTestMaterialization(async request=>{calls++;assert.deepEqual(request,{args:['install'],cwd:'fixture-root',timeoutMs:5});return {code:0,stdout:'ok',stderr:''};});
  const invocation=bindCompilerInstallInvocation(bind({...controls(),testMaterialization:token}));
  assert.equal(invocation.materialization,token);assert.equal(calls,0);
  const result=await consumeRuntimeDependencyTestMaterialization(invocation.materialization!,{args:['install'],cwd:'fixture-root',timeoutMs:5});
  assert.deepEqual(result,{code:0,stdout:'ok',stderr:''});assert.equal(calls,1);
  // Caller-owned lifecycle capability identity and mutability remain intact.
  {
    const lifecycle = {
      async born() {},
      async inspect() { throw new Error('unused inspection'); },
      async retired() {},
      async disposed() { throw new Error('unused disposal'); }
    };
    const bound = bind({ ...controls(), generatedStateLifecycle: lifecycle });
    assert.equal(bound.generatedStateLifecycle, lifecycle);
    assert.equal(Object.isFrozen(lifecycle), false);
  }
});

test('same parent cancellation survives every projection, including a newly supplied child signal',()=>{
  const parent=new AbortController(),child=new AbortController(),reason=Object.freeze({cancel:true});
  const bound=bind({...controls(),signal:parent.signal});
  const process=bindCompilerInstallInvocation({...bound,signal:child.signal});
  const effects=effect(process.controls);parent.abort(reason);
  assert.throws(()=>remaining(effects,'effects'),e=>e===reason);
  // Direct rebinding still observes parent identity and cancellation.
  {
    const controller=new AbortController();
    const first=bind({...controls(),signal:controller.signal,async beforeCommit(){}});
    const rebound=bind(first);
    assert.equal(context(rebound).operationId,context(first).operationId);
    const reason=Object.freeze({stop:true});controller.abort(reason);
    assert.throws(()=>bind(rebound),e=>e===reason);
  }
});
