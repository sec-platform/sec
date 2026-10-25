import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { runtimeDependencyOperationOptions as coordinate } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import {
  runtimeDependencyOperationControls as bind,
  captureRuntimeDependencyControlInput as capture,
  runtimeDependencyOperationContext as context,
  runtimeDependencyOperationRemainingMs as remaining,
  waitForRuntimeDependencyOperation as wait
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

class Clock {
  #now = 0;
  #calls = 0;
  lockTimeoutMs = 100;
  monotonicNowMs = function (this: Clock): number { this.#calls++; return this.#now; };
  advance(now: number): void { this.#now = now; }
  get calls(): number { return this.#calls; }
}

test('a raw snapshot retains the selected clock method without executing it or freezing provider state', () => {
  const provider = new Clock(), raw = capture(provider);
  assert.equal(provider.calls, 0);
  provider.monotonicNowMs = () => assert.fail('replaced clock');
  provider.lockTimeoutMs = 1;
  const bound = bind(raw);
  provider.advance(10);
  assert.equal(remaining(bound, 'snapshot'), 90);
  assert.equal(provider.calls, 2);
  assert.equal(Object.isFrozen(provider), false);
});

test('control, direct context, coordinator and wait all consume one clock-method convention', async () => {
  const one = new Clock(), two = new Clock(), three = new Clock(), four = new Clock();
  assert.equal(context(one).initialBudgetMs, 100);
  assert.equal(remaining(two, 'direct'), 100);
  assert.equal(remaining(coordinate(three), 'coordinator'), 100);
  let sleepCalls = 0;
  await wait(four, 4, async delay => { assert.equal(delay, 4); sleepCalls++; }, 'wait');
  assert.equal(sleepCalls, 1);
  assert.ok([one,two,three,four].every(clock => clock.calls > 0));
});

test('a child keeps the parent ledger even if it provides a different callable clock', () => {
  const provider = new Clock(), parent = bind(provider);
  provider.advance(20);
  const child = bind({ ...parent, lockTimeoutMs: 10, monotonicNowMs() { assert.fail('replacement clock'); } });
  assert.equal(context(child).operationId, context(parent).operationId);
  assert.equal(remaining(child, 'child'), 10);
  provider.advance(31);
  assert.throws(() => remaining(child, 'expired'), /deadline/);
});

test('snapshot fields cannot renew a parent deadline and retain its exact issuer', () => {
  const provider = new Clock(), parent = bind(provider), snapshot = capture(parent);
  provider.advance(80);
  const child = bind({ ...snapshot, lockTimeoutMs: 1000 });
  assert.equal(context(child), context(parent));
  assert.equal(remaining(child, 'retained'), 20);
});

test('clock source failure remains exact and backward movement is still refused', () => {
  for (const reason of [undefined, null, false, 0, Object.freeze({ clock: 'failed' })]) {
    const source = { monotonicNowMs() { throw reason; } };
    assert.throws(() => bind(source), error => error === reason);
  }
  const provider = new Clock();
  provider.advance(20);
  const bound = bind(provider);
  provider.advance(19);
  assert.throws(() => remaining(bound, 'regression'), /backwards/);
});

test('a clock callback cannot remove native cancellation at the budget readback', () => {
  const controller = new AbortController(), reason = new Error('cancel'), provider = new Clock();
  const selected = provider.monotonicNowMs; let cancel = false;
  provider.monotonicNowMs = function () {
    const result = Reflect.apply(selected, this, []);
    if (cancel) controller.abort(reason);
    return result;
  };
  const raw = Object.assign(provider, { signal: controller.signal }), bound = bind(raw);
  cancel = true;
  assert.throws(() => remaining(bound, 'cancel'), error => error === reason);
});

test('no inherited or non-enumerable clock is accidentally promoted into the input contract', () => {
  const input = Object.create({ monotonicNowMs() { assert.fail('inherited'); } });
  Object.defineProperty(input, 'monotonicNowMs', { get() { assert.fail('hidden'); } });
  assert.equal(capture(input).monotonicNowMs, undefined);
});
