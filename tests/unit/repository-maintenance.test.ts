import { expect, test } from 'bun:test';

import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import {
  parseExactRemoteRefRecoveryPreparation
} from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { parseRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
import {
  assertRepositoryMaintenanceDispatcherPermission,
  createRepositoryMaintenanceDispatchPayload
} from '../../src/adapters/self-hosting/control/repository-maintenance/dispatch.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from '../../src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const MAIN = 'a'.repeat(40);

function requestSource(): string {
  return JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-ref-retirement',
      retirement: {
        classification: 'closed-pr-superseded',
        branches: ['fix/old'],
        expectedHeadSha: 'b'.repeat(40),
        pullRequestNumber: 631
      }
    }]
  });
}

function environment(source = requestSource()): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_EVENT_NAME: 'repository_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: MAIN,
    GITHUB_WORKFLOW_SHA: MAIN,
    GITHUB_WORKFLOW_REF:
      'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    GITHUB_ACTOR: 'maintainer',
    SEC_MAINTENANCE_REQUEST_JSON: source,
    SEC_MAINTENANCE_ISSUE_NUMBER: '313',
    SEC_MAINTENANCE_COMMENT_ID: '42',
    SEC_MAINTENANCE_COMMENT_AUTHOR: 'maintainer',
    SEC_MAINTENANCE_AUTHOR_ASSOCIATION: 'MEMBER'
  };
}

test('maintenance dispatcher requires current maintain/admin before creating a workflow signal', () => {
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'admin' })).toBe('admin');
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'maintain' })).toBe('maintain');
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'write', role_name: 'maintain' }))
    .toBe('maintain');
  for (const value of [
    { permission: 'write' },
    { permission: 'admin', role_name: 'custom-maintainer' },
    { permission: 'triage' },
    { permission: 'read' },
    { permission: 'none' },
    {},
    null
  ]) {
    expect(() => assertRepositoryMaintenanceDispatcherPermission(value))
      .toThrow(/maintain\/admin permission|must be one object/u);
  }
});

test('maintenance dispatch payload carries only exact lifecycle comment locator and raw digest', () => {
  const payload = createRepositoryMaintenanceDispatchPayload({
    issueNumber: 313,
    commentId: 42,
    commentBody: requestSource()
  });
  expect(payload).toEqual({
    event_type: 'sec-repository-maintenance-v2',
    client_payload: {
      schema: 'sec-repository-maintenance-dispatch-v1',
      issue_number: 313,
      comment_id: 42,
      comment_body_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    }
  });
  expect(JSON.stringify(payload)).not.toContain('expectedMainSha');
  expect(() => createRepositoryMaintenanceDispatchPayload({
    issueNumber: 312,
    commentId: 42,
    commentBody: requestSource()
  })).toThrow('identity is invalid');
});

test('maintenance request accepts one exact ref or bounded exact comment batch', () => {
  const parsed = parseRepositoryMaintenanceRequest(requestSource());
  expect(parsed.operations).toHaveLength(1);
  expect(parsed.operations[0]!.retirement).toEqual(parseExactRefRetirement({
    classification: 'closed-pr-superseded',
    branches: ['fix/old'],
    expectedHeadSha: 'b'.repeat(40),
    pullRequestNumber: 631
  }));
  expect(() => parseExactRefRetirement({
    classification: 'closed-pr-superseded',
    branches: ['fix/old', 'fix/other'],
    expectedHeadSha: 'b'.repeat(40),
    pullRequestNumber: 631
  })).toThrow('exactly one branch');
  expect(parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['transport/old'],
    expectedHeadSha: 'b'.repeat(40)
  })).toEqual({
    classification: 'transport-only',
    branches: ['transport/old'],
    expectedHeadSha: 'b'.repeat(40)
  });
  expect(() => parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['transport/one', 'transport/two'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('exactly one branch');
  expect(() => parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['fix/old'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('transport/*');
  expect(parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  })).toEqual({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  });
  expect(() => parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/one', 'fix/two'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('exactly one branch');
  const multi = JSON.parse(requestSource()) as Record<string, unknown>;
  const operations = multi.operations as unknown[];
  multi.operations = [...operations, ...operations];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(multi)))
    .toThrow('exact ref retirement must remain one-operation-per-request');

  const expectedBodyDigest = `sha256:${'c'.repeat(64)}` as const;
  const comment = parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [42, 43].map((commentId) => ({
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId,
        expectedBodyDigest
      }
    }))
  }));
  expect(comment.operations).toEqual([42, 43].map((commentId) => ({
    kind: 'exact-comment-retirement',
    retirement: {
      issueNumber: 313,
      commentId,
      expectedBodyDigest
    }
  })));

  const duplicate = JSON.parse(JSON.stringify(comment)) as Record<string, unknown>;
  duplicate.operations = [
    (comment.operations as readonly unknown[])[0],
    (comment.operations as readonly unknown[])[0]
  ];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(duplicate)))
    .toThrow('duplicate comment identity');

  const mixed = JSON.parse(requestSource()) as Record<string, unknown>;
  mixed.operations = [
    ...(mixed.operations as unknown[]),
    (comment.operations as readonly unknown[])[0]
  ];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(mixed)))
    .toThrow('exact ref retirement must remain one-operation-per-request');

  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: Array.from({ length: 65 }, (_, index) => ({
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId: index + 1,
        expectedBodyDigest: 'sha256:' + 'd'.repeat(64)
      }
    }))
  }))).toThrow('1..64 operations');
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId: 0,
        expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
      }
    }]
  }))).toThrow('commentId');
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 650,
        commentId: 42,
        expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
      }
    }]
  }))).toThrow('restricted to lifecycle issue #313');
});

