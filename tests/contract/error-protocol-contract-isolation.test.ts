import { expect, test } from 'bun:test';

import { buildErrorProtocolContract } from '../../src/application/error-protocol-contract.ts';

for (const side of ['input', 'output'] as const) {
  test(`mutating ${side} example details cannot alter a later error contract`, () => {
    const first = buildErrorProtocolContract('first command');
    const expected = structuredClone(buildErrorProtocolContract('next command'));
    const rollback = first.examples.find((example) => example.id === 'upgrade-rollback-error')!;
    const details = rollback[side].details as Record<string, unknown>;
    details.rollbackStatus = `caller-owned-${side}`;
    details.nested = { value: 'caller-owned' };
    delete details.migrationId;

    expect(buildErrorProtocolContract('next command')).toEqual(expected);
    expect(first.command).toBe('first command');
  });
}

test('example details retain their input/output meaning within one owned result', () => {
  const contract = buildErrorProtocolContract('contract errors');
  const rollback = contract.examples.find((example) => example.id === 'upgrade-rollback-error')!;
  expect(rollback.output.details).toBe(rollback.input.details);
  expect(rollback.input.details).toMatchObject({
    migrationId: 'mig-customer-normalizer-file',
    migrationKind: 'file-replace',
    rollbackStatus: 'restored'
  });
  const unexpected = contract.examples.find((example) => example.id === 'unexpected-error')!;
  expect(unexpected.input).not.toHaveProperty('code');
  expect(unexpected.input).not.toHaveProperty('details');
});
