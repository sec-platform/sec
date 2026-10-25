import { expect, test } from 'bun:test';
import type { BranchLifecycleInventory } from '../../../src/execution/verification/branch-closeout.ts';

import {
  projectBranchLifecycleForWorkSelection,
  selectBranchLifecyclePullRequests
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitHubCredentialArgs,
  createBranchLifecycleGitHubRemoteObservation
} from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY, auditBranchLifecycle, authorizeBranchCloseout, createBranchCloseoutPreparation, createBranchCloseoutReceipt, isPathWithin, parseBranchCloseoutReceipt } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-contract.ts';
import { parseRepositoryFullName } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
const MAIN_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';
const RACE_SHA = '3333333333333333333333333333333333333333';
const WORKTREE_REF = `sha256:${'a'.repeat(64)}` as const;

test('lifecycle inventory retains live PRs and only exact physical historical heads', () => {
  const pullRequests = [
    {
      number: 1,
      headBranch: 'feat/open',
      headSha: null,
      baseBranch: 'main',
      state: 'open' as const,
      isDraft: true,
      isCrossRepository: false,
      url: null
    },
    {
      number: 2,
      headBranch: 'fix/residue',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'merged' as const,
      isDraft: false,
      isCrossRepository: false,
      url: null
    },
    {
      number: 3,
      headBranch: 'fix/residue',
      headSha: RACE_SHA,
      baseBranch: 'main',
      state: 'closed' as const,
      isDraft: false,
      isCrossRepository: false,
      url: null
    },
    {
      number: 4,
      headBranch: 'docs/absent',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      state: 'closed' as const,
      isDraft: false,
      isCrossRepository: false,
      url: null
    }
  ];

  expect(selectBranchLifecyclePullRequests(pullRequests, [
    { branch: 'fix/residue', headSha: HEAD_SHA }
  ]).map(({ number }) => number)).toEqual([1, 2]);
});

test('GitHub repository identity parser accepts only exact supported remote forms', () => {
  expect(parseRepositoryFullName('https://github.com/sec-platform/sec.git')).toBe('sec-platform/sec');
  expect(parseRepositoryFullName('git@github.com:sec-platform/sec.git')).toBe('sec-platform/sec');
  expect(parseRepositoryFullName('ssh://git@github.com/sec-platform/sec.git')).toBe('sec-platform/sec');
  expect(parseRepositoryFullName('https://attacker.invalid/github.com/sec-platform/sec.git')).toBeNull();
  expect(parseRepositoryFullName('https://github.com/sec-platform/sec/extra')).toBeNull();
});

