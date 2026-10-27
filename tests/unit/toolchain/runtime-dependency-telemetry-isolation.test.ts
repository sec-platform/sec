import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { runtimeDependencyOperationOptions, runtimeDependencyOperationRemainingMs } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { measureRuntimeDependencyOperationPhase, measureRuntimeDependencyOperationPhaseAsync, readRuntimeDependencyOperationTelemetry } from '../../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

function clock() {
  let now = 0;
  let error: Error | undefined;
  const options = runtimeDependencyOperationOptions({ monotonicNowMs: () => { if (error) throw error; return now; } });
  return { options, time: (value: number) => { now = value; }, fail: () => { error = new Error('clock unavailable'); } };
}

for (const mode of ['sync', 'async'] as const) {
  test(`${mode} completed result survives a failed terminal clock sample`, async () => {
    const state = clock();
    const result = Object.freeze({ completed: true });
    const action = () => { state.fail(); return result; };
    const actual = mode === 'sync'
      ? measureRuntimeDependencyOperationPhase(state.options, 'install', action)
      : await measureRuntimeDependencyOperationPhaseAsync(state.options, 'install', async () => action());
    assert.equal(actual, result);
    assert.deepEqual(readRuntimeDependencyOperationTelemetry(state.options).phases, [{
      phase: 'install', count: 1, durationMs: 0, unmeasuredCount: 1,
      outcomes: { completed: 1, aborted: 0, 'deadline-exhausted': 0, failed: 0 }
    }]);
    // Diagnostic isolation must not disable the actual operation's clock guard.
    assert.throws(() => runtimeDependencyOperationRemainingMs(state.options, 'actual operation'), /clock unavailable/);
  });

  test(`${mode} preserves an undefined rejection when terminal timing also fails`, async () => {
    const state = clock();
    const action = () => { state.fail(); throw undefined; };
    let rejected = false;
    try {
      if (mode === 'sync') measureRuntimeDependencyOperationPhase(state.options, 'publication', action);
      else await measureRuntimeDependencyOperationPhaseAsync(state.options, 'publication', async () => action());
    } catch (error) { rejected = true; assert.equal(error, undefined); }
    assert.equal(rejected, true);
    const phase = readRuntimeDependencyOperationTelemetry(state.options).phases[0]!;
    assert.equal(phase.count, 1);
    assert.equal(phase.unmeasuredCount, 1);
    assert.equal(phase.outcomes.failed, 1);
  });

  test(`${mode} retains the pre-action clock check`, async () => {
    const state = clock(); state.fail();
    let ran = false;
    const action = () => { ran = true; };
    if (mode === 'sync') assert.throws(() => measureRuntimeDependencyOperationPhase(state.options, 'install', action), /clock unavailable/);
    else await assert.rejects(measureRuntimeDependencyOperationPhaseAsync(state.options, 'install', async () => action()), /clock unavailable/);
    assert.equal(ran, false);
    assert.deepEqual(readRuntimeDependencyOperationTelemetry(state.options).phases, []);
  });

  test(`${mode} never loses a revoked Proxy thrown by the action`, async () => {
    const state = clock();
    const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
    let rejected = false;
    try {
      if (mode === 'sync') measureRuntimeDependencyOperationPhase(state.options, 'validation', () => { throw proxy; });
      else await measureRuntimeDependencyOperationPhaseAsync(state.options, 'validation', async () => { throw proxy; });
    } catch (error) { rejected = true; assert.equal(error, proxy); }
    assert.equal(rejected, true);
    assert.equal(readRuntimeDependencyOperationTelemetry(state.options).phases[0]!.outcomes.failed, 1);
  });
}

for (const end of [-1, NaN]) {
  test(`unmeasurable terminal duration ${String(end)} is explicit, not a business failure`, () => {
    const state = clock();
    assert.equal(measureRuntimeDependencyOperationPhase(state.options, 'identity', () => { state.time(end); return 'result'; }), 'result');
    const phase = readRuntimeDependencyOperationTelemetry(state.options).phases[0]!;
    assert.equal(phase.durationMs, 0);
    assert.equal(phase.unmeasuredCount, 1);
    assert.equal(phase.outcomes.completed, 1);
  });
}

for (const field of ['code', 'message', 'name'] as const) {
  test(`throwing error ${field} getter does not replace the primary failure`, () => {
    const state = clock();
    const error = new CodedFailure('RUNTIME-DEPS-003', 'failure');
    Object.defineProperty(error, field, { get() { throw new Error('secondary classification error'); } });
    assert.throws(() => measureRuntimeDependencyOperationPhase(state.options, 'cleanup', () => { throw error; }), (actual: unknown) => actual === error);
    assert.equal(readRuntimeDependencyOperationTelemetry(state.options).phases[0]!.outcomes.failed, 1);
  });
}

test('terminal recording retains the captured context after caller options are revoked', () => {
  const state = clock();
  const { proxy: options, revoke } = Proxy.revocable(state.options, {});
  const result = measureRuntimeDependencyOperationPhase(options, 'install', () => {
    state.time(4);
    revoke();
    return 'installed';
  });
  assert.equal(result, 'installed');
  const phase = readRuntimeDependencyOperationTelemetry(state.options).phases[0]!;
  assert.equal(phase.durationMs, 4);
  assert.equal(phase.outcomes.completed, 1);
});

test('parent and narrowed child share telemetry while unrelated operations remain separate', () => {
  const state = clock();
  const child = runtimeDependencyOperationOptions({ ...state.options, pollIntervalMs: 10 });
  measureRuntimeDependencyOperationPhase(state.options, 'identity', () => { state.time(2); });
  measureRuntimeDependencyOperationPhase(child, 'source-scan', () => { state.time(5); });
  assert.deepEqual(readRuntimeDependencyOperationTelemetry(state.options).phases.map((phase) => [phase.phase, phase.durationMs]), [['identity', 2], ['source-scan', 3]]);
  assert.deepEqual(readRuntimeDependencyOperationTelemetry(clock().options).phases, []);
});
