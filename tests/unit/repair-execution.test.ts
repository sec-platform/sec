import { expect, test } from 'bun:test';
import { runRepairWithFailureReadback } from '../../src/application/repair-execution.ts';

test('application repair waits for readback but not for optional presentation', async () => {
  const primary = Object.freeze({ kind: 'repair-failed' });
  const secondary = Object.freeze({ kind: 'readback-failed' });
  const events: string[] = [];
  let rejectReadback!: (reason: unknown) => void;
  const readback = new Promise<void>((_, reject) => { rejectReadback = reject; });
  const never = new Promise<void>(() => {});
  const result = runRepairWithFailureReadback(
    async () => { events.push('repair'); throw primary; },
    () => { events.push('readback'); return readback; },
    error => { expect(error).toBe(secondary); events.push('report'); return never; }
  );
  let settled = false;
  const observed = result.catch(error => { settled = true; expect(error).toBe(primary); });
  await Promise.resolve();
  expect(events).toEqual(['repair', 'readback']);
  expect(settled).toBe(false);
  rejectReadback(secondary);
  await observed;
  expect(settled).toBe(true);
  expect(events).toEqual(['repair', 'readback', 'report']);
});

test('an asynchronously failing diagnostic is observed without replacing repair failure', async () => {
  const primary = new Error('repair');
  const secondary = new Error('readback');
  let reports = 0;
  await expect(runRepairWithFailureReadback(
    async () => { throw primary; },
    async () => { throw secondary; },
    async error => { reports++; expect(error).toBe(secondary); throw new Error('display'); }
  )).rejects.toBe(primary);
  await Promise.resolve();
  expect(reports).toBe(1);
});

test('successful application repair returns its exact value without readback or diagnostics', async () => {
  const value = Object.freeze({ outcome: 'done' });
  let reads = 0;
  let reports = 0;
  expect(await runRepairWithFailureReadback(
    async () => value,
    async () => { reads++; },
    () => { reports++; }
  )).toBe(value);
  expect({ reads, reports }).toEqual({ reads: 0, reports: 0 });
});
