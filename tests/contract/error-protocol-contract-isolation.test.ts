import { expect, test } from 'bun:test';

import { buildErrorProtocolContract } from '../../src/application/error-protocol-contract.ts';

test('mutating returned example details cannot alter a later error contract', () => {
  const first = buildErrorProtocolContract('first command');
  const expected = structuredClone(buildErrorProtocolContract('next command'));
  const rollback = first.examples.find((example) => example.id === 'upgrade-rollback-error')!;
  expect(rollback.output.details).toEqual(rollback.input.details);
  expect(rollback.input.details).toMatchObject({
    migrationId: 'mig-customer-normalizer-file',
    migrationKind: 'file-replace',
    rollbackStatus: 'restored'
  });
  const unexpected = first.examples.find((example) => example.id === 'unexpected-error')!;
  expect(unexpected.input).not.toHaveProperty('code');
  expect(unexpected.input).not.toHaveProperty('details');
  const details = rollback.input.details as Record<string, unknown>;
  details.rollbackStatus = 'caller-owned';
  details.nested = { value: 'caller-owned' };
  delete details.migrationId;

  expect(buildErrorProtocolContract('next command')).toEqual(expected);
  expect(first.command).toBe('first command');
});
