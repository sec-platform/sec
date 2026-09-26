import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { sha256 } from '../../src/contracts/canonical.ts';
import { parseExactCommentRetirement } from '../../src/adapters/self-hosting/control/repository-maintenance/comment-retirement-contract.ts';
import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { parseRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
import { planRepositoryMaintenance } from '../../src/adapters/self-hosting/control/repository-maintenance/plan.ts';

import { assertHostedRepositoryMaintenanceIdentity, parseHostedRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts';

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

test('hosted maintenance binds event, repository, ref, checkout and workflow revision independently', () => {
  const plan = planRepositoryMaintenance(parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1', repository: 'sec-platform/sec', expectedMainSha: MAIN,
    operations: [{ kind: 'closed-pr-retirement', pullRequestNumber: 631, reviewCommentId: null }]
  })));
  const environment = {
    GITHUB_EVENT_NAME: 'repository_dispatch',
    SEC_MAINTENANCE_EVENT_TYPE: 'sec-repository-maintenance-v1',
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: MAIN,
    GITHUB_WORKFLOW_SHA: MAIN,
    GITHUB_WORKFLOW_REF: 'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main'
  };
  expect(() => assertHostedRepositoryMaintenanceIdentity(plan, environment)).not.toThrow();
  for (const key of Object.keys(environment)) {
    for (const value of [undefined, '', 'different']) {
      expect(() => assertHostedRepositoryMaintenanceIdentity(plan, { ...environment, [key]: value })).toThrow();
    }
  }
});

test('maintenance rejects duplicate comment identities before admitting any operation', () => {
  const comment = { commentId: 42, expectedAuthorLogin: 'bot', expectedBodyDigest: sha256('notice'), reason: 'automation-noise' };
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1', repository: 'sec-platform/sec', expectedMainSha: MAIN,
    operations: [
      { kind: 'closed-pr-retirement', pullRequestNumber: 629, reviewCommentId: null },
      { kind: 'closed-conversation-comment-retirement', issueNumber: 630, comments: [comment, comment] }
    ]
  }))).toThrow('duplicate comment ids');
});

test('comment retirement reason is a literal enum, never a string-coercible object', () => {
  expect(() => parseExactCommentRetirement({
    commentId: 42, expectedAuthorLogin: 'bot', expectedBodyDigest: sha256('notice'),
    reason: { toString: () => 'automation-noise' }
  })).toThrow('reason is invalid');
});

test('hosted input binds the complete canonical request and never repairs digest or identity drift', () => {
  // Independent wire vector: explicitly sorted JSON hashed by the host primitive,
  // not an expected digest produced by the request decoder under test.
  const source = `{"expectedMainSha":"${MAIN}","operations":[{"kind":"closed-pr-retirement","pullRequestNumber":631,"reviewCommentId":null}],"repository":"sec-platform/sec","schema":"sec-repository-maintenance-request-v1"}`;
  const environment = {
    GITHUB_EVENT_NAME: 'repository_dispatch',
    SEC_MAINTENANCE_EVENT_TYPE: 'sec-repository-maintenance-v1',
    GITHUB_REPOSITORY: 'sec-platform/sec', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: MAIN, GITHUB_WORKFLOW_SHA: MAIN,
    GITHUB_WORKFLOW_REF: 'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    SEC_MAINTENANCE_REQUEST_JSON: source,
    SEC_MAINTENANCE_REQUEST_DIGEST: `sha256:${createHash('sha256').update(source).digest('hex')}`
  };
  expect(parseHostedRepositoryMaintenanceRequest(environment)).toEqual(JSON.parse(source));
  expect(parseHostedRepositoryMaintenanceRequest({ ...environment, SEC_MAINTENANCE_REQUEST_JSON: `\n${source}\n` }))
    .toEqual(JSON.parse(source));
  for (const changed of [
    { SEC_MAINTENANCE_REQUEST_JSON: undefined },
    { SEC_MAINTENANCE_REQUEST_JSON: ' '.repeat(131073) },
    { SEC_MAINTENANCE_REQUEST_JSON: source.replace('631', '632') },
    { SEC_MAINTENANCE_REQUEST_DIGEST: undefined },
    { SEC_MAINTENANCE_REQUEST_DIGEST: `sha256:${'0'.repeat(64)}` },
    { GITHUB_WORKFLOW_SHA: '2'.repeat(40) },
    { GITHUB_SHA: '2'.repeat(40) }
  ]) {
    expect(() => parseHostedRepositoryMaintenanceRequest({ ...environment, ...changed })).toThrow();
  }
});
