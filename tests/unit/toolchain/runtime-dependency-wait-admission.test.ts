import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationOptions,
  waitForRuntimeDependencyOperation
} from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

const deadlineFailure = (error: unknown): boolean =>
  error instanceof CodedFailure && error.code === 'RUNTIME-DEPS-003';

async function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  try { await work; } catch (error) { return error; }
  assert.fail('Expected operation to reject');
}

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

test('dependency wait preserves the identity of a synchronous sleep failure', async () => {
  const controller = new AbortController();
  const reason = new Error('synchronous sleep failure');
  const failure = await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1, () => {
    throw reason;
  }, 'sync-throw'));
  assert.strictEqual(failure, reason);
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
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('dependency wait preserves the identity of an async sleep failure', async () => {
  const controller = new AbortController();
  const reason = new Error('asynchronous sleep failure');
  assert.strictEqual(await rejectionOf(waitForRuntimeDependencyOperation({ signal: controller.signal }, 1,
    async () => { throw reason; }, 'async-reject')), reason);
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
  const after = runtimeDependencyOperationContext(options);
  assert.strictEqual(after.operationId, parent.operationId);
  assert.equal(after.deadlineAtMonotonicMs, 100);
});

test('dependency wait rejects a submillisecond parent remainder before starting sleep', async () => {
  let now = 0;
  const options = runtimeDependencyOperationOptions({ lockTimeoutMs: 100, monotonicNowMs: () => now });
  now = 99.5;
  let started = false;
  assert.equal(deadlineFailure(await rejectionOf(waitForRuntimeDependencyOperation(options, 1,
    async () => { started = true; }, 'expired-parent'))), true);
  assert.equal(started, false);
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
