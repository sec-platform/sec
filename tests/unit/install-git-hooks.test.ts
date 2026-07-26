import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('tracked hooks bind dependency preparation and candidate freeze without ambient EOL drift', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const agentContract = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const preCommit = await readFile(path.join(repoRoot, '.githooks', 'pre-commit'), 'utf8');
  const prePush = await readFile(path.join(repoRoot, '.githooks', 'pre-push'), 'utf8');
  const postCheckout = await readFile(path.join(repoRoot, '.githooks', 'post-checkout'), 'utf8');
  const postMerge = await readFile(path.join(repoRoot, '.githooks', 'post-merge'), 'utf8');
  const postRewrite = await readFile(path.join(repoRoot, '.githooks', 'post-rewrite'), 'utf8');
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
  for (const dependencyHook of [postCheckout, postMerge, postRewrite]) {
    expect(dependencyHook).toContain('bun ./platform/dev-runner.ts deps:ensure');
  }
  expect(postCheckout).not.toContain('\r');
  expect(attributes).toContain('/.githooks/* text eol=lf');
});
