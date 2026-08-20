import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentDefaultChangedPathsV1,
  CodexDevelopmentDefaultGitRevisionV1,
  CodexDevelopmentDefaultTrackedTreeIsCleanV1
} from '../../scripts/codex/ci-orchestration-core.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

test('CI orchestration Git observations ignore ambient repository redirection', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-ci-git-isolation-'));
  const previousGitDir = process.env.GIT_DIR;
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'base\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const baseSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'head\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'head']);
    const headSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    process.env.GIT_DIR = path.join(repositoryRoot, 'nonexistent-ambient.git');

    expect(CodexDevelopmentDefaultGitRevisionV1(repositoryRoot, 'HEAD')).toBe(headSha);
    expect(CodexDevelopmentDefaultTrackedTreeIsCleanV1(repositoryRoot)).toBe(true);
    const changed = CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, baseSha, headSha);
    expect(changed?.files).toEqual(['fixture.txt']);
    expect(changed?.transitionObservation).toBeDefined();
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
