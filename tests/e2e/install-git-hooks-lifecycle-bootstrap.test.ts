import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installGitHooksMain } from '../../src/adapters/self-hosting/development/hooks/install.ts';

import { configuredBootstrapHooksPath, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, managedHookNames, managedHookSource, withRepository } from './fixtures/install-git-hooks.ts';
test('production hook installer CLI rejects the no-remote fixture authority flag', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooksMain({
      argv: ['--test-no-remote-fixture'],
      cwd: repoRoot,
      env: { ...process.env, CI: 'false' }
    })).toBe(1);
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});

test('hook installer keeps primary bootstrap and linked worktree generations independent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-linked-'));
  const repoRoot = path.join(root, 'main');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet', '-b', 'main']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await mkdir(path.join(repoRoot, '.githooks'));
    await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(hookPath, managedHookSource(hook), 'utf8');
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, ['add', '.gitattributes', 'README.md', '.githooks']);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
    git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-fixture', linkedRoot]);
    const linkedPostMerge = path.join(linkedRoot, '.githooks', 'post-merge');
    await writeFile(linkedPostMerge, `${managedHookSource('post-merge')}# linked-branch-hook\n`, 'utf8');
    await chmod(linkedPostMerge, 0o755);
    git(linkedRoot, ['add', '.githooks/post-merge']);
    git(linkedRoot, ['update-index', '--chmod=+x', '.githooks/post-merge']);

    expect(await installGitHooks({ repoRoot: linkedRoot })).toMatchObject({ status: 'installed' });

    const linkedGeneration = configuredManagedHooksPath(linkedRoot);
    const bootstrapGeneration = configuredBootstrapHooksPath(repoRoot);
    expect(linkedGeneration).not.toBe(bootstrapGeneration);
    expect(path.resolve(git(linkedRoot, ['config', '--get', 'core.hooksPath']))).toBe(linkedGeneration);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).toBe(bootstrapGeneration);
    expect(() => git(repoRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toThrow();
    await expectManagedHooksMirror(linkedRoot, linkedGeneration);
    await expectManagedHooksMirror(repoRoot, bootstrapGeneration);
    expect(await readFile(path.join(linkedGeneration, 'post-merge'), 'utf8')).toContain('# linked-branch-hook');
    expect(await readFile(path.join(bootstrapGeneration, 'post-merge'), 'utf8')).not.toContain('# linked-branch-hook');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hook installer refuses a non-default primary as linked bootstrap', async () => {
  await withRepository(async (repoRoot) => {
    git(repoRoot, ['branch', '--move', 'candidate-primary']);
    git(repoRoot, ['remote', 'add', 'origin', path.join(repoRoot, 'origin.git')]);
    git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const linkedRoot = path.join(path.dirname(repoRoot), 'linked-non-default');
    git(repoRoot, ['worktree', 'add', '--quiet', '-b', 'linked-non-default', linkedRoot]);

    expect(await installGitHooks({ repoRoot: linkedRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--local', '--get', 'core.hooksPath'])).toThrow();
    expect(() => git(linkedRoot, ['config', '--worktree', '--get', 'core.hooksPath'])).toThrow();
  });
});
