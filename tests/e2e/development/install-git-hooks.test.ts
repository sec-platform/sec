import { expect, test } from 'bun:test';

import { configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, withRepository } from './fixtures/install-git-hooks.ts';
test('hook installer validates the Git SHA-256 blob formula', async () => {
  await withRepository(async (repoRoot) => {
    expect(git(repoRoot, ['rev-parse', '--show-object-format'])).toBe('sha256');
    expect(['installed', 'managed']).toContain((await installGitHooks({ repoRoot })).status);
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  }, ['--object-format=sha256']);
});
