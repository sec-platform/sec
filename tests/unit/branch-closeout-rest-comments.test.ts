import { expect, test } from 'bun:test';

import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
  bindCloseoutReceiptObservations,
  branchLifecycleDigest,
  parseRestCloseoutReceiptCommentCandidates,
  renderPublishedBranchCloseoutReceiptComment,
  validateBranchCloseoutReceiptForPublication,
  type BranchLifecycleContext,
  type BranchPublishedCloseoutReceiptV1,
  type BranchPullRequestObservation
} from '../../scripts/codex/branch-lifecycle.ts';

const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

function commandResult(
  stdout: unknown = '',
  status = 0,
  stderr = ''
): { status: number; stdout: Buffer; stderr: Buffer } {
  return {
    status,
    stdout: Buffer.from(typeof stdout === 'string' ? stdout : JSON.stringify(stdout)),
    stderr: Buffer.from(stderr)
  };
}

function publishedReceipt(): BranchPublishedCloseoutReceiptV1 {
  const payload: Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
    repository: 'sec-platform/sec',
    pullRequest: 42,
    branch: 'feat/example',
    preparedHeadSha: HEAD_SHA,
    preparationDigest: DIGEST_A,
    recoveryDigest: DIGEST_B,
    disposition: 'merged',
    durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` },
    authorization: {
      remoteAction: 'already-absent',
      localAction: 'already-absent'
    },
    attempts: [
      'recovery-create',
      'recovery-verify',
      'remote-delete',
      'local-delete',
      'prune',
      'readback'
    ].map((operation) => ({
      operation: operation as BranchPublishedCloseoutReceiptV1['attempts'][number]['operation'],
      status: 'success' as const,
      detailDigest: branchLifecycleDigest({ detail: `${operation} ok` })
    })),
    readback: {
      mainRemoteSha: MAIN_SHA,
      remoteBranchSha: null,
      localBranchSha: null,
      boundWorktreeCount: 0,
      unknownCount: 0
    },
    closeoutStatus: 'completed',
    mainSha: MAIN_SHA,
    receiptDigest: DIGEST_C
  };
  return { ...payload, publicationDigest: branchLifecycleDigest(payload) };
}

function restComment(
  id: number,
  body: string,
  login: string | null,
  association = 'MEMBER'
): Record<string, unknown> {
  return {
    id,
    body,
    user: login === null ? null : { login },
    author_association: association
  };
}

function pullRequest(): BranchPullRequestObservation {
  return {
    number: 42,
    headBranch: 'feat/example',
    headSha: HEAD_SHA,
    baseBranch: 'main',
    baseSha: MAIN_SHA,
    state: 'merged',
    isDraft: false,
    isCrossRepository: false,
    url: 'https://github.com/sec-platform/sec/pull/42',
    closeoutReceiptCommentCandidates: []
  };
}

test('REST parser flattens all pages and ignores unrelated/deleted-author comments', () => {
  const receiptBody = renderPublishedBranchCloseoutReceiptComment(publishedReceipt());
  const source = JSON.stringify([
    [
      restComment(1, 'ordinary discussion', 'user-a'),
      restComment(2, receiptBody, null)
    ],
    [restComment(3, receiptBody, 'QzCrane')]
  ]);
  expect(parseRestCloseoutReceiptCommentCandidates(source, 42)).toEqual([{
    body: receiptBody,
    author: 'QzCrane',
    authorAssociation: 'MEMBER'
  }]);
});

test('required merged PR consumes paginated REST comments and live maintainer permission', () => {
  const receipt = publishedReceipt();
  const body = renderPublishedBranchCloseoutReceiptComment(receipt);
  const calls: string[] = [];
  const ctx: BranchLifecycleContext = {
    repositoryRoot: '/workspace/sec',
    run: (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (command === 'git' && args[0] === 'cat-file') return commandResult();
      if (command === 'gh' && args.includes('--paginate')) {
        return commandResult([[restComment(3, body, 'QzCrane')]]);
      }
      if (command === 'gh' && args.some((arg) => arg.endsWith('/permission'))) {
        return commandResult('maintain');
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }
  };
  const [bound] = bindCloseoutReceiptObservations(
    ctx,
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequest()]
  );
  expect(bound?.closeoutReceipt).toEqual({
    requirement: 'required',
    status: 'present',
    receipt,
    reason: null
  });
  expect(calls.some((call) => call.includes('--paginate --slurp'))).toBe(true);
});

test('paginated comment read failure produces unknown, not a false missing receipt', () => {
  const ctx: BranchLifecycleContext = {
    repositoryRoot: '/workspace/sec',
    run: (command, args) => {
      if (command === 'git' && args[0] === 'cat-file') return commandResult();
      if (command === 'gh' && args.includes('--paginate')) {
        return commandResult('', 1, 'network unavailable');
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }
  };
  const [bound] = bindCloseoutReceiptObservations(
    ctx,
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequest()]
  );
  expect(bound?.closeoutReceipt?.status).toBe('unknown');
  expect(bound?.closeoutReceipt?.reason).toContain('comment inventory failed');
});

test('formal publication rejects a fabricated full receipt before projection', () => {
  expect(() => validateBranchCloseoutReceiptForPublication({
    schema: 'sec-branch-closeout-receipt-v1',
    receiptDigest: DIGEST_A
  } as never)).toThrow();
});
