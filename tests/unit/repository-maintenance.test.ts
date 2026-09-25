import { expect, test } from 'bun:test';

import { sha256 } from '../../src/contracts/canonical.ts';
import { parseExactCommentRetirement } from '../../src/adapters/self-hosting/control/repository-maintenance/comment-retirement.ts';
import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { parseRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
import { planRepositoryMaintenance } from '../../src/adapters/self-hosting/control/repository-maintenance/plan.ts';

const MAIN = '1'.repeat(40);

test('repository maintenance parser accepts only governed retirement operations', () => {
  const comment = {
    commentId: 42,
    expectedAuthorLogin: 'chatgpt-codex-connector[bot]',
    expectedBodyDigest: sha256('provider notice'),
    reason: 'automation-noise'
  } as const;
  const request = parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [
      { kind: 'exact-ref-retirement', retirement: { classification: 'transport-only', branches: ['transport/old'], expectedHeadSha: MAIN } },
      { kind: 'closed-pr-retirement', pullRequestNumber: 629, reviewCommentId: null },
      { kind: 'closed-conversation-comment-retirement', issueNumber: 630, comments: [comment] }
    ]
  }));
  expect(request.operations).toHaveLength(3);
  const plan = planRepositoryMaintenance(request);
  expect(plan).toMatchObject({
    schema: 'sec-repository-maintenance-plan-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN
  });
  expect(plan.steps).toEqual(request.operations);
  expect(request.operations[0]).toEqual({ kind: 'exact-ref-retirement', retirement: parseExactRefRetirement({
    classification: 'transport-only', branches: ['transport/old'], expectedHeadSha: MAIN
  }) });
  expect(request.operations[2]).toEqual({
    kind: 'closed-conversation-comment-retirement', issueNumber: 630,
    comments: [parseExactCommentRetirement(comment)]
  });
});

test('repository maintenance parser rejects unknown generic ref deletion and comment drift fields', () => {
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1', repository: 'sec-platform/sec', expectedMainSha: MAIN,
    operations: [{ kind: 'delete-ref', branch: 'main', sha: MAIN }]
  }))).toThrow('maintenance operation kind is unknown');
  expect(() => parseExactCommentRetirement({
    commentId: 1, expectedAuthorLogin: 'bot', expectedBodyDigest: sha256('x'), reason: 'automation-noise', force: true
  })).toThrow('fields are invalid');
});


test('exact ref retirement never becomes arbitrary branch deletion', () => {
  expect(() => parseExactRefRetirement({ classification: 'transport-only', branches: ['feat/product'], expectedHeadSha: MAIN }))
    .toThrow('transport-only retirement accepts only transport/* branches');
  expect(() => parseExactRefRetirement({ classification: 'duplicate-transport-alias', branches: ['work/a'], expectedHeadSha: MAIN }))
    .toThrow('requires transport/*');
  expect(parseExactRefRetirement({
    classification: 'duplicate-transport-alias', branches: ['transport/a', 'work/a'], expectedHeadSha: MAIN
  }).branches).toEqual(['transport/a', 'work/a']);
});
