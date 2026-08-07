import { expect, test } from 'bun:test';

import {
  VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
  VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
  VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
  createCandidateTreeParityV1,
  createFreezeSessionV1,
  parseVerificationCandidateTreeParityV1,
  parseVerificationFreezeSessionV1,
  parseVerificationRegistryProjectionV1
} from '../../scripts/codex/verification-session-contract.ts';

const BASE_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const TREE_SHA = '3333333333333333333333333333333333333333';
const MERGED_TREE_SHA = '4444444444444444444444444444444444444444';
const MANIFEST_DIGEST = `sha256:${'a'.repeat(64)}` as const;

test('registry projection round-trips default and open-pr entries with exact identity', () => {
  const source = JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
    observedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultTreeSha: TREE_SHA,
    entries: [
      {
        manifestPath: 'docs/work-packages/example-v1.md',
        manifestDigest: MANIFEST_DIGEST,
        source: 'default',
        prNumber: null,
        baseSha: null,
        headSha: null,
        headTreeSha: null
      },
      {
        manifestPath: 'docs/work-packages/candidate-v1.md',
        manifestDigest: MANIFEST_DIGEST,
        source: 'open-pr',
        prNumber: 7,
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headTreeSha: TREE_SHA
      }
    ]
  });
  const projection = parseVerificationRegistryProjectionV1(source);
  expect(projection.entries).toHaveLength(2);
  expect(projection.entries[0]!.source).toBe('default');
  expect(projection.entries[1]!.prNumber).toBe(7);
});

test('registry projection rejects a default entry that binds PR identity', () => {
  const source = JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
    observedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultTreeSha: TREE_SHA,
    entries: [{
      manifestPath: 'docs/work-packages/example-v1.md',
      manifestDigest: MANIFEST_DIGEST,
      source: 'default',
      prNumber: 7,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headTreeSha: TREE_SHA
    }]
  });
  expect(() => parseVerificationRegistryProjectionV1(source))
    .toThrow('default source cannot bind PR identity');
});

test('freeze session binds exact facts and rejects tampering', () => {
  const session = createFreezeSessionV1({
    sessionId: 'sess-001',
    frozenAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    prNumber: 7,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    manifestPath: 'docs/work-packages/example-v1.md',
    manifestDigest: MANIFEST_DIGEST,
    candidateTreeSha: TREE_SHA
  });
  expect(session.schema).toBe(VERIFICATION_FREEZE_SESSION_SCHEMA_V1);
  expect(parseVerificationFreezeSessionV1(JSON.stringify(session))).toEqual(session);

  const tampered = JSON.parse(JSON.stringify(session)) as typeof session;
  tampered.candidateTreeSha = MERGED_TREE_SHA;
  expect(() => parseVerificationFreezeSessionV1(JSON.stringify(tampered)))
    .toThrow('digest mismatch');
});

test('candidate tree parity is matched only for identical trees', () => {
  const matched = createCandidateTreeParityV1({
    checkedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    sessionId: 'sess-001',
    prNumber: 7,
    candidateTreeSha: TREE_SHA,
    mergedTreeSha: TREE_SHA
  });
  expect(matched.parity).toBe('matched');
  expect(parseVerificationCandidateTreeParityV1(JSON.stringify(matched))).toEqual(matched);

  const drift = createCandidateTreeParityV1({
    checkedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    sessionId: 'sess-001',
    prNumber: 7,
    candidateTreeSha: TREE_SHA,
    mergedTreeSha: MERGED_TREE_SHA
  });
  expect(drift.parity).toBe('drift');
  expect(drift.schema).toBe(VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1);
});

test('freeze session rejects an invalid manifest path', () => {
  expect(() => createFreezeSessionV1({
    sessionId: 'sess-001',
    frozenAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    prNumber: 7,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    manifestPath: 'docs/other/manifest.md',
    manifestDigest: MANIFEST_DIGEST,
    candidateTreeSha: TREE_SHA
  })).toThrow('Manifest path must match');
});
