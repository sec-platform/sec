import { expect, test } from 'bun:test';

import { sha256 } from '../../src/contracts/canonical.ts';
import {
  createReviewReport,
  assertReviewReportCurrent
} from '../../src/adapters/verification/platform/review/contract/report.ts';
import {
  createGitHubExactHeadReviewReport,
  GITHUB_TRUSTED_APP_EXACT_HEAD_REVIEW_METHOD
} from '../../src/adapters/verification/platform/review/provider/github-report.ts';
import {
  REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
  REVIEW_STABILITY_POLICY,
  createReviewSnapshotDigest,
  createReviewStabilityReceipt
} from '../../src/adapters/verification/platform/review/contract/stability.ts';

const D = (value: string) => sha256(value);
const SHA = '1'.repeat(40);
const TREE = '2'.repeat(40);

function receipt() {
  const snapshotBase = {
    paginationComplete: true as const,
    reviewedHeadSha: SHA,
    reviewPageDigests: [D('page')],
    threadPageDigests: [D('thread')],
    reviewCount: 1,
    threadCount: 0,
    unresolvedBlockingThreadCount: 0 as const,
    requestChangesPrincipalIds: Object.freeze([]) as readonly []
  };
  return createReviewStabilityReceipt({
    stage: 'pre-expensive', repository: 'sec-platform/sec', prNumber: 630,
    sessionRevision: D('session'), scopeAuthorizationRevision: D('scope'),
    scopeAuthorizationReceiptDigest: D('scope-receipt'), headSha: SHA, headTreeSha: TREE,
    policy: REVIEW_STABILITY_POLICY,
    principal: { kind: 'github-app', actorNodeId: 'BOT_kgDOC98s_g', appId: 1144995,
      appNodeId: 'A_kwHOAOQ6Gs4AEXij', appSlug: 'chatgpt-codex-connector', reviewState: 'COMMENTED' },
    independence: { candidateAuthorNodeId: 'AUTHOR', integrationPrincipalNodeId: 'INTEGRATOR' },
    producer: {
      identity: 'src/adapters/verification/platform/ci/runtime/verification-session-github.ts',
      executionIdentity: 'github-review-observer:sec-platform/sec:630:' + SHA,
      providerIdentity: 'github', candidateWriteCapability: 'read-only',
      capabilityReceiptDigest: REVIEW_OBSERVER_READ_ONLY_CAPABILITY_RECEIPT,
      trustedRevision: REVIEW_STABILITY_POLICY.trustedRevision,
      sourceTransport: 'github-rest', sourceRunId: 'run-1',
      sourceRef: `github://sec-platform/sec/pull/630@${SHA}`, sourceDigest: D('page')
    },
    snapshot: { ...snapshotBase, snapshotDigest: createReviewSnapshotDigest(snapshotBase) },
    reviewedAt: '2026-09-25T12:00:00.000Z', expiresAt: '2026-09-25T13:00:00.000Z'
  });
}

function baseInput() {
  const source = receipt();
  return {
    stage: source.stage, repository: source.repository, prNumber: source.prNumber,
    sessionRevision: source.sessionRevision, scopeAuthorizationRevision: source.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: source.scopeAuthorizationReceiptDigest,
    headSha: source.headSha, headTreeSha: source.headTreeSha, policyDigest: source.policy.policyDigest,
    principal: source.principal, reviewMethodRevision: GITHUB_TRUSTED_APP_EXACT_HEAD_REVIEW_METHOD,
    coverageMode: 'explicit-surface-set' as const, requiredSurfaces: ['a.ts', 'b.ts'], reviewedSurfaces: ['a.ts', 'b.ts'],
    findings: [] as any[], sourceReviewRevision: source.reviewRevision, sourceReceiptDigest: source.receiptDigest
  };
}

