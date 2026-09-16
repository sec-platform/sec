import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  assertDevelopmentCommitCandidateCurrent,
  freezeDevelopmentCommitCandidate,
  requireDevelopmentCommitCandidate,
  type DevelopmentCommitRequest
} from './candidate.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

test('development commit candidate binds the retained index and rejects clones or drift', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-candidate-test-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    await writeFile(path.join(root, 'base.txt'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'base']);
    await writeFile(path.join(root, 'next.txt'), 'next\n');
    git(root, ['add', 'next.txt']);
    const request: DevelopmentCommitRequest = Object.freeze({
      repositoryRoot: path.resolve(root),
      message: 'candidate\n',
      author: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' }),
      committer: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' })
    });
    await withAuthorityGitReadSession(
      { cwd: request.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
      async (session) => {
        const candidate = await freezeDevelopmentCommitCandidate({ request, session });
        expect(requireDevelopmentCommitCandidate(candidate, request).candidate).toBe(candidate);
        expect(() => requireDevelopmentCommitCandidate({ ...candidate }, request)).toThrow(
          'origin or request identity is invalid'
        );
        await expect(assertDevelopmentCommitCandidateCurrent({ candidate, request, session }))
          .resolves.toMatchObject({ candidate });
        await writeFile(path.join(root, 'next.txt'), 'changed\n');
        git(root, ['add', 'next.txt']);
        await expect(assertDevelopmentCommitCandidateCurrent({ candidate, request, session }))
          .rejects.toThrow('changed before Effect admission');
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development commit candidate rejects an empty staged tree before commit object creation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-empty-candidate-test-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    await writeFile(path.join(root, 'base.txt'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'base']);
    const request: DevelopmentCommitRequest = Object.freeze({
      repositoryRoot: path.resolve(root),
      message: 'must-not-exist\n',
      author: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' }),
      committer: Object.freeze({ name: 'SEC Tests', email: 'tests@example.com', date: '1700000100 +0000' })
    });
    await withAuthorityGitReadSession(
      { cwd: request.repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
      async (session) => {
        await expect(freezeDevelopmentCommitCandidate({ request, session }))
          .rejects.toThrow('has no staged tree delta');
      }
    );
    expect(git(root, ['rev-list', '--count', 'HEAD'])).toBe('1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
