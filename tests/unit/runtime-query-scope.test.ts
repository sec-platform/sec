import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { createRuntimeQueryScope } from '../../src/execution/runtime-query-scope.ts';

test('query admission rejects non-positive, fractional and unbounded capacity', () => {
  for (const capacity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createRuntimeQueryScope(capacity), TypeError);
  }
});

test('capacity is reserved before capture and excess requests never capture inputs', async () => {
  const scope = createRuntimeQueryScope(1);
  let rejected: Promise<unknown> | undefined;
  let extraCaptured = false;
  const accepted = scope.run(() => {
    rejected = scope.run(() => { extraCaptured = true; return 99; }, value => value);
    return 7;
  }, value => value);
  assert.ok(rejected);
  await assert.rejects(rejected, { code: 'RUNTIME-BUSY-001' });
  assert.equal(extraCaptured, false);
  assert.equal(await accepted, 7);
  assert.equal(await scope.run(() => 8, value => value), 8);
  await scope.close();
});

test('capture and execution failures release capacity without replacing the original error', async () => {
  const scope = createRuntimeQueryScope(1);
  const captureFailure = new Error('capture failed');
  const executionFailure = new Error('execution failed');
  let executed = false;
  await assert.rejects(scope.run(() => { throw captureFailure; }, () => {
    executed = true;
  }), error => error === captureFailure);
  assert.equal(executed, false);
  await assert.rejects(scope.run(() => 1, () => Promise.reject(executionFailure)),
    error => error === executionFailure);
  assert.equal(await scope.run(() => 2, value => value), 2);
  await scope.close();
});

test('close stops admission but drains accepted execution to its actual settlement', async () => {
  const scope = createRuntimeQueryScope(1);
  let resolveWork!: (value: number) => void;
  const work = new Promise<number>(resolve => { resolveWork = resolve; });
  let executed = false;
  const result = scope.run(() => 1, () => { executed = true; return work; });
  const closed = scope.close();
  assert.equal(scope.close(), closed);
  let drained = false;
  void closed.then(() => { drained = true; });
  let extraCaptured = false;
  await assert.rejects(scope.run(() => { extraCaptured = true; return 2; }, value => value),
    { code: 'RUNTIME-CLOSED-001' });
  assert.equal(extraCaptured, false);
  assert.equal(executed, true);
  assert.equal(drained, false);
  resolveWork(7);
  assert.equal(await result, 7);
  await closed;
  assert.equal(drained, true);
});

test('a reentrant close during capture prevents execution and still settles its admission', async () => {
  const scope = createRuntimeQueryScope(1);
  let closed: Promise<void> | undefined;
  let executed = false;
  const result = scope.run(() => { closed = scope.close(); return 1; }, () => {
    executed = true;
  });
  await assert.rejects(result, { code: 'RUNTIME-CLOSED-001' });
  assert.ok(closed);
  await closed;
  assert.equal(executed, false);
});

test('drain completion does not turn an accepted query failure into success', async () => {
  const scope = createRuntimeQueryScope(1);
  const failure = new Error('accepted query failed');
  let rejectWork!: (reason: Error) => void;
  const work = new Promise<never>((_resolve, reject) => { rejectWork = reject; });
  const result = scope.run(() => 1, () => work);
  const rejection = assert.rejects(result, error => error === failure);
  const closed = scope.close();
  // Attach execute() to work before rejecting it; no clock or timer is needed.
  await Promise.resolve();
  rejectWork(failure);
  await rejection;
  await closed;
});
