import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runtimeDependencyOperationOptions as bind,
  runtimeDependencyOperationContext as context,
  runtimeDependencyOperationEffectFence as fence,
  runtimeDependencyOperationRemainingMs as remaining
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { captureRuntimeDependencyInstallRequest } from '../../../src/execution/dependency-install-request.ts';

const controls = () => ({ lockTimeoutMs: 1000, monotonicNowMs: () => 0 });

test('every coordinator route consumes the same closed fields without evaluating or forwarding extensions', () => {
  const hiddenCapability = { invoke() { assert.fail('extension executed'); } };
  const input = new Proxy({ ...controls(), extension: hiddenCapability,
    get unknownSecret() { assert.fail('unknown getter'); throw new Error('unreachable'); },
    get sharedDepsRoot() { assert.fail('retired root getter'); throw new Error('unreachable'); },
    [Symbol('foreign authority')]: hiddenCapability }, { ownKeys() { assert.fail('enumerated whole input'); } });
  const bound = bind(input);
  assert.equal(remaining(bound, 'closed'), 1000);
  assert.equal('extension' in bound, false); assert.equal('unknownSecret' in bound, false);
  assert.equal('sharedDepsRoot' in bound, false);
  // @ts-expect-error Coordinator outputs do not forward arbitrary extensions.
  assert.equal(bound.customCapability, undefined);
  assert.ok(Object.isFrozen(bound));
  const parentInput = new Proxy({ ...bound, get sharedDepsRoot() {
    assert.fail('retired root accessor executed'); return 'unreachable';
  } }, {});
  assert.throws(() => bind(parentInput), error => {
    assert.equal((error as { code?: string }).code, 'RUNTIME-DEPS-003');
    assert.match((error as Error).message, /unowned executable accessor/);
    return true;
  });
  assert.equal(context(parentInput), context(bound));
  assert.ok(!Object.values(bound as Readonly<Record<string, unknown>>).includes(hiddenCapability));
  assert.equal(Object.getOwnPropertySymbols(bound).length, 1); // Only the actual owner's parent ledger.
});

test('declared capability identity is preserved without inspecting its methods or freezing the provider', () => {
  const lifecycle = new Proxy({
    async born() {},
    async inspect() { throw new Error('unused inspection'); },
    async retired() {},
    async disposed() { throw new Error('unused disposal'); }
  }, { ownKeys() { assert.fail('provider enumeration'); }, get() { assert.fail('provider access'); } });
  const capability = Object.freeze({ fixture: true });
  const bound = bind({ ...controls(), generatedStateLifecycle: lifecycle, testMaterialization: capability as never });
  assert.equal(bound.generatedStateLifecycle, lifecycle); assert.equal(bound.testMaterialization, capability);
  assert.equal(Object.isFrozen(lifecycle), false);
});

