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