test('GitHub remote observation binds canonical URL and ignores every ambient Git config scope', () => {
  const hostileEnvironment = {
    [process.platform === 'win32' ? 'Path' : 'PATH']: 'trusted-path',
    HOME: 'hostile-global-home',
    USERPROFILE: 'trusted-profile',
    SSH_AUTH_SOCK: 'trusted-agent',
    HTTPS_PROXY: 'trusted-proxy',
    gh_prompt_disabled: '0',
    GIT_DIR: 'hostile-repository',
    Git_Dir: 'forged-git-dir',
    GIT_WORK_TREE: 'forged-worktree',
    GIT_INDEX_FILE: 'forged-index',
    GIT_OBJECT_DIRECTORY: 'forged-objects',
    Git_Config_Count: '1',
    git_config_value_0: 'forged-helper',
    git_config_key_19: 'core.fsmonitor',
    git_config_value_19: 'forged-monitor',
    git_askpass: 'forged-git-askpass',
    GIT_ASKPASS_REQUIRE: 'force',
    ssh_askpass: 'forged-ssh-askpass',
    SSH_ASKPASS_REQUIRE: 'force',
    git_ssh: 'forged-git-ssh',
    GIT_SSH_COMMAND: 'forged-git-ssh-command',
    git_no_replace_objects: '0',
    GIT_OPTIONAL_LOCKS: '1',
    GIT_TERMINAL_PROMPT: '1',
    git_terminal_prompt: '1',
    GIT_CONFIG_GLOBAL: 'hostile-global-config',
    GIT_CONFIG_SYSTEM: 'hostile-system-config',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.https://attacker.invalid/.insteadOf',
    GIT_CONFIG_VALUE_0: 'https://github.com/'
  };
  const windows = createBranchLifecycleGitHubRemoteObservation(
    'sec-platform/sec', hostileEnvironment, 'win32'
  );
  expect(windows.repositoryUrl).toBe('https://github.com/sec-platform/sec.git');
  expect(windows.argumentsPrefix).toEqual([
    '--git-dir=NUL',
    ...createBranchLifecycleGitHubCredentialArgs()
  ]);
  expect(windows.environment).toMatchObject({
    PATH: 'trusted-path',
    HOME: 'hostile-global-home',
    USERPROFILE: 'trusted-profile',
    SSH_AUTH_SOCK: 'trusted-agent',
    HTTPS_PROXY: 'trusted-proxy',
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: 'NUL',
    GIT_CONFIG_SYSTEM: 'NUL'
  });
  expect(Object.keys(windows.environment).filter((name) => name.toUpperCase() === 'PATH'))
    .toEqual(['PATH']);
  expect(Object.keys(windows.environment).filter((name) => name.toUpperCase() === 'GIT_NO_REPLACE_OBJECTS'))
    .toEqual(['GIT_NO_REPLACE_OBJECTS']);
  for (const name of Object.keys(windows.environment)) {
    const canonicalName = name.toUpperCase();
    expect([
      'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_CONFIG_COUNT',
      'GIT_ASKPASS', 'GIT_ASKPASS_REQUIRE', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE',
      'GIT_SSH', 'GIT_SSH_COMMAND'
    ]).not.toContain(canonicalName);
    expect(canonicalName).not.toMatch(/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u);
  }

  const linux = createBranchLifecycleGitHubRemoteObservation(
    'sec-platform/sec', hostileEnvironment, 'linux'
  );
  expect(linux.argumentsPrefix[0]).toBe('--git-dir=/dev/null');
  expect(linux.environment.GIT_CONFIG_GLOBAL).toBe('/dev/null');
  expect(() => createBranchLifecycleGitHubRemoteObservation(
    '../foreign', hostileEnvironment, 'linux'
  )).toThrow('bounded owner/name identity');
});

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
  expectedLocalSha: string | null = HEAD_SHA,
  worktreePathsAtPreparation: string[] = []
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
    worktreePathsAtPreparation
  });
}

test('merged local residue is authorized independently of unrelated active work but not its own active owner', () => {
  const mergedPullRequest = {
    number: 42,
    headBranch: 'codex/修复',
    headSha: HEAD_SHA,
    baseBranch: 'main',
    state: 'merged' as const,
    isDraft: false,
    isCrossRepository: false,
    url: null
  };
  const snapshot = inventory({
    localBranches: [
      { branch: 'codex/修复', sha: HEAD_SHA },
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/candidate', sha: RACE_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/candidate', sha: RACE_SHA }
    ],
    pullRequests: [mergedPullRequest, {
      number: 99,
      headBranch: 'feat/candidate',
      headSha: RACE_SHA,
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/candidate',
      manifest: 'config/repository/work-packages/example-v1.md',
      reason: null
    }
  });
  const prepared = createBranchCloseoutPreparation({
    preparedAt: '2026-08-04T00:01:00.000Z',
    repository: snapshot.repository,
    branch: 'codex/修复',
    refState: 'absent',
    expectedHeadSha: HEAD_SHA,
    expectedRemoteSha: HEAD_SHA,
    expectedLocalSha: HEAD_SHA,
    expectedPrHeadSha: HEAD_SHA,
    pullRequestNumber: 42,
    pullRequestStateAtPreparation: 'merged',
    recovery: {
      kind: 'bundle',
      path: '/recovery/sec-example.bundle',
      sha256: `sha256:${'a'.repeat(64)}`,
      verified: true,
      verifyOutput: 'verified'
    },
    worktreePathsAtPreparation: []
  });

  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'merged' as const,
    durableGoal: { kind: 'main' as const, reference: `main@${MAIN_SHA}` }
  };
  const authorization = authorizeBranchCloseout({
    preparation: prepared,
    request,
    before: snapshot,
    current: snapshot
  });
  expect(authorization.blockers).toEqual([]);
  expect(authorization.remoteAction).toBe('already-absent');
  expect(authorization.localAction).toBe('delete-exact');

  const selected = authorizeBranchCloseout({
    preparation: prepared,
    request,
    before: snapshot,
    current: {
      ...snapshot,
      activeWorkPackage: { ...snapshot.activeWorkPackage, branch: 'codex/修复' }
    }
  });
  expect(selected.blockers).toContain(
    'active Work Package still selects the candidate being closed out'
  );
  expect(selected.remoteAction).toBe('blocked');
  expect(selected.localAction).toBe('blocked');

  const foreign = authorizeBranchCloseout({
    preparation: prepared,
    request,
    before: snapshot,
    current: snapshot,
    foreignWorktreeObservationDigests: [`sha256:${'b'.repeat(64)}`]
  });
  expect(foreign.blockers).toContain('external-maintainer-disposition-required');
  expect(foreign.remoteAction).toBe('blocked');
  expect(foreign.localAction).toBe('blocked');
});

test('idle lifecycle is clean only when the remote contains main', () => {
  const report = auditBranchLifecycle(inventory());
  expect(report.status).toBe('clean');
  expect(report.findings).toEqual([]);
});

test('bounded selection lifecycle binds prospective transport and distinguishes extra residue from missing worktree authority', () => {
  const input = {
    exactMain: MAIN_SHA,
    defaultBranch: 'main',
    localRefs: [{ branch: 'codex/next', sha: MAIN_SHA }],
    remoteRefs: [],
    worktrees: [{ worktreeRef: WORKTREE_REF, branch: 'codex/next', headSha: MAIN_SHA }],
    openPullRequests: [],
    preservedOpenPullRequests: [],
    prospectiveTransport: {
      branch: 'codex/next',
      headSha: MAIN_SHA,
      worktreeRef: WORKTREE_REF
    }
  };
  const projection = projectBranchLifecycleForWorkSelection(input);
  expect(projection).toMatchObject({
    activeState: 'none',
    activeLegality: 'not-applicable',
    closeoutState: 'none',
    blockerRefs: []
  });

  const residue = projectBranchLifecycleForWorkSelection({
    ...input,
    remoteRefs: [{ branch: 'feat/stale', sha: HEAD_SHA }]
  });
  expect(residue.closeoutState).toBe('required');
  expect(residue.blockerRefs).toHaveLength(1);
  expect(() => projectBranchLifecycleForWorkSelection({
    ...input,
    worktrees: []
  })).toThrow('exact local branch/worktree preimage');
});

test('bounded selection lifecycle preserves exact other PR transports and blocks their drift', () => {
  const preservedWorktreeRef = `sha256:${'b'.repeat(64)}` as const;
  const input = {
    exactMain: MAIN_SHA,
    defaultBranch: 'main',
    localRefs: [
      { branch: 'codex/active', sha: HEAD_SHA },
      { branch: 'codex/preserved', sha: RACE_SHA }
    ],
    remoteRefs: [
      { branch: 'codex/active', sha: HEAD_SHA },
      { branch: 'codex/preserved', sha: RACE_SHA }
    ],
    worktrees: [
      { worktreeRef: WORKTREE_REF, branch: 'codex/active', headSha: HEAD_SHA },
      { worktreeRef: preservedWorktreeRef, branch: 'codex/preserved', headSha: RACE_SHA }
    ],
    openPullRequests: [{
      number: 42,
      headBranch: 'codex/active',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: MAIN_SHA
    }],
    preservedOpenPullRequests: [{
      number: 43,
      headBranch: 'codex/preserved',
      headSha: RACE_SHA,
      baseBranch: 'main',
      baseSha: MAIN_SHA
    }],
    prospectiveTransport: null
  } as const;
  const projection = projectBranchLifecycleForWorkSelection(input);
  expect(projection).toMatchObject({
    activeLegality: 'legal',
    closeoutState: 'none',
    preservedPullRequests: [{ number: 43, headBranch: 'codex/preserved', headSha: RACE_SHA }]
  });

  const driftedHead = projectBranchLifecycleForWorkSelection({
    ...input,
    remoteRefs: [
      { branch: 'codex/active', sha: HEAD_SHA },
      { branch: 'codex/preserved', sha: HEAD_SHA }
    ]
  });
  expect(driftedHead.closeoutState).toBe('required');
  expect(driftedHead.projectionDigest).not.toBe(projection.projectionDigest);
  expect(driftedHead.inventoryObservationDigest).not.toBe(projection.inventoryObservationDigest);

  const driftedWorktree = projectBranchLifecycleForWorkSelection({
    ...input,
    worktrees: [
      { worktreeRef: WORKTREE_REF, branch: 'codex/active', headSha: HEAD_SHA },
      { worktreeRef: preservedWorktreeRef, branch: 'codex/preserved', headSha: HEAD_SHA }
    ]
  });
  expect(driftedWorktree.closeoutState).toBe('required');
  expect(driftedWorktree.projectionDigest).not.toBe(projection.projectionDigest);
  expect(driftedWorktree.inventoryObservationDigest).not.toBe(projection.inventoryObservationDigest);
});

