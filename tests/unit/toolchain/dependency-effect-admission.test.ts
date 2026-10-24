import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationEffectFence } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('effect callback getter is fixed before clock execution and provider dispatch', async () => {
  let armed = false, calls = 0;
  const controls = runtimeDependencyOperationControls({ lockTimeoutMs: 1000, monotonicNowMs() {
    if (armed) Object.defineProperty(input, 'beforeCommit', {
      value: async () => assert.fail('clock replacement effect'), configurable: true
    });
    return 0;
  }});
  let callback = async () => { calls++; };
  const input = { ...controls, get beforeCommit() {
    const selected = callback;
    callback = async () => assert.fail('getter reread effect');
    return selected;
  } };
  armed = true;
  await runtimeDependencyOperationEffectFence(input, 'capture');
  assert.equal(calls, 1);
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

test('arbitrary provider rejection retains its identity',async()=>{
  const controls=runtimeDependencyOperationControls({lockTimeoutMs:1000,monotonicNowMs:()=>0});
  for(const reason of [undefined,null,false,0,new Error('failed')]){
    await assert.rejects(runtimeDependencyOperationEffectFence({...controls,beforeCommit:async()=>{throw reason;}},'failed'),e=>e===reason);
  }
});
