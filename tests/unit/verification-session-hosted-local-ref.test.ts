import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BranchCloseoutAttempt } from '../../src/execution/verification/branch-closeout.ts';

import { withWorkspaceWriteLease } from '../../src/adapters/filesystem/write-lease.ts';
import { createBranchCloseoutPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { branchLifecycleDigest } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';

import { deleteHostedLocalRefCas } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import type { OperationDigest } from '../../src/execution/operation/semantic.ts';

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('hosted local ref consumer admits the native Git delete transaction', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-local-ref-'));
  const repositoryRoot = path.join(root, 'repository');
  mkdirSync(repositoryRoot);
  try {
    git(repositoryRoot, ['init', '-b', 'main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'base.txt'), 'base\n');
    git(repositoryRoot, ['add', 'base.txt']);
    git(repositoryRoot, ['commit', '-m', 'base']);
    const headSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    git(repositoryRoot, ['branch', 'feat/example']);
    const commonDir = path.join(repositoryRoot, '.git');
    const bundlePath = path.join(root, 'recovery.bundle');
    git(repositoryRoot, ['bundle', 'create', bundlePath, 'refs/heads/feat/example']);
    const verifyOutput = git(repositoryRoot, ['bundle', 'verify', bundlePath]);
    const bundleDigest = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    const preparation = createBranchCloseoutPreparation({
      preparedAt: '2026-09-27T00:00:00.000Z',
      repository: { root: repositoryRoot, commonDir, fullName: 'sec-platform/sec',
        remote: 'origin', defaultBranch: 'main' },
      branch: 'feat/example', refState: 'present', expectedHeadSha: headSha,
      expectedRemoteSha: headSha, expectedLocalSha: headSha, expectedPrHeadSha: null,
      pullRequestNumber: 42, pullRequestStateAtPreparation: 'merged',
      recovery: { kind: 'bundle', path: bundlePath, sha256: `sha256:${bundleDigest}`,
        verified: true, verifyOutput },
      worktreePathsAtPreparation: []
    });
    const attempts: BranchCloseoutAttempt[] = [];
    const operationId = branchLifecycleDigest({ kind: 'hosted-native-ref-delete', headSha }) as OperationDigest;
    const result = await withWorkspaceWriteLease(commonDir, undefined, async (lease) =>
      (await deleteHostedLocalRefCas(preparation, attempts, lease, operationId)));
    expect(result).toMatchObject({ operation: 'local-delete', status: 'success' });
    expect(attempts).toHaveLength(1);
    expect(spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/feat/example'], {
      cwd: repositoryRoot, windowsHide: true
    }).status).toBe(1);
    expect(git(repositoryRoot, ['rev-parse', 'HEAD'])).toBe(headSha);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
