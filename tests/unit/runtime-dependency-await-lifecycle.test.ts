import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationOptions,
  waitForRuntimeDependencyOperation
} from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { FailureError } from '../../src/contracts/failure.ts';

type Outcome = { kind: 'fulfilled' } | { kind: 'rejected'; error: unknown };
function observed(work: Promise<void>): { outcome: () => Outcome | undefined; settled: Promise<Outcome> } {
  let outcome: Outcome | undefined;
  const settled = work.then(
    () => outcome = { kind: 'fulfilled' },
    (error: unknown) => outcome = { kind: 'rejected', error }
  );
  return { outcome: () => outcome, settled };
}
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nextTurn(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)); }
function requireRejection(outcome: Outcome | undefined, reason: unknown): void {
  assert.equal(outcome?.kind, 'rejected');
  if (outcome?.kind === 'rejected') assert.strictEqual(outcome.error, reason);
}

for (const kind of ['wait', 'fence'] as const) {
  test(`${kind} cannot have real cancellation suppressed by a public abort listener`, async () => {
    const controller = new AbortController();
    const reason = { kind, cause: 'cancel' };
    const held = deferred(); const entered = deferred();
    const stop = (event: Event): void => event.stopImmediatePropagation();
    controller.signal.addEventListener('abort', stop);
    const options = runtimeDependencyOperationOptions({
      signal: controller.signal,
      beforeCommit: async () => { entered.resolve(); await held.promise; }
    });
    const work = observed(kind === 'wait'
      ? waitForRuntimeDependencyOperation(options, 1, () => { entered.resolve(); return held.promise; }, 'suppressed-wait')
      : runtimeDependencyOperationEffectFence(options, 'suppressed-fence'));
    try {
      await entered.promise;
      controller.abort(reason);
      await nextTurn();
      requireRejection(work.outcome(), reason);
      // Do not remove listeners owned by somebody else.
      assert.deepEqual(getEventListeners(controller.signal, 'abort'), [stop]);
    } finally {
      held.resolve(); await work.settled;
      controller.signal.removeEventListener('abort', stop);
    }
  });

  test(`${kind} ignores a synthetic public abort event and still observes the later real abort`, async () => {
    const controller = new AbortController();
    const reason = new Error('real abort');
    const held = deferred(); const entered = deferred();
    const options = runtimeDependencyOperationOptions({
      signal: controller.signal,
      beforeCommit: async () => { entered.resolve(); await held.promise; }
    });
    const work = observed(kind === 'wait'
      ? waitForRuntimeDependencyOperation(options, 1, () => { entered.resolve(); return held.promise; }, 'synthetic-wait')
      : runtimeDependencyOperationEffectFence(options, 'synthetic-fence'));
    try {
      await entered.promise;
      controller.signal.dispatchEvent(new Event('abort'));
      await nextTurn();
      assert.equal(controller.signal.aborted, false);
      assert.equal(work.outcome(), undefined);
      controller.abort(reason);
      await nextTurn();
      requireRejection(work.outcome(), reason);
    } finally { held.resolve(); await work.settled; }
  });

  test(`${kind} timeout settles even when its provider promise never settles`, async () => {
    const held = deferred();
    const options = runtimeDependencyOperationOptions({
      lockTimeoutMs: 20, monotonicNowMs: () => 0,
      beforeCommit: () => held.promise
    });
    const work = observed(kind === 'wait'
      ? waitForRuntimeDependencyOperation(options, 1, () => held.promise, 'held-wait')
      : runtimeDependencyOperationEffectFence(options, 'held-fence'));
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        work.settled,
        new Promise<{ kind: 'watchdog' }>((resolve) => {
          watchdog = setTimeout(() => resolve({ kind: 'watchdog' }), 200);
        })
      ]);
      assert.equal(result.kind, 'rejected');
      if (result.kind === 'rejected') {
        assert.ok(result.error instanceof FailureError);
        assert.equal(result.error.code, 'RUNTIME-DEPS-003');
      }
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
      held.resolve(); await work.settled;
    }
  });
}

