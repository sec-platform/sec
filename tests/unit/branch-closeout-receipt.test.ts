import { expect, test } from 'bun:test';

import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
  auditBranchLifecycle,
  bindCloseoutReceiptObservations,
  branchLifecycleDigest,
  createPublishedBranchCloseoutReceipt,
  parsePublishedBranchCloseoutReceiptComment,
  publishAndReadBackBranchCloseoutReceipt,
  renderPublishedBranchCloseoutReceiptComment,
  type BranchCloseoutReceipt,
  type BranchCloseoutReceiptObservation,
  type BranchLifecycleCommandRunner,
  type BranchLifecycleContext,
  type BranchLifecycleInventory,
  type BranchPublishedCloseoutReceiptV1,
  type BranchPullRequestObservation
} from '../../scripts/codex/branch-lifecycle.ts';

const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const RECEIPT_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const RECOVERY_DIGEST = `sha256:${'b'.repeat(64)}` as const;
const PREPARATION_DIGEST = `sha256:${'c'.repeat(64)}` as const;

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

function publishedReceipt(
  overrides: Partial<Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'>> = {}
): BranchPublishedCloseoutReceiptV1 {
  const payload: Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
    repository: 'sec-platform/sec',
    pullRequest: 42,
    branch: 'feat/example',
    preparedHeadSha: HEAD_SHA,
    preparationDigest: PREPARATION_DIGEST,
    recoveryDigest: RECOVERY_DIGEST,
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
    receiptDigest: RECEIPT_DIGEST,
    ...overrides
  };
  return { ...payload, publicationDigest: branchLifecycleDigest(payload) };
}

function receiptObservation(
  value: BranchCloseoutReceiptObservation
): BranchCloseoutReceiptObservation {
  return value;
}

function inventory(
  closeoutReceipt: BranchCloseoutReceiptObservation
): BranchLifecycleInventory {
  return {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-08-07T00:00:00.000Z',
    repository: {
      root: '/workspace/sec',
      commonDir: '/workspace/sec/.git',
      fullName: 'sec-platform/sec',
      remote: 'origin',
      remoteUrl: 'https://github.com/sec-platform/sec.git',
      defaultBranch: 'main'
    },
    main: { localSha: MAIN_SHA, remoteSha: MAIN_SHA },
    localBranches: [{ branch: 'main', sha: MAIN_SHA }],
    remoteBranches: [{ branch: 'main', sha: MAIN_SHA }],
    worktrees: [{
      path: '/workspace/sec',
      headSha: MAIN_SHA,
      branch: 'main',
      dirtyCount: 0,
      untrackedCount: 0,
      locked: false,
      prunable: false,
      observation: 'resolved',
      reason: null
    }],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: MAIN_SHA,
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42',
      publishedCloseoutReceipts: closeoutReceipt.receipt ? [closeoutReceipt.receipt] : [],
      invalidCloseoutReceiptComments: [],
      closeoutReceipt
    }],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: {
      observation: 'resolved',
      deleteBranchOnMerge: true,
      reason: null
    },
    pruneConfiguration: {
      observation: 'resolved',
      fetchPrune: true,
      remotePrune: true,
      fetchPruneTags: true,
      reason: null
    },
    unknowns: []
  };
}

