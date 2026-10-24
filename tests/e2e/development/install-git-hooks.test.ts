import { expect, test } from 'bun:test';
import path from 'node:path';

import { configuredBootstrapHooksPath, configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer configures unset authority idempotently', async () => {
  await withRepository(async (repoRoot) => {
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    expect(path.resolve(git(repoRoot, ['config', '--get', 'core.hooksPath']))).toBe(configured);
    expect(configuredBootstrapHooksPath(repoRoot)).toBe(configured);
    expect(git(repoRoot, ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'])).toBe('true');
    await expectManagedHooksMirror(repoRoot, configured);
    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'managed' });
    expect(configuredManagedHooksPath(repoRoot)).toBe(configured);
  });
});

test('hook installer validates the Git SHA-256 blob formula', async () => {
  await withRepository(async (repoRoot) => {
    expect(git(repoRoot, ['rev-parse', '--show-object-format'])).toBe('sha256');
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  }, ['--object-format=sha256']);
});
