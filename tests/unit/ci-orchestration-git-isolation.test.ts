import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import {
  CodexDevelopmentDefaultChangedPathsV1,
  CodexDevelopmentDefaultGitRevisionV1,
  CodexDevelopmentDefaultTrackedTreeIsCleanV1,
  CodexDevelopmentExactGitTestImpactSourceProviderV1
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

test('trusted-base TestImpact reads a new candidate module graph from exact Git objects', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-ci-candidate-impact-'));
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'base\n', 'utf8');
    git(repositoryRoot, ['add', 'README.md']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const baseSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    mkdirSync(path.join(repositoryRoot, 'platform', 'shared'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'platform', 'shared', 'candidate-only.ts'),
      'export const candidateOnly = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'unit', 'candidate-only.test.ts'),
      "import { candidateOnly } from '../../platform/shared/candidate-only.ts'; void candidateOnly;\n", 'utf8');
    git(repositoryRoot, ['add', 'platform/shared/candidate-only.ts', 'tests/unit/candidate-only.test.ts']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    // The physical checkout is old-main. Only immutable candidate objects may
    // contribute source bytes to the provider.
    git(repositoryRoot, ['checkout', '--quiet', '--detach', baseSha]);
    const provider = CodexDevelopmentExactGitTestImpactSourceProviderV1(
      repositoryRoot,
      candidateSha
    );
    expect(provider.moduleFiles).toEqual([
      'platform/shared/candidate-only.ts',
      'tests/unit/candidate-only.test.ts'
    ]);
    expect(selectTestsForSources(['platform/shared/candidate-only.ts'], provider)).toEqual({
      fast: ['tests/unit/candidate-only.test.ts'],
      slow: [],
      owners: ['module-graph']
    });
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
