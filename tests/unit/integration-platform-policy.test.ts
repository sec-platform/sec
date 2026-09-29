import { describe, expect, test } from 'bun:test';

import {
  SEC_INTEGRATION_PLATFORM_POLICY,
  canonicalizeIntegrationPlatformObservation
} from '../../src/adapters/self-hosting/control/integration/platform-policy.ts';

const DIGEST = `sha256:${'1'.repeat(64)}` as const;

describe('integration platform policy', () => {
  test('requires canonical platform enforcement and never treats feature-unavailable as merge authority', () => {
    expect(SEC_INTEGRATION_PLATFORM_POLICY).toMatchObject({
      physicalMerge: 'github-pr-squash-exact-head-cas-no-admin',
      allowPlatformEnforcementUnavailable: false,
      claimsNoBypassEnforcement: false
    });
    expect(() => canonicalizeIntegrationPlatformObservation({
      status: 'platform-enforcement-unavailable',
      rulesetDigest: DIGEST,
      reason: 'GitHub canonical main-authority ruleset readback is unavailable'
    })).toThrow('unavailable enforcement is not admitted');
  });

  test('rejects ambiguous or falsely degraded projections', () => {
    expect(() => canonicalizeIntegrationPlatformObservation({
      status: 'available',
      rulesetDigest: DIGEST,
      reason: 'partially available'
    })).toThrow('must not carry a degraded reason');
    expect(() => canonicalizeIntegrationPlatformObservation({
      status: 'platform-enforcement-unavailable',
      rulesetDigest: DIGEST,
      reason: ''
    })).toThrow('reason must be bounded canonical text');
  });
});