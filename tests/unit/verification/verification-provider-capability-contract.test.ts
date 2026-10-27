import { expect, test } from 'bun:test';

import {
  EXTERNAL_CAPABILITY_LEDGER_MAX_INPUT_BYTES,
  parseExternalCapabilityLedger
} from '../../../src/adapters/verification/platform/provider/capability-ledger.ts';
test('verification provider capability ledger rejects oversized input and YAML aliases', () => {
  expect(() => parseExternalCapabilityLedger(
    'x'.repeat(EXTERNAL_CAPABILITY_LEDGER_MAX_INPUT_BYTES + 1)
  )).toThrow('UTF-8 input byte limit');

  const aliased = [
    'schema: sec-external-capability-ledger-v4',
    'shared: &shared',
    '  value: 1',
    'catalog: *shared',
    ''
  ].join('\n');
  expect(() => parseExternalCapabilityLedger(aliased))
    .toThrow('not one valid strict YAML document');
});