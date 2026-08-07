import { expect, test } from 'bun:test';

import {
  BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
  auditBranchLifecycle,
  authorizeBranchCloseout,
  classifyBranchLifecycle,
  createBranchCloseoutPreparation,
  createBranchCloseoutReceipt,
  isPathWithin,
  parseBranchCloseoutReceipt,
  type BranchCloseoutPreparation,
  type BranchLifecycleInventory
} from '../../scripts/codex/branch-lifecycle-contract.ts';

const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const RACE_SHA = '3333333333333333333333333333333333333333';

function inventory(overrides: Partial<BranchLifecycleInventory> = {}): BranchLifecycleInventory {
  const base: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1',
    observedAt: '2026-08-04T00:00:00.000Z',
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
    pullRequests: [],
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
  return { ...base, ...overrides };
}

function preparation(
  before: BranchLifecycleInventory,
  expectedLocalSha: string | null = HEAD_SHA
) {
  return createBranchCloseoutPreparation({
    preparedAt: '2026-08-04T00:01:00.000Z',
    repository: {
      root: before.repository.root,
      commonDir: before.repository.commonDir,
      fullName: before.repository.fullName,
      remote: before.repository.remote,
      defaultBranch: before.repository.defaultBranch
    },
    branch: 'feat/example',
    refState: 'present',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha,
    expectedPrHeadSha: null,
    pullRequestNumber: 42,
    pullRequestStateAtPreparation: 'open',
    recovery: {
      kind: 'bundle',
      path: '/recovery/sec-example.bundle',
      sha256: `sha256:${'a'.repeat(64)}`,
      verified: true,
      verifyOutput: 'verified'
    },
    worktreePathsAtPreparation: []
  });
}

test('idle lifecycle is clean only when the remote contains main', () => {
  const report = auditBranchLifecycle(inventory());
  expect(report.status).toBe('clean');
  expect(report.findings).toEqual([]);
});

test('idle lifecycle rejects every non-main remote head', () => {
  const report = auditBranchLifecycle(inventory({
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/stale', sha: HEAD_SHA }
    ]
  }));
  expect(report.status).toBe('drift');
  expect(report.findings.some(({ code, branch }) => (
    code === 'idle-remote-head-drift' && branch === 'feat/stale'
  ))).toBe(true);
  expect(report.findings.some(({ code, branch }) => (
    code === 'orphan-remote-head' && branch === 'feat/stale'
  ))).toBe(true);
});

test('clone prune drift is a blocking lifecycle error, not a protected state', () => {
  const report = auditBranchLifecycle(inventory({
    pruneConfiguration: {
      observation: 'resolved',
      fetchPrune: null,
      remotePrune: false,
      fetchPruneTags: true,
      reason: null
    }
  }));
  expect(report.status).toBe('drift');
  expect(report.findings.filter(({ code }) => code === 'prune-configuration-drift')).toHaveLength(2);
});

test('active lifecycle admits only main and the exact active/open candidate', () => {
  const active = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: 'https://github.com/sec-platform/sec/pull/42'
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  });
  const report = auditBranchLifecycle(active);
  expect(report.status).toBe('clean');
  expect(classifyBranchLifecycle(active).find(({ branch }) => branch === 'feat/example')?.classification)
    .toBe('active-candidate');
});

test('open PR without an active Work Package is unauthorized', () => {
  const report = auditBranchLifecycle(inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }]
  }));
  expect(report.status).toBe('drift');
  expect(report.findings.some(({ code }) => code === 'open-pr-without-active-package')).toBe(true);
});

test('dirty worktree is formally protected-pending instead of an active feature claim', () => {
  const observed = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'codex/local-recovery', sha: HEAD_SHA }
    ],
    worktrees: [
      {
        path: '/workspace/sec',
        headSha: MAIN_SHA,
        branch: 'main',
        dirtyCount: 0,
        untrackedCount: 0,
        locked: false,
        prunable: false,
        observation: 'resolved',
        reason: null
      },
      {
        path: '/workspace/sec-worktrees/recovery',
        headSha: HEAD_SHA,
        branch: 'codex/local-recovery',
        dirtyCount: 2,
        untrackedCount: 1,
        locked: false,
        prunable: false,
        observation: 'resolved',
        reason: null
      }
    ]
  });
  const classification = classifyBranchLifecycle(observed)
    .find(({ branch }) => branch === 'codex/local-recovery');
  expect(classification?.classification).toBe('protected-pending');
  expect(classification?.remoteSha).toBeNull();
  expect(auditBranchLifecycle(observed).status).toBe('protected');
});