test('callback and environment methods retain private provider state, arguments and original selection', async () => {
  class Provider {
    #events: unknown[][] = [];
    lockTimeoutMs = 1000;
    rematerialize = false;
    monotonicNowMs = function(this: Provider) { this.#events.push(['clock']); return 0; };
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
  provider.rematerialize = true;
  provider.beforeCommit = async () => assert.fail('late fence'); provider.now = () => assert.fail('late clock');
  await fence(bound, 'private'); assert.equal(bound.now?.(), 'time');
  await bound.sleep?.(4); await bound.testCompilerRename?.('a','b'); await bound.testInstallLockDelete?.('p',3);
  await bound.testCompilerPublishHook?.('active-backed-up'); await bound.testProjectProjectionHook?.('published');
  await bound.testCompilerBridgeValidationHook?.('binding-observed');
  assert.deepEqual(provider.events.filter(e => e[0] !== 'clock'), [['fence',true],['now'],['sleep',4],['rename','a','b'],
    ['delete','p',3],['publish','active-backed-up'],['project','published'],['bridge','binding-observed']]);
});

for (const field of ['beforeCommit','monotonicNowMs','now','sleep','testCompilerRename','testInstallLockDelete',
  'testCompilerPublishHook','testProjectProjectionHook','testCompilerBridgeValidationHook'] as const) {
  test(`invalid ${field} is rejected before clock or effect execution`, () => {
    assert.throws(() => bind({ lockTimeoutMs: 1000, monotonicNowMs() { assert.fail('invalid input ran clock'); },
      [field]: 'not-callable' } as never), e => (e as {code?: string}).code === 'RUNTIME-DEPS-003');
  });
}

for (const input of [{ rematerialize: 'false' }, { installMode: 'maybe' }]) {
  test(`invalid request decision ${JSON.stringify(input)} does not reach the environment`, () => {
    assert.throws(() => bind({ ...input, monotonicNowMs() { assert.fail('clock'); } } as never),
      e => (e as {code?: string}).code === 'RUNTIME-DEPS-003');
  });
}

test('all request decisions and method identities are captured before the clock can change source options', async () => {
  const events: string[]=[];
  const raw = { lockTimeoutMs:1000, pollIntervalMs:10, installMode:'allow' as 'allow'|'prebound-only', rematerialize:false,
    async beforeCommit(){events.push('original');},
    monotonicNowMs(){raw.installMode='prebound-only';raw.rematerialize=true;raw.pollIntervalMs=999;raw.beforeCommit=async()=>assert.fail('replacement');return 0;} };
  const bound=bind(raw); assert.equal(bound.installMode,'allow'); assert.equal(bound.rematerialize,false);
  assert.equal(bound.pollIntervalMs,10); assert.ok(Object.isFrozen(bound));
  assert.equal(Reflect.set(bound,'lockTimeoutMs',10_000),false);
  assert.equal(context(bound).deadlineAtMonotonicMs,1000);
  await fence(bound,'capture'); assert.deepEqual(events,['original']);
});

test('rebinding issued invocations preserves the parent operation and still checks cancellation', () => {
  const controller=new AbortController();let clocks=0;
  const first=bind({lockTimeoutMs:1000,signal:controller.signal,monotonicNowMs:()=>{clocks++;return 0;},async beforeCommit(){}});
  const before=clocks; const rebound=bind(first); assert.ok(clocks>before);
  assert.equal(context(rebound).operationId,context(first).operationId);
  const reason=Object.freeze({stop:true});controller.abort(reason);
  assert.throws(()=>bind(rebound),e=>e===reason);
});

test('narrow child constraints remain independent of the reusable parent', async () => {
  let now=0,calls=0;
  const parent=bind({lockTimeoutMs:100,monotonicNowMs:()=>now,async beforeCommit(){calls++;}});now=20;
  const child=bind({...parent,lockTimeoutMs:10});
  assert.equal(remaining(parent,'parent'),80);assert.equal(remaining(child,'child'),10);
  now=25;const rebound=bind({...child,pollIntervalMs:1});
  assert.equal(context(rebound).operationId,context(parent).operationId);
  assert.equal(remaining(rebound,'rebound'),5);await fence(rebound,'call');assert.equal(calls,1);
  now=31;assert.throws(()=>remaining(rebound,'expired'),/deadline/);
});

test('known inherited and nonenumerable internal values stay outside the existing input boundary', () => {
  const raw=Object.create({ installMode:'invalid',now(){assert.fail('inherited');} });
  Object.defineProperty(raw,'sleep',{get(){assert.fail('hidden');},enumerable:false});
  const bound=bind(raw);assert.equal(bound.installMode,undefined);assert.equal(bound.sleep,undefined);
});

test('removing a parent binding from a selected getter is rejected rather than minting a fresh ledger', () => {
  const parent=bind(controls());const symbol=Object.getOwnPropertySymbols(parent)[0]!;
  const raw={...parent,get installMode(){Reflect.deleteProperty(raw,symbol);return 'allow' as const;}};
  assert.throws(()=>bind(raw),/not owner-issued/);
});

test('method binding and the selected clock preserve exact sync and async failure values', async () => {
  let selected: unknown;
  const bound=bind({...controls(),beforeCommit(){throw selected;},sleep:async()=>{throw selected;}});
  for(const reason of [undefined,null,false,0,Object.freeze({error:true})]){
    selected=reason;
    assert.throws(() => runtimeDependencyOperationControls({ monotonicNowMs() { throw selected; } }), e => e === reason);
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


test('rebinding owner-issued controls preserves the operation without skipping clock or cancellation checks', () => {
  const controller=new AbortController();let calls=0;
  const initial=runtimeDependencyOperationControls({lockTimeoutMs:100,signal:controller.signal,monotonicNowMs:()=>{calls++;return 0;}});
  const before=calls;const rebound=runtimeDependencyOperationControls(initial);assert.ok(calls>before);
  assert.equal(context(rebound).operationId,context(initial).operationId);
  controller.abort('stop');assert.throws(()=>runtimeDependencyOperationControls(rebound),e=>e==='stop');
});
