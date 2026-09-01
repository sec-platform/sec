import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  DEVELOPMENT_COMMIT_EFFECT_GRANT_DENIAL,
  DevelopmentCommitEffectGrantUnavailableError,
  runDevelopmentCommitCommand
} from '../../src/development/commit/effect-grant.ts';
import {
  retryDevelopmentCommit,
  runDevelopmentCommit,
  type DevelopmentCommitRecovery,
  type DevelopmentCommitRequest
} from '../../src/development/commit/operation.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture(): Promise<Readonly<{ root: string; request: DevelopmentCommitRequest }>> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-denial-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  await writeFile(path.join(root, 'base.txt'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  await writeFile(path.join(root, 'next.txt'), 'next\n');
  git(root, ['add', 'next.txt']);
  return Object.freeze({
    root,
    request: Object.freeze({
      repositoryRoot: path.resolve(root), message: 'denied commit\n',
      author: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' }),
      committer: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' })
    })
  });
}

test('development.commit denies structural and self-digest grants before any Git Effect', async () => {
  const { root, request } = await fixture();
  try {
    const before = Object.freeze({ head: git(root, ['rev-parse', 'HEAD']), index: git(root, ['write-tree']), objects: git(root, ['count-objects', '-v']) });
    const forged = Object.freeze({ authorityGrantDigest: `sha256:${'0'.repeat(64)}`, repositoryRoot: root });
    await expect(runDevelopmentCommit(request, forged)).rejects.toBeInstanceOf(DevelopmentCommitEffectGrantUnavailableError);
    expect({ head: git(root, ['rev-parse', 'HEAD']), index: git(root, ['write-tree']), objects: git(root, ['count-objects', '-v']) }).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development.commit retry denies before consuming caller recovery bytes', async () => {
  const request = Object.freeze({
    repositoryRoot: path.resolve('.'), message: 'retry\n',
    author: Object.freeze({ name: 'SEC', email: 'sec@example.com', date: '1700000100 +0000' }),
    committer: Object.freeze({ name: 'SEC', email: 'sec@example.com', date: '1700000100 +0000' })
  });
  await expect(retryDevelopmentCommit({
    request,
    effectGrantReceipt: Object.freeze({ digest: `sha256:${'1'.repeat(64)}` }),
    recovery: Object.freeze({}) as DevelopmentCommitRecovery
  })).rejects.toBeInstanceOf(DevelopmentCommitEffectGrantUnavailableError);
});

test('development commit CLI emits the canonical typed denial without an upstream issuer', async () => {
  expect(await runDevelopmentCommitCommand(['message'])).toBe(1);
  expect(DEVELOPMENT_COMMIT_EFFECT_GRANT_DENIAL).toEqual({
    schema: 'sec-development-commit-effect-grant-denial-v1',
    status: 'denied',
    reason: 'effect-grant-issuer-unavailable'
  });
});
