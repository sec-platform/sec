import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { configureBranchLifecycleClone } from '../../src/control/branch-lifecycle/branch-lifecycle-config.ts';

const roots: string[] = [];

function git(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stderr: 'pipe',
    stdout: 'pipe'
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('branch lifecycle clone configuration capability', () => {
  test('publishes each prune setting through one bounded Git config effect and reads back exact values', async () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-branch-config-'));
    roots.push(repositoryRoot);
    git(repositoryRoot, ['init']);

    await expect(configureBranchLifecycleClone({ repositoryRoot })).resolves.toEqual({
      observation: 'resolved',
      fetchPrune: true,
      remotePrune: true,
      fetchPruneTags: true,
      reason: null
    });
    expect(git(repositoryRoot, ['config', '--local', '--get-all', 'fetch.prune'])).toBe('true');
    expect(git(repositoryRoot, ['config', '--local', '--get-all', 'remote.origin.prune'])).toBe('true');
    expect(git(repositoryRoot, ['config', '--local', '--get-all', 'fetch.pruneTags'])).toBe('true');
  });
});