test('clear ReviewReport covers the exact required surface and binds the source receipt', () => {
  const source = receipt();
  const report = createGitHubExactHeadReviewReport({ receipt: source, requiredSurfaces: ['b.ts', 'a.ts'] });
  expect(report.terminal).toBe('clear');
  expect(report.requiredSurfaces).toEqual(['a.ts', 'b.ts']);
  expect(report.reviewedSurfaces).toEqual(['a.ts', 'b.ts']);
  expect(report.unreviewedSurfaces).toEqual([]);
  expect(report.findings).toEqual([]);
  assertReviewReportCurrent(report, {
    stage: source.stage, sessionRevision: source.sessionRevision,
    scopeAuthorizationRevision: source.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: source.scopeAuthorizationReceiptDigest,
    headSha: source.headSha, headTreeSha: source.headTreeSha,
    policyDigest: source.policy.policyDigest, sourceReviewRevision: source.reviewRevision,
    sourceReceiptDigest: source.receiptDigest, reviewMethodRevision: report.reviewMethodRevision,
    coverageMode: report.coverageMode, requiredSurfaces: ['a.ts', 'b.ts']
  });
});

test('unreviewed required surface is incomplete and cannot authorize integration', () => {
  const report = createReviewReport({ ...baseInput(), reviewedSurfaces: ['a.ts'] });
  expect(report.terminal).toBe('incomplete');
  expect(report.unreviewedSurfaces).toEqual(['b.ts']);
  expect(() => assertReviewReportCurrent(report, {
    stage: report.stage, sessionRevision: report.sessionRevision,
    scopeAuthorizationRevision: report.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: report.scopeAuthorizationReceiptDigest,
    headSha: report.headSha, headTreeSha: report.headTreeSha, policyDigest: report.policyDigest,
    sourceReviewRevision: report.sourceReviewRevision, sourceReceiptDigest: report.sourceReceiptDigest,
    reviewMethodRevision: report.reviewMethodRevision, coverageMode: report.coverageMode,
    requiredSurfaces: report.requiredSurfaces
  })).toThrow('does not authorize integration');
});



test('exact-head change-set coverage cannot silently leave required surfaces unreviewed', () => {
  expect(() => createReviewReport({ ...baseInput(), coverageMode: 'exact-head-change-set',
    reviewedSurfaces: ['a.ts'] })).toThrow('must cover every required surface');
});

test('finding severity and status rules are deterministic rather than reviewer preference', () => {
  const finding = {
    findingId: 'F1', subject: 'unsafe state', owner: 'owner', invariantRef: 'docs#invariant',
    severity: 'p1', blocking: true, evidenceRefs: [D('evidence')], reproduction: 'counterexample',
    confidence: 'high', limitations: [], remediationClass: 'code', status: 'open', riskAcceptanceRef: null
  } as const;
  expect(createReviewReport({ ...baseInput(), findings: [finding] }).terminal).toBe('blocked');
  expect(() => createReviewReport({ ...baseInput(), findings: [{ ...finding, blocking: false }] }))
    .toThrow('open p1 must block');
  expect(() => createReviewReport({ ...baseInput(), findings: [{ ...finding,
    severity: 'p2', blocking: false }] }))
    .toThrow('open p2 must block');
  expect(() => createReviewReport({ ...baseInput(), findings: [{ ...finding,
    severity: 'nit', blocking: true }] }))
    .toThrow('nit must not block');
  expect(() => createReviewReport({ ...baseInput(), findings: [{ ...finding,
    status: 'accepted-risk', blocking: false }] }))
    .toThrow('accepted-risk requires riskAcceptanceRef');
  expect(createReviewReport({ ...baseInput(), findings: [{ ...finding,
    status: 'accepted-risk', blocking: false, riskAcceptanceRef: D('risk-acceptance') }] }).terminal)
    .toBe('unresolved');
});

test('report currentness binds exact tree, scope and source review receipt', () => {
  const report = createReviewReport(baseInput());
  expect(() => assertReviewReportCurrent(report, {
    stage: report.stage, sessionRevision: report.sessionRevision,
    scopeAuthorizationRevision: report.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: report.scopeAuthorizationReceiptDigest,
    headSha: '3'.repeat(40), headTreeSha: report.headTreeSha, policyDigest: report.policyDigest,
    sourceReviewRevision: report.sourceReviewRevision, sourceReceiptDigest: report.sourceReceiptDigest,
    reviewMethodRevision: report.reviewMethodRevision, coverageMode: report.coverageMode,
    requiredSurfaces: report.requiredSurfaces
  })).toThrow('headSha drift');
});
