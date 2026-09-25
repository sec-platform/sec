import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation
} from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { FailureError } from '../../src/contracts/failure.ts';

const deadlineFailure = (error: unknown): boolean =>
  error instanceof FailureError && error.code === 'RUNTIME-DEPS-003';

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try { await work; } catch (error) { return error; }
  assert.fail('Expected operation to reject');
}

test('dependency wait uses its initially captured deadline for raw options', async () => {
  let now = 0;
  const options = { lockTimeoutMs: 100, monotonicNowMs: () => now };
  const failure = await rejectionOf(waitForRuntimeDependencyOperation(options, 1, async () => {
    now = 101;
  }, 'raw-deadline'));
  assert.equal(deadlineFailure(failure), true);
});

test('dependency wait retains monotonic-clock history for raw options', async () => {
  let now = 10;
  const options = { lockTimeoutMs: 100, monotonicNowMs: () => now };
  const failure = await rejectionOf(waitForRuntimeDependencyOperation(options, 1, async () => {
    now = 9;
  }, 'raw-clock'));
  assert.equal(deadlineFailure(failure), true);
  assert.match((failure as Error).message, /moved backwards/u);
});

test('mutating raw options while sleeping cannot renew an operation deadline', async () => {
  let now = 0;
  const options = { lockTimeoutMs: 100, monotonicNowMs: () => now };
  const failure = await rejectionOf(waitForRuntimeDependencyOperation(options, 1, async () => {
    options.lockTimeoutMs = 10_000;
    now = 101;
  }, 'changed-options'));
  assert.equal(deadlineFailure(failure), true);
});

test('remaining-budget admission rejects cancellation during its clock sample', () => {
  const controller = new AbortController();
  const reason = new Error('cancelled while sampling');
  let armed = false;
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    monotonicNowMs: () => { if (armed) controller.abort(reason); return 0; }
  });
  armed = true;
  assert.throws(() => runtimeDependencyOperationRemainingMs(options, 'clock-admission'),
    (error: unknown) => error === reason);
});

test('dependency wait never starts sleep after cancellation during budget sampling', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled before registration');
  let armed = false;
  let started = false;
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    monotonicNowMs: () => { if (armed) controller.abort(reason); return 0; }
  });
  armed = true;
  const failure = await rejectionOf(waitForRuntimeDependencyOperation(options, 1, async () => {
    started = true;
  }, 'abort-before-registration'));
  assert.strictEqual(failure, reason);
  assert.equal(started, false);
});

test('dependency wait closes an abort-before-listener-registration gap', async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const reason = new Error('cancelled in registration');
  // Interpose the actual listener registration, including an owner-private
  // dependent signal. An override on the public source alone is not a seam.
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'addEventListener');
  const original = AbortSignal.prototype.addEventListener;
  Object.defineProperty(AbortSignal.prototype, 'addEventListener', {
    configurable: true,
    value(this: AbortSignal, ...args: Parameters<AbortSignal['addEventListener']>) {
      controller.abort(reason);
      Reflect.apply(original, this, args);
    }
  });
  try {
    let started = false;
    const failure = await rejectionOf(waitForRuntimeDependencyOperation(
      { signal }, 1, async () => { started = true; }, 'registration-gap'
    ));
    assert.strictEqual(failure, reason);
    assert.equal(started, false);
    assert.equal(getEventListeners(signal, 'abort').length, 0);
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal.prototype, 'addEventListener', descriptor);
    else Reflect.deleteProperty(AbortSignal.prototype, 'addEventListener');
  }
});

test('dependency wait does not run deferred sleep after immediate caller cancellation', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  let started = false;
  const work = waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, async () => {
    started = true;
  }, 'immediate-cancellation');
  controller.abort(reason);
  assert.strictEqual(await rejectionOf(work), reason);
  assert.equal(started, false);
});

test('dependency wait preserves an explicit null cancellation reason', async () => {
  const controller = new AbortController();
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, () => {
    controller.abort(null);
    return new Promise<void>(() => {});
  }, 'null-reason'));
  assert.strictEqual(failure, null);
});

test('dependency wait preserves cancellation reason identity during sleep', async () => {
  const controller = new AbortController();
  const reason = { kind: 'cancel' };
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, () => {
    controller.abort(reason);
    return new Promise<void>(() => {});
  }, 'reason-identity'));
  assert.strictEqual(failure, reason);
});

