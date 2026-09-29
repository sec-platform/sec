import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { BranchLifecycleInventory } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { createRecoveryBundle } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';

function git(root: string, args: readonly string[], allowFailure = false) {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }
  return result;
}

test('branch recovery bundle retains only the source closure missing from exact main', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-recovery-compaction-'));
  const repository = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'recovery');
  const consumer = path.join(root, 'consumer.git');
  const empty = path.join(root, 'empty.git');
  try {
    mkdirSync(repository);
    git(repository, ['init', '--quiet', '--initial-branch=main']);
    git(repository, ['config', 'user.name', 'SEC Test']);
    git(repository, ['config', 'user.email', 'sec-test@example.invalid']);
    for (let index = 0; index < 16; index += 1) {
      writeFileSync(path.join(repository, 'history.txt'), `main-history-${index}\n`, 'utf8');
      git(repository, ['add', 'history.txt']);
      git(repository, ['commit', '--quiet', '-m', `main history ${index}`]);
    }

    git(repository, ['switch', '--quiet', '-c', 'feat/recovery-delta']);
    writeFileSync(path.join(repository, 'feature.txt'), 'unique branch state\n', 'utf8');
    git(repository, ['add', 'feature.txt']);
    git(repository, ['commit', '--quiet', '-m', 'feature delta']);
    const featureSha = git(repository, ['rev-parse', 'HEAD']).stdout.trim();

    git(repository, ['switch', '--quiet', 'main']);
    writeFileSync(path.join(repository, 'main-only.txt'), 'new main state\n', 'utf8');
    git(repository, ['add', 'main-only.txt']);
    git(repository, ['commit', '--quiet', '-m', 'main-only delta']);
    const mainSha = git(repository, ['rev-parse', 'HEAD']).stdout.trim();

    const inventory: BranchLifecycleInventory = {
      schema: 'sec-branch-lifecycle-inventory-v1',
      observedAt: '2026-09-29T00:00:00.000Z',
      repository: {
        root: repository,
        commonDir: path.join(repository, '.git'),
        fullName: 'sec-platform/sec',
        remote: 'origin',
        remoteUrl: repository,
        defaultBranch: 'main'
      },
      main: { localSha: mainSha, remoteSha: mainSha },
      localBranches: [
        { branch: 'main', sha: mainSha },
        { branch: 'feat/recovery-delta', sha: featureSha }
      ],
      remoteBranches: [{ branch: 'main', sha: mainSha }],
      worktrees: [{
        path: repository,
        headSha: mainSha,
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
      repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
      pruneConfiguration: {
        observation: 'resolved',
        fetchPrune: true,
        remotePrune: true,
        fetchPruneTags: true,
        reason: null
      },
      unknowns: []
    };

    const result = createRecoveryBundle({
      inventory,
      branch: 'feat/recovery-delta',
      expectedSha: featureSha,
      recoveryRoot,
      refSource: { kind: 'local-branch' }
    });
    expect(result.recovery.kind).toBe('bundle');
    if (result.recovery.kind !== 'bundle') throw new Error('expected bundle recovery');

    const fullBundle = path.join(root, 'full-history.bundle');
    git(repository, ['bundle', 'create', fullBundle, 'refs/heads/feat/recovery-delta']);
    expect(statSync(result.recovery.path).size).toBeLessThan(statSync(fullBundle).size);

    mkdirSync(consumer);
    git(consumer, ['init', '--quiet', '--bare']);
    git(consumer, ['fetch', repository, 'refs/heads/main:refs/heads/main']);
    expect(git(consumer, ['bundle', 'verify', result.recovery.path], true).status).toBe(0);
    git(consumer, ['fetch', result.recovery.path, 'refs/heads/feat/recovery-delta:refs/heads/recovered']);
    expect(git(consumer, ['rev-parse', 'refs/heads/recovered']).stdout.trim()).toBe(featureSha);

    mkdirSync(empty);
    git(empty, ['init', '--quiet', '--bare']);
    expect(git(empty, ['bundle', 'verify', result.recovery.path], true).status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);