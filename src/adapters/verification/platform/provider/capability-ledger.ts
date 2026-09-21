import path from 'node:path';

import { createVerificationProviderAvailabilityEpoch, type VerificationProviderAvailabilityEpoch, type VerificationProviderCapabilityInput } from './contract/capability.ts';
import { parseYamlValue } from '../../../formats/yaml.ts';
import {
  inspectNoFollowDirectoryChain,
  readNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

export const VERIFICATION_PROVIDER_LEDGER_PATH =
  'config/external-capabilities/ledger.yaml' as const;

export const VERIFICATION_PROVIDER_LEDGER_MAX_INPUT_BYTES = 1024 * 1024;
export const VERIFICATION_PROVIDER_LEDGER_MAX_ALIAS_COUNT = 0;

export interface VerificationProviderCapabilityLedgerProjection {
  readonly document: Readonly<Record<string, unknown>>;
  readonly availabilityEpoch: VerificationProviderAvailabilityEpoch;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  const unknownKey = Object.keys(value).find((key) => !expected.has(key));
  if (unknownKey !== undefined) throw new Error(`${label}.${unknownKey} is not allowed.`);
  const missingKey = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missingKey !== undefined) throw new Error(`${label}.${missingKey} is required.`);
}

export function parseVerificationProviderCapabilityLedger(
  source: string
): VerificationProviderCapabilityLedgerProjection {
  const root = record(parseYamlValue(source, {
    label: 'External capability ledger',
    maximumInputBytes: VERIFICATION_PROVIDER_LEDGER_MAX_INPUT_BYTES,
    maximumAliasCount: VERIFICATION_PROVIDER_LEDGER_MAX_ALIAS_COUNT,
    stringKeys: true
  }), 'External capability ledger');
  if (root.schema !== 'sec-external-capability-ledger-v4') {
    throw new Error('External capability ledger schema must be sec-external-capability-ledger-v4.');
  }
  const verification = record(root.verification, 'External capability ledger.verification');
  exact(verification, [
    'schema', 'epochId', 'observedAt', 'expiresAt', 'diagnosticRetention', 'capabilities'
  ], 'External capability ledger.verification');
  if (verification.schema !== 'sec-verification-provider-availability-ledger-v1') {
    throw new Error('External capability ledger.verification schema is invalid.');
  }
  const retention = record(verification.diagnosticRetention,
    'External capability ledger.verification.diagnosticRetention');
  exact(retention, ['rawProviderProse', 'positiveClaimsRequireDurableEvidence'],
    'External capability ledger.verification.diagnosticRetention');
  if (retention.rawProviderProse !== 'disposable-after-normalization'
    || retention.positiveClaimsRequireDurableEvidence !== true) {
    throw new Error('Verification provider diagnostic retention policy is not fail-closed.');
  }
  if (!Array.isArray(verification.capabilities)) {
    throw new Error('External capability ledger.verification.capabilities must be an array.');
  }
  const capabilities = verification.capabilities.map((entry, index) => {
    const capability = record(entry, `verification capability ${index}`);
    exact(capability, [
      'capability', 'role', 'provider', 'availability', 'reasonCode', 'receiptRef', 'observedAt'
    ], `verification capability ${index}`);
    return capability as unknown as VerificationProviderCapabilityInput;
  });
  const availabilityEpoch = createVerificationProviderAvailabilityEpoch({
    epochId: String(verification.epochId),
    observedAt: String(verification.observedAt),
    expiresAt: String(verification.expiresAt),
    capabilities
  });
  return Object.freeze({
    document: Object.freeze(root),
    availabilityEpoch
  });
}

export function loadVerificationProviderCapabilityLedger(
  repositoryRoot = process.cwd()
): VerificationProviderAvailabilityEpoch {
  const absolutePath = path.resolve(repositoryRoot, VERIFICATION_PROVIDER_LEDGER_PATH);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absolutePath),
    'External capability ledger parent'
  ).target;
  const bytes = readNoFollowOrdinaryFile(
    parent,
    path.basename(absolutePath),
    { maximumBytes: VERIFICATION_PROVIDER_LEDGER_MAX_INPUT_BYTES }
  );
  if (bytes === null) {
    throw new Error('External capability ledger is missing.');
  }
  return parseVerificationProviderCapabilityLedger(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  ).availabilityEpoch;
}
