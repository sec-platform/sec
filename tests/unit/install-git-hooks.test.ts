import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { installGitHooks, installGitHooksMain } from '../../scripts/install-git-hooks.ts';

const managedHookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge', 'post-rewrite'] as const;

function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function withRepository(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-install-'));
  try {
    git(repoRoot, ['init', '--quiet']);
    await mkdir(path.join(repoRoot, '.githooks'));
    await Promise.all(managedHookNames.map((hook) => (
      writeFile(path.join(repoRoot, '.githooks', hook), '#!/usr/bin/env sh\nexit 0\n', 'utf8')
    )));
    git(repoRoot, ['add', '.githooks']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test('hook installer configures unset and stale missing paths and is idempotent', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe('.githooks');
    expect(git(repoRoot, ['config', '--get', 'core.hooksPath'])).toBe('.githooks');
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'])).toBe('true');
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
  });

  await withRepository(async (repoRoot) => {
    const staleHooks = path.join(repoRoot, 'missing-hooks');
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    expect(git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toBe(staleHooks);
    expect(git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe('.githooks');
    expect(git(repoRoot, ['config', '--get', 'core.hooksPath'])).toBe('.githooks');
  });
});

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

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('Tracked executable managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withRepository(async (repoRoot) => {
    git(repoRoot, ['update-index', '--chmod=-x', '.githooks/pre-commit']);

    await expect(installGitHooks({ repoRoot })).rejects.toThrow('Tracked executable managed hooks are unavailable');
    expect(await installGitHooks({ repoRoot, lifecycle: true })).toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer lifecycle skips CI and Gitless environments while explicit install fails', async () => {
  const gitlessRoot = await mkdtemp(path.join(tmpdir(), 'sec-hooks-gitless-'));
  try {
    await writeFile(path.join(gitlessRoot, '.git'), 'gitdir: missing\n', 'utf8');
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'true' }
    })).toBe(0);
    expect(await installGitHooksMain({
      argv: ['--lifecycle'],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(0);
    expect(await installGitHooksMain({
      argv: [],
      cwd: gitlessRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
  } finally {
    await rm(gitlessRoot, { recursive: true, force: true });
  }
});

test('hook installer isolates linked-worktree configuration from shared stale authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-linked-'));
  const repoRoot = path.join(root, 'main');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await mkdir(path.join(repoRoot, '.githooks'));
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    await Promise.all(managedHookNames.map((hook) => (
      writeFile(path.join(repoRoot, '.githooks', hook), '#!/usr/bin/env sh\nexit 0\n', 'utf8')
    )));
    git(repoRoot, ['add', 'README.md', '.githooks']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
    const staleHooks = path.join(root, 'missing-shared-hooks');
    git(repoRoot, ['config', '--local', 'core.hooksPath', staleHooks]);
    git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-fixture', linkedRoot]);

    expect(await installGitHooks({ repoRoot: linkedRoot })).toMatchObject({ status: 'installed' });

    expect(git(linkedRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toBe('.githooks');
    expect(git(linkedRoot, ['config', '--get', 'core.hooksPath'])).toBe('.githooks');
    expect(git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toBe(staleHooks);
    expect(git(repoRoot, ['config', '--get', 'core.hooksPath'])).toBe(staleHooks);
    expect(await readFile(path.join(repoRoot, '.git', 'config'), 'utf8')).not.toContain('path = .githooks');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tracked hooks bootstrap dependencies and freeze the complete candidate automatically', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const agentContract = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const preCommit = await readFile(path.join(repoRoot, '.githooks', 'pre-commit'), 'utf8');
  const prePush = await readFile(path.join(repoRoot, '.githooks', 'pre-push'), 'utf8');
  const postCheckout = await readFile(path.join(repoRoot, '.githooks', 'post-checkout'), 'utf8');
  const attributes = await readFile(path.join(repoRoot, '.gitattributes'), 'utf8');

  expect(agentContract).toContain('pre-commit imports:freeze');
  expect(agentContract).toContain('选择范围始终是完整 base→candidate index TypeScript diff');
  expect(agentContract).not.toContain('pre-commit imports:staged');
  expect(agentContract).not.toContain('普通提交仍只处理 staged paths');
  expect(preCommit).toContain('bun ./platform/dev-runner.ts imports:freeze');
  expect(preCommit).not.toContain('SEC_CHANGED_BASE');
  expect(preCommit).not.toContain('\r');
  expect(prePush).toContain('bun ./platform/dev-runner.ts imports:freeze');
  expect(prePush).toContain('git diff --cached --quiet HEAD');
  expect(prePush).not.toContain('\r');
  expect(postCheckout).toContain('bun ./platform/dev-runner.ts deps:ensure');
  expect(postCheckout).not.toContain('\r');
  expect(attributes).toContain('/.githooks/* text eol=lf');
});
