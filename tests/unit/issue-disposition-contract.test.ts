import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  compileIssueDisposition,
  createIssueAcceptanceId,
  createIssueDispositionPlan,
  decideUnexpectedIssueReopen,
  parseGitHubClosingKeywordOccurrences,
  parseIssueDispositionPlan,
  parseIssueDisposition,
  renderPullRequestBody
} from '../../src/adapters/self-hosting/control/issues/disposition.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';

const REPOSITORY = 'sec-platform/sec';
const MANIFEST = 'config/repository/work-packages/controlled-pr-issue-disposition-single-writer-v1.md';
const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function body(mode: 'progress-only' | 'close-tracking-after-readback' = 'close-tracking-after-readback') {
  return renderPullRequestBody({
    summary: 'Implements the exact Issue lifecycle transaction without delegating authority to prose.',
    manifestPath: MANIFEST,
    mode
  });
}

function plan(mode: 'progress-only' | 'close-tracking-after-readback' = 'close-tracking-after-readback') {
  return createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'issue-352',
    title: 'feat(integration): add machine issue disposition', body: body(mode),
    linkedClosingIssues: [] });
}

function acceptanceIds() {
  return [createIssueAcceptanceId({ manifestDigest: DIGEST_A,
    index: 0, text: 'exact lifecycle readback' })] as const;
}

test('canonical PR renderer emits only non-effect control fields', () => {
  const rendered = body();
  expect(rendered).toContain(`Work-Package: ${MANIFEST}`);
  expect(rendered).toContain('Issue-Disposition: close-tracking-after-readback');
  expect(parseGitHubClosingKeywordOccurrences(rendered, REPOSITORY)).toEqual([]);
  expect(parseIssueDispositionPlan(encodeVerificationActionData(plan()))).toEqual(plan());
});

test('all GitHub closing spellings are rejected even under negation, case, colon, and cross-repo syntax', () => {
  const cases = [
    'do not close #352', 'Closes: #352', 'cLoSeS:#352', 'CLOSED sec-platform/sec#352',
    'does not fix #352', 'Fixes: sec-platform/sec#352', 'FIXED #352',
    'must not resolve #352', 'Resolves: #352', 'RESOLVED sec-platform/sec#352',
    'Fixes https://github.com/sec-platform/sec/issues/352',
    'does not close <https://github.com/other/repo/issues/9>'
  ];
  for (const source of cases) {
    expect(parseGitHubClosingKeywordOccurrences(source, REPOSITORY)).toHaveLength(1);
    expect(() => renderPullRequestBody({ summary: source, manifestPath: MANIFEST,
      mode: 'progress-only' })).toThrow('closing-keyword');
  }
  expect(parseGitHubClosingKeywordOccurrences(
    'fixes #352 and resolves other/repo#9', REPOSITORY
  ).map(({ repository, issueNumber }) => `${repository}#${issueNumber}`))
    .toEqual(['sec-platform/sec#352', 'other/repo#9']);
});

test('PR plan rejects provider-linked issues and malformed or duplicate control fields', () => {
  expect(() => createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'issue-352',
    title: 'safe title', body: body(), linkedClosingIssues: [{ repository: REPOSITORY,
      issueNumber: 352 }] })).toThrow('zero closing authority');
  expect(() => createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'issue-352', title: 'safe title',
    body: `${body()}Issue-Disposition: progress-only\n`, linkedClosingIssues: [] }))
    .toThrow('exactly one');
  expect(() => createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'issue-352', title: 'safe title',
    body: `${body()}  issue-disposition: progress-only\n`, linkedClosingIssues: [] }))
    .toThrow('exactly one');
  expect(() => createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'none', title: 'safe title',
    body: body(), linkedClosingIssues: [] })).toThrow('requires one tracking Issue');
});

