import { expect, test } from 'bun:test';

import {
  PhysicalResourceCompositeSettlementError,
  settlePhysicalResourcesAsync
} from './resource-settlement.ts';

test('async physical settlement awaits every cleanup in caller order', async () => {
  const events: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const terminal = await settlePhysicalResourcesAsync({
    cleanup: ['alpha', 'beta', 'gamma'].map((label) => ({
      label,
      settle: async () => {
        events.push(`start:${label}`);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        events.push(`end:${label}`);
      }
    }))
  });

  expect(maximumActive).toBe(1);
  expect(events).toEqual([
    'start:alpha', 'end:alpha',
    'start:beta', 'end:beta',
    'start:gamma', 'end:gamma'
  ]);
  expect(terminal).toEqual({
    status: 'settled',
    attemptedLabels: ['alpha', 'beta', 'gamma']
  });
  expect(Object.isFrozen(terminal)).toBe(true);
  expect(Object.isFrozen(terminal.attemptedLabels)).toBe(true);
});

test('async physical settlement preserves primary and every cleanup residue', async () => {
  const primary = new Error('operation failed');
  const firstResidue = new Error('first cleanup failed');
  const thirdResidue = new Error('third cleanup failed');
  const attempted: string[] = [];
  let settlementError: unknown;
  try {
    await settlePhysicalResourcesAsync({
      primary: { label: 'operation', error: primary },
      cleanup: [
        {
          label: 'first',
          settle: async () => {
            attempted.push('first');
            throw firstResidue;
          }
        },
        {
          label: 'second',
          settle: async () => { attempted.push('second'); }
        },
        {
          label: 'third',
          settle: async () => {
            attempted.push('third');
            throw thirdResidue;
          }
        }
      ]
    });
  } catch (error) {
    settlementError = error;
  }

  expect(attempted).toEqual(['first', 'second', 'third']);
  expect(settlementError).toBeInstanceOf(PhysicalResourceCompositeSettlementError);
  if (!(settlementError instanceof PhysicalResourceCompositeSettlementError)) return;
  expect(settlementError.failures).toEqual([
    { label: 'operation', error: primary },
    { label: 'first', error: firstResidue },
    { label: 'third', error: thirdResidue }
  ]);
  expect(settlementError.errors).toEqual([primary, firstResidue, thirdResidue]);
});

test('async physical settlement rethrows an unaccompanied primary unchanged', async () => {
  const primary = new Error('operation failed');
  let settlementError: unknown;
  try {
    await settlePhysicalResourcesAsync({
      primary: { label: 'operation', error: primary },
      cleanup: []
    });
  } catch (error) {
    settlementError = error;
  }
  expect(settlementError).toBe(primary);
});