test('bounded selection lifecycle rejects conflicting active and preserved PR branches', () => {
  const active = {
    number: 42,
    headBranch: 'codex/active',
    headSha: HEAD_SHA,
    baseBranch: 'main',
    baseSha: MAIN_SHA
  } as const;
  const input = {
    exactMain: MAIN_SHA,
    defaultBranch: 'main',
    localRefs: [],
    remoteRefs: [{ branch: 'codex/active', sha: HEAD_SHA }],
    worktrees: [],
    openPullRequests: [active],
    prospectiveTransport: null
  } as const;
  expect(() => projectBranchLifecycleForWorkSelection({
    ...input,
    preservedOpenPullRequests: [{ ...active, number: 43 }]
  })).toThrow('conflicting branch');
});

test('bounded selection lifecycle rejects a pull request targeting another branch', () => {
  const projection = projectBranchLifecycleForWorkSelection({
    exactMain: MAIN_SHA,
    defaultBranch: 'main',
    localRefs: [],
    remoteRefs: [{ branch: 'codex/active', sha: HEAD_SHA }],
    worktrees: [],
    openPullRequests: [{
      number: 42,
      headBranch: 'codex/active',
      headSha: HEAD_SHA,
      baseBranch: 'release',
      baseSha: MAIN_SHA
    }],
    preservedOpenPullRequests: [],
    prospectiveTransport: null
  });
  expect(projection.activeLegality).toBe('invalid');
});

test('bounded selection lifecycle binds transport identity without treating a branch prefix as authority', () => {
  const projection = projectBranchLifecycleForWorkSelection({
    exactMain: MAIN_SHA,
    defaultBranch: 'main',
    localRefs: [],
    remoteRefs: [{ branch: 'integration/legacy', sha: HEAD_SHA }],
    worktrees: [],
    openPullRequests: [{
      number: 42,
      headBranch: 'integration/legacy',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: MAIN_SHA
    }],
    preservedOpenPullRequests: [],
    prospectiveTransport: null
  });
  expect(projection).toMatchObject({
    activeState: 'incomplete',
    activeBranch: 'integration/legacy',
    activeHeadSha: HEAD_SHA,
    activeLegality: 'legal',
    closeoutState: 'none'
  });
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
      manifest: 'config/repository/work-packages/example-v1.md',
      reason: null
    }
  });
  const report = auditBranchLifecycle(active);
  expect(report.status).toBe('clean');
  expect(report.classifications.find(({ branch }) => branch === 'feat/example')?.classification)
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
  const report = auditBranchLifecycle(observed);
  const classification = report.classifications
    .find(({ branch }) => branch === 'codex/local-recovery');
  expect(classification?.classification).toBe('protected-pending');
  expect(classification?.remoteSha).toBeNull();
  expect(report.status).toBe('protected');
});

test('path containment is segment-safe', () => {
  expect(isPathWithin('/workspace/sec/.tmp/recovery.bundle', '/workspace/sec')).toBe(true);
  expect(isPathWithin('/workspace/sec-recovery/recovery.bundle', '/workspace/sec')).toBe(false);
});

