import { expect, test } from 'bun:test';
import { chmod, lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acquirePhysicalMutationLease } from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';

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
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await readdir(managedRoot)).toContain(published!.name);
  });
});

test('managed fast path settles a completed transition after marker publication interruption', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
  });
});

test('managed fast-path recovery acknowledges a dead operation owner only after transition settlement', async () => {
  await withRepository(async (repoRoot) => {
    const deadPid = 2_147_483_647;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterOperationLeaseAcquisition: true,
      leaseOwnerPid: deadPid
    })).toMatchObject({ status: 'conflict' });

    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const managedRoot = path.join(commonGitDir, 'sec-managed-hooks-v3');
    const managedRootIdentity = inspectNoFollowDirectoryChain(
      managedRoot,
      'Managed hook fast-path recovery fixture'
    ).target;
    const issuedLeaseEntries = (await readdir(managedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile());
    expect(issuedLeaseEntries).toHaveLength(1);
    const leaseName = issuedLeaseEntries[0]!.name;
    const leasePath = path.join(managedRoot, leaseName);

    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    const transitionNames = await configTransitionNames(repoRoot);
    expect(transitionNames).toHaveLength(1);
    await expect(lstat(leasePath)).rejects.toThrow();

    const abandoned = acquirePhysicalMutationLease(managedRootIdentity, leaseName, {
      ownerPid: deadPid
    });
    expect(abandoned).not.toBeNull();
    const abandonedBytes = await readFile(leasePath);
    const unexpectedTransitionFile = path.join(
      managedRoot,
      transitionNames[0]!,
      'unexpected-recovery-fixture'
    );
    await writeFile(unexpectedTransitionFile, 'preserve predecessor lease\n', 'utf8');

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await readFile(leasePath)).toEqual(abandonedBytes);
    expect(await configTransitionNames(repoRoot)).toEqual(transitionNames);

    await rm(unexpectedTransitionFile);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expect(lstat(leasePath)).rejects.toThrow();
  });
});
