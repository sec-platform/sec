import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runtimeDependencyOperationOptions as bind,
  runtimeDependencyOperationContext as context,
  runtimeDependencyOperationEffectFence as fence
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { captureRuntimeDependencyInstallRequest } from '../../../src/execution/dependency-install-request.ts';

const controls = () => ({ lockTimeoutMs: 1000, monotonicNowMs: () => 0 });

test('declared capability identity is preserved without freezing the provider', () => {
  const lifecycle = {
    async born() {},
    async inspect() { throw new Error('unused inspection'); },
    async retired() {},
    async disposed() { throw new Error('unused disposal'); }
  };
  const bound = bind({ ...controls(), generatedStateLifecycle: lifecycle });
  assert.equal(bound.generatedStateLifecycle, lifecycle);
  assert.equal(Object.isFrozen(lifecycle), false);
});

test('callback and environment methods retain private provider state and arguments', async () => {
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
});

test('rebinding issued invocations preserves the parent operation and still checks cancellation', () => {
  const controller=new AbortController();
  const first=bind({...controls(),signal:controller.signal,async beforeCommit(){}});
  const rebound=bind(first);
  assert.equal(context(rebound).operationId,context(first).operationId);
  const reason=Object.freeze({stop:true});controller.abort(reason);
  assert.throws(()=>bind(rebound),e=>e===reason);
});

test('method binding preserves exact sync and async failure values', async () => {
  let selected: unknown;
  const bound=bind({...controls(),beforeCommit(){throw selected;},sleep:async()=>{throw selected;}});
  for(const reason of [undefined,null,false,0,Object.freeze({error:true})]){
    selected=reason;
    await assert.rejects(fence(bound,'failure'),e=>e===reason);
    // Both methods use the same argument/receiver-preserving binder; retain
    // the async method's own wiring without crossing every payload again.
    if(reason===undefined)await assert.rejects(bound.sleep!(1),e=>e===reason);
  }
});

test('public request validation and internal coordinator accept the same three modes without new defaults', () => {
  for(const mode of ['allow','offline-copy-only','prebound-only'] as const){
    const request=captureRuntimeDependencyInstallRequest({installMode:mode});
    assert.equal(request.installMode,mode);assert.equal(request.rematerialize,undefined);
    const bound=bind({...request,...controls()});assert.equal(bound.installMode,mode);assert.equal(bound.rematerialize,undefined);
    assert.equal(bound.lockTimeoutMs,1000);
  }
  assert.equal(bind(controls()).installMode,undefined);
});


test('rebinding owner-issued controls preserves the operation and cancellation', () => {
  const controller=new AbortController();
  const initial=runtimeDependencyOperationControls({...controls(),signal:controller.signal});
  const rebound=runtimeDependencyOperationControls(initial);
  assert.equal(context(rebound).operationId,context(initial).operationId);
  controller.abort('stop');assert.throws(()=>runtimeDependencyOperationControls(rebound),e=>e==='stop');
});
