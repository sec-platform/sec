import { describe, expect, test } from 'bun:test';

import {
  parseVerificationProviderCapabilityLedger,
  VERIFICATION_PROVIDER_LEDGER_MAX_INPUT_BYTES
} from '../../src/adapters/verification/platform/provider/capability-ledger.ts';
import { assertProviderCapabilityUsable, assertProviderRetryGuard, classifyProviderDiagnosticText, createVerificationProviderAvailabilityEpoch, createVerificationProviderCapability, resolveProviderAvailability } from '../../src/adapters/verification/platform/provider/contract/capability.ts';

const OBSERVED_AT = '2026-08-11T00:00:00.000Z';
const EXPIRES_AT = '2026-08-12T00:00:00.000Z';
const POSITIVE_EVIDENCE = `sha256:${'a'.repeat(64)}` as const;

describe('verification provider capability contract', () => {
  test('static availability remains a routing projection and never grants effect authority', () => {
    const writer = createVerificationProviderCapability({
      capability: 'github-writer',
      role: 'writer',
      provider: 'github-api',
      availability: 'available',
      reasonCode: null,
      receiptRef: POSITIVE_EVIDENCE,
      observedAt: OBSERVED_AT
    });
    const reviewer = createVerificationProviderCapability({
      capability: 'codex-review',
      role: 'reviewer',
      provider: 'codex-code-review',
      availability: 'unavailable',
      reasonCode: 'provider-quota-unavailable',
      receiptRef: POSITIVE_EVIDENCE,
      observedAt: OBSERVED_AT
    });
    const hosted = createVerificationProviderCapability({
      capability: 'github-actions-hosted-verification',
      role: 'hosted-verification',
      provider: 'github-actions',
      availability: 'available',
      reasonCode: null,
      receiptRef: POSITIVE_EVIDENCE,
      observedAt: OBSERVED_AT
    });
    expect(writer.role).toBe('writer');
    expect(writer.availability).toBe('unknown');
    expect(reviewer.role).toBe('reviewer');
    expect(reviewer.availability).toBe('unavailable');
    expect(hosted.role).toBe('hosted-verification');
    expect(hosted.availability).toBe('unknown');
  });

  test('ledger parser delegates static positive projection normalization to the canonical contract', () => {
    const projection = parseVerificationProviderCapabilityLedger(JSON.stringify({
      schema: 'sec-external-capability-ledger-v4',
      verification: {
        schema: 'sec-verification-provider-availability-ledger-v1',
        epochId: 'static-positive-projection',
        observedAt: OBSERVED_AT,
        expiresAt: EXPIRES_AT,
        diagnosticRetention: {
          rawProviderProse: 'disposable-after-normalization',
          positiveClaimsRequireDurableEvidence: true
        },
        capabilities: [{
          capability: 'github-writer',
          role: 'writer',
          provider: 'github-api',
          availability: 'available',
          reasonCode: null,
          receiptRef: POSITIVE_EVIDENCE,
          observedAt: OBSERVED_AT
        }]
      }
    }));
    const epoch = projection.availabilityEpoch;
    expect(resolveProviderAvailability(epoch, 'github-writer')).toMatchObject({
      availability: 'unknown',
      reasonCode: 'provider-receipt-unverified',
      receiptRef: null
    });
  });

  test('raw quota prose is never engineering truth: only reasonCode and a digest are retained', () => {
    const raw = 'You have reached your quota. Upgrade your plan or check your billing settings to continue.';
    const classified = classifyProviderDiagnosticText(raw);
    expect(classified.reasonCode).toBe('provider-quota-unavailable');
    expect(classified.receiptRef).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(raw).not.toContain(classified.reasonCode);

    const epoch = createVerificationProviderAvailabilityEpoch({
      epochId: 'test-quota-epoch',
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      capabilities: [{
        capability: 'codex-review',
        role: 'reviewer',
        provider: 'codex-code-review',
        availability: 'unavailable',
        reasonCode: classified.reasonCode,
        receiptRef: classified.receiptRef,
        observedAt: OBSERVED_AT
      }]
    });
    const resolved = resolveProviderAvailability(epoch, 'codex-review');
    expect(resolved.reasonCode).toBe('provider-quota-unavailable');
    expect(resolved.receiptRef).toBe(classified.receiptRef);
    // The raw prose sentence is absent from every normalized surface; only the
    // bounded reasonCode and a digest are retained.
    expect(JSON.stringify(resolved)).not.toContain('You have reached your quota');
    expect(JSON.stringify(resolved)).not.toContain('billing settings');
    expect(JSON.stringify(resolved)).not.toContain('Upgrade your plan');
  });

  test('an unavailable provider in the same availability epoch is never retried', () => {
    const epoch = createVerificationProviderAvailabilityEpoch({
      epochId: 'test-no-retry-epoch',
      observedAt: OBSERVED_AT,
      expiresAt: EXPIRES_AT,
      capabilities: [{
        capability: 'codex-review',
        role: 'reviewer',
        provider: 'codex-code-review',
        availability: 'unavailable',
        reasonCode: 'provider-quota-unavailable',
        receiptRef: null,
        observedAt: OBSERVED_AT
      }]
    });
    try {
      assertProviderRetryGuard({
        previous: { availability: 'unavailable', epochId: epoch.epochId },
        requested: { capability: 'codex-review', epochId: epoch.epochId }
      });
      throw new Error('expected provider retry guard to reject');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROVIDER-UNAVAILABLE-NOT-RETRIED' });
    }
    // A new availability epoch (availability input changed) allows a fresh call.
    expect(() => assertProviderRetryGuard({
      previous: { availability: 'unavailable', epochId: 'old-epoch' },
      requested: { capability: 'codex-review', epochId: 'new-epoch' }
    })).not.toThrow();
  });

  test('explicit fixture separates roles, binds freshness, and has no dynamic-ledger expectation', () => {
    const registry = createVerificationProviderAvailabilityEpoch({
      epochId: 'explicit-provider-fixture', observedAt: OBSERVED_AT, expiresAt: EXPIRES_AT,
      capabilities: [
        { capability: 'github-writer', role: 'writer', provider: 'github-api', availability: 'unknown', reasonCode: 'provider-receipt-unverified', receiptRef: null, observedAt: OBSERVED_AT },
        { capability: 'codex-review', role: 'reviewer', provider: 'codex-code-review', availability: 'unknown', reasonCode: 'provider-receipt-unverified', receiptRef: null, observedAt: OBSERVED_AT },
        { capability: 'deepseek-independent-review', role: 'reviewer', provider: 'deepseek-independent-execution', availability: 'unknown', reasonCode: 'provider-not-provisioned', receiptRef: null, observedAt: OBSERVED_AT },
        { capability: 'github-actions-hosted-verification', role: 'hosted-verification', provider: 'github-actions', availability: 'unknown', reasonCode: 'provider-receipt-unverified', receiptRef: null, observedAt: OBSERVED_AT }
      ]
    });
    expect(registry.epochDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(registry.capabilities.map((entry) => entry.capability).sort()).toEqual([
      'codex-review',
      'deepseek-independent-review',
      'github-actions-hosted-verification',
      'github-writer'
    ]);
    expect(resolveProviderAvailability(registry, 'codex-review').availability).toBe('unknown');
    expect(resolveProviderAvailability(registry, 'deepseek-independent-review').availability)
      .toBe('unknown');
    expect(resolveProviderAvailability(registry, 'github-writer').availability).toBe('unknown');
    expect(resolveProviderAvailability(registry, 'github-actions-hosted-verification').availability)
      .toBe('unknown');
    expect(() => assertProviderCapabilityUsable({ epoch: registry, capability: 'codex-review',
      expectedRole: 'writer', now: '2026-08-11T02:00:00.000Z' })).toThrow('registered for reviewer');
    expect(() => assertProviderCapabilityUsable({ epoch: registry, capability: 'codex-review',
      expectedRole: 'reviewer', now: registry.expiresAt })).toThrow('expired');
    expect(() => assertProviderCapabilityUsable({ epoch: registry, capability: 'codex-review',
      expectedRole: 'reviewer', now: '2026-08-10T23:59:59.999Z' })).toThrow('availability epoch');
  });

  test('capability validation rejects unknown roles, states, and unsafe reason text', () => {
    expect(() => createVerificationProviderCapability({
      capability: 'codex-review',
      role: 'reviewer',
      provider: 'codex-code-review',
      availability: 'unavailable',
      reasonCode: 'RAW QUOTA TEXT with spaces and Uppercase',
      receiptRef: null,
      observedAt: OBSERVED_AT
    })).toThrow('bounded kebab-case code');
    expect(() => createVerificationProviderCapability({
      capability: 'codex-review',
      role: 'reviewer',
      provider: 'codex-code-review',
      availability: 'available',
      reasonCode: 'provider-quota-unavailable',
      receiptRef: POSITIVE_EVIDENCE,
      observedAt: OBSERVED_AT
    })).toThrow('available capability must not carry an availability reason code');
    expect(() => createVerificationProviderCapability({
      capability: 'codex-review',
      role: 'reviewer',
      provider: 'codex-code-review',
      availability: 'mystate' as never,
      reasonCode: null,
      receiptRef: null,
      observedAt: OBSERVED_AT
    })).toThrow('availability state is unknown');
    expect(() => createVerificationProviderCapability({
      capability: 'github-writer', role: 'writer', provider: 'codex-code-review',
      availability: 'unknown', reasonCode: 'provider-receipt-unverified', receiptRef: null, observedAt: OBSERVED_AT
    })).toThrow('must use provider github-api');
  });
});


test('verification provider capability ledger rejects oversized input and YAML aliases', () => {
  expect(() => parseVerificationProviderCapabilityLedger(
    'x'.repeat(VERIFICATION_PROVIDER_LEDGER_MAX_INPUT_BYTES + 1)
  )).toThrow('UTF-8 input byte limit');

  const aliased = [
    'schema: sec-external-capability-ledger-v4',
    'shared: &shared',
    '  value: 1',
    'verification: *shared',
    ''
  ].join('\n');
  expect(() => parseVerificationProviderCapabilityLedger(aliased))
    .toThrow();
});