test('dependency wait cleans listeners when sleep throws synchronously', async () => {
  const controller = new AbortController();
  const reason = new Error('synchronous sleep failure');
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, () => {
    throw reason;
  }, 'sync-throw'));
  assert.strictEqual(failure, reason);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('simultaneous cancellation and synchronous sleep failure leave no orphaned rejection', async () => {
  const controller = new AbortController();
  const cancelled = new Error('abort during sleep entry');
  const thrown = new Error('sleep entry threw');
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, () => {
    controller.abort(cancelled);
    throw thrown;
  }, 'cancel-and-throw'));
  assert.ok(failure === cancelled || failure === thrown);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('dependency wait cleans listeners on async sleep failure', async () => {
  const controller = new AbortController();
  const reason = new Error('asynchronous sleep failure');
  assert.strictEqual(await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1,
    async () => { throw reason; }, 'async-reject')), reason);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('dependency wait cleans listeners after successful sleep', async () => {
  const controller = new AbortController();
  await waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, async () => {}, 'success');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('dependency wait rejects an already-cancelled signal without starting sleep', async () => {
  const controller = new AbortController();
  const reason = new Error('already cancelled');
  controller.abort(reason);
  let started = false;
  assert.strictEqual(await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1,
    async () => { started = true; }, 'already-aborted')), reason);
  assert.equal(started, false);
});

test('dependency wait bounds delay by the original normalized parent budget', async () => {
  let now = 0;
  const options = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  const parent = runtimeDependencyOperationContext(options);
  now = 80;
  let delay = -1;
  await waitForRuntimeDependencyOperation(options, 1_000, async (ms) => { delay = ms; }, 'bounded-delay');
  assert.equal(delay, 20);
  assert.strictEqual(runtimeDependencyOperationContext(options), parent);
  assert.equal(parent.deadlineAtMonotonicMs, 100);
});

test('dependency wait rejects an expired parent before starting sleep', async () => {
  let now = 0;
  const options = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  now = 101;
  let started = false;
  assert.equal(deadlineFailure(await rejectionOf(waitForRuntimeDependencyOperation(options, 1,
    async () => { started = true; }, 'expired-parent'))), true);
  assert.equal(started, false);
});

test('dependency wait has a real deadline even when injected sleep never settles', async () => {
  const controller = new AbortController();
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({
    lockTimeoutMs: 10, signal: controller.signal, monotonicNowMs: () => 0
  }, 1, () => new Promise<void>(() => {}), 'unsettled-sleep'));
  assert.equal(deadlineFailure(failure), true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('dependency effect fence never invokes beforeCommit after a sampling-time abort', async () => {
  const controller = new AbortController();
  const reason = new Error('effect not admitted');
  let armed = false;
  let committed = false;
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    monotonicNowMs: () => { if (armed) controller.abort(reason); return 0; },
    beforeCommit: async () => { committed = true; }
  });
  armed = true;
  assert.strictEqual(await rejectionOf(runtimeDependencyOperationEffectFence(options, 'fence')), reason);
  assert.equal(committed, false);
});

test('dependency effect fence rejects a cancellation caused by beforeCommit', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled in fence');
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    beforeCommit: async () => { controller.abort(reason); }
  });
  assert.strictEqual(await rejectionOf(runtimeDependencyOperationEffectFence(options, 'fence')), reason);
});


test('queued dependency sleep never starts after the budget expires before its microtask', async () => {
  let now = 0;
  let started = false;
  const work = waitForRuntimeDependencyOperation({ lockTimeoutMs: 100, monotonicNowMs: () => now },
    50, async () => { started = true; }, 'queued-expiry');
  now = 100;
  assert.equal(deadlineFailure(await rejectionOf(work)), true);
  assert.equal(started, false);
});

test('queued dependency sleep is reclamped to the budget remaining at actual admission', async () => {
  let now = 0;
  let delay = -1;
  const work = waitForRuntimeDependencyOperation({ lockTimeoutMs: 100, monotonicNowMs: () => now },
    80, async (ms) => { delay = ms; }, 'queued-reclamp');
  now = 95;
  await work;
  assert.equal(delay, 5);
});

test('normalized dependency options are frozen and independent of mutable raw inputs', () => {
  const raw = { lockTimeoutMs: 100, pollIntervalMs: 10, monotonicNowMs: () => 0 };
  const normalized = runtimeDependencyOperationOptions(raw);
  raw.pollIntervalMs = 999;
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalized.pollIntervalMs, 10);
  assert.equal(Reflect.set(normalized, 'lockTimeoutMs', 10_000), false);
  assert.equal(runtimeDependencyOperationContext(normalized).deadlineAtMonotonicMs, 100);
});
