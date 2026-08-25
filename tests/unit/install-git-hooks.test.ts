import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('tracked hooks bind one commit sentinel without duplicating import work at push', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const preCommit = await readFile(path.join(repoRoot, '.githooks', 'pre-commit'), 'utf8');
  const attributes = await readFile(path.join(repoRoot, '.gitattributes'), 'utf8');

  expect(preCommit).toContain('export SEC_GIT_HOOK_ACTIVE=1');
  expect(preCommit).toContain('bun ./platform/dev-runner.ts imports:freeze');
  expect(preCommit).not.toContain('SEC_CHANGED_BASE');
  expect(preCommit).not.toContain('\r');
  await expect(readFile(path.join(repoRoot, '.githooks', 'pre-push'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  for (const retired of ['pre-push', 'post-checkout', 'post-merge', 'post-rewrite']) {
    await expect(readFile(path.join(repoRoot, '.githooks', retired), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect(attributes).toContain('/.githooks/* text eol=lf');
});