for (const reason of [null, 'cancelled', { kind: 'owner-cancel' }]) {
  test(`a pending effect fence preserves cancellation reason ${reason === null ? 'null' : typeof reason}`, async () => {
    const controller = new AbortController(); const held = deferred(); const entered = deferred();
    const options = runtimeDependencyOperationOptions({
      signal: controller.signal,
      beforeCommit: async () => { entered.resolve(); await held.promise; }
    });
    const work = observed(runtimeDependencyOperationEffectFence(options, 'reason-fence'));
    try {
      await entered.promise; controller.abort(reason); await nextTurn();
      requireRejection(work.outcome(), reason);
    } finally { held.resolve(); await work.settled; }
  });
}

test('the pending effect fence does not restart after cancellation when its provider later resolves', async () => {
  const controller = new AbortController(); const held = deferred(); const entered = deferred();
  const reason = new Error('cancelled'); let calls = 0; let completed = false;
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    beforeCommit: async () => { calls += 1; entered.resolve(); await held.promise; completed = true; }
  });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'late-success'));
  try {
    await entered.promise; controller.abort(reason); await nextTurn();
    requireRejection(work.outcome(), reason);
    assert.equal(completed, false); // Settlement is not forced provider cancellation.
    held.resolve(); await nextTurn();
    assert.equal(completed, true); assert.equal(calls, 1);
    requireRejection(await work.settled, reason);
  } finally { held.resolve(); await work.settled; }
});

test('late provider rejection after fence cancellation is consumed, not an unhandled rejection', async () => {
  const controller = new AbortController(); const held = deferred(); const entered = deferred();
  const cancellation = new Error('cancelled'); const late = new Error('late provider failure');
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal,
    beforeCommit: async () => { entered.resolve(); await held.promise; }
  });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'late-failure'));
  try {
    await entered.promise; controller.abort(cancellation); await nextTurn();
    requireRejection(work.outcome(), cancellation);
  } finally {
    held.reject(late); await work.settled; await nextTurn();
  }
});

test('immediate cancellation prevents deferred effect-fence work from starting', async () => {
  const controller = new AbortController(); const reason = new Error('before hook'); let calls = 0;
  const options = runtimeDependencyOperationOptions({
    signal: controller.signal, beforeCommit: async () => { calls += 1; }
  });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'deferred-hook'));
  controller.abort(reason);
  requireRejection(await work.settled, reason);
  assert.equal(calls, 0);
});

test('the effect hook does not start after its budget is consumed before its microtask', async () => {
  let now = 0; let calls = 0;
  const options = runtimeDependencyOperationOptions({
    lockTimeoutMs: 100, monotonicNowMs: () => now,
    beforeCommit: async () => { calls += 1; }
  });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'expired-hook'));
  now = 101;
  const result = await work.settled;
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') assert.ok(result.error instanceof FailureError);
  assert.equal(calls, 0);
});

