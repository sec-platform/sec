import { expect, test } from 'bun:test';
import { chmod, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('prior retirement recovers after delete before its durable retired receipt', async () => {
  await withRepository(async (repoRoot) => {
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationRetirementDelete: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    await expect(lstat(previousGeneration)).rejects.toThrow();

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('operation lease reclaims an exact dead owner and preserves live or foreign owners', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: 2_147_483_647
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: process.pid
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
  });

  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerHost: 'foreign-host-for-sec-test',
      leaseOwnerPid: process.pid
    })).toMatchObject({ status: 'conflict' });
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
  });
});

test('external config actor divergence is preserved and typed between effect and readback', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      configActorAfterStep: (stepIndex, actorRoot) => {
        if (stepIndex === 0) {
          git(actorRoot, ['config', '--local', 'extensions.worktreeConfig', 'false']);
        }
      }
    })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig']))
      .toBe('false');
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
  });
});
