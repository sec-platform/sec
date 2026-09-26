import { expect, test } from 'bun:test';

import { VERIFICATION_FREEZE_SESSION_SCHEMA, VERIFICATION_REGISTRY_PROJECTION_SCHEMA, createVerificationSession, createVerificationSessionProposalDigest, parseVerificationFreezeSession, parseVerificationRegistryProjection, parseVerificationSession } from '../../src/adapters/verification/platform/session/contract/session.ts';

const BASE_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const TREE_SHA = '3333333333333333333333333333333333333333';
const MERGED_TREE_SHA = '4444444444444444444444444444444444444444';
const MANIFEST_DIGEST = `sha256:${'a'.repeat(64)}` as const;

test('registry projection round-trips default and open-pr entries with exact identity', () => {
  const source = JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA,
    observedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultTreeSha: TREE_SHA,
    entries: [
      {
        manifestPath: 'config/repository/work-packages/example-v1.md',
        manifestDigest: MANIFEST_DIGEST,
        source: 'default',
        prNumber: null,
        baseSha: null,
        headSha: null,
        headTreeSha: null
      },
      {
        manifestPath: 'config/repository/work-packages/candidate-v1.md',
        manifestDigest: MANIFEST_DIGEST,
        source: 'open-pr',
        prNumber: 7,
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headTreeSha: TREE_SHA
      }
    ]
  });
  const projection = parseVerificationRegistryProjection(source);
  expect(projection.entries).toHaveLength(2);
  expect(projection.entries[0]!.source).toBe('default');
  expect(projection.entries[1]!.prNumber).toBe(7);
});

test('registry projection rejects a default entry that binds PR identity', () => {
  const source = JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA,
    observedAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    defaultTreeSha: TREE_SHA,
    entries: [{
      manifestPath: 'config/repository/work-packages/example-v1.md',
      manifestDigest: MANIFEST_DIGEST,
      source: 'default',
      prNumber: 7,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      headTreeSha: TREE_SHA
    }]
  });
  expect(() => parseVerificationRegistryProjection(source))
    .toThrow('default source cannot bind PR identity');
});

test('freeze session binds exact facts and rejects tampering', () => {
  const source = {
    schema: VERIFICATION_FREEZE_SESSION_SCHEMA,
    sessionId: 'sess-001',
    frozenAt: '2026-08-07T00:00:00.000Z',
    repository: 'sec-platform/sec',
    prNumber: 7,
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    manifestPath: 'config/repository/work-packages/example-v1.md',
    manifestDigest: MANIFEST_DIGEST,
    candidateTreeSha: TREE_SHA,
    sessionDigest: ''
  };
  expect(() => parseVerificationFreezeSession(JSON.stringify(source))).toThrow('digest mismatch');
});

test('V2 revision is stable across run identity and timestamps and binds semantic inputs', () => {
  const input = {
    sessionId: 'sess-001', createdAt: '2026-08-09T00:00:00.000Z', repository: 'sec-platform/sec', prNumber: 7,
    baseSha: BASE_SHA, baseTreeSha: MERGED_TREE_SHA, headSha: HEAD_SHA, headTreeSha: TREE_SHA,
    manifestPath: 'config/repository/work-packages/example-v1.md', manifestDigest: MANIFEST_DIGEST,
    sessionProposalDigest: `sha256:${'7'.repeat(64)}` as const,
    scopeAuthorizationRevision: `sha256:${'b'.repeat(64)}` as const,
    scopeAuthorizationReceiptDigest: `sha256:${'9'.repeat(64)}` as const,
    actionPlanClosureDigest: `sha256:${'c'.repeat(64)}` as const,
    profile: 'full', environmentDigest: `sha256:${'d'.repeat(64)}` as const,
    trustRevision: BASE_SHA, reviewPolicyDigest: `sha256:${'e'.repeat(64)}` as const,
    evidenceRequirementDigest: `sha256:${'f'.repeat(64)}` as const,
    integrationPolicyDigest: `sha256:${'1'.repeat(64)}` as const,
    mainHealthRef: { mainSha: BASE_SHA, mainTreeSha: MERGED_TREE_SHA, healthRevision: `sha256:${'2'.repeat(64)}` as const, ledgerReceiptDigest: `sha256:${'3'.repeat(64)}` as const }
  };
  const first = createVerificationSession(input);
  const resumed = createVerificationSession({ ...input, sessionId: 'sess-002', createdAt: '2026-08-09T01:00:00.000Z' });
  expect(first.sessionRevision).toBe(resumed.sessionRevision);
  expect(createVerificationSession({ ...input, scopeAuthorizationReceiptDigest: `sha256:${'8'.repeat(64)}` }).sessionRevision).toBe(first.sessionRevision);
  expect(createVerificationSession({ ...input, mainHealthRef: { ...input.mainHealthRef, ledgerReceiptDigest: `sha256:${'4'.repeat(64)}` } }).sessionRevision).toBe(first.sessionRevision);
  expect(createVerificationSession({ ...input, actionPlanClosureDigest: `sha256:${'6'.repeat(64)}` }).sessionRevision).not.toBe(first.sessionRevision);
  expect(parseVerificationSession(JSON.stringify(first))).toEqual(first);
  expect(createVerificationSession({ ...input, headTreeSha: MERGED_TREE_SHA }).sessionRevision).not.toBe(first.sessionRevision);
});

test('session proposal digest is precomputable without session identity or receipt provenance',()=>{
  const proposal={repository:'sec-platform/sec',prNumber:7,baseSha:BASE_SHA,baseTreeSha:MERGED_TREE_SHA,headSha:HEAD_SHA,headTreeSha:TREE_SHA,manifestPath:'config/repository/work-packages/example-v1.md',manifestDigest:MANIFEST_DIGEST,testImpactTransitionDigest:`sha256:${'4'.repeat(64)}` as const,scopeProposalDigest:`sha256:${'5'.repeat(64)}` as const,actionPlanClosureDigest:`sha256:${'6'.repeat(64)}` as const,profile:'full',environmentDigest:`sha256:${'7'.repeat(64)}` as const,trustRevision:BASE_SHA,reviewPolicyDigest:`sha256:${'8'.repeat(64)}` as const,mainHealthPolicyDigest:`sha256:${'9'.repeat(64)}` as const};
  const digest=createVerificationSessionProposalDigest(proposal);
  expect(createVerificationSessionProposalDigest({...proposal,actionPlanClosureDigest:`sha256:${'a'.repeat(64)}`})).not.toBe(digest);
  expect(createVerificationSessionProposalDigest({...proposal,testImpactTransitionDigest:`sha256:${'b'.repeat(64)}`})).not.toBe(digest);
});
