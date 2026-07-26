import { expect, test } from 'bun:test';

import { buildTaskEnvelope } from '../../platform/compiler/synthesize/build-task-envelope.ts';
import { buildCustomerNormalizerLock, buildCustomerNormalizerPlan } from '../helpers/repair-fixtures.ts';

test('task envelope preserves typed slot contracts and fixed write constraints', () => {
  const plan = buildCustomerNormalizerPlan({
    slotDescription: 'Normalize the canonical customer input.'
  });
  const lock = buildCustomerNormalizerLock();
  const baseTask = lock.slotTasks[0];
  if (!baseTask) throw new Error('Missing customer normalizer task fixture.');

  const envelope = buildTaskEnvelope(plan, lock, {
    ...baseTask,
    inputType: 'CustomerInput',
    outputType: 'CustomerRecord'
  });

  expect(envelope).toMatchObject({
    taskId: 'fill_slot_customer_normalizer',
    taskKind: 'adapter-slot',
    phase: 'adapt',
    targetFile: 'custom/customer_normalizer.ts',
    allowedPaths: ['custom/customer_normalizer.ts'],
    requiredSymbols: ['normalizeCustomerInput'],
    inputContracts: {
      description: 'Normalize the canonical customer input.',
      inputType: 'CustomerInput',
      outputType: 'CustomerRecord'
    }
  });
  expect(envelope.forbiddenOperations).toEqual([
    'modify_other_files',
    'add_dependencies',
    'access_database',
    'change_exports'
  ]);
});
