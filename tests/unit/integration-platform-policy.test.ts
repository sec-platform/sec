import { describe, expect, test } from 'bun:test';

import {
  SEC_INTEGRATION_PLATFORM_POLICY_V1,
  canonicalizeIntegrationPlatformObservationV1
} from '../../platform/shared/integration-platform-policy.ts';

const DIGEST = `sha256:${'1'.repeat(64)}` as const;

describe('integration platform policy', () => {
  test('admits a stable provider feature-unavailable fact without claiming no-bypass', () => {
    expect(SEC_INTEGRATION_PLATFORM_POLICY_V1).toMatchObject({
      physicalMerge: 'github-pr-squash-exact-head-cas-no-admin',
      allowPlatformEnforcementUnavailable: true,
      claimsNoBypassEnforcement: false
    });
    expect(canonicalizeIntegrationPlatformObservationV1({
      status: 'platform-enforcement-unavailable',
      rulesetDigest: DIGEST,
      reason: 'GitHub private/free plan does not expose rulesets'
    })).toEqual({
      status: 'platform-enforcement-unavailable',
      rulesetDigest: DIGEST,
      reason: 'GitHub private/free plan does not expose rulesets'
    });
  });

  test('rejects ambiguous or falsely degraded projections', () => {
    expect(() => canonicalizeIntegrationPlatformObservationV1({
      status: 'available',
      rulesetDigest: DIGEST,
      reason: 'partially available'
    })).toThrow('must not carry a degraded reason');
    expect(() => canonicalizeIntegrationPlatformObservationV1({
      status: 'platform-enforcement-unavailable',
      rulesetDigest: DIGEST,
      reason: ''
    })).toThrow('reason must be bounded canonical text');
  });
});
