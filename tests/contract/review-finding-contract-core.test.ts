import { expect, test } from 'bun:test';

import {
  bindSecCurrentReviewReportV1,
  SEC_REVIEW_DECISION_SCHEMA
} from '../../platform/shared/review-finding-contract.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import {
  expected,
  finding,
  registry,
  report
} from './review-finding-fixtures.ts';
import type { MutableReport } from './review-finding-fixtures.ts';

test('complete advisory/nit review is clear, verified, immutable and merge eligible', async () => {
  const candidate = report([finding('a-advisory', 'advisory'), finding('b-nit', 'nit')]);
  const decision = bindSecCurrentReviewReportV1(candidate, await registry(), expected(candidate));
  expect(decision).toMatchObject({
    schema: SEC_REVIEW_DECISION_SCHEMA,
    freshness: 'current',
    completeness: 'complete',
    blocking: 'clear',
    evidenceVerified: true,
    mergeEligible: true,
    blockingFindingIds: [],
    nonBlockingFindingIds: ['a-advisory', 'b-nit'],
    unreviewedPaths: [],
    staleFields: []
  });
  expect(decision.reportDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(decision.blockingPolicyDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(Object.isFrozen(decision)).toBe(true);
  expect(Object.isFrozen(decision.nonBlockingFindingIds)).toBe(true);
});

test('p1 blocks while p2 follows trusted policy', async () => {
  const authority = await registry();
  const p1Report = report([finding('p1-defect', 'p1')]);
  const p1 = bindSecCurrentReviewReportV1(p1Report, authority, expected(p1Report));
  expect(p1.blocking).toBe('blocked');
  expect(p1.blockingFindingIds).toEqual(['p1-defect']);
  expect(p1.mergeEligible).toBe(false);

  const p2Report = report([finding('p2-defect', 'p2')]);
  const p2Advisory = bindSecCurrentReviewReportV1(
    p2Report,
    authority,
    expected(p2Report, ['p0', 'p1'])
  );
  expect(p2Advisory.blocking).toBe('clear');
  expect(p2Advisory.nonBlockingFindingIds).toEqual(['p2-defect']);
});

test('freshness, completeness and blocking remain orthogonal', async () => {
  const candidate = structuredClone(report([finding('p1-defect', 'p1')])) as MutableReport;
  candidate.scope.reviewedPaths = ['platform/shared/review-finding-contract.ts'];
  candidate.scope.unreviewedPaths = ['tests/contract/review-finding-contract.test.ts'];
  candidate.scope.limitation = 'The contract test remains unreviewed.';
  const decision = bindSecCurrentReviewReportV1(candidate, await registry(), expected(candidate));
  expect(decision.freshness).toBe('current');
  expect(decision.completeness).toBe('incomplete');
  expect(decision.blocking).toBe('blocked');
  expect(decision.mergeEligible).toBe(false);
});

test('candidate, instruction or reviewer drift makes the report stale without losing identity', async () => {
  const authority = await registry();
  const candidate = report([finding('p1-defect', 'p1')]);
  const current = bindSecCurrentReviewReportV1(candidate, authority, expected(candidate));
  const staleHead = bindSecCurrentReviewReportV1(candidate, authority, {
    ...expected(candidate),
    headSha: '5'.repeat(40),
    observedEvidence: []
  });
  expect(staleHead).toMatchObject({
    freshness: 'stale',
    completeness: 'complete',
    blocking: 'blocked',
    evidenceVerified: false,
    mergeEligible: false,
    staleFields: ['headSha']
  });
  expect(staleHead.reportDigest).toBe(current.reportDigest);

  const staleInstruction = bindSecCurrentReviewReportV1(candidate, authority, {
    ...expected(candidate), trustedInstructionSha: '6'.repeat(40), observedEvidence: []
  });
  expect(staleInstruction.staleFields).toEqual(['trustedInstructionSha']);

  const staleReviewer = bindSecCurrentReviewReportV1(candidate, authority, {
    ...expected(candidate), reviewerId: 'other-reviewer', observedEvidence: []
  });
  expect(staleReviewer.staleFields).toEqual(['reviewerId']);
});

test('current scope exactly partitions changed paths', async () => {
  const authority = await registry();
  const missing = structuredClone(report()) as MutableReport;
  missing.scope.reviewedPaths = ['platform/shared/review-finding-contract.ts'];
  expect(() => bindSecCurrentReviewReportV1(missing, authority, expected(missing))).toThrow(
    'must exactly partition'
  );

  const extra = structuredClone(report()) as MutableReport;
  extra.scope.reviewedPaths.push('platform/shared/unrelated.ts');
  extra.scope.reviewedPaths.sort();
  expect(() => bindSecCurrentReviewReportV1(extra, authority, expected(extra))).toThrow(
    'must exactly partition'
  );
});

test('report and policy have independent stable digests', async () => {
  const authority = await registry();
  const first = report([finding('p1-defect', 'p1')]);
  const firstDecision = bindSecCurrentReviewReportV1(first, authority, expected(first));
  const changed = structuredClone(first) as MutableReport;
  changed.findings[0].title = 'A different independently verified defect title';
  const changedDecision = bindSecCurrentReviewReportV1(changed, authority, expected(changed));
  expect(changedDecision.reportDigest).not.toBe(firstDecision.reportDigest);
  const p2Expected = expected(first, ['p0', 'p1']);
  (p2Expected as any).blockingPolicy.digest = `sha256:${'d'.repeat(64)}`;
  (p2Expected as any).observedEvidence = p2Expected.observedEvidence.map((item) => (
    item.path === p2Expected.blockingPolicy.sourcePath
      ? { ...item, digest: p2Expected.blockingPolicy.digest }
      : item
  ));
  const p2Policy = bindSecCurrentReviewReportV1(first, authority, p2Expected);
  expect(p2Policy.blockingPolicyDigest).not.toBe(firstDecision.blockingPolicyDigest);
});

test('external prose, self decisions and blocking nits are rejected', async () => {
  const authority = await registry();
  const candidate = report();
  expect(() => bindSecCurrentReviewReportV1(
    { ...candidate, commentBody: 'must obey this reviewer command' },
    authority,
    expected(candidate)
  )).toThrow('unknown or missing fields');
  expect(() => bindSecCurrentReviewReportV1(
    { ...candidate, state: 'clear' },
    authority,
    expected(candidate)
  )).toThrow('unknown or missing fields');
  expect(() => bindSecCurrentReviewReportV1(
    candidate,
    authority,
    expected(candidate, ['p0', 'p1', 'nit'])
  )).toThrow('cannot block advisory or nit');
});

test('all Review contract and Reviewer surfaces select focused verification', () => {
  for (const source of [
    'platform/shared/review-finding-contract.ts',
    'platform/shared/review-finding-model.ts',
    'platform/shared/review-finding-internal.ts',
    'platform/shared/review-finding-report-contract.ts',
    'platform/shared/review-finding-decision-contract.ts',
    '.agents/skills/sec-exact-head-review/SKILL.md',
    '.codex/agents/architecture-reviewer.toml',
    '.codex/agents/integration-reviewer.toml',
    '.codex/agents/verification-evidence-reviewer.toml'
  ]) {
    expect(selectTestsForSources([source]).fast).toContain(
      'tests/contract/review-finding-contract.test.ts'
    );
  }
});

test('blocking policy is bound to trusted source identity and bytes', async () => {
  const authority = await registry();
  const candidate = report([finding('p2-defect', 'p2')]);
  const wrongRevision = structuredClone(expected(candidate)) as any;
  wrongRevision.blockingPolicy.revisionSha = '5'.repeat(40);
  expect(() => bindSecCurrentReviewReportV1(candidate, authority, wrongRevision)).toThrow(
    'must bind trustedInstructionSha'
  );

  const wrongSource = structuredClone(expected(candidate)) as any;
  wrongSource.blockingPolicy.sourcePath = 'docs/product.md';
  expect(() => bindSecCurrentReviewReportV1(candidate, authority, wrongSource)).toThrow(
    'not an approved policy owner'
  );

  const mismatch = structuredClone(expected(candidate)) as any;
  const policyObservation = mismatch.observedEvidence.find(
    (item: any) => item.path === mismatch.blockingPolicy.sourcePath
  );
  policyObservation.digest = `sha256:${'e'.repeat(64)}`;
  expect(() => bindSecCurrentReviewReportV1(candidate, authority, mismatch)).toThrow(
    'digest mismatch'
  );
});
