import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { runtimeDependencyOperationOptions, runtimeDependencyOperationRemainingMs } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { measureRuntimeDependencyOperationPhase, measureRuntimeDependencyOperationPhaseAsync, readRuntimeDependencyOperationTelemetry } from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';
import { FailureError } from '../../src/contracts/failure.ts';

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

  for (const [name, reason] of [['error', new Error('primary')], ['null', null], ['undefined', undefined], ['object', { primary: true }]] as const) {
    test(`${mode} preserves the exact ${name} rejection when terminal timing also fails`, async () => {
      const state = clock();
      const action = () => { state.fail(); throw reason; };
      let rejected = false;
      try {
        if (mode === 'sync') measureRuntimeDependencyOperationPhase(state.options, 'publication', action);
        else await measureRuntimeDependencyOperationPhaseAsync(state.options, 'publication', async () => action());
      } catch (error) { rejected = true; assert.equal(error, reason); }
      assert.equal(rejected, true);
      const phase = readRuntimeDependencyOperationTelemetry(state.options).phases[0]!;
      assert.equal(phase.count, 1);
      assert.equal(phase.unmeasuredCount, 1);
      assert.equal(phase.outcomes.failed, 1);
    });
  }

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

for (const end of [-1, NaN, Infinity, -Infinity]) {
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
    const error = new FailureError('RUNTIME-DEPS-003', 'failure');
    Object.defineProperty(error, field, { get() { throw new Error('secondary classification error'); } });
    assert.throws(() => measureRuntimeDependencyOperationPhase(state.options, 'cleanup', () => { throw error; }), (actual: unknown) => actual === error);
    assert.equal(readRuntimeDependencyOperationTelemetry(state.options).phases[0]!.outcomes.failed, 1);
  });
}

test('classification does not inspect an unrelated message field', () => {
  const state = clock();
  const error = new FailureError('UNRELATED', 'failure'); error.name = 'AbortError';
  Object.defineProperty(error, 'message', { get() { throw new Error('irrelevant message'); } });
  assert.throws(() => measureRuntimeDependencyOperationPhase(state.options, 'cleanup', () => { throw error; }), (actual: unknown) => actual === error);
  assert.equal(readRuntimeDependencyOperationTelemetry(state.options).phases[0]!.outcomes.aborted, 1);
});

test('existing cancellation and deadline outcome projections retain their precedence', () => {
  const controller = new AbortController();
  const options = runtimeDependencyOperationOptions({ signal: controller.signal, monotonicNowMs: () => 0 });
  const deadline = new FailureError('RUNTIME-DEPS-003', 'operation DEADLINE exhausted');
  assert.throws(() => measureRuntimeDependencyOperationPhase(options, 'install', () => { throw deadline; }), (error: unknown) => error === deadline);
  assert.throws(() => measureRuntimeDependencyOperationPhase(options, 'install', () => { controller.abort(deadline); throw deadline; }), (error: unknown) => error === deadline);
  const phase = readRuntimeDependencyOperationTelemetry(options).phases[0]!;
  assert.equal(phase.outcomes['deadline-exhausted'], 1);
  assert.equal(phase.outcomes.aborted, 1);
  assert.equal(phase.count, 2);
});

test('successful durations accumulate without mutating previously published snapshots', () => {
  const state = clock();
  measureRuntimeDependencyOperationPhase(state.options, 'install', () => { state.time(4); });
  const first = readRuntimeDependencyOperationTelemetry(state.options);
  measureRuntimeDependencyOperationPhase(state.options, 'install', () => { state.time(11); });
  const second = readRuntimeDependencyOperationTelemetry(state.options);
  assert.equal(first.phases[0]!.count, 1); assert.equal(first.phases[0]!.durationMs, 4);
  assert.equal(second.phases[0]!.count, 2); assert.equal(second.phases[0]!.durationMs, 11);
  assert.equal(second.phases[0]!.unmeasuredCount, 0);
  assert.ok(Object.isFrozen(second)); assert.ok(Object.isFrozen(second.phases));
  assert.ok(Object.isFrozen(second.phases[0])); assert.ok(Object.isFrozen(second.phases[0]!.outcomes));
});

test('each attempt resolves its operation context once', () => {
  const state = clock();
  let lookups = 0;
  const options = new Proxy(state.options, { get(target, key, receiver) { if (typeof key === 'symbol') lookups += 1; return Reflect.get(target, key, receiver); } });
  measureRuntimeDependencyOperationPhase(options, 'install', () => {});
  assert.equal(lookups, 1);
});

test('parent and narrowed child share telemetry while unrelated operations remain separate', () => {
  const state = clock();
  const child = runtimeDependencyOperationOptions({ ...state.options, pollIntervalMs: 10 });
  measureRuntimeDependencyOperationPhase(state.options, 'identity', () => { state.time(2); });
  measureRuntimeDependencyOperationPhase(child, 'source-scan', () => { state.time(5); });
  assert.deepEqual(readRuntimeDependencyOperationTelemetry(state.options).phases.map((phase) => [phase.phase, phase.durationMs]), [['identity', 2], ['source-scan', 3]]);
  assert.deepEqual(readRuntimeDependencyOperationTelemetry(clock().options).phases, []);
});

test('overlapping asynchronous attempts each retain their own elapsed interval', async () => {
  const state = clock();
  let finishFirst!: () => void; let finishSecond!: () => void;
  const first = measureRuntimeDependencyOperationPhaseAsync(state.options, 'install', () => new Promise<void>((resolve) => { finishFirst = resolve; }));
  const second = measureRuntimeDependencyOperationPhaseAsync(state.options, 'install', () => new Promise<void>((resolve) => { finishSecond = resolve; }));
  state.time(5); finishSecond(); await second;
  state.time(10); finishFirst(); await first;
  const phase = readRuntimeDependencyOperationTelemetry(state.options).phases[0]!;
  assert.equal(phase.count, 2); assert.equal(phase.durationMs, 15);
  assert.equal(phase.unmeasuredCount, 0); assert.equal(phase.outcomes.completed, 2);
});
