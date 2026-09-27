import { expect, test } from 'bun:test';
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configTransitionNames, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('unknown or forked config transition namespaces are retained and block reuse', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const commonGitDir = path.resolve(git(repoRoot, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]));
    const foreignTransition = path.join(
      commonGitDir,
      'sec-managed-hooks-v3',
      'config-transition-' + 'f'.repeat(64)
    );
    await mkdir(foreignTransition);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(await readdir(path.dirname(foreignTransition))).toContain(path.basename(foreignTransition));
  });
});

test('a completed prior transition settles before a valid source update starts a new operation', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(previousGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});

test('durable prior generation inventory settles after marker crash and source update', async () => {
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
      crashAfterMarkerPublication: true
    })).toMatchObject({ status: 'conflict' });
    expect(await configTransitionNames(repoRoot)).toHaveLength(1);
    expect(await lstat(previousGeneration)).not.toBeNull();

    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(previousGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
    expect(await configTransitionNames(repoRoot)).toHaveLength(0);
    await expectManagedHooksMirror(repoRoot, currentGeneration);
  });
});
