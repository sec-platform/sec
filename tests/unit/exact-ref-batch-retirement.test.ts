import { expect, test } from 'bun:test';
import { assertGitHubApiMaintenanceRequest, executeGitHubApiOperation } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  assertPlannedRefSupersessionEvidence
} from '../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts';
import {
  decideExactRefBatchContinuation, parseExactRefRetirement, parsePlannedRefSupersessionReview
} from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { parseExactRemoteRefBatchRecoveryPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const HEAD = 'b'.repeat(40);
const MAIN = 'a'.repeat(40);
const review = {
  kind: 'branch-supersession-review', version: 4, repository: 'sec-platform/sec',
  branch: 'fix/old', headSha: HEAD, headTreeSha: 'c'.repeat(40),
  currentMainSha: MAIN, currentMainTreeSha: 'd'.repeat(40), mergeBaseSha: 'e'.repeat(40),
  mergeBaseTreeSha: 'f'.repeat(40), reviewer: 'source review', verdict: 'approved',
  sourcePathSet: { count: 2, digest: `sha256:${'1'.repeat(64)}` },
  assessment: 'All exact source changes have a retained or superseding consumer.', unknowns: []
};

function preparation() {
  const retirements = [parseExactRefRetirement({ classification: 'reviewed-plan-superseded',
    branches: ['fix/old'], expectedHeadSha: HEAD, review })];
  const request = { schema: 'sec-repository-maintenance-request-v2', repository: 'sec-platform/sec',
    expectedMainSha: MAIN, operations: retirements.map((retirement) => ({ kind: 'exact-ref-retirement', retirement })) };
  return { schema: 'sec-exact-ref-batch-recovery-preparation-v1', repository: request.repository,
    expectedMainSha: MAIN, requestDigest: sha256(request), retirements,
    refs: [{ branch: 'fix/old', expectedHeadSha: HEAD, refState: 'present', blocker: null }],
    recovery: { bundleName: 'sec-branch-closeout-batch-plan.bundle', sha256: `sha256:${'2'.repeat(64)}`,
      verifyOutput: 'complete native bundle' } };
}

test('fixed batch preparation rejects changed plans, duplicate refs and incomplete source review', () => {
  expect(parseExactRemoteRefBatchRecoveryPreparation(preparation()).refs).toHaveLength(1);
  expect(() => parsePlannedRefSupersessionReview({ ...review, unknowns: ['unread source'] })).toThrow();
  expect(() => parsePlannedRefSupersessionReview({ ...review, issueNumber: 313 })).toThrow();
  expect(() => parseExactRefRetirement({ classification: 'reviewed-plan-superseded',
    branches: ['fix/other'], expectedHeadSha: HEAD, review })).toThrow('differs');
  const changed = preparation();
  changed.refs[0]!.expectedHeadSha = MAIN;
  expect(() => parseExactRemoteRefBatchRecoveryPreparation(changed)).toThrow('differs');
  const duplicated = preparation();
  duplicated.retirements.push(duplicated.retirements[0]!);
  duplicated.refs.push(duplicated.refs[0]!);
  expect(() => parseExactRemoteRefBatchRecoveryPreparation(duplicated)).toThrow('duplicate');
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...preparation(), requestDigest: `sha256:${'3'.repeat(64)}` }))
    .toThrow('fixed dispatch');
});

