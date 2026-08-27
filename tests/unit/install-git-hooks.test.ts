import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('tracked hooks bind dependency preparation and candidate freeze without ambient EOL drift', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const preCommit = await readFile(path.join(repoRoot, '.githooks', 'pre-commit'), 'utf8');
  const prePush = await readFile(path.join(repoRoot, '.githooks', 'pre-push'), 'utf8');
  const postCheckout = await readFile(path.join(repoRoot, '.githooks', 'post-checkout'), 'utf8');
  const postMerge = await readFile(path.join(repoRoot, '.githooks', 'post-merge'), 'utf8');
  const postRewrite = await readFile(path.join(repoRoot, '.githooks', 'post-rewrite'), 'utf8');
  const attributes = await readFile(path.join(repoRoot, '.gitattributes'), 'utf8');

  for (const hook of [preCommit, prePush, postCheckout, postMerge, postRewrite]) {
    expect(hook).toContain('export SEC_GIT_HOOK_ACTIVE=1');
  }
  expect(preCommit).toContain('bun ./platform/dev-runner.ts imports:freeze');
  expect(preCommit).not.toContain('SEC_CHANGED_BASE');
  expect(preCommit).not.toContain('\r');
  expect(prePush).toContain('bun ./platform/dev-runner.ts imports:freeze');
  expect(prePush).toContain('git diff --cached --quiet HEAD');
  expect(prePush).not.toContain('\r');
  for (const dependencyHook of [postCheckout, postMerge, postRewrite]) {
    expect(dependencyHook).toContain('bun ./scripts/install-git-hooks.ts --lifecycle');
    expect(dependencyHook).toContain('bun ./platform/dev-runner.ts deps:ensure');
    expect(dependencyHook.indexOf('install-git-hooks.ts --lifecycle'))
      .toBeLessThan(dependencyHook.indexOf('dev-runner.ts deps:ensure'));
  }
  expect(postCheckout).not.toContain('\r');
  expect(attributes).toContain('/.githooks/* text eol=lf');
});
