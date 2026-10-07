import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBatchRecoveryBundle, createRecoveryBundle, verifyRecoveryAuthorityHeadsLive } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import type { BranchLifecycleInventory } from '../../src/execution/verification/branch-closeout.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture(root: string) {
  const repository = path.join(root, 'source');
  mkdirSync(repository);
  git(repository, ['init', '--quiet', '--initial-branch=main']);
  git(repository, ['config', 'user.name', 'SEC Test']);
  git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
  for (let index = 0; index < 3; index += 1) {
    writeFileSync(path.join(repository, 'base.txt'), `base ${index}\n`);
    git(repository, ['add', '.']);
    git(repository, ['commit', '--quiet', '-m', `base ${index}`]);
  }
  const mainSha = git(repository, ['rev-parse', 'HEAD']);
  const refs = ['fix/first', 'fix/second'].map((branch) => {
    git(repository, ['switch', '--quiet', '-c', branch, 'main']);
    writeFileSync(path.join(repository, 'unique.txt'), `${branch}\n`);
    git(repository, ['add', '.']);
    git(repository, ['commit', '--quiet', '-m', branch]);
    return { branch, expectedHeadSha: git(repository, ['rev-parse', 'HEAD']) };
  });
  git(repository, ['switch', '--quiet', 'main']);
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

test('one batch bundle restores both unique tips with no source repository or main prerequisites', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-complete-batch-'));
  try {
    const { repository, refs, inventory } = fixture(root);
    const recoveryRoot = path.join(root, 'recovery');
    const recovery = createBatchRecoveryBundle({ inventory, refs, recoveryRoot });
    const reused = createBatchRecoveryBundle({ inventory, refs, recoveryRoot });
    expect(reused.path).toBe(recovery.path);
    expect(reused.sha256).toBe(recovery.sha256);
    expect(readdirSync(recoveryRoot).filter((entry) => entry.endsWith('.bundle'))).toHaveLength(1);
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery,
      expectedHeads: refs.map((ref) => ref.expectedHeadSha), requireComplete: true }).status).toBe('success');
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery,
      expectedHeads: ['0'.repeat(40)], requireComplete: true }).status).toBe('failed');
    rmSync(repository, { recursive: true, force: true });
    const empty = path.join(root, 'empty.git');
    mkdirSync(empty);
    git(empty, ['init', '--quiet', '--bare']);
    git(empty, ['bundle', 'verify', recovery.path]);
    git(empty, ['fetch', '--no-tags', recovery.path, '+refs/heads/*:refs/heads/*']);
    for (const ref of refs) expect(git(empty, ['show', `${ref.expectedHeadSha}:unique.txt`])).toBe(ref.branch);
    expect(git(empty, ['show', `${inventory.main.remoteSha}:base.txt`])).toBe('base 2');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('a compact single-head bundle cannot masquerade as self-contained batch recovery', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-reject-partial-batch-'));
  try {
    const { refs, inventory } = fixture(root);
    const compact = createRecoveryBundle({ inventory, branch: refs[0]!.branch,
      expectedSha: refs[0]!.expectedHeadSha, recoveryRoot: path.join(root, 'compact'),
      refSource: { kind: 'local-branch' } }).recovery;
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery: compact,
      expectedHeads: [refs[0]!.expectedHeadSha], requireComplete: false }).status).toBe('success');
    expect(verifyRecoveryAuthorityHeadsLive({ inventory, recovery: compact,
      expectedHeads: [refs[0]!.expectedHeadSha], requireComplete: true }).status).toBe('failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
