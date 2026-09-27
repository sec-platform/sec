import { expect, test } from 'bun:test';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installGitHooks as installGitHooksProduction } from '../../src/adapters/self-hosting/development/hooks/install.ts';

import { git, withCanonicalRemoteRepository } from './fixtures/install-git-hooks.ts';
test('primary bootstrap rejects staged managed-hook bytes that are not the remote-bound HEAD tree', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    await writeFile(
      path.join(repoRoot, '.githooks', 'pre-commit'),
      '#!/usr/bin/env sh\nset -ux\n\n bun ./src/adapters/self-hosting/development/runner/cli.ts imports:freeze\n',
      'utf8'
    );
    await chmod(path.join(repoRoot, '.githooks', 'pre-commit'), 0o755);
    git(repoRoot, ['add', '.githooks/pre-commit']);
    expect(await installGitHooksProduction({ repoRoot, lifecycle: true }))
      .toMatchObject({ status: 'conflict' });
    expect(() => git(repoRoot, ['config', '--get', 'core.hooksPath'])).toThrow();
  });
});
