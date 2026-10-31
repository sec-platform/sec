import { expect, test } from 'bun:test';
import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
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
    git(repoRoot, ['add', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationRetirementDelete: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    await expect(lstat(previousGeneration)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('operation lease preserves an interrupted owner even when its PID cannot authorize recovery', async () => {
  await withRepository(async (repoRoot) => {
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const configPath = path.join(commonGitDir, 'config');
    const originalConfig = await readFile(configPath);
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: 2_147_483_647
    })).toMatchObject({ status: 'conflict' });

    const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const entries = await readdir(managedRoot);
    expect(entries).toHaveLength(1);
    const leasePath = path.join(managedRoot, entries[0]!);
    const leaseBytes = await readFile(leasePath);
    const leaseIdentity = await lstat(leasePath, { bigint: true });
    expect(leaseIdentity.isFile()).toBe(true);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await readFile(leasePath)).toEqual(leaseBytes);
    const retainedIdentity = await lstat(leasePath, { bigint: true });
    expect([retainedIdentity.dev, retainedIdentity.ino]).toEqual([leaseIdentity.dev, leaseIdentity.ino]);
    expect(await readdir(managedRoot)).toEqual(entries);
    expect(await configTransitionNames(repoRoot)).toEqual([]);
    expect(await readFile(configPath)).toEqual(originalConfig);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
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
