import { expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer preserves an effective worktree authority in explicit and lifecycle modes', async () => {
  await withRepository(async (repoRoot) => {
    const customHooks = path.join(repoRoot, 'custom-hooks');
    await mkdir(customHooks);
    git(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
    git(repoRoot, ['config', '--worktree', 'core.hooksPath', customHooks]);

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('Existing Git hook authority is preserved');
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(customHooks);

    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe(customHooks);
  });
});

test('hook installer audits default hooks and preserves a non-sample authority', async () => {
  await withRepository(async (repoRoot) => {
    const defaultHook = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
    await writeFile(defaultHook, '#!/usr/bin/env sh\nexit 0\n', 'utf8');

    await expect(installGitHooks({ repoRoot })).rejects.toThrow(defaultHook);
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer requires the tracked managed hook before configuring authority', async () => {
  await withRepository(async (repoRoot) => {
    git(repoRoot, ['rm', '--cached', '--quiet', '.githooks/pre-commit']);
    await rm(path.join(repoRoot, '.githooks', 'pre-commit'));

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    git(repoRoot, ['update-index', '--chmod=-x', '.githooks/pre-commit']);

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, '.githooks', 'pre-commit'), '#!/usr/bin/env sh\nexit 42\n', 'utf8');

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('index-identical managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer requires executable managed sources on POSIX', async () => {
  if (process.platform === 'win32') return;
  await withRepository(async (repoRoot) => {
    await chmod(path.join(repoRoot, '.githooks', 'pre-commit'), 0o644);
    expect(await installGitHooks({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});