function closeoutReceipt(): BranchCloseoutReceipt {
  const snapshot = inventory(receiptObservation({
    requirement: 'not-required',
    status: 'not-required',
    receipt: null,
    reason: null
  }));
  return {
    schema: 'sec-branch-closeout-receipt-v1',
    generatedAt: '2026-08-07T00:01:00.000Z',
    preparation: {
      schema: 'sec-branch-closeout-preparation-v1',
      preparedAt: '2026-08-07T00:00:00.000Z',
      repository: {
        root: '/workspace/sec',
        commonDir: '/workspace/sec/.git',
        fullName: 'sec-platform/sec',
        remote: 'origin',
        defaultBranch: 'main'
      },
      branch: 'feat/example',
      refState: 'present',
      expectedHeadSha: HEAD_SHA,
      expectedRemoteSha: HEAD_SHA,
      expectedLocalSha: null,
      expectedPrHeadSha: null,
      pullRequestNumber: 42,
      pullRequestStateAtPreparation: 'open',
      recovery: {
        kind: 'bundle',
        path: '/recovery/example.bundle',
        sha256: RECOVERY_DIGEST,
        verified: true,
        verifyOutput: 'ok'
      },
      worktreePathsAtPreparation: [],
      preparationDigest: PREPARATION_DIGEST
    },
    request: {
      capability: 'branch-ref-closeout-v1',
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    authorization: {
      branch: 'feat/example',
      classification: 'merged-closeout',
      remoteAction: 'already-absent',
      localAction: 'already-absent',
      blockers: [],
      protections: []
    },
    attempts: [{ operation: 'readback', status: 'success', detail: 'readback ok' }],
    before: snapshot,
    after: snapshot,
    status: 'completed',
    residue: [],
    receiptDigest: RECEIPT_DIGEST
  };
}

function pullRequestWithCandidate(
  body: string,
  author = 'QzCrane'
): BranchPullRequestObservation {
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
    closeoutReceiptCommentCandidates: [{
      body,
      author,
      authorAssociation: 'MEMBER'
    }]
  };
}

function permissionRequest(args: readonly string[]): boolean {
  return args.some((arg) => arg.endsWith('/permission'));
}

