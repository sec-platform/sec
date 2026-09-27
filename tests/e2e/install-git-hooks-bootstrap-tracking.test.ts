import { expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installGitHooks as installGitHooksProduction } from '../../src/adapters/self-hosting/development/hooks/install.ts';

import { configuredManagedHooksPath, expectManagedHooksMirror, git, withCanonicalRemoteRepository } from './fixtures/install-git-hooks.ts';
test('primary bootstrap rejects invalid local tracking authority and accepts main descendants', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
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
