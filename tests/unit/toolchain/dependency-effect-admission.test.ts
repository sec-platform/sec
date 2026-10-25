import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationEffectFence } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

test('effect callback getter is fixed before clock execution and provider dispatch', async () => {
  let armed = false;
  const controls = runtimeDependencyOperationControls({ lockTimeoutMs: 1000, monotonicNowMs() {
    if (armed) Object.defineProperty(input, 'beforeCommit', {
      value: async () => assert.fail('clock replacement effect'), configurable: true
    });
    return 0;
  }});
  class Input {
    #calls = 0;
    async invoke() { assert.equal(this, input); this.#calls++; }
    get calls() { return this.#calls; }
    get beforeCommit() {
      const selected = callback;
      callback = async () => assert.fail('getter reread effect');
      return selected;
    }
  }
  const input = Object.assign(new Input(), controls);
  let callback: () => Promise<void> = input.invoke;
  armed = true;
  await runtimeDependencyOperationEffectFence(input, 'capture');
  assert.equal(input.calls, 1);
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
  // The coordinator's method-binding keeper retains all five payload classes;
  // this unwrapped route separately preserves an async undefined rejection.
  await assert.rejects(runtimeDependencyOperationEffectFence({...controls,beforeCommit:async()=>{throw undefined;}},'failed'),e=>e===undefined);
});
