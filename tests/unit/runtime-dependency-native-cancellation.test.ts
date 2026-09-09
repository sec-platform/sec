import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  awaitRuntimeDependencyOperation, runtimeDependencyOperationContext,
  runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs
} from '../../src/toolchain/dependencies/runtime/operation-controls.ts';
import { measureRuntimeDependencyOperationPhase, readRuntimeDependencyOperationTelemetry } from '../../src/toolchain/dependencies/runtime/operation-telemetry.ts';

function controls(signal?: AbortSignal) { return runtimeDependencyOperationControls({ lockTimeoutMs: 1000, monotonicNowMs: () => 0, signal }); }

test('native cancellation still rejects a bound operation when public signal methods are replaced', () => {
  const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
  const bound = controls(controller.signal);
  Object.defineProperties(controller.signal, { aborted: { value: false }, throwIfAborted: { value() {} } });
  controller.abort(reason);
  assert.throws(() => runtimeDependencyOperationRemainingMs(bound, 'bound'), error => error === reason);
});

test('a cancelled parent cannot be resurrected while a child adds its own signal', () => {
  const parent = new AbortController(), child = new AbortController(), reason = Object.freeze({ parent: 'cancelled' });
  const bound = controls(parent.signal);
  Object.defineProperty(parent.signal, 'aborted', { value: false });
  parent.abort(reason);
  assert.throws(() => runtimeDependencyOperationControls({ ...bound, signal: child.signal }), error => error === reason);
});

test('private await follows real state despite a source listener stopping event propagation', async () => {
  const controller = new AbortController(), reason = Object.freeze({ cancel: 'provider' });
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  const context = runtimeDependencyOperationContext(controls(controller.signal));
  await assert.rejects(awaitRuntimeDependencyOperation(context, 'cancel', () => {
    controller.abort(reason); return new Promise<void>(() => {});
  }), error => error === reason);
});

test('synthetic abort notifications do not cancel bounded provider completion', async () => {
  const controller = new AbortController(), context = runtimeDependencyOperationContext(controls(controller.signal));
  await awaitRuntimeDependencyOperation(context, 'synthetic', async () => { controller.signal.dispatchEvent(new Event('abort')); });
});

test('telemetry does not classify an arbitrary exception as abort from a shadowed true property', () => {
  const controller = new AbortController(), bound = controls(controller.signal), reason = new Error('provider');
  Object.defineProperty(controller.signal, 'aborted', { value: true });
  assert.throws(() => measureRuntimeDependencyOperationPhase(bound, 'identity', () => { throw reason; }), error => error === reason);
  assert.equal(readRuntimeDependencyOperationTelemetry(bound).phases[0]?.outcomes.failed, 1);
});

test('telemetry observes a real abort even when the visible property says false', () => {
  const controller = new AbortController(), bound = controls(controller.signal), reason = Object.freeze({ abort: 'native' });
  Object.defineProperty(controller.signal, 'aborted', { value: false });
  controller.abort(reason);
  assert.throws(() => measureRuntimeDependencyOperationPhase(bound, 'identity', () => { throw reason; }), error => error === reason);
  assert.equal(readRuntimeDependencyOperationTelemetry(bound).phases[0]?.outcomes.aborted, 1);
});
