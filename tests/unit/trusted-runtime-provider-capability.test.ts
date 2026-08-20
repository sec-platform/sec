import { expect, test } from 'bun:test';

import {
  createVerificationProviderAvailabilityEpochV1,
  createVerificationProviderCapabilityV1,
  resolveProviderAvailabilityV1
} from '../../platform/shared/verification-provider-capability-contract.ts';

const OBSERVED_AT = '2026-08-19T00:00:00.000Z';
const EXPIRES_AT = '2026-08-20T00:00:00.000Z';
const RECEIPT = `sha256:${'a'.repeat(64)}` as const;

test('independent trusted runtime is a first-class verification provider capability', () => {
  const capability = createVerificationProviderCapabilityV1({
    capability: 'trusted-runtime-verification',
    role: 'hosted-verification',
    provider: 'sec-trusted-runtime',
    availability: 'unknown',
    reasonCode: 'provider-receipt-unverified',
    receiptRef: null,
    observedAt: OBSERVED_AT
  });
  expect(capability.capability).toBe('trusted-runtime-verification');
  expect(capability.provider).toBe('sec-trusted-runtime');
  expect(capability.role).toBe('hosted-verification');
});

test('static positive trusted-runtime claims cannot mint execution authority', () => {
  const capability = createVerificationProviderCapabilityV1({
    capability: 'trusted-runtime-verification',
    role: 'hosted-verification',
    provider: 'sec-trusted-runtime',
    availability: 'available',
    reasonCode: null,
    receiptRef: RECEIPT,
    observedAt: OBSERVED_AT
  });
  expect(capability.availability).toBe('unknown');
  expect(capability.reasonCode).toBe('provider-receipt-unverified');
  expect(capability.receiptRef).toBeNull();
});

test('trusted runtime cannot impersonate the GitHub Actions capability and vice versa', () => {
  expect(() => createVerificationProviderCapabilityV1({
    capability: 'trusted-runtime-verification',
    role: 'hosted-verification',
    provider: 'github-actions',
    availability: 'unknown',
    reasonCode: 'provider-receipt-unverified',
    receiptRef: null,
    observedAt: OBSERVED_AT
  })).toThrow('must use provider sec-trusted-runtime');

  expect(() => createVerificationProviderCapabilityV1({
    capability: 'github-actions-hosted-verification',
    role: 'hosted-verification',
    provider: 'sec-trusted-runtime',
    availability: 'unknown',
    reasonCode: 'provider-receipt-unverified',
    receiptRef: null,
    observedAt: OBSERVED_AT
  })).toThrow('must use provider github-actions');
});

test('unregistered trusted runtime remains explicit unknown rather than falling back to Actions', () => {
  const epoch = createVerificationProviderAvailabilityEpochV1({
    epochId: 'trusted-runtime-missing',
    observedAt: OBSERVED_AT,
    expiresAt: EXPIRES_AT,
    capabilities: [{
      capability: 'github-actions-hosted-verification',
      role: 'hosted-verification',
      provider: 'github-actions',
      availability: 'unknown',
      reasonCode: 'provider-not-provisioned',
      receiptRef: null,
      observedAt: OBSERVED_AT
    }]
  });
  expect(resolveProviderAvailabilityV1(epoch, 'trusted-runtime-verification')).toMatchObject({
    provider: 'sec-trusted-runtime',
    role: 'hosted-verification',
    availability: 'unknown',
    reasonCode: 'provider-unregistered'
  });
});
