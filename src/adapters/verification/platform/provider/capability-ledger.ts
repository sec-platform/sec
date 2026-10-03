import { parseYamlValue } from '../../../formats/yaml.ts';

export const EXTERNAL_CAPABILITY_LEDGER_PATH =
  'config/external-capabilities/ledger.yaml' as const;

export const EXTERNAL_CAPABILITY_LEDGER_MAX_INPUT_BYTES = 1024 * 1024;
const EXTERNAL_CAPABILITY_LEDGER_MAX_ALIAS_COUNT = 0;

export interface ExternalCapabilityLedgerProjection {
  readonly document: Readonly<Record<string, unknown>>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Parses only stable tracked provider catalog/policy state.
 *
 * Runtime provider availability is an observation and must never be persisted
 * into main as an epoch with observedAt/expiresAt. Runtime owners issue fresh
 * availability observations/receipts and may still use the canonical
 * VerificationProviderAvailabilityEpoch contract in memory.
 */
export function parseExternalCapabilityLedger(
  source: string
): ExternalCapabilityLedgerProjection {
  const root = record(parseYamlValue(source, {
    label: 'External capability ledger',
    maximumInputBytes: EXTERNAL_CAPABILITY_LEDGER_MAX_INPUT_BYTES,
    maximumAliasCount: EXTERNAL_CAPABILITY_LEDGER_MAX_ALIAS_COUNT,
    stringKeys: true
  }), 'External capability ledger');
  if (root.schema !== 'sec-external-capability-ledger-v4') {
    throw new Error('External capability ledger schema must be sec-external-capability-ledger-v4.');
  }
  if (Object.prototype.hasOwnProperty.call(root, 'verification')) {
    throw new Error(
      'External capability ledger.verification is not allowed; '
      + 'runtime provider availability must come from provider observations.'
    );
  }
  return Object.freeze({ document: Object.freeze(root) });
}
