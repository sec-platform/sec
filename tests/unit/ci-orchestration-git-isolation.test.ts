import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentDefaultGitRevision,
  CodexDevelopmentDefaultTrackedTreeIsClean,
  CodexDevelopmentExactGitTestImpactSourceProvider
} from '../../src/verification/ci/runtime/ci-orchestration-core.ts';
import { selectCiPrRiskSlowSuites } from '../../src/verification/ci/runtime/pr-risk-selection.ts';
import { selectTestsForSources } from '../../src/verification/test-impact/runtime/impact.ts';

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

    expect(CodexDevelopmentDefaultGitRevision(repositoryRoot, 'HEAD')).toBe(headSha);
    expect(CodexDevelopmentDefaultTrackedTreeIsClean(repositoryRoot)).toBe(true);
    const changed = CodexDevelopmentDefaultChangedPaths(repositoryRoot, baseSha, headSha);
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
    expect(() => CodexDevelopmentExactGitTestImpactSourceProvider(
      repositoryRoot,
      baseSha
    )).toThrow('Exact candidate module descriptor census is missing');

    mkdirSync(path.join(repositoryRoot, 'src', 'candidate'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'docs'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'src', 'candidate', 'sec.module.json'), JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: []
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'sec.module.json'), JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: []
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'docs', 'authority.json'), JSON.stringify({
      documents: [{
        id: 'candidate-guide',
        path: 'docs/candidate.md',
        kind: 'navigation',
        domain: 'repository.navigation',
        lifecycle: 'stable',
        dynamicPolicy: 'forbidden',
        owns: [],
        projects: [],
        audience: [],
        consumers: [],
        updateTriggers: []
      }]
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'docs', 'candidate.md'), '# Candidate\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'platform', 'candidate', 'candidate-only.ts'),
      'export const candidateOnly = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'unit', 'candidate-only.test.ts'),
      "import { candidateOnly } from '../../platform/candidate/candidate-only.ts'; void candidateOnly;\n", 'utf8');
    git(repositoryRoot, ['add', 'platform/candidate', 'tests', 'docs']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    // The physical checkout is old-main. Only immutable candidate objects may
    // contribute source bytes to the provider.
    git(repositoryRoot, ['checkout', '--quiet', '--detach', baseSha]);
    const provider = CodexDevelopmentExactGitTestImpactSourceProvider(
      repositoryRoot,
      candidateSha
    );
    expect(provider.moduleFiles).toEqual([
      'platform/candidate/candidate-only.ts',
      'tests/unit/candidate-only.test.ts'
    ]);
    expect(selectTestsForSources(['platform/candidate/candidate-only.ts'], provider)).toEqual({
      fast: ['tests/unit/candidate-only.test.ts'],
      slow: [],
      owners: ['candidate.module']
    });
    expect(selectCiPrRiskSlowSuites(['docs/candidate.md'], provider).resolved).toBe(true);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
