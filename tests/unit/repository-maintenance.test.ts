import { expect, test } from 'bun:test';
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isRepositoryMaintenancePermission } from '../../src/adapters/providers/github-api/repository-maintenance-permission.ts';
import { readLinuxRetainedFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts';
import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { parseExactRemoteRefRecoveryPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { parseRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
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

function batchSource(count = 1): string {
  const value = JSON.parse(requestSource());
  value.schema = 'sec-repository-maintenance-request-v2';
  value.operations = Array.from({ length: count }, (_, index) => ({
    kind: 'exact-ref-retirement',
    retirement: { classification: 'main-tree-identical', branches: [`fix/old-${index}`], expectedHeadSha: 'b'.repeat(40) }
  }));
  return JSON.stringify(value);
}

test('shared maintenance permission predicate accepts only qualified maintain/admin roles', () => {
  for (const role of ['admin', 'maintain']) expect(isRepositoryMaintenancePermission(role)).toBe(true);
  for (const role of ['OWNER', 'MEMBER', 'write', 'triage', 'read', 'none', '', null, undefined, {}, ['admin']]) {
    expect(isRepositoryMaintenancePermission(role)).toBe(false);
  }
});

test('v2 batch rejects duplicates, mixed lanes and unbounded or malformed requests', () => {
  expect(parseRepositoryMaintenanceRequest(batchSource(64)).operations).toHaveLength(64);
  expect(() => parseRepositoryMaintenanceRequest(batchSource(65))).toThrow('1..64');
  const value = JSON.parse(batchSource());
  value.operations.push(value.operations[0]);
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('duplicate branch');
  value.operations = [];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('1..64');
  value.operations = [{ kind: 'exact-comment-retirement', retirement: {
    issueNumber: 313, commentId: 42, expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
  }}];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('only an exact ref batch');
  const unknown = { ...JSON.parse(batchSource()), authority: 'admin' };
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(unknown))).toThrow('fields');
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


test('v4 reviews belong only to immutable v2 plans; legacy comments remain readable', () => {
  const request = JSON.parse(batchSource());
  request.operations[0].retirement = {
    classification: 'reviewed-plan-superseded', branches: ['fix/old-0'], expectedHeadSha: 'b'.repeat(40),
    review: { kind: 'branch-supersession-review', version: 4, repository: 'sec-platform/sec',
      branch: 'fix/old-0', headSha: 'b'.repeat(40), headTreeSha: 'c'.repeat(40),
      currentMainSha: MAIN, currentMainTreeSha: 'd'.repeat(40), mergeBaseSha: 'e'.repeat(40),
      mergeBaseTreeSha: 'f'.repeat(40), reviewer: 'Review explanation, not an authenticated actor',
      verdict: 'approved', sourcePathSet: { count: 1, digest: 'sha256:' + '1'.repeat(64) },
      assessment: 'Exact source disposition adopted by the authenticated plan maintainer.', unknowns: [] }
  };
  expect(parseRepositoryMaintenanceRequest(JSON.stringify(request)).operations).toHaveLength(1);
  request.schema = 'sec-repository-maintenance-request-v1';
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(request))).toThrow('require a v2 batch');
  const legacy = JSON.parse(requestSource());
  legacy.schema = 'sec-repository-maintenance-request-v2';
  legacy.operations[0].retirement = { classification: 'reviewed-superseded', branches: ['fix/old-0'],
    expectedHeadSha: 'b'.repeat(40), reviewIssueNumber: 313, reviewCommentId: 42 };
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(legacy))).toThrow('not mutable comment reviews');
});


test('the physical bounded reader rejects growth after its initial size observation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-input-growth-'));
  const file = path.join(root, 'request.json');
  writeFileSync(file, '{}');
  const fd = openSync(file, 'r');
  try {
    let observations = 0;
    expect(() => readLinuxRetainedFile(fd, 'maintenance request growth fixture', 8, () => {
      observations += 1;
      if (observations === 2) appendFileSync(file, ' '.repeat(9));
    })).toThrow('bounded no-follow read size');
    expect(observations).toBeGreaterThanOrEqual(2);
  } finally { closeSync(fd); rmSync(root, { recursive: true, force: true }); }
});