test('exact ref recovery preparation binds request identity, ref state and bundle digest', () => {
  const retirement = parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  });
  const parsed = parseExactRemoteRefRecoveryPreparation({
    schema: 'sec-exact-ref-retirement-recovery-preparation-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    retirement,
    refState: 'present',
    recovery: {
      bundleName: 'sec-branch-closeout-1234-99-123e4567-e89b-12d3-a456-426614174000.bundle',
      sha256: `sha256:${'c'.repeat(64)}` as const,
      verifyOutput: 'verified'
    }
  });
  expect(parsed).toEqual({
    schema: 'sec-exact-ref-retirement-recovery-preparation-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    retirement,
    refState: 'present',
    recovery: {
      bundleName: 'sec-branch-closeout-1234-99-123e4567-e89b-12d3-a456-426614174000.bundle',
      sha256: `sha256:${'c'.repeat(64)}` as const,
      verifyOutput: 'verified'
    }
  });
  expect(() => parseExactRemoteRefRecoveryPreparation({
    ...parsed,
    refState: 'moved'
  })).toThrow('identity is invalid');
  expect(() => parseExactRemoteRefRecoveryPreparation({
    ...parsed,
    recovery: {
      ...parsed.recovery,
      bundleName: '../escape.bundle'
    }
  })).toThrow('bundle identity is invalid');
});

test('hosted maintenance binds exact main workflow, lifecycle issue and maintainer event identity', () => {
  const request = parseRepositoryMaintenanceRequest(requestSource());
  expect(() => assertHostedRepositoryMaintenanceIdentity(request, environment())).not.toThrow();
  for (const changed of [
    { GITHUB_EVENT_NAME: 'issue_comment' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_SHA: 'c'.repeat(40) },
    { GITHUB_WORKFLOW_SHA: 'c'.repeat(40) },
    { SEC_MAINTENANCE_ISSUE_NUMBER: '312' },
    { SEC_MAINTENANCE_COMMENT_ID: '0' },
    { SEC_MAINTENANCE_AUTHOR_ASSOCIATION: 'CONTRIBUTOR' },
    { GITHUB_ACTOR: 'other' }
  ]) {
    expect(() => assertHostedRepositoryMaintenanceIdentity(
      request,
      { ...environment(), ...changed }
    )).toThrow();
  }
});

test('hosted request is parsed from the exact issue comment body without repair', () => {
  const source = requestSource();
  expect(parseHostedRepositoryMaintenanceRequest(environment(source)))
    .toEqual(JSON.parse(source));
  expect(() => parseHostedRepositoryMaintenanceRequest(
    environment(source.replace('fix/old', 'fix/changed'))
  )).not.toThrow();
  expect(() => parseHostedRepositoryMaintenanceRequest({
    ...environment(source),
    SEC_MAINTENANCE_REQUEST_JSON: undefined
  })).toThrow('absent');
});

test('canonical maintenance request digest changes with exact ref identity', () => {
  const left = parseRepositoryMaintenanceRequest(requestSource());
  const right = parseRepositoryMaintenanceRequest(
    requestSource().replace('b'.repeat(40), 'c'.repeat(40))
  );
  expect(sha256(left)).not.toBe(sha256(right));
});


test('reviewed superseded ref retirement is single-ref and bound to lifecycle issue evidence', () => {
  const request = {
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-ref-retirement',
      retirement: {
        classification: 'reviewed-superseded',
        branches: ['fix/orphan'],
        expectedHeadSha: 'b'.repeat(40),
        reviewIssueNumber: 313,
        reviewCommentId: 9001
      }
    }]
  };
  expect(parseRepositoryMaintenanceRequest(JSON.stringify(request)).operations[0]).toEqual({
    kind: 'exact-ref-retirement',
    retirement: {
      classification: 'reviewed-superseded',
      branches: ['fix/orphan'],
      expectedHeadSha: 'b'.repeat(40),
      reviewIssueNumber: 313,
      reviewCommentId: 9001
    }
  });
  const wrongIssue = structuredClone(request);
  wrongIssue.operations[0]!.retirement.reviewIssueNumber = 312;
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(wrongIssue)))
    .toThrow('restricted to lifecycle issue #313');
  const multiple = structuredClone(request);
  multiple.operations[0]!.retirement.branches = ['fix/orphan', 'fix/other'];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(multiple)))
    .toThrow('exactly one branch');
});
