
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';

type IntegrationPlatformDigest = `sha256:${string}`;

/**
 * One semantic owner for the physical integration guarantees SEC can actually
 * observe on the current repository plan.  `claimsNoBypassEnforcement=false`
 * is deliberate: an exact-head compare-and-swap merge can prevent stale-head
 * integration, but it must never be described as GitHub-side no-bypass
 * protection when the provider does not expose rulesets/branch protection.
 */
export const INTEGRATION_PLATFORM_POLICY = Object.freeze({
  schema: 'sec-integration-platform-policy-v1' as const,
  physicalMerge: 'github-pr-squash-exact-head-cas-no-admin' as const,
  allowPlatformEnforcementUnavailable: true as const,
  claimsNoBypassEnforcement: false as const
});

export const INTEGRATION_PLATFORM_POLICY_DIGEST =
  `sha256:${rawSha256Hex(encodeVerificationActionData(INTEGRATION_PLATFORM_POLICY))}` as const;

export interface IntegrationPlatformObservation {
  readonly status: 'available' | 'platform-enforcement-unavailable';
  /** Digest of the exact ruleset projection, or of the bounded provider-unavailable observation. */
  readonly rulesetDigest: IntegrationPlatformDigest;
  readonly reason: string | null;
}

function fail(message: string): never {
  throw new Error(`Integration platform ${message}`);
}

function digest(value: unknown): IntegrationPlatformDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail('observation digest must be a SHA-256 digest.');
  }
  return value as IntegrationPlatformDigest;
}

function reason(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('unavailable observation reason must be bounded canonical text.');
  }
  return value;
}

/**
 * Canonicalizes the provider observation without manufacturing protection.
 * Unknown/unreadable transport never reaches this function; callers keep that
 * as a hard blocker.  A stable provider-level "feature unavailable" result is
 * accepted only by the explicit maintainer-rooted policy above.
 */
export function canonicalizeIntegrationPlatformObservation(
  value: IntegrationPlatformObservation
): IntegrationPlatformObservation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'reason,rulesetDigest,status') {
    fail('observation keys are invalid.');
  }
  const rulesetDigest = digest(value.rulesetDigest);
  if (value.status === 'available') {
    if (value.reason !== null) fail('available observation must not carry a degraded reason.');
    return Object.freeze({ status: value.status, rulesetDigest, reason: null });
  }
  if (value.status !== 'platform-enforcement-unavailable') {
    fail('observation status is invalid.');
  }
  if (!INTEGRATION_PLATFORM_POLICY.allowPlatformEnforcementUnavailable
      || INTEGRATION_PLATFORM_POLICY.claimsNoBypassEnforcement) {
    fail('unavailable enforcement is not admitted by the active policy.');
  }
  return Object.freeze({ status: value.status, rulesetDigest, reason: reason(value.reason) });
}
