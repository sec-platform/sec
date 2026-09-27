import { expect, test } from 'bun:test';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, managedHookNames, withRepository } from './fixtures/install-git-hooks.ts';
test('authorized damaged prior generation gets a bounded transient capacity slot', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const firstGeneration = configuredManagedHooksPath(repoRoot);
    const sourcePath = path.join(repoRoot, '.githooks', 'pre-commit');
    const updatedSource = (await readFile(sourcePath, 'utf8')).replace('set -eu', 'set -ux');
    await writeFile(sourcePath, updatedSource, 'utf8');
    await chmod(sourcePath, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    git(repoRoot, ['update-index', '--chmod=+x', '.githooks/pre-commit']);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const currentGeneration = configuredManagedHooksPath(repoRoot);
    expect(currentGeneration).not.toBe(firstGeneration);

    const generationBytes = new Map<string, Buffer>();
    for (const hook of managedHookNames) {
      generationBytes.set(hook, await readFile(path.join(currentGeneration, hook)));
    }
    const duplicateGenerations: string[] = [];
    const digest = /^generation-([0-9a-f]{64})/u.exec(path.basename(currentGeneration))?.[1];
    expect(digest).toBeDefined();
    for (let index = 1; index <= 7; index += 1) {
      const duplicate = path.join(
        path.dirname(currentGeneration),
        `generation-${digest}-00000000-0000-0000-0000-${String(index).padStart(12, '0')}`
      );
      duplicateGenerations.push(duplicate);
      await mkdir(duplicate);
      for (const hook of managedHookNames) {
        await writeFile(path.join(duplicate, hook), generationBytes.get(hook)!);
        await chmod(path.join(duplicate, hook), 0o755);
      }
    }

    const damagedBytes = '#!/usr/bin/env sh\nexit 42\n';
    await writeFile(path.join(currentGeneration, 'pre-commit'), damagedBytes, 'utf8');
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const repairedGeneration = configuredManagedHooksPath(repoRoot);
    expect(repairedGeneration).not.toBe(currentGeneration);
    await expectManagedHooksMirror(repoRoot, repairedGeneration);
    await expect(lstat(currentGeneration)).rejects.toThrow();
    for (const duplicate of duplicateGenerations) {
      await expect(lstat(duplicate)).rejects.toThrow();
    }
  });
});
