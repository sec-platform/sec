import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { captureVerifyProjectOptions } from '../../src/compiler/verify/verify-invocation.ts';

for (const key of ['isolated', 'emitTiming'] as const) {
  for (const value of [null, 0, 'false', {}]) test(`${key} rejects a non-boolean without coercion`, () => {
    assert.throws(() => captureVerifyProjectOptions({ [key]: value } as never), TypeError);
  });
}

test('owned inputs and nested observer/staging decisions are captured once', () => {
  const counts = new Map<string, number>();
  const handler = () => {}, lease = {}, proof = {}, logger = {};
  const observer = { onEvent: handler, transactionId: 'tx:one' };
  const staging = { executionBoundary: 'windows-appcontainer', workspaceWriteLease: lease };
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ emitTiming: true, isolated: true, pipelineObserver: observer,
    stagingTreeOptions: staging, stagedVerificationProof: proof, logger })) {
    Object.defineProperty(raw, key, { get() { counts.set(key, (counts.get(key) ?? 0) + 1); return value; } });
  }
  Object.defineProperty(raw, 'unowned', { enumerable: true, get() { assert.fail('unowned input'); } });
  const input = new Proxy(raw, { ownKeys() { assert.fail('enumerated options'); } });
  const captured = captureVerifyProjectOptions(input as never);
  Object.assign(observer, { onEvent: () => assert.fail('replacement'), transactionId: 'changed' });
  Object.assign(staging, { executionBoundary: 'changed', workspaceWriteLease: {} });
  assert.equal(captured.pipelineObserver?.onEvent, handler); assert.equal(captured.pipelineObserver?.transactionId, 'tx:one');
  assert.equal(captured.stagingTreeOptions?.executionBoundary, 'windows-appcontainer');
  assert.equal(captured.stagingTreeOptions?.workspaceWriteLease, lease);
  assert.equal(captured.stagedVerificationProof, proof); assert.equal(captured.logger, logger);
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.pipelineObserver));
  assert.ok(Object.isFrozen(captured.stagingTreeOptions)); assert.ok([...counts.values()].every(count => count === 1));
});

test('commit callback retains its original class private state after method replacement', async () => {
  class Options {
    #calls = 0;
    async beforeCommit() { this.#calls++; }
    get calls() { return this.#calls; }
  }
  const options = new Options(), captured = captureVerifyProjectOptions(options);
  options.beforeCommit = async () => assert.fail('replacement method');
  await captured.beforeCommit?.(); assert.equal(options.calls, 1);
});

for (const value of [null, {}, { onEvent() {}, transactionId: '' }, { onEvent: false, transactionId: 'tx' }]) {
  test('invalid observer shape rejects instead of reaching an event callback', () => {
    assert.throws(() => captureVerifyProjectOptions({ pipelineObserver: value } as never), TypeError);
  });
}

test('native cancellation is not overridden by the public signal method', () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  Object.defineProperty(controller.signal, 'throwIfAborted', { value() {} }); controller.abort(reason);
  assert.throws(() => captureVerifyProjectOptions({ signal: controller.signal }), error => error === reason);
});

for (const executionBoundary of [null, '', 'arbitrary']) test('unknown staging boundaries are not silently accepted', () => {
  assert.throws(() => captureVerifyProjectOptions({ stagingTreeOptions: { executionBoundary } } as never), TypeError);
});
