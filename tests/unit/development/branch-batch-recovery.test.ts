import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBatchRecoveryBundle, createRecoveryBundle, verifyRecoveryAuthorityHeadsLive } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import type { BranchLifecycleInventory } from '../../../src/execution/verification/branch-closeout.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

function git(root: string, args: readonly string[], input?: string): string {
  // Native identity is scoped to the fixture process; do not spawn Git
  // solely to configure author and committer for each new repository.
  const result = spawnSync('git', [...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, input,
    env: { ...process.env,
      GIT_AUTHOR_NAME: 'SEC Test', GIT_AUTHOR_EMAIL: 'sec-test@example.invalid',
      GIT_COMMITTER_NAME: 'SEC Test', GIT_COMMITTER_EMAIL: 'sec-test@example.invalid'
    }
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture(root: string) {
  const repository = path.join(root, 'source');
  mkdirSync(repository);
  git(repository, ['init', '--quiet', '--initial-branch=main']);
  // One shared main prerequisite and two independent native branch tips.
  // Fast-import writes the complete immutable graph without repeated
  // switch/add/commit processes; reset then owns the main index/worktree.
  const branches = ['fix/first', 'fix/second'];
  const commits = ['main', ...branches].map((branch, index) => {
    const message = index === 0 ? 'base' : branch;
    const file = index === 0 ? 'base.txt' : 'unique.txt';
    const content = index === 0 ? 'base 2\n' : `${branch}\n`;
    const parent = index === 0 ? '' : 'from refs/heads/main\n';
    return `commit refs/heads/${branch}\ncommitter SEC Test <sec-test@example.invalid> ${1_700_000_000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${parent}M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}`;
  });
  git(repository, ['fast-import', '--quiet'], ['feature done', ...commits, 'done', ''].join('\n'));
  git(repository, ['reset', '--hard', 'main']);
  // Read immutable native refs after importing the graph and materializing
  // the independent main index and worktree.
  const tips = git(repository, ['rev-parse',
    'refs/heads/main', 'refs/heads/fix/first', 'refs/heads/fix/second'
  ]).split('\n');
  if (tips.length !== 3 || tips.some(tip => !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(tip))) {
    throw new Error('Expected three exact native Git tip identities');
  }
  const [mainSha, firstSha, secondSha] = tips as [string, string, string];
  const refs = [
    { branch: branches[0]!, expectedHeadSha: firstSha },
    { branch: branches[1]!, expectedHeadSha: secondSha }
  ];
  const inventory: BranchLifecycleInventory = {
    schema: 'sec-branch-lifecycle-inventory-v1', observedAt: '2026-10-05T00:00:00.000Z',
    repository: { root: repository, commonDir: path.join(repository, '.git'), fullName: 'sec-platform/sec',
      remote: 'origin', remoteUrl: repository, defaultBranch: 'main' },
    main: { localSha: mainSha, remoteSha: mainSha }, localBranches: [], remoteBranches: [],
    worktrees: [{ path: repository, headSha: mainSha, branch: 'main', dirtyCount: 0, untrackedCount: 0,
      locked: false, prunable: false, observation: 'resolved', reason: null }],
    pullRequests: [], activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true, remotePrune: true, fetchPruneTags: true, reason: null },
    unknowns: []
  };
  return { repository, refs, inventory };
}

test('batch recovery rejects compact prerequisites and restores both unique tips without its source repository', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-complete-batch-'));
  return settleWorkspaceCallback(async () => {
    const { repository, refs, inventory } = fixture(root);
    const recoveryRoot = path.join(root, 'recovery');
    const recovery = createBatchRecoveryBundle({ inventory, refs, recoveryRoot });
    const reused = createBatchRecoveryBundle({ inventory, refs, recoveryRoot });
    expect(reused.path).toBe(recovery.path);
    expect(reused.sha256).toBe(recovery.sha256);
    expect(readdirSync(recoveryRoot).filter((entry) => entry.endsWith('.bundle'))).toHaveLength(1);
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery,
      expectedHeads: ['0'.repeat(40)], requireComplete: true }).status).toBe('failed');
    const compact = createRecoveryBundle({ inventory, branch: refs[0]!.branch,
      expectedSha: refs[0]!.expectedHeadSha, recoveryRoot: path.join(root, 'compact'),
      refSource: { kind: 'local-branch' } }).recovery;
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery: compact,
      expectedHeads: [refs[0]!.expectedHeadSha], requireComplete: false }).status).toBe('success');
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery: compact,
      expectedHeads: [refs[0]!.expectedHeadSha], requireComplete: true }).status).toBe('failed');
    rmSync(repository, { recursive: true, force: true });
    const empty = path.join(root, 'empty.git');
    mkdirSync(empty);
    git(empty, ['init', '--quiet', '--bare']);
    git(empty, ['bundle', 'verify', recovery.path]);
    git(empty, ['fetch', '--no-tags', recovery.path, '+refs/heads/*:refs/heads/*']);
    for (const ref of refs) expect(git(empty, ['show', `${ref.expectedHeadSha}:unique.txt`])).toBe(ref.branch);
    expect(git(empty, ['show', `${inventory.main.remoteSha}:base.txt`])).toBe('base 2');
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}, 60_000);