test('absence of an independently sourced completion assessment can only compile progress', () => {
  const disposition = compileIssueDisposition({ plan: plan(), currentSpecRevision: DIGEST_B,
    acceptanceIds: acceptanceIds(), newMainSha: SHA_A, newMainTreeSha: SHA_B,
    evidenceRefs: [DIGEST_C], expectedProviderState: 'OPEN' });
  expect(disposition.kind).toBe('progressed');
  expect(disposition.issueNumber).toBe(352);
  expect(disposition.completionAssessment).toBe('unavailable');
  expect(disposition.providerMutationCapability).toBe('unsupported-no-conditional-write');
  expect(disposition.blockers).toEqual([
    'provider-conditional-write-unsupported',
    'trusted-completion-assessment-unavailable'
  ]);
  expect(parseIssueDisposition(encodeVerificationActionData(disposition))).toEqual(disposition);

  const staleState = compileIssueDisposition({ plan: plan(), currentSpecRevision: DIGEST_B,
    acceptanceIds: acceptanceIds(), newMainSha: SHA_A, newMainTreeSha: SHA_B,
    evidenceRefs: [DIGEST_C], expectedProviderState: 'CLOSED' });
  expect(staleState.kind).toBe('progressed');
  expect(staleState.blockers).toContain('expected-provider-state-not-open');
});

test('disposition parser rejects close-mode states outside the compiler output language', () => {
  const noTrackingPlan = createIssueDispositionPlan({ repository: REPOSITORY, prNumber: 357,
    manifestPath: MANIFEST, manifestDigest: DIGEST_A, tracking: 'none',
    title: 'feat(integration): add machine issue disposition', body: body('progress-only'),
    linkedClosingIssues: [] });
  const compiled = compileIssueDisposition({ plan: noTrackingPlan,
    currentSpecRevision: DIGEST_B, acceptanceIds: acceptanceIds(), newMainSha: SHA_A,
    newMainTreeSha: SHA_B, evidenceRefs: [DIGEST_C], expectedProviderState: 'OPEN' });
  const { dispositionId: _dispositionId, operationId: _operationId,
    receiptDigest: _receiptDigest, ...semantic } = compiled;
  void _dispositionId; void _operationId; void _receiptDigest;
  const invalidSemantic = { ...semantic, planMode: 'close-tracking-after-readback',
    blockers: semantic.blockers.filter((blocker) => blocker !== 'plan-progress-only') };
  const dispositionId = hash(invalidSemantic);
  const operationId = hash({ dispositionId, effect: 'none' });
  const invalidReceipt = { ...invalidSemantic, dispositionId, operationId };
  expect(() => parseIssueDisposition(encodeVerificationActionData({ ...invalidReceipt,
    receiptDigest: hash(invalidReceipt) }))).toThrow('close disposition has no tracking Issue');
});

test('progress plan cannot mint an effect even when every fact is satisfied', () => {
  const disposition = compileIssueDisposition({ plan: plan('progress-only'),
    currentSpecRevision: DIGEST_B, acceptanceIds: acceptanceIds(), newMainSha: SHA_A,
    newMainTreeSha: SHA_B, evidenceRefs: [DIGEST_C], expectedProviderState: 'OPEN' });
  expect(disposition.kind).toBe('progressed');
  expect(disposition.blockers).toContain('plan-progress-only');
});

test('unexpected reopen is authorized only by the exact PR merge closer', () => {
  expect(decideUnexpectedIssueReopen({ repository: REPOSITORY, issueNumber: 346,
    issueState: 'CLOSED', authorizedIssueNumbers: [], closer: { repository: REPOSITORY,
      prNumber: 351, mergeCommitSha: SHA_A }, expectedPrNumber: 351,
  expectedMergeCommitSha: SHA_A })).toEqual({ decision: 'manual-reopen-required',
    reason: 'exact-pr-merge-caused-unauthorized-close-but-provider-conditional-write-is-unsupported' });
  expect(decideUnexpectedIssueReopen({ repository: REPOSITORY, issueNumber: 346,
    issueState: 'CLOSED', authorizedIssueNumbers: [], closer: null,
    expectedPrNumber: 351, expectedMergeCommitSha: SHA_A }).decision).toBe('blocked');
  expect(decideUnexpectedIssueReopen({ repository: REPOSITORY, issueNumber: 346,
    issueState: 'CLOSED', authorizedIssueNumbers: [346], closer: null,
    expectedPrNumber: 351, expectedMergeCommitSha: SHA_A }).decision).toBe('no-op');
});
