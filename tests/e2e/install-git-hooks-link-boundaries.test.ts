import { expect, test } from 'bun:test';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { configuredManagedHooksPath, git, installGitHooks, tryCreateLink, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer rejects a symlinked managed generation root without replacing it', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const foreignGeneration = path.join(repoRoot, 'foreign-generation');
    await mkdir(foreignGeneration);
    await rm(previousGeneration, { recursive: true, force: true });
    if (!await tryCreateLink(
      foreignGeneration,
      previousGeneration,
      process.platform === 'win32' ? 'junction' : 'dir'
    )) return;

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(previousGeneration)).isSymbolicLink()).toBe(true);
  });
});

test('hook installer rejects a symlinked managed hook without replacing it', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const previousGeneration = configuredManagedHooksPath(repoRoot);
    const occupiedHook = path.join(previousGeneration, 'pre-commit');
    const foreignHook = path.join(repoRoot, 'foreign-pre-commit');
    await writeFile(foreignHook, '#!/usr/bin/env sh\nexit 42\n', 'utf8');
    await rm(occupiedHook, { force: true });
    if (!await tryCreateLink(foreignHook, occupiedHook, 'file')) return;

    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(previousGeneration);
    expect((await lstat(occupiedHook)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignHook, 'utf8')).toBe('#!/usr/bin/env sh\nexit 42\n');
  });
});

test('hook installer rejects repository and common-Git ancestor links before any config effect', async () => {
  let alias: string | null = null;
  try {
    await withRepository(async (repoRoot) => {
      alias = `${repoRoot}-ancestor-alias`;
      if (await tryCreateLink(repoRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')) {
        expect(await installGitHooks({ repoRoot: alias, lifecycle: true }))
          .toMatchObject({ status: 'conflict' });
        expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
      }

      expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
      const commonGitDir = path.resolve(git(repoRoot, [
        'rev-parse', '--path-format=absolute', '--git-common-dir'
      ]));
      const retainedCommonDir = path.join(repoRoot, '.git-retained-for-link-test');
      await rename(commonGitDir, retainedCommonDir);
      if (!await tryCreateLink(
        retainedCommonDir,
        commonGitDir,
        process.platform === 'win32' ? 'junction' : 'dir'
      )) {
        await rename(retainedCommonDir, commonGitDir);
        return;
      }
      expect(await installGitHooks({ repoRoot, lifecycle: true }))
        .toMatchObject({ status: 'conflict' });
      expect((await lstat(commonGitDir)).isSymbolicLink()).toBe(true);
    });
  } finally {
    if (alias !== null) await rm(alias, { recursive: true, force: true });
  }
});
