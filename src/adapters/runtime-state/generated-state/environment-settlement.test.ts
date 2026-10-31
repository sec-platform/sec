import { settleWorkspaceCallback } from '../../../../tests/testkit/workspace-cleanup.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { settleWorkspaceEnvironmentOperation as settleWorkspaceEnvironment } from '../../../bootstrap/runtime-state/environment-settlement.ts';

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
  try {
    git(root, ['init', '--quiet', '--initial-branch=main']);
    writeFileSync(path.join(root, 'tracked.txt'), 'base\n', 'utf8');
    git(root, ['add', 'tracked.txt']);
    git(root, ['-c', 'user.name=SEC Test', '-c', 'user.email=sec-test@example.invalid', 'commit', '--quiet', '-m', 'base']);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test.skipIf(process.platform !== 'win32')(
  'workspace settlement observes exact Git status through the production authority session',
  async () => {
    const root = createRepository();
    await settleWorkspaceCallback(async () => {
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
    }, async () => {
      rmSync(root, { recursive: true, force: true });
    });
  }
);

test('an exhausted parent deadline blocks cleanup before Git child admission', async () => {
  const root = createRepository();
  await settleWorkspaceCallback(async () => {
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
  }, async () => {
    rmSync(root, { recursive: true, force: true });
  });
});