test('resume does not equate absence with successful CAS or replay a recreated exact OID', () => {
  const base = { mode: 'fresh' as const, preparedState: 'present' as const, expectedHeadSha: HEAD,
    absenceObserved: false, recreationObserved: false };
  expect(decideExactRefBatchContinuation({ ...base, currentHeadSha: HEAD, priorEffect: 'not-started' })).toBe('delete-cas');
  expect(decideExactRefBatchContinuation({ ...base, currentHeadSha: null, priorEffect: 'not-started' })).toBe('absent-unattributed');
  expect(decideExactRefBatchContinuation({ ...base, currentHeadSha: null, priorEffect: 'started' })).toBe('converged-observed');
  for (const priorEffect of ['returned', 'settled'] as const) {
    expect(decideExactRefBatchContinuation({ ...base, currentHeadSha: null, priorEffect })).toBe('retired');
  }
  for (const priorEffect of ['started', 'returned', 'settled'] as const) {
    for (const preparedState of ['present', 'absent'] as const) {
      expect(decideExactRefBatchContinuation({ ...base, preparedState, currentHeadSha: HEAD, priorEffect })).toBe('blocked-recreation');
    }
  }
  expect(decideExactRefBatchContinuation({ ...base, preparedState: 'absent', currentHeadSha: HEAD,
    priorEffect: 'not-started' })).toBe('blocked-recreation');
  expect(decideExactRefBatchContinuation({ ...base, currentHeadSha: MAIN, priorEffect: 'not-started' })).toBe('blocked-drift');
  expect(decideExactRefBatchContinuation({ ...base, preparedState: 'unknown', currentHeadSha: HEAD,
    priorEffect: 'not-started' })).toBe('delete-cas');
  expect(decideExactRefBatchContinuation({ ...base, preparedState: 'unknown', currentHeadSha: null,
    priorEffect: 'not-started' })).toBe('absent-unattributed');
});

test('review prose, copied evidence and test capabilities cannot authenticate a native maintenance plan', async () => {
  expect(() => assertPlannedRefSupersessionEvidence({ review: parsePlannedRefSupersessionReview(review),
    author: 'maintainer', requestDigest: preparation().requestDigest, receiptDigest: `sha256:${'0'.repeat(64)}` })).toThrow('owner observation');
  let called = false;
  const capability = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', token: 'test-token-0123456789',
    principal: { transport: 'github-rest-token', login: 'maintainer', nodeId: 'test', userId: 1, permission: 'admin' },
    effect: 'read', transport: async () => { called = true; throw new Error('must not call provider'); } });
  await withGitHubApiTestSession({ capability, operation: async () => {
    expect(() => assertGitHubApiMaintenanceRequest(capability, preparation().requestDigest)).toThrow('authenticated exact');
    await expect(executeGitHubApiOperation(capability, { kind: 'maintenance-artifact', artifactId: '1' })).rejects.toThrow('authenticated read');
  } });
  expect(called).toBe(false);
});

test('resume continuation is effect-free for every finite state combination, including stale or forked histories', () => {
  for (const preparedState of ['present', 'absent', 'unknown'] as const) {
    for (const currentHeadSha of [null, HEAD, MAIN]) {
      for (const priorEffect of ['not-started', 'started', 'returned', 'settled'] as const) {
        for (const absenceObserved of [false, true]) {
          for (const recreationObserved of [false, true]) {
            expect(decideExactRefBatchContinuation({ mode: 'resume', preparedState, currentHeadSha,
              expectedHeadSha: HEAD, priorEffect, absenceObserved, recreationObserved })).not.toBe('delete-cas');
          }
        }
      }
    }
  }
});


test('preparation v2 preserves historical absence independently of the latest present state and reads v1 conservatively', () => {
  const legacy = preparation();
  expect(parseExactRemoteRefBatchRecoveryPreparation(legacy).refs[0]!.absenceObserved).toBe(false);
  const current = { ...legacy, schema: 'sec-exact-ref-batch-recovery-preparation-v2',
    refs: legacy.refs.map((row) => ({ ...row, absenceObserved: true })) };
  expect(parseExactRemoteRefBatchRecoveryPreparation(current).refs[0]).toMatchObject({ refState: 'present', absenceObserved: true });
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...current,
    refs: current.refs.map((row) => ({ ...row, refState: 'absent', absenceObserved: false })) })).toThrow('exact plan');
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...current,
    refs: legacy.refs })).toThrow('fields');
});
