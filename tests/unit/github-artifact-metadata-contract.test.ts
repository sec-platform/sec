import { describe, expect, test } from 'bun:test';

type RawArtifact = {
  id: number;
  name: string;
  digest: string;
  expired: boolean;
  expires_at: unknown;
  size_in_bytes: number;
};

type CanonicalArtifact = {
  id: number;
  name: string;
  digest: string;
  expired: false;
  expiresAt: string;
  sizeInBytes: number;
};

const {
  gitHubArtifactMaxBytes,
  gitHubArtifactSafetyWindowMs,
  canonicalizeGitHubArtifactMetadata
} = require('../../src/adapters/verification/platform/ci/runtime/github-artifact-metadata.cjs') as {
  gitHubArtifactMaxBytes: number;
  gitHubArtifactSafetyWindowMs: number;
  canonicalizeGitHubArtifactMetadata: (
    value: RawArtifact,
    options: { checkedAtMs: number; label?: string },
  ) => CanonicalArtifact;
};

const CHECKED_AT = Date.parse('2026-07-18T17:45:00.000Z');
const DIGEST = `sha256:${'a'.repeat(64)}`;

function artifact(overrides: Partial<RawArtifact> = {}): RawArtifact {
  return {
    id: 8432436673,
    name: 'sec-scope-attestation-v1',
    digest: DIGEST,
    expired: false,
    expires_at: '2026-10-16T17:42:35Z',
    size_in_bytes: 677,
    ...overrides
  };
}

describe('GitHub artifact metadata ingress contract', () => {
  test.each([
    ['attestation', '2026-10-16T17:42:35Z', '2026-10-16T17:42:35.000Z', 677],
    ['verification', '2026-10-16T17:43:52Z', '2026-10-16T17:43:52.000Z', 1393],
    ['canonical zero milliseconds', '2026-10-16T17:42:35.000Z', '2026-10-16T17:42:35.000Z', 677],
    ['canonical nonzero milliseconds', '2026-10-16T17:42:35.123Z', '2026-10-16T17:42:35.123Z', 677]
  ])('canonicalizes %s expiry at the GitHub boundary', (_label, raw, expected, size) => {
    const value = canonicalizeGitHubArtifactMetadata(
      artifact({ expires_at: raw, size_in_bytes: size }),
      { checkedAtMs: CHECKED_AT }
    );
    expect(value.expiresAt).toBe(expected);
    expect(value.sizeInBytes).toBe(size);
    expect(value.expired).toBe(false);
  });

  test.each([
    '2026-02-30T17:42:35Z',
    '2026-10-16T19:42:35+02:00',
    '2026-10-16t17:42:35z',
    '2026-10-16T17:42:35.0Z',
    'not-a-time'
  ])('rejects noncanonical external timestamp %s', (expiresAt) => {
    expect(() => canonicalizeGitHubArtifactMetadata(
      artifact({ expires_at: expiresAt }),
      { checkedAtMs: CHECKED_AT }
    )).toThrow();
  });

  test('rejects a non-string external timestamp', () => {
    expect(() => canonicalizeGitHubArtifactMetadata(
      artifact({ expires_at: undefined }),
      { checkedAtMs: CHECKED_AT }
    )).toThrow('must be a UTC timestamp string');
  });

  test.each([
    ['expired flag', { expired: true }],
    ['missing expired flag', { expired: undefined }],
    ['invalid digest', { digest: `sha512:${'a'.repeat(64)}` }],
    ['zero size', { size_in_bytes: 0 }],
    ['fractional size', { size_in_bytes: 677.5 }],
    ['oversize archive', { size_in_bytes: gitHubArtifactMaxBytes + 1 }],
    ['unsafe lifetime', { expires_at: '2026-07-19T17:44:59Z' }]
  ])('rejects %s metadata', (_label, overrides) => {
    expect(() => canonicalizeGitHubArtifactMetadata(
      artifact(overrides as Partial<RawArtifact>),
      { checkedAtMs: CHECKED_AT }
    )).toThrow();
  });

  test('accepts an expiry exactly at the safety-window boundary', () => {
    const expiresAt = new Date(CHECKED_AT + gitHubArtifactSafetyWindowMs).toISOString();
    expect(canonicalizeGitHubArtifactMetadata(
      artifact({ expires_at: expiresAt }),
      { checkedAtMs: CHECKED_AT }
    ).expiresAt).toBe(expiresAt);
  });
});