test('path containment is segment-safe', () => {
  expect(isPathWithin('/workspace/sec/.tmp/recovery.bundle', '/workspace/sec')).toBe(true);
  expect(isPathWithin('/workspace/sec-recovery/recovery.bundle', '/workspace/sec')).toBe(false);
});

test('authorization blocks an exact remote SHA race', () => {
  const before = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  });
  const current = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: RACE_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }]
  });
  const authorization = authorizeBranchCloseout({
    preparation: preparation(before),
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    before,
    current
  });
  expect(authorization.remoteAction).toBe('blocked');
  expect(authorization.blockers).toContain('remote branch SHA changed after preparation');
});

test('local branch appearing after preparation blocks all deletion', () => {
  const before = inventory({
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  });
  const current = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: before.remoteBranches,
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }]
  });
  const authorization = authorizeBranchCloseout({
    preparation: preparation(before, null),
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    before,
    current
  });
  expect(authorization.remoteAction).toBe('blocked');
  expect(authorization.localAction).toBe('blocked');
  expect(authorization.blockers).toContain('local branch appeared after preparation');
});

test('divergent local branch is protected because remote recovery does not cover it', () => {
  const before = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: RACE_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  });
  const prepared = preparation(before, RACE_SHA);
  const current = inventory({
    localBranches: before.localBranches,
    remoteBranches: before.remoteBranches,
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }]
  });
  const authorization = authorizeBranchCloseout({
    preparation: prepared,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    before,
    current
  });
  expect(authorization.blockers).toEqual([]);
  expect(authorization.remoteAction).toBe('delete-cas');
  expect(authorization.localAction).toBe('protect-local');
  expect(authorization.protections[0]).toContain('diverges from recovered remote head');
});

test('merged closeout can delete remote while protecting a dirty local worktree', () => {
  const before = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  });
  const current = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    worktrees: [
      {
        path: '/workspace/sec',
        headSha: MAIN_SHA,
        branch: 'main',
        dirtyCount: 0,
        untrackedCount: 0,
        locked: false,
        prunable: false,
        observation: 'resolved',
        reason: null
      },
      {
        path: '/workspace/sec-worktrees/example',
        headSha: HEAD_SHA,
        branch: 'feat/example',
        dirtyCount: 1,
        untrackedCount: 0,
        locked: false,
        prunable: false,
        observation: 'resolved',
        reason: null
      }
    ],
    pullRequests: [{
      number: 42,
      headBranch: 'feat/example',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'merged',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }]
  });
  const prepared = preparation(before);
  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
    disposition: 'merged' as const,
    durableGoal: { kind: 'main' as const, reference: `main@${MAIN_SHA}` }
  };
  const authorization = authorizeBranchCloseout({ preparation: prepared, request, before, current });
  expect(authorization.remoteAction).toBe('delete-cas');
  expect(authorization.localAction).toBe('protect-local');

  const after = inventory({
    localBranches: current.localBranches,
    remoteBranches: [{ branch: 'main', sha: MAIN_SHA }],
    worktrees: current.worktrees,
    pullRequests: current.pullRequests
  });
  const receipt = createBranchCloseoutReceipt({
    generatedAt: '2026-08-04T00:02:00.000Z',
    preparation: prepared,
    request,
    authorization,
    attempts: [
      { operation: 'recovery-create', status: 'success', detail: prepared.recovery.path },
      { operation: 'recovery-verify', status: 'success', detail: prepared.recovery.sha256 },
      { operation: 'remote-delete', status: 'success', detail: 'deleted' },
      { operation: 'local-delete', status: 'skipped', detail: 'protect-local' },
      { operation: 'prune', status: 'success', detail: 'pruned' },
      { operation: 'readback', status: 'success', detail: 'read back' }
    ],
    before,
    after
  });
  expect(receipt.status).toBe('protected-pending');
  expect(parseBranchCloseoutReceipt(JSON.stringify(receipt)).receiptDigest).toBe(receipt.receiptDigest);

  const tampered = JSON.stringify({ ...receipt, status: 'completed' });
  expect(() => parseBranchCloseoutReceipt(tampered)).toThrow('digest mismatch');
});