test('closeout keeps remote CAS, local appearance, divergent recovery and registered worktree boundaries independent', () => {
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
      manifest: 'config/repository/work-packages/example-v1.md',
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
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'merged' as const,
    durableGoal: { kind: 'main' as const, reference: `main@${MAIN_SHA}` }
  };

  const raced = authorizeBranchCloseout({
    preparation: prepared,
    request,
    before,
    current: { ...current, remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: RACE_SHA }
    ] }
  });
  expect(raced.remoteAction).toBe('blocked');
  expect(raced.blockers).toContain('remote branch SHA changed after preparation');

  const missingLocal = { ...before, localBranches: [{ branch: 'main', sha: MAIN_SHA }] };
  const appeared = authorizeBranchCloseout({
    preparation: preparation(missingLocal, null),
    request,
    before: missingLocal,
    current
  });
  expect(appeared.remoteAction).toBe('blocked');
  expect(appeared.localAction).toBe('blocked');
  expect(appeared.blockers).toContain('local branch appeared after preparation');

  const divergentBefore = { ...before, localBranches: [
    { branch: 'main', sha: MAIN_SHA },
    { branch: 'feat/example', sha: RACE_SHA }
  ] };
  const divergent = authorizeBranchCloseout({
    preparation: preparation(divergentBefore, RACE_SHA),
    request,
    before: divergentBefore,
    current: { ...current, localBranches: divergentBefore.localBranches }
  });
  expect(divergent.blockers).toEqual([]);
  expect(divergent.remoteAction).toBe('delete-cas');
  expect(divergent.localAction).toBe('protect-local');
  expect(divergent.protections[0]).toContain('diverges from recovered remote head');

  const withWorktree = { ...current, worktrees: [
    ...current.worktrees,
    {
      path: '/workspace/sec-worktrees/example',
      headSha: HEAD_SHA,
      branch: 'feat/example',
      dirtyCount: 1,
      untrackedCount: 0,
      locked: false,
      prunable: false,
      observation: 'resolved' as const,
      reason: null
    }
  ] };
  const authorization = authorizeBranchCloseout({ preparation: prepared, request, before, current: withWorktree });
  expect(authorization.remoteAction).toBe('blocked');
  expect(authorization.localAction).toBe('protect-local');
  expect(authorization.blockers).toContain('registered worktree must reach completed physical closeout before branch/ref CAS');

  const receipt = createBranchCloseoutReceipt({
    generatedAt: '2026-08-04T00:02:00.000Z',
    preparation: prepared,
    request,
    authorization,
    attempts: [],
    before,
    after: withWorktree
  });
  expect(receipt.status).toBe('blocked');
  expect(parseBranchCloseoutReceipt(JSON.stringify(receipt)).receiptDigest).toBe(receipt.receiptDigest);
});

test('branch/ref CAS rejects missing or caller-forged worktree cleanup authority', () => {
  const targetPath = '/workspace/sec-worktrees/example';
  const before = inventory({
    localBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    remoteBranches: [
      { branch: 'main', sha: MAIN_SHA },
      { branch: 'feat/example', sha: HEAD_SHA }
    ],
    worktrees: [
      inventory().worktrees[0]!,
      {
        path: targetPath,
        headSha: HEAD_SHA,
        branch: 'feat/example',
        dirtyCount: 0,
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
      state: 'open',
      isDraft: false,
      isCrossRepository: false,
      url: null
    }],
    activeWorkPackage: {
      state: 'active',
      branch: 'feat/example',
      manifest: 'config/repository/work-packages/example-v1.md',
      reason: null
    }
  });
  const current = inventory({
    localBranches: before.localBranches,
    remoteBranches: before.remoteBranches,
    pullRequests: [{ ...before.pullRequests[0]!, state: 'merged' }]
  });
  const prepared = preparation(before, HEAD_SHA, [targetPath]);
  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'merged' as const,
    durableGoal: { kind: 'main' as const, reference: `main@${MAIN_SHA}` }
  };
  const withoutReceipt = authorizeBranchCloseout({ preparation: prepared, request, before, current });
  expect(withoutReceipt.remoteAction).toBe('blocked');
  expect(withoutReceipt.localAction).toBe('blocked');
  expect(withoutReceipt.blockers).toContain(`exact completed worktree cleanup receipt is required for ${targetPath}`);

  const forged = authorizeBranchCloseout({
    preparation: prepared,
    request,
    before,
    current,
    // A shape-compatible value is not in the physical module's private token
    // ledger and therefore cannot turn caller JSON/digests into authority.
    worktreeCleanupTokens: [{} as never],
    expectedHeadTreeSha: '4'.repeat(40)
  });
  expect(forged.remoteAction).toBe('blocked');
  expect(forged.localAction).toBe('blocked');
  expect(forged.blockers).toContain(`exact completed worktree cleanup receipt is required for ${targetPath}`);
});
