import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { InstallStrategyRegistry, type InstallStrategy } from '../../src/compiler/compose/install-strategies.ts';
import type { InstallPlanStep } from '../../src/compiler/contract.ts';
import path from 'node:path';
import { tmpdir } from 'node:os';

function step(): InstallPlanStep { return { action: 'probe', to: 'src/a.ts' } as unknown as InstallPlanStep; }
function registry(execute: InstallStrategy['execute']) {
  return new InstallStrategyRegistry().register({ action: 'probe', canHandle: value => String(value.action) === 'probe', execute });
}

test('a provider cannot turn its cancelled fence into a successful write admission', async () => {
  const controller = new AbortController(), reason = new Error('cancelled');
  await assert.rejects(registry(async (_step, context) => {
    Object.defineProperties(context.signal!, { aborted: { value: false }, throwIfAborted: { value() {} } });
    controller.abort(reason);
    await context.commitFence!();
    assert.fail('effect admitted after native cancellation');
  }).executeAll([step()], { workspaceRoot: path.join(tmpdir(), 'sec-install-native'), lock: {} as never, signal: controller.signal }), error => error === reason);
});

test('cancelled ingress does not enumerate a caller plan even with an overridden public abort method', async () => {
  const controller = new AbortController(), reason = new Error('cancelled');
  Object.defineProperty(controller.signal, 'throwIfAborted', { value() {} });
  controller.abort(reason);
  const steps: InstallPlanStep[] = [];
  Object.defineProperty(steps, Symbol.iterator, { get() { assert.fail('plan enumerated'); } });
  await assert.rejects(registry(async () => assert.fail('executor')).executeAll(steps,
    { workspaceRoot: path.join(tmpdir(), 'sec-install-native'), lock: {} as never, signal: controller.signal }), error => error === reason);
});
