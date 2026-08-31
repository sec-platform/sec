import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { installGitHooksForTest } from '../../src/development/hooks/install.ts';
import type { GitReadProviderResolutionFailure } from '../../src/external-capabilities/git-read/runtime/session.ts';

test('tracked hooks bind a pure staged check and candidate freeze without ambient EOL drift', async () => {
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
  const observationRoot = await mkdtemp(path.join(tmpdir(), 'sec-hook-command-'));
  try {
    const argumentsPath = path.join(observationRoot, 'arguments');
    const executed = spawnSync('sh', [
      '-c',
      'bun() { printf "%s\\n" "$@" > "$SEC_HOOK_ARGUMENTS"; }\n. "$1"',
      'hook-contract',
      path.join(repoRoot, '.githooks', 'pre-commit')
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, SEC_HOOK_ARGUMENTS: argumentsPath },
      windowsHide: true
    });
    expect(executed.status).toBe(0);
    expect((await readFile(argumentsPath, 'utf8')).trim().split(/\r?\n/u)).toEqual([
      'run',
      'imports:check',
      '--staged'
    ]);
  } finally {
    await rm(observationRoot, { force: true, recursive: true });
  }
  expect(preCommit).not.toContain('SEC_CHANGED_BASE');
  expect(preCommit).not.toContain('\r');
  expect(prePush).toContain('bun run imports:freeze');
  expect(prePush).toContain('git diff --cached --quiet HEAD');
  expect(prePush).not.toContain('\r');
  for (const dependencyHook of [postCheckout, postMerge, postRewrite]) {
    const lifecycleIndex = dependencyHook.indexOf('bun run postinstall');
    const dependencyIndex = dependencyHook.indexOf('bun run deps:ensure');
    expect(lifecycleIndex).toBeGreaterThanOrEqual(0);
    expect(dependencyIndex).toBeGreaterThan(lifecycleIndex);
  }
  expect(postCheckout).not.toContain('\r');
  expect(attributes).toContain('/.githooks/* text eol=lf');
});

test('hook installer keeps Windows provider admission separate from host executable execution', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const spawned: string[] = [];
  const providerFailure: GitReadProviderResolutionFailure = Object.freeze({
    kind: 'unresolved-git-read-provider',
    route: 'host-local-git-v1',
    status: 'unavailable',
    reason: 'git-session-failed',
    detailDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`
  });

  const result = await installGitHooksForTest({
    repoRoot,
    lifecycle: true,
    providerResolutionForTest: providerFailure,
    beforeSpawnForTest: (kind) => spawned.push(kind)
  });

  expect(result.status).toBe('conflict');
  expect(result.message).toContain('Git provider admission is unavailable for host-local-git-v1');
  expect(result.message).toContain('git-session-failed');
  expect(result.message).toContain(providerFailure.detailDigest);
  expect(spawned).toEqual([]);
});
