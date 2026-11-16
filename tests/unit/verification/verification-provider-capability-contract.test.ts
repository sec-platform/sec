import { expect, test } from 'bun:test';

import {
  EXTERNAL_CAPABILITY_LEDGER_MAX_INPUT_BYTES,
  parseExternalCapabilityLedger
} from '../../../src/adapters/verification/platform/provider/capability-ledger.ts';
test('verification provider ledger accepts stable YAML and rejects unsafe size, aliases and runtime authority', () => {
  const stable = [
    'schema: sec-external-capability-ledger-v4',
    'status: active',
    ''
  ].join('\n');
  expect(parseExternalCapabilityLedger(stable).document).toEqual({
    schema: 'sec-external-capability-ledger-v4',
    status: 'active'
  });
  expect(() => parseExternalCapabilityLedger([
    'schema: sec-external-capability-ledger-v4',
    'verification:',
    '  provider: stale-runtime-observation',
    ''
  ].join('\n'))).toThrow('runtime provider availability must come from provider observations');

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