import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureRuntimeDependencyInstallRequest as capture } from '../../src/adapters/toolchain/dependencies/contract/install-request.ts';
import { bindCompilerInstallInvocation } from '../../src/adapters/toolchain/dependencies/runtime/install-invocation.ts';
import { consumeRuntimeDependencyTestMaterialization, issueRuntimeDependencyTestMaterialization } from '../../src/adapters/toolchain/dependencies/runtime/materialization-fixture-capability.ts';
import {
  runtimeDependencyOperationOptions as bind, runtimeDependencyEffectFenceOptions as effect,
  runtimeDependencyOperationEffectFence as fence
} from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationContext as context, runtimeDependencyOperationRemainingMs as remaining } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

const controls=()=>({lockTimeoutMs:1000,monotonicNowMs:()=>0});

test('public request, coordinator, process binder and effect use one captured provider receiver', async()=>{
  class Provider {
    #calls=0;
    async beforeCommit(){this.#calls++;}
    installMode='offline-copy-only' as const;
    get calls(){return this.#calls;}
  }
  const provider=new Provider();const request=capture(provider);
  const bound=bind({...controls(),...request});const process=bindCompilerInstallInvocation(bound);
  assert.equal(process.isolated,true);assert.equal(context(process.controls),context(bound));
  provider.beforeCommit=()=>assert.fail('replacement');
  await process.beforeCommit?.();await fence(effect(bound),'effect');assert.equal(provider.calls,2);
});

test('effect projections cannot add another bound callback layer on repeated nested calls', async()=>{
  let calls=0;const bound=bind({...controls(),async beforeCommit(){calls++;}});
  let input=effect(bound);const original=input.beforeCommit;
  for(let i=0;i<1000;i++)input=effect(input);
  assert.equal(input.beforeCommit,original);assert.equal(context(input),context(bound));
  await fence(input,'nested');assert.equal(calls,1);
});

test('process and effect projections do not reacquire unrelated coordinator facilities',()=>{
  const input=new Proxy({...controls(),installMode:'allow' as const,
    get generatedStateLifecycle(){assert.fail('lifecycle'); throw new Error('unreachable');},get now(){assert.fail('wall clock'); throw new Error('unreachable');},
    get runtimeStateEnvironment(){assert.fail('runtime state environment'); throw new Error('unreachable');},get testCompilerRename(){assert.fail('rename'); throw new Error('unreachable');}
  },{ownKeys(){assert.fail('wide enumeration');}});
  assert.equal(bindCompilerInstallInvocation(input).isolated,false);
  assert.equal(remaining(effect(input),'narrow'),1000);
});

test('process mode admission still rejects prebound-only before starting a clock or fixture',()=>{
  assert.throws(()=>bindCompilerInstallInvocation({installMode:'prebound-only',monotonicNowMs:()=>assert.fail('clock')}),/Prebound-only/);
});

test('coordinator transmission does not turn an unissued materialization object into an authority',()=>{
  const value=bind({...controls(),testMaterialization:{} as never});
  assert.throws(()=>bindCompilerInstallInvocation(value),/owner-issued/);
});

test('issued fixture remains the exact issued object across public-to-process control binding',async()=>{
  let calls=0;
  const token=issueRuntimeDependencyTestMaterialization(async request=>{calls++;assert.equal(request.timeoutMs,5);return {code:0,stdout:'ok',stderr:''};});
  const invocation=bindCompilerInstallInvocation(bind({...controls(),testMaterialization:token}));
  assert.equal(invocation.materialization,token);assert.equal(calls,0);
  const result=await consumeRuntimeDependencyTestMaterialization(invocation.materialization!,{args:[],cwd:'.',timeoutMs:5});
  assert.equal(result.stdout,'ok');assert.equal(calls,1);
});

test('same parent cancellation survives every projection, including a newly supplied child signal',()=>{
  const parent=new AbortController(),child=new AbortController(),reason=Object.freeze({cancel:true});
  const bound=bind({...controls(),signal:parent.signal});
  const process=bindCompilerInstallInvocation({...bound,signal:child.signal});
  const effects=effect(process.controls);parent.abort(reason);
  assert.throws(()=>remaining(effects,'effects'),e=>e===reason);
});

test('zero false and omitted request values keep identical meanings at public and coordinator boundaries',()=>{
  for(const request of [{},{rematerialize:false},{installMode:'allow' as const}]){
    const publicValue=capture(request),internal=bind({...controls(),...request});
    assert.equal(internal.rematerialize,publicValue.rematerialize);
    assert.equal(internal.installMode,publicValue.installMode);
  }
  assert.throws(()=>capture({rematerialize:0 as never}));assert.throws(()=>bind({...controls(),rematerialize:0 as never}));
});
