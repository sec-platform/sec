import { expect, test } from 'bun:test';

import { parseBranchCloseoutReceipt } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { renderPublishedBranchCloseoutReceiptComment } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { parseRestCloseoutReceiptCommentCandidates } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-parsers.ts';
import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,
  type BranchPublishedCloseoutReceipt
} from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';

const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

function publishedReceipt(): BranchPublishedCloseoutReceipt {
  const payload: Omit<BranchPublishedCloseoutReceipt, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,
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
      operation: operation as BranchPublishedCloseoutReceipt['attempts'][number]['operation'],
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

test('REST parser flattens all pages and ignores unrelated/deleted-author comments', () => {
  const receiptBody = renderPublishedBranchCloseoutReceiptComment(publishedReceipt());
  const source = JSON.stringify([
    [
      restComment(1, 'ordinary discussion', 'user-a'),
      restComment(2, receiptBody, null)
    ],
    [restComment(3, receiptBody, 'maintainer')]
  ]);
  expect(parseRestCloseoutReceiptCommentCandidates(source, 42)).toEqual([{
    body: receiptBody,
    author: 'maintainer',
    authorAssociation: 'MEMBER'
  }]);
});

test('formal publication rejects a fabricated full receipt before projection', () => {
  expect(() => parseBranchCloseoutReceipt({
    schema: 'sec-branch-closeout-receipt-v1',
    receiptDigest: DIGEST_A
  } as never)).toThrow();
});
