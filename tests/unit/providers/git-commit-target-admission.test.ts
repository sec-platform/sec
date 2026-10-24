import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { captureGitDevelopmentCommitContract, compileGitDevelopmentCommitContractDigest } from '../../../src/adapters/providers/git-read/runtime/commit-contract.ts';

function input(ref = 'refs/heads/feature') {
  const person = () => ({ name: 'Maintainer', email: 'maintainer@example.test', date: '0 +0000' });
  return { repositoryRoot: path.resolve('repo'), worktreeRoot: path.resolve('repo'), ref,
    tree: 'a'.repeat(40), parents: ['b'.repeat(40)], expectedOld: 'b'.repeat(40), target: 'c'.repeat(40),
    message: 'Commit message', author: person(), committer: person(),
    signing: 'disabled' as const, hooks: 'disabled' as const,
    preflightReceiptDigest: `sha256:${'d'.repeat(64)}` as const };
}

test('Git-invalid branch components are rejected before a commit contract can be used', () => {
  for (const name of ['feature..old', 'feature/', 'feature//part', 'feature.',
    'feature.lock', 'feature.lock/part', 'feature/.hidden', 'feature/.', 'feature/..',
    'feature/part.lock', 'feature/part.lock/next']) {
    const value = input(`refs/heads/${name}`);
    assert.equal(captureGitDevelopmentCommitContract(value), null, name);
  }
  assert.throws(() => compileGitDevelopmentCommitContractDigest(input('refs/heads/feature..old')), /not canonical/);
});

test('valid branches retain their exact spelling without normalization or namespace expansion', () => {
  for (const name of ['feature', 'Feature/v2.0', 'feature/_private', 'feature/a-b', 'feature/lock', 'feature/a.locked']) {
    const value = input(`refs/heads/${name}`);
    assert.deepEqual(captureGitDevelopmentCommitContract(value), value);
  }
  for (const ref of ['HEAD', 'refs/tags/v1', 'refs/heads/-feature', 'refs/heads/中文']) {
    assert.equal(captureGitDevelopmentCommitContract(input(ref)), null);
  }
});

test('embedded NUL in either physical root cannot pass path canonicalization', () => {
  for (const field of ['repositoryRoot', 'worktreeRoot'] as const) {
    const value = input(); value[field] = path.resolve('repo\0other');
    assert.equal(captureGitDevelopmentCommitContract(value), null);
  }
});
