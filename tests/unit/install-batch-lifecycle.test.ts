import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InstallStrategyRegistry, type InstallStrategy } from '../../src/compiler/compose/install-strategies.ts';
import type { InstallPlanStep } from '../../src/compiler/contract.ts';

function step(to: string, id = to): InstallPlanStep { return { action: 'probe', to, blockId: id } as unknown as InstallPlanStep; }
function context(signal?: AbortSignal) { return { workspaceRoot: path.join(tmpdir(), 'sec-batch-contract'), lock: {} as never, signal }; }
function deferred() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
function custom(execute: InstallStrategy['execute']): InstallStrategy { return { action: 'probe', canHandle: s => String(s.action) === 'probe', execute }; }

test('subtree-overlapping destinations serialize in original order', async () => {
  const registry = new InstallStrategyRegistry(), events: string[] = [];
  let active = 0;
  registry.register(custom(async s => {
    assert.equal(active++, 0); events.push(s.blockId); await Promise.resolve(); active--;
  }));
  await registry.executeAll([step('area/child', 'first'), step('area', 'second'), step('area/sibling', 'third')], context());
  assert.deepEqual(events, ['first', 'second', 'third']);
});

test('sibling directories without an overlapping parent remain independent', async () => {
  const registry = new InstallStrategyRegistry(), held = deferred(); let entered = 0;
  registry.register(custom(async () => { if (++entered === 2) held.release(); await held.promise; }));
  await registry.executeAll([step('a/one'), step('a/two')], context());
  assert.equal(entered, 2);
});

test('a later unsupported operation rejects the entire plan before any execution', async () => {
  const registry = new InstallStrategyRegistry(); let effects = 0;
  registry.register(custom(async () => { effects++; }));
  await assert.rejects(registry.executeAll([step('a'), { ...step('b'), action: 'unknown' } as never], context()));
  assert.equal(effects, 0);
});

test('selector callbacks cannot replace later steps or previously captured provider methods', async () => {
  const registry = new InstallStrategyRegistry(), inputs = [step('a'), step('b')];
  const seen: string[] = [];
  const provider = custom(async s => { seen.push(s.to); });
  provider.canHandle = () => {
    Object.assign(inputs[1]!, { to: 'replaced' }); provider.execute = async () => assert.fail('replaced method'); return true;
  };
  registry.register(provider);
  await registry.executeAll(inputs, context());
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('all started installs are joined before batch failure returns', async () => {
  const registry = new InstallStrategyRegistry(), held = deferred(), started = deferred();
  const primary = new Error('first'); let returned = false;
  registry.register(custom(async (s, c) => {
    if (s.to === 'a') { await started.promise; throw primary; }
    started.release(); await held.promise;
    assert.equal(c.signal?.aborted, true);
  }));
  const running = registry.executeAll([step('a'), step('b')], context()).then(
    () => assert.fail('unexpected success'), e => { returned = true; assert.equal(e, primary); }
  );
  await started.promise; await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(returned, false);
  held.release(); await running; assert.equal(returned, true);
});

test('cancellation during the owner fence prevents the selected effect', async () => {
  const registry = new InstallStrategyRegistry(), controller = new AbortController(), reason = new Error('cancelled');
  registry.register(custom(async () => assert.fail('effect after cancellation')));
  await assert.rejects(registry.executeAll([step('a')], { ...context(controller.signal), async commitFence() { controller.abort(reason); } }), e => e === reason);
});

test('the provider keeps private instance state and receives a frozen batch context', async () => {
  class Provider implements InstallStrategy {
    readonly action = 'probe'; #calls = 0;
    canHandle(s: InstallPlanStep) { return String(s.action) === 'probe'; }
    async execute(_s: InstallPlanStep, c: ReturnType<typeof context>) { this.#calls++; assert.ok(Object.isFrozen(c)); }
    get calls() { return this.#calls; }
  }
  const provider = new Provider(); await new InstallStrategyRegistry().register(provider).executeAll([step('a')], context());
  assert.equal(provider.calls, 1);
});