test('a successful fence retains its receiver, operation identity and public signal', async () => {
  let receiver: unknown;
  const controller = new AbortController();
  const provider = { marker: 'retained', signal: controller.signal,
    beforeCommit: async function () { receiver = this; } };
  const options = runtimeDependencyOperationOptions(provider);
  const context = runtimeDependencyOperationContext(options);
  await runtimeDependencyOperationEffectFence(options, 'receiver');
  assert.strictEqual(receiver, provider);
  assert.strictEqual(runtimeDependencyOperationContext(options), context);
  assert.strictEqual(options.signal, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const failureMode of ['sync', 'async'] as const) {
  test(`an effect-fence ${failureMode} failure preserves the original error`, async () => {
    const reason = { failureMode };
    const controller = new AbortController();
    const beforeCommit = failureMode === 'sync'
      ? () => { throw reason; }
      : async () => { throw reason; };
    const options = runtimeDependencyOperationOptions({ signal: controller.signal, beforeCommit });
    requireRejection(await observed(runtimeDependencyOperationEffectFence(options, 'hook-failure')).settled, reason);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('the fence performs a terminal budget check after a successfully resolved provider', async () => {
  let now = 0;
  const options = runtimeDependencyOperationOptions({
    lockTimeoutMs: 100, monotonicNowMs: () => now,
    beforeCommit: async () => { now = 101; }
  });
  const result = await observed(runtimeDependencyOperationEffectFence(options, 'terminal-budget')).settled;
  assert.equal(result.kind, 'rejected');
  if (result.kind === 'rejected') assert.ok(result.error instanceof FailureError);
});

test('a hook-free fence still observes cancellation before returning effect admission', async () => {
  const controller = new AbortController(); const reason = new Error('no-hook cancellation');
  const options = runtimeDependencyOperationOptions({ signal: controller.signal });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'no-hook'));
  controller.abort(reason);
  requireRejection(await work.settled, reason);
});

test('cancellation of an ancestor settles a child fence despite a suppressed ancestor event', async () => {
  const parent = new AbortController(); const child = new AbortController();
  const stop = (event: Event): void => event.stopImmediatePropagation();
  parent.signal.addEventListener('abort', stop);
  const held = deferred(); const entered = deferred(); const reason = new Error('ancestor');
  const base = runtimeDependencyOperationOptions({ signal: parent.signal });
  const options = runtimeDependencyOperationOptions({
    ...base, signal: child.signal,
    beforeCommit: async () => { entered.resolve(); await held.promise; }
  });
  const work = observed(runtimeDependencyOperationEffectFence(options, 'ancestor'));
  try {
    await entered.promise; parent.abort(reason); await nextTurn();
    requireRejection(work.outcome(), reason);
    assert.equal(child.signal.aborted, false);
  } finally { held.resolve(); await work.settled; parent.signal.removeEventListener('abort', stop); }
});

for (const terminal of ['success', 'provider failure', 'cancellation', 'deadline'] as const) {
  test(`the actual await observer releases its listeners after ${terminal}`, async () => {
    const source = new AbortController();
    const original = AbortSignal.prototype.addEventListener;
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'addEventListener');
    const observedSignals = new Set<AbortSignal>();
    const provider = deferred();
    const failure = new Error(terminal);
    const options = runtimeDependencyOperationOptions({
      signal: source.signal,
      lockTimeoutMs: terminal === 'deadline' ? 20 : 1000,
      monotonicNowMs: () => 0,
      beforeCommit: () => provider.promise
    });
    Object.defineProperty(AbortSignal.prototype, 'addEventListener', {
      configurable: true,
      writable: true,
      value: function (this: AbortSignal, ...args: Parameters<AbortSignal['addEventListener']>) {
        if (args[0] === 'abort') observedSignals.add(this);
        return Reflect.apply(original, this, args);
      }
    });
    const work = observed(runtimeDependencyOperationEffectFence(options, `listener cleanup ${terminal}`));
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await nextTurn();
      if (terminal === 'success') provider.resolve();
      if (terminal === 'provider failure') provider.reject(failure);
      if (terminal === 'cancellation') source.abort(failure);
      const outcome = await Promise.race([
        work.settled,
        new Promise<never>((_resolve, reject) => {
          watchdog = setTimeout(() => reject(new Error('await did not settle')), 200);
        })
      ]);
      if (terminal === 'success') assert.equal(outcome.kind, 'fulfilled');
      else if (terminal === 'deadline') {
        assert.equal(outcome.kind, 'rejected');
        if (outcome.kind === 'rejected') assert.equal((outcome.error as FailureError).code, 'RUNTIME-DEPS-003');
      } else requireRejection(outcome, failure);
      for (const observer of observedSignals) assert.deepEqual(getEventListeners(observer, 'abort'), []);
    } finally {
      if (watchdog !== undefined) clearTimeout(watchdog);
      provider.resolve();
      if (descriptor) Object.defineProperty(AbortSignal.prototype, 'addEventListener', descriptor);
      else Reflect.deleteProperty(AbortSignal.prototype, 'addEventListener');
      await work.settled;
    }
  });
}
