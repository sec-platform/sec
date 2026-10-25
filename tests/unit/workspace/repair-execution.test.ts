import { expect, test } from 'bun:test';
import { runRepairWithFailureReadback } from '../../../src/application/repair-execution.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

test('application repair awaits failed readback and preserves its original failure', async () => {
  const primary = Object.freeze({ kind: 'repair-failed' });
  const secondary = Object.freeze({ kind: 'readback-failed' });
  const events: string[] = [];
  let rejectReadback!: (reason: unknown) => void;
  const readback = new Promise<void>((_, reject) => { rejectReadback = reject; });
  const result = runRepairWithFailureReadback(
    async () => { events.push('repair'); throw primary; },
    () => { events.push('readback'); return readback; },
    error => { expect(error).toBe(secondary); events.push('report'); }
  );
  let settled = false;
  const observed = result.catch(error => { settled = true; expect(error).toBe(primary); });
  await settleWorkspaceCallback(async () => {
    await Promise.resolve();
    expect(events).toEqual(['repair', 'readback']);
    expect(settled).toBe(false);
  }, async () => { rejectReadback(secondary); await observed; });
  expect(settled).toBe(true);
  expect(events).toEqual(['repair', 'readback', 'report']);
});