function bindingRunner(permission: string | null): BranchLifecycleCommandRunner {
  return (command, args) => {
    expect(command === 'git' || command === 'gh').toBe(true);
    if (command === 'git' && args[0] === 'cat-file') return commandResult();
    if (command === 'gh' && permissionRequest(args)) {
      return permission === null
        ? commandResult('', 1, 'permission lookup unavailable')
        : commandResult(permission);
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
}

function bindingContext(permission: string | null): BranchLifecycleContext {
  return { repositoryRoot: '/workspace/sec', run: bindingRunner(permission) };
}

function restComment(id: number, body: string): Record<string, unknown> {
  return {
    id,
    body,
    user: { login: 'QzCrane' },
    author_association: 'OWNER'
  };
}

test('published closeout receipt comment round-trips byte-exact identity', () => {
  const receipt = publishedReceipt();
  const comment = renderPublishedBranchCloseoutReceiptComment(receipt);
  expect(parsePublishedBranchCloseoutReceiptComment(comment)).toEqual(receipt);
});

test('published closeout receipt rejects payload tampering', () => {
  const receipt = publishedReceipt();
  const comment = renderPublishedBranchCloseoutReceiptComment(receipt)
    .replace('feat/example', 'feat/tampered');
  expect(() => parsePublishedBranchCloseoutReceiptComment(comment))
    .toThrow('publicationDigest mismatch');
});

test('completed receipt cannot hide a remaining remote ref', () => {
  const receipt = publishedReceipt({
    readback: {
      mainRemoteSha: MAIN_SHA,
      remoteBranchSha: HEAD_SHA,
      localBranchSha: null,
      boundWorktreeCount: 0,
      unknownCount: 0
    }
  });
  const comment = `<!-- sec-branch-closeout-receipt-v1 -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``;
  expect(() => parsePublishedBranchCloseoutReceiptComment(comment))
    .toThrow('unresolved branch state');
});

test('legacy PR without enforcement marker remains explicitly not-required', () => {
  const report = auditBranchLifecycle(inventory(receiptObservation({
    requirement: 'not-required',
    status: 'not-required',
    receipt: null,
    reason: null
  })));
  expect(report.status).toBe('clean');
  expect(report.findings.some(({ code }) => code.startsWith('closeout-receipt-'))).toBe(false);
});

test('post-enforcement merged PR without a receipt is lifecycle drift', () => {
  const report = auditBranchLifecycle(inventory(receiptObservation({
    requirement: 'required',
    status: 'missing',
    receipt: null,
    reason: 'no exact receipt'
  })));
  expect(report.status).toBe('drift');
  expect(report.findings.some(({ code }) => code === 'closeout-receipt-missing')).toBe(true);
});

test('post-enforcement merged PR with an exact terminal receipt is clean', () => {
  const receipt = publishedReceipt();
  const report = auditBranchLifecycle(inventory(receiptObservation({
    requirement: 'required',
    status: 'present',
    receipt,
    reason: null
  })));
  expect(report.status).toBe('clean');
  expect(report.findings.some(({ code }) => code.startsWith('closeout-receipt-'))).toBe(false);
});

test('published blocked receipt cannot authorize clean completion', () => {
  const receipt = publishedReceipt({ closeoutStatus: 'blocked' });
  const report = auditBranchLifecycle(inventory(receiptObservation({
    requirement: 'required',
    status: 'present',
    receipt,
    reason: null
  })));
  expect(report.status).toBe('drift');
  expect(report.findings.some(({ code }) => code === 'closeout-receipt-nonterminal')).toBe(true);
});

test('receipt applicability unknown locks lifecycle health', () => {
  const report = auditBranchLifecycle(inventory(receiptObservation({
    requirement: 'unknown',
    status: 'unknown',
    receipt: null,
    reason: 'base commit is unavailable'
  })));
  expect(report.status).toBe('blocked');
  expect(report.findings.some(({ code }) => (
    code === 'closeout-receipt-applicability-unknown'
  ))).toBe(true);
});

test('maintain permission authorizes an exact receipt candidate', () => {
  const receipt = publishedReceipt();
  const [bound] = bindCloseoutReceiptObservations(
    bindingContext('maintain'),
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequestWithCandidate(renderPublishedBranchCloseoutReceiptComment(receipt))]
  );
  expect(bound?.closeoutReceipt).toEqual({
    requirement: 'required',
    status: 'present',
    receipt,
    reason: null
  });
});

test('write permission cannot forge a closeout receipt', () => {
  const receipt = publishedReceipt();
  const [bound] = bindCloseoutReceiptObservations(
    bindingContext('write'),
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequestWithCandidate(renderPublishedBranchCloseoutReceiptComment(receipt))]
  );
  expect(bound?.closeoutReceipt?.status).toBe('missing');
});

test('permission lookup failure makes receipt authority unknown', () => {
  const receipt = publishedReceipt();
  const [bound] = bindCloseoutReceiptObservations(
    bindingContext(null),
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequestWithCandidate(renderPublishedBranchCloseoutReceiptComment(receipt))]
  );
  expect(bound?.closeoutReceipt?.status).toBe('unknown');
});

test('malformed receipt from an admin is invalid rather than missing', () => {
  const [bound] = bindCloseoutReceiptObservations(
    bindingContext('admin'),
    '/workspace/sec',
    'sec-platform/sec',
    [pullRequestWithCandidate('<!-- sec-branch-closeout-receipt-v1 -->\ninvalid')]
  );
  expect(bound?.closeoutReceipt?.status).toBe('invalid');
});

test('publication reuses an existing trusted receipt without posting a duplicate', () => {
  const receipt = closeoutReceipt();
  const published = createPublishedBranchCloseoutReceipt(receipt);
  const body = renderPublishedBranchCloseoutReceiptComment(published);
  const calls: string[] = [];
  const ctx: BranchLifecycleContext = {
    repositoryRoot: '/workspace/sec',
    run: (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args.includes('--paginate')) return commandResult([[restComment(10, body)]]);
      if (permissionRequest(args)) return commandResult('maintain');
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }
  };
  const result = publishAndReadBackBranchCloseoutReceipt(ctx, receipt);
  expect(result.readback).toBe('success');
  expect(result.detail).toContain('reused existing');
  expect(calls.some((call) => call.includes('-X POST'))).toBe(false);
});

test('new publication reads back the exact created comment identity', () => {
  const receipt = closeoutReceipt();
  const published = createPublishedBranchCloseoutReceipt(receipt);
  const body = renderPublishedBranchCloseoutReceiptComment(published);
  const comment = restComment(11, body);
  const ctx: BranchLifecycleContext = {
    repositoryRoot: '/workspace/sec',
    run: (command, args) => {
      if (args.includes('--paginate')) return commandResult([[]]);
      if (args.includes('-X') && args.includes('POST')) return commandResult(comment);
      if (permissionRequest(args)) return commandResult('admin');
      if (args.some((arg) => arg.endsWith('/issues/comments/11'))) return commandResult(comment);
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }
  };
  const result = publishAndReadBackBranchCloseoutReceipt(ctx, receipt);
  expect(result).toMatchObject({
    publish: 'success',
    readback: 'success',
    receipt: published
  });
});
