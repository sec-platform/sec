import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { chmod, lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acquirePhysicalMutationLease } from '../../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

import { configTransitionNames, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('a prepared publication with a changed source is retained and blocks guessed retirement', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterGenerationPublication: true
    })).toMatchObject({ status: 'conflict' });
    const managedRoot = path.join(
      path.resolve(git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])),
      'sec-managed-hooks-v3'
    );
    const published = (await readdir(managedRoot, { withFileTypes: true }))
      .find((entry) => entry.name.startsWith('generation-'));
    expect(published).toBeDefined();
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await readdir(managedRoot)).toContain(published!.name);
  });
});

test('managed fast-path settlement preserves an unresolved lease and foreign transition members', async () => {
  await withRepository(async (repoRoot) => {
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    let leaseName: string | undefined;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true,
      configActorAfterStep: (stepIndex) => {
        if (stepIndex !== 0) return;
        const leases = readdirSync(managedRoot).filter((name) => name.startsWith('lease-'));
        expect(leases).toHaveLength(1);
        leaseName = leases[0];
      }
    })).toMatchObject({ status: 'conflict' });
    expect(leaseName).toBeDefined();
    const leasePath = path.join(managedRoot, leaseName!);
    const transitionNames = await configTransitionNames(repoRoot);
    expect(transitionNames).toHaveLength(1);
    await expect(lstat(leasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    const configPath = path.join(commonGitDir, 'config');
    const configBytes = await readFile(configPath);
    const worktreeConfigPath = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'config.worktree'
    ]));
    const worktreeConfigBytes = await readFile(worktreeConfigPath);
    const managedRootIdentity = inspectNoFollowDirectoryChain(
      managedRoot,
      'Managed hook fast-path recovery fixture'
    ).target;
    const unresolved = acquirePhysicalMutationLease(managedRootIdentity, leaseName!, {
      ownerPid: 2_147_483_647
    });
    expect(unresolved).not.toBeNull();
    try {
      const unresolvedBytes = await readFile(leasePath);
      const unresolvedIdentity = await lstat(leasePath, { bigint: true });
      expect(await installGitHooks({ repoRoot, lifecycle: true }))
        .toMatchObject({ status: 'conflict' });
      expect(await readFile(leasePath)).toEqual(unresolvedBytes);
      const retainedIdentity = await lstat(leasePath, { bigint: true });
      expect([retainedIdentity.dev, retainedIdentity.ino])
        .toEqual([unresolvedIdentity.dev, unresolvedIdentity.ino]);
      expect(await configTransitionNames(repoRoot)).toEqual(transitionNames);
      expect(await readFile(configPath)).toEqual(configBytes);
      expect(await readFile(worktreeConfigPath)).toEqual(worktreeConfigBytes);
    } finally {
      unresolved?.release();
    }

    const unexpectedTransitionFile = path.join(
      managedRoot, transitionNames[0]!, 'unexpected-recovery-fixture'
    );
    const foreignBytes = 'preserve foreign transition member\n';
    await writeFile(unexpectedTransitionFile, foreignBytes, 'utf8');
    await settleWorkspaceCallback(async () => {
      expect(await installGitHooks({ repoRoot, lifecycle: true }))
        .toMatchObject({ status: 'conflict' });
      expect(await readFile(unexpectedTransitionFile, 'utf8')).toBe(foreignBytes);
      expect(await configTransitionNames(repoRoot)).toEqual(transitionNames);
    }, async () => {
      await rm(unexpectedTransitionFile);
    });
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expect(lstat(leasePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
