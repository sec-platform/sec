import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationEffectFence } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('effect callback is fixed before a budget clock can replace it', async () => {
  let armed = false, calls = 0;
  const controls = runtimeDependencyOperationControls({ lockTimeoutMs: 1000, monotonicNowMs() {
    if (armed) input.beforeCommit = async () => assert.fail('replacement effect');
    return 0;
  }});
  const input = { ...controls, beforeCommit: async () => { calls++; } };
  armed = true;
  await runtimeDependencyOperationEffectFence(input, 'capture');
  assert.equal(calls, 1);
});

test('a selected method survives caller replacement while deferred execution is pending', async () => {
  let calls = 0;
  const input = { ...runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>0}),
    beforeCommit: async () => {calls++;} };
  const pending = runtimeDependencyOperationEffectFence(input, 'capture');
  input.beforeCommit = async () => assert.fail('replacement effect');
  await pending;assert.equal(calls,1);
});

test('the exact provided receiver retains class-private method state', async () => {
  class Input { #calls=0;async beforeCommit(){this.#calls++;}get calls(){return this.#calls;} }
  const input=Object.assign(new Input(),runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>0}));
  await runtimeDependencyOperationEffectFence(input,'receiver');assert.equal(input.calls,1);
});

for(const callback of [null,false,7,'not callable']){
  test(`invalid callback ${String(callback)} is refused before a clock or provider runs`, async()=>{
    let armed=false;
    const controls=runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>{if(armed)assert.fail('clock ran');return 0;}});
    armed=true;
    await assert.rejects(runtimeDependencyOperationEffectFence({...controls,beforeCommit:callback as never},'invalid'),TypeError);
  });
}

test('callback getter runs once, not again at provider dispatch',async()=>{
  let reads=0,calls=0;const controls=runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>0});
  const input={...controls,get beforeCommit(){reads++;return async()=>{calls++;};}};
  await runtimeDependencyOperationEffectFence(input,'getter');assert.equal(reads,1);assert.equal(calls,1);
});

test('post-callback exhaustion cannot turn into successful admission',async()=>{
  let now=0;const controls=runtimeDependencyOperationControls({lockTimeoutMs:100,monotonicNowMs:()=>now});
  await assert.rejects(runtimeDependencyOperationEffectFence({...controls,beforeCommit:async()=>{now=101;}},'exhausted'),/deadline/);
});

test('arbitrary provider rejection retains its identity',async()=>{
  const controls=runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>0});
  for(const reason of [undefined,null,false,0,new Error('failed')]){
    await assert.rejects(runtimeDependencyOperationEffectFence({...controls,beforeCommit:async()=>{throw reason;}},'failed'),e=>e===reason);
  }
});
