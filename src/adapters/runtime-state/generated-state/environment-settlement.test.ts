import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { settleWorkspaceEnvironment } from './environment-settlement.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Git fixture command failed with exit ${result.status}.`);
  }
  return result.stdout.trim();
}

function createRepository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-environment-settlement-'));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  writeFileSync(path.join(root, 'tracked.txt'), 'base\n', 'utf8');
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  return root;
}

test.skipIf(process.platform !== 'win32')(
  'workspace settlement observes exact Git status through the production authority session',
  async () => {
    const root = createRepository();
    try {
      const clean = await settleWorkspaceEnvironment({ repositoryRoot: root, workspaceRoot: root });
      expect(clean.workingState).toMatchObject({ status: 'resolved', records: [] });
      expect(clean.workingStateDigest).toStartWith('sha256:');

      writeFileSync(path.join(root, 'tracked.txt'), 'changed\n', 'utf8');
      const dirty = await settleWorkspaceEnvironment({ repositoryRoot: root, workspaceRoot: root });
      expect(dirty.workingState).toMatchObject({ status: 'resolved' });
      if (dirty.workingState.status === 'resolved') {
        expect(dirty.workingState.records).toEqual([' M tracked.txt']);
      }
      expect(dirty.blockers).toContain('git: M tracked.txt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('an exhausted parent deadline blocks cleanup before Git child admission', async () => {
  const root = createRepository();
  try {
    const result = await settleWorkspaceEnvironment({
      repositoryRoot: root,
      workspaceRoot: root,
      fix: true,
      deadlineAtUnixMs: Date.now() - 1
    });
    expect(result.workingState).toMatchObject({
      status: 'unresolved',
      reason: 'git-session-deadline-exhausted'
    });
    expect(result.cleanupDigest).toBeNull();
    expect(result.blockers).toContain('git-working-state-unresolved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
