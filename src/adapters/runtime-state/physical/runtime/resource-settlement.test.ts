import { expect, test } from 'bun:test';

import {
  ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError,
  settleResourcesAsync as settlePhysicalResourcesAsync
} from '../../../../execution/resource-settlement.ts';

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