function orphanRemoteInventory(): BranchLifecycleInventory {
  return inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'probe/stale', sha: HEAD_SHA }
    ],
    pullRequests: [],
    activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null }
  });
}

function orphanPreparation(before: BranchLifecycleInventory): BranchCloseoutPreparation {
  return createBranchCloseoutPreparation({
    preparedAt: '2026-08-04T00:03:00.000Z',
    repository: before.repository,
    branch: 'probe/stale',
    refState: 'present',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha: null,
    expectedPrHeadSha: null,
    pullRequestNumber: null,
    pullRequestStateAtPreparation: null,
    recovery: {
      kind: 'bundle',
      path: '/recovery/sec-probe-stale.bundle',
      sha256: `sha256:${'a'.repeat(64)}`,
      verified: true,
      verifyOutput: 'verified'
    },
    worktreePathsAtPreparation: []
  });
}

test('orphan remote closeout requires an explicit completed-spike disposition and durable issue goal', () => {
  const observed = orphanRemoteInventory();
  const prepared = orphanPreparation(observed);
  const authorization = authorizeBranchCloseout({
    preparation: prepared,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'completed-spike',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#269' }
    },
    before: observed,
    current: observed
  });
  expect(authorization.blockers).toEqual([]);
  expect(authorization.remoteAction).toBe('delete-cas');
  expect(authorization.localAction).toBe('already-absent');
  expect(authorization.classification).toBe('orphan-unknown');
});

test('orphan remote closeout rejects merged and closed-superseded dispositions', () => {
  const observed = orphanRemoteInventory();
  const prepared = orphanPreparation(observed);
  const merged = authorizeBranchCloseout({
    preparation: prepared,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${MAIN_SHA}` }
    },
    before: observed,
    current: observed
  });
  expect(merged.blockers).toContain('disposition merged cannot close out orphan-unknown');
  const superseded = authorizeBranchCloseout({
    preparation: prepared,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'closed-superseded',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#269' }
    },
    before: observed,
    current: observed
  });
  expect(superseded.blockers).toContain(
    'disposition closed-superseded cannot close out orphan-unknown'
  );
});

test('active work package selecting another branch does not block orphan closeout', () => {
  const observed = orphanRemoteInventory();
  const current = {
    ...observed,
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/candidate', sha: RACE_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'probe/stale', sha: HEAD_SHA },
      { branch: 'feat/candidate', sha: RACE_SHA }
    ],
    pullRequests: [{
      number: 99,
      headBranch: 'feat/candidate',
      headSha: RACE_SHA,
      baseBranch: 'main',
      state: 'open' as const,
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active' as const,
      branch: 'feat/candidate',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  };
  const authorization = authorizeBranchCloseout({
    preparation: orphanPreparation(observed),
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'completed-spike',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#269' }
    },
    before: observed,
    current
  });
  expect(authorization.blockers).toEqual([]);
  expect(authorization.remoteAction).toBe('delete-cas');
});

test('active work package selecting the closeout branch blocks it', () => {
  const observed = orphanRemoteInventory();
  const current = {
    ...observed,
    activeWorkPackage: {
      state: 'active' as const,
      branch: 'probe/stale',
      manifest: 'docs/work-packages/example-v1.md',
      reason: null
    }
  };
  const authorization = authorizeBranchCloseout({
    preparation: orphanPreparation(observed),
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY_V1,
      disposition: 'completed-spike',
      durableGoal: { kind: 'issue', reference: 'sec-platform/sec#269' }
    },
    before: observed,
    current
  });
  expect(authorization.blockers).toContain(
    'active Work Package still selects the candidate being closed out'
  );
  expect(authorization.remoteAction).toBe('blocked');
});
