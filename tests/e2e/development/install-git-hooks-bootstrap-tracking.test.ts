import { expect, test } from 'bun:test';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installGitHooks as installGitHooksProduction } from '../../../src/adapters/self-hosting/development/hooks/install.ts';

import { configuredManagedHooksPath, expectManagedHooksMirror, git, withCanonicalRemoteRepository } from './fixtures/install-git-hooks.ts';
test('primary bootstrap rejects invalid local tracking authority and accepts main descendants', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    const stagedHook = path.join(repoRoot, '.githooks', 'pre-commit');
    await writeFile(
      stagedHook,
      "#!/usr/bin/env sh\nset -ux\n\n bun ./src/bootstrap/development/runner-cli.ts imports:freeze\n",
      'utf8'
    );
    await chmod(stagedHook, 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({
        status: 'conflict',
        message: 'Tracked, executable, index-identical managed hooks are unavailable in the current or primary-bootstrap worktree; Git hook authority was not changed.'
      });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
    // Restore the exact HEAD/index/worktree source before testing tracking-ref authority.
    git(repoRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '.githooks/pre-commit']);

    try {
      git(repoRoot, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/HEAD'
      ]);
    } catch {
      git(repoRoot, [
        'update-ref',
        '--no-deref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/HEAD'
      ]);
    }
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    const initial = git(repoRoot, ['rev-parse', 'HEAD']);
    await writeFile(path.join(repoRoot, 'REMOTE.md'), 'new remote head\n', 'utf8');
    git(repoRoot, ['add', 'REMOTE.md']);
    git(repoRoot, ['commit', '--quiet', '-m', 'advance remote fixture']);
    git(repoRoot, ['push', '--quiet', 'origin', 'main']);
    git(repoRoot, ['update-ref', 'refs/heads/main', initial]);
    git(repoRoot, ['reset', '--quiet', '--hard', initial]);
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', initial]);
    git(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });

  await withCanonicalRemoteRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, 'LOCAL.md'), 'local ahead\n', 'utf8');
    git(repoRoot, ['add', 'LOCAL.md']);
    git(repoRoot, ['commit', '--quiet', '-m', 'local ahead fixture']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});
