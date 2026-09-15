import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'bun:test';

import { installGitHooksForTest, observeManagedGitHooksWithSession } from '../../src/development/hooks/install.ts';
import { withAuthorityGitReadSession } from '../../src/external-capabilities/git-read/authority.ts';
import {
  GIT_READ_DEFAULT_OPERATION_BUDGET,
  isolatedGitReadEnvironment,
  type GitReadProviderResolutionFailure
} from '../../src/external-capabilities/git-read/runtime/session.ts';

test('tracked hooks bind deterministic staged normalization and candidate freeze without ambient EOL drift', async () => {
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
      'imports:apply',
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
  expect(postCheckout).not.toContain('\r');
  expect(attributes).toContain('/.githooks/* text eol=lf');
});

test('transition hooks supply canonical package identity and preserve Git arguments and stdin', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  const root = await mkdtemp(path.join(tmpdir(), 'sec hook package '));
  try {
    const authority = pathToFileURL(path.join(repoRoot, 'src/toolchain/runtime/bun-version.ts')).href;
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      type: 'module',
      scripts: { dev: '"$npm_execpath" ./runner.ts' }
    }));
    await writeFile(path.join(root, 'runner.ts'), `
import { assertCanonicalBunPackageRunner } from ${JSON.stringify(authority)};
assertCanonicalBunPackageRunner(${JSON.stringify(process.versions.bun)}, undefined, process.cwd());
console.log(JSON.stringify({ args: process.argv.slice(2), active: process.env.SEC_GIT_HOOK_ACTIVE,
  stdin: await Bun.stdin.text() }));
`);
    for (const event of ['post-checkout', 'post-merge', 'post-rewrite']) {
      const executed = spawnSync('sh', [path.join(repoRoot, '.githooks', event), 'first argument', '0'], {
        cwd: root,
        input: 'old new\n',
        encoding: 'utf8',
        env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
        windowsHide: true
      });
      expect({ status: executed.status, error: executed.error }).toEqual({ status: 0, error: undefined });
      expect(JSON.parse(executed.stdout)).toEqual({
        args: ['workspace-transition', event, 'first argument', '0'],
        active: '1',
        stdin: 'old new\n'
      });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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

test('hook observation borrows one Git session without closing its owner capability', async () => {
  const repoRoot = path.resolve(import.meta.dir, '../..');
  await withAuthorityGitReadSession({
    cwd: repoRoot,
    source: isolatedGitReadEnvironment(),
    budget: GIT_READ_DEFAULT_OPERATION_BUDGET
  }, async (session) => {
    const first = await observeManagedGitHooksWithSession({ repoRoot, session });
    expect(session.verifyExecutable()).toBe(true);

    const second = await observeManagedGitHooksWithSession({ repoRoot, session });
    expect(second.disposition).toBe(first.disposition);
    expect(session.verifyExecutable()).toBe(true);
  });
});
