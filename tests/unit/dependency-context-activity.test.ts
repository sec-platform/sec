import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  assertRuntimeDependencyOperationActive, runtimeDependencyOperationContext,
  runtimeDependencyOperationControls
} from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

const context = (clock = () => 0, signal?: AbortSignal) => runtimeDependencyOperationContext(
  runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: clock, signal }));

test('context checks consume the original ledger without renewing budget', () => {
  let now = 0; const operation = context(() => now);
  now = 50; assertRuntimeDependencyOperationActive(operation, 'half');
  now = 100; assert.throws(() => assertRuntimeDependencyOperationActive(operation, 'done'), /deadline/);
  assert.equal(operation.deadlineAtMonotonicMs, 100);
});

for (const reason of [null, false, 0, 'cancelled', Object.freeze({ cancelled: true })]) {
  test(`a context scan preserves the native cancellation reason ${String(reason)}`, () => {
    const controller = new AbortController(), operation = context(() => 0, controller.signal);
    Object.defineProperty(controller.signal, 'aborted', { value: false }); controller.abort(reason);
    assert.throws(() => assertRuntimeDependencyOperationActive(operation, 'scan'), error => error === reason);
  });
}

test('cancellation during a clock callback cannot admit another scan step', () => {
  const controller = new AbortController(), reason = {}; let armed = false;
  const operation = context(() => { if (armed) controller.abort(reason); return 0; }, controller.signal);
  armed = true;
  assert.throws(() => assertRuntimeDependencyOperationActive(operation, 'scan'), error => error === reason);
});

test('a copied or fabricated context is not a new authority', () => {
  const operation = context();
  assert.throws(() => assertRuntimeDependencyOperationActive({ ...operation }, 'copy'), /not owner-issued/);
  assert.throws(() => assertRuntimeDependencyOperationActive({ monotonicNowMs: () => assert.fail('forged clock') } as never, 'fake'), /not owner-issued/);
});

test('backward clock movement and exhausted submillisecond remainder use existing rules', () => {
  let now = 0; const operation = context(() => now);
  now = 20; assertRuntimeDependencyOperationActive(operation, 'forward'); now = 19;
  assert.throws(() => assertRuntimeDependencyOperationActive(operation, 'backward'), /backwards/);
  now = 0; const another = context(() => now); now = 99.5;
  assert.throws(() => assertRuntimeDependencyOperationActive(another, 'fraction'), /deadline/);
});
