import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  createVerificationProviderAvailabilityEpochV1,
  type VerificationProviderAvailabilityEpochV1,
  type VerificationProviderCapabilityInputV1
} from '../../platform/shared/verification-provider-capability-contract.ts';

export const VERIFICATION_PROVIDER_LEDGER_PATH_V1 =
  'docs/governance/external-capability-ledger.yaml' as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

export function parseVerificationProviderCapabilityLedgerV1(
  source: string
): VerificationProviderAvailabilityEpochV1 {
  const root = record(parseYaml(source), 'External capability ledger');
  if (root.schema !== 'sec-external-capability-ledger-v4') {
    throw new Error('Verification provider availability requires sec-external-capability-ledger-v4.');
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
    return capability as unknown as VerificationProviderCapabilityInputV1;
  });
  return createVerificationProviderAvailabilityEpochV1({
    epochId: String(verification.epochId),
    observedAt: String(verification.observedAt),
    expiresAt: String(verification.expiresAt),
    capabilities
  });
}

export function loadVerificationProviderCapabilityLedgerV1(
  repositoryRoot = process.cwd()
): VerificationProviderAvailabilityEpochV1 {
  return parseVerificationProviderCapabilityLedgerV1(
    readFileSync(path.join(repositoryRoot, VERIFICATION_PROVIDER_LEDGER_PATH_V1), 'utf8')
  );
}
