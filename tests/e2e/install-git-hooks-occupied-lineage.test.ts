import { expect, test } from 'bun:test';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configuredManagedHooksPath, expectManagedHooksMirror, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer never replaces an occupied managed generation root', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    await rm(previousGeneration, { recursive: true, force: true });
    await mkdir(previousGeneration);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(previousGeneration)).isDirectory()).toBe(true);
    const marker = (await readFile(path.join(path.dirname(previousGeneration), '.last-install'), 'utf8'))
      .split('\n');
    expect(marker[2]).toBe(path.basename(previousGeneration));
  });
});

test('hook installer never replaces an occupied managed hook entry', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    await rm(occupiedHook, { force: true });
    await mkdir(occupiedHook);

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(occupiedHook)).isDirectory()).toBe(true);
  });
});

test('hook installer retires a rename-replaced entry only through exact managed lineage evidence', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    const replacement = path.join(repoRoot, 'replacement-pre-commit');
    const replacementBytes = '#!/usr/bin/env sh\nexit 42\n';
    await writeFile(replacement, replacementBytes, 'utf8');
    await rm(occupiedHook, { force: true });
    await rename(replacement, occupiedHook);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const reboundGeneration = configuredManagedHooksPath(repoRoot);
    expect(reboundGeneration).not.toBe(previousGeneration);
    await expectManagedHooksMirror(repoRoot, reboundGeneration);
    await expect(lstat(previousGeneration)).rejects.toThrow();
  });
});
