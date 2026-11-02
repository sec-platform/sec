import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BranchLifecycleInventory } from '../../../src/execution/verification/branch-closeout.ts';


import { createRecoveryBundle } from '../../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

function git(root: string, args: readonly string[], allowFailure = false, input?: string) {
  // Commit identity belongs to this test process; keep the native graph
  // while avoiding independent Git config subprocesses.
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    input,
    env: { ...process.env,
      GIT_AUTHOR_NAME: 'SEC Test', GIT_AUTHOR_EMAIL: 'sec-test@example.invalid',
      GIT_COMMITTER_NAME: 'SEC Test', GIT_COMMITTER_EMAIL: 'sec-test@example.invalid'
    }
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }
  return result;
}

test('branch recovery bundle retains only the source closure missing from exact main', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-recovery-compaction-'));
  const repository = path.join(root, 'repository');
  const recoveryRoot = path.join(root, 'recovery');
  const consumer = path.join(root, 'consumer.git');
  const empty = path.join(root, 'empty.git');
  return settleWorkspaceCallback(async () => {
    mkdirSync(repository);
    git(repository, ['init', '--quiet', '--initial-branch=main']);
    // Build the same sixteen native parent-linked commits in one Git process.
    // fast-import updates only Git objects/refs; reset materializes the final
    // index and worktree before any recovery effect or competing branch begins.
    const importRecords = Array.from({ length: 16 }, (_, index) => {
      const message = `main history ${index}`;
      const content = `main-history-${index}\n`;
      return `commit refs/heads/main\ncommitter SEC Test <sec-test@example.invalid> ${1_700_000_000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nM 100644 inline history.txt\ndata ${Buffer.byteLength(content)}\n${content}`;
    });
    // Both divergent tips are immutable fixture inputs. Import them with the
    // original main chain, rather than switching the physical index twice.
    const divergentRecords = [
      { ref: 'feat/recovery-delta', message: 'feature delta', file: 'feature.txt',
        content: 'unique branch state\n', parent: 'from refs/heads/main\n' },
      { ref: 'main', message: 'main-only delta', file: 'main-only.txt',
        content: 'new main state\n', parent: '' }
    ].map(({ ref, message, file, content, parent }, index) => (
      `commit refs/heads/${ref}\ncommitter SEC Test <sec-test@example.invalid> ${1_700_000_016 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${parent}M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}`
    ));
    git(repository, ['fast-import', '--quiet'], false,
      ['feature done', ...importRecords, ...divergentRecords, 'done', ''].join('\n'));
    // Restore only the final main worktree/index; the source tip remains a
    // distinct native ref and object graph for the recovery effect.
    git(repository, ['reset', '--hard', 'main']);
    const tipLines = git(repository, [
      'rev-parse', 'refs/heads/feat/recovery-delta', 'refs/heads/main'
    ]).stdout.trim().split('\n');
    expect(tipLines).toHaveLength(2);
    const [featureSha, mainSha] = tipLines as [string, string];

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
    expect(git(empty, ['bundle', 'verify', result.recovery.path], true).status).toBeGreaterThan(0);
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}, 30_000);
