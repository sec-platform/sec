import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  GitReadAuthorityError,
  withAuthorityGitReadOperation,
  withAuthorityGitReadSession
} from '../../src/external-capabilities/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../src/external-capabilities/git-read/runtime/session.ts';
import {
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentDefaultGitRevision,
  CodexDevelopmentDefaultTrackedTreeIsClean,
  CodexDevelopmentExactGitWorkspaceSourceSnapshot,
  CodexDevelopmentTestImpactSourceProviderFromSnapshot
} from '../../src/verification/ci/runtime/ci-orchestration-core.ts';
import { selectTestsForSources } from '../../src/verification/test-impact/runtime/impact.ts';
import { selectSlowTestRiskClosure } from '../../src/verification/test-impact/slow-risk-selection.ts';

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

test('CI orchestration Git observations ignore ambient repository redirection', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-ci-git-isolation-'));
  const previousGitDir = process.env.GIT_DIR;
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'base\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'removed.txt'), 'removed\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt', 'removed.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const baseSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'head\n', 'utf8');
    unlinkSync(path.join(repositoryRoot, 'removed.txt'));
    git(repositoryRoot, ['add', 'fixture.txt', 'removed.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'head']);
    const headSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    process.env.GIT_DIR = path.join(repositoryRoot, 'nonexistent-ambient.git');

    await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: {} }, async (session) => {
      const admittedExecutableBytes = session.executableBytes;
      expect(await CodexDevelopmentDefaultGitRevision(session, 'HEAD')).toBe(headSha);
      expect(await CodexDevelopmentDefaultTrackedTreeIsClean(session)).toBe(true);
      const changed = await CodexDevelopmentDefaultChangedPaths(session, baseSha, headSha);
      expect(changed.files).toEqual(['fixture.txt', 'removed.txt']);
      expect(changed.transitionObservation.removedPathBlobs).toEqual([expect.objectContaining({
        path: 'removed.txt',
        baseMode: '100644',
        headMode: null,
        headBlobSha: null
      })]);
      expect(session.executableBytes).toBe(admittedExecutableBytes);
    });
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('GitRead phases share aggregate process budget and parent deadline', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-ci-git-operation-'));
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'fixture.txt'), 'fixture\n', 'utf8');
    git(repositoryRoot, ['add', 'fixture.txt']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'fixture']);

    let processFailure: unknown;
    try {
      await withAuthorityGitReadOperation({
        cwd: repositoryRoot,
        deadlineAtUnixMs: Date.now() + 10_000,
        budget: { ...GIT_READ_DEFAULT_OPERATION_BUDGET, maxProcesses: 1 }
      }, async (operation) => {
        await operation.runPhase('preflight', (session) =>
          CodexDevelopmentDefaultGitRevision(session, 'HEAD'));
        await operation.runPhase('readback', (session) =>
          CodexDevelopmentDefaultGitRevision(session, 'HEAD'));
      });
    } catch (error) {
      processFailure = error;
    }
    expect(processFailure).toBeInstanceOf(GitReadAuthorityError);
    expect((processFailure as GitReadAuthorityError).failure.reason)
      .toBe('process-budget-exhausted');

    let recordFailure: unknown;
    try {
      await withAuthorityGitReadOperation({
        cwd: repositoryRoot,
        deadlineAtUnixMs: Date.now() + 10_000,
        budget: { ...GIT_READ_DEFAULT_OPERATION_BUDGET, maxRecords: 1 }
      }, async (operation) => {
        await operation.runPhase('preflight', async (session) => {
          expect(session.consumeRecords(1)).toBeNull();
        });
        await operation.runPhase('readback', async (session) => {
          session.consumeRecords(1);
        });
      });
    } catch (error) {
      recordFailure = error;
    }
    expect(recordFailure).toBeInstanceOf(GitReadAuthorityError);
    expect((recordFailure as GitReadAuthorityError).failure.reason)
      .toBe('record-budget-exhausted');

    let outputFailure: unknown;
    try {
      await withAuthorityGitReadOperation({
        cwd: repositoryRoot,
        deadlineAtUnixMs: Date.now() + 10_000,
        budget: {
          ...GIT_READ_DEFAULT_OPERATION_BUDGET,
          maxStdoutBytes: 42,
          maxCommandStdoutBytes: 42
        }
      }, async (operation) => {
        await operation.runPhase('preflight', async (session) => {
          await session.run(['rev-parse', '--verify', '--end-of-options', 'HEAD']);
        });
        await operation.runPhase('readback', async (session) => {
          await session.run(['rev-parse', '--verify', '--end-of-options', 'HEAD']);
        });
      });
    } catch (error) {
      outputFailure = error;
    }
    expect(outputFailure).toBeInstanceOf(GitReadAuthorityError);
    expect((outputFailure as GitReadAuthorityError).failure.reason)
      .toBe('stdout-budget-exhausted');

    let callbackReached = false;
    await expect(withAuthorityGitReadOperation({
      cwd: repositoryRoot,
      deadlineAtUnixMs: Date.now() - 1,
      budget: GIT_READ_DEFAULT_OPERATION_BUDGET
    }, (operation) => operation.runPhase('expired', async () => {
      callbackReached = true;
    }))).rejects.toBeInstanceOf(Error);
    expect(callbackReached).toBe(false);

    let unavailableCallbackReached = false;
    await expect(withAuthorityGitReadOperation({
      cwd: repositoryRoot,
      deadlineAtUnixMs: Date.now() + 10_000,
      budget: GIT_READ_DEFAULT_OPERATION_BUDGET,
      source: { PATH: '' }
    }, (operation) => operation.runPhase('unavailable', async () => {
      unavailableCallbackReached = true;
    }))).rejects.toBeInstanceOf(GitReadAuthorityError);
    expect(unavailableCallbackReached).toBe(false);

    let detachedPhaseCompleted = false;
    let detachedOperationSettled = false;
    const detachedOperation = withAuthorityGitReadOperation({
      cwd: repositoryRoot,
      deadlineAtUnixMs: Date.now() + 10_000,
      budget: GIT_READ_DEFAULT_OPERATION_BUDGET
    }, async (operation) => {
      void operation.runPhase('detached-success', async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        detachedPhaseCompleted = true;
      });
    });
    void detachedOperation.then(
      () => { detachedOperationSettled = true; },
      () => { detachedOperationSettled = true; }
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(detachedOperationSettled).toBe(false);
    await detachedOperation;
    expect(detachedPhaseCompleted).toBe(true);

    const outerFailure = new Error('outer operation failed');
    let detachedPhaseSettled = false;
    let concurrentPhaseFailure: unknown;
    let observedFailure: unknown;
    try {
      await withAuthorityGitReadOperation({
        cwd: repositoryRoot,
        deadlineAtUnixMs: Date.now() + 10_000,
        budget: GIT_READ_DEFAULT_OPERATION_BUDGET
      }, async (operation) => {
        void operation.runPhase('detached', async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          detachedPhaseSettled = true;
          throw new Error('detached phase failed');
        });
        void operation.runPhase('concurrent', async () => {
          throw new Error('concurrent phase unexpectedly entered its callback');
        }).catch((error: unknown) => {
          concurrentPhaseFailure = error;
        });
        throw outerFailure;
      });
    } catch (error) {
      observedFailure = error;
    }
    expect(detachedPhaseSettled).toBe(true);
    expect(concurrentPhaseFailure).toBeInstanceOf(Error);
    expect(observedFailure).toBe(outerFailure);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('trusted-base TestImpact reads a new candidate module graph from exact Git objects', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-ci-candidate-impact-'));
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'base\n', 'utf8');
    git(repositoryRoot, ['add', 'README.md']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const baseSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

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
      }]
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'docs', 'candidate.md'), '# Candidate\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'src', 'candidate', 'candidate-only.ts'),
      'export const candidateOnly = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'unit', 'candidate-only.test.ts'),
      "import { candidateOnly } from '../../src/candidate/candidate-only.ts'; void candidateOnly;\n", 'utf8');
    git(repositoryRoot, ['add', 'src/candidate', 'tests', 'docs']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    // The physical checkout is old-main. Only immutable candidate objects may
    // contribute source bytes to the provider.
    git(repositoryRoot, ['checkout', '--quiet', '--detach', baseSha]);
    const snapshots = await withAuthorityGitReadSession(
      { cwd: repositoryRoot, budget: {} },
      async (session) => Object.freeze([
        await CodexDevelopmentExactGitWorkspaceSourceSnapshot(session, candidateSha),
        await CodexDevelopmentExactGitWorkspaceSourceSnapshot(session, candidateSha)
      ] as const)
    );
    const coldProvider = CodexDevelopmentTestImpactSourceProviderFromSnapshot(
      snapshots[0],
      repositoryRoot
    );
    const warmProvider = CodexDevelopmentTestImpactSourceProviderFromSnapshot(
      snapshots[1],
      repositoryRoot
    );
    expect(coldProvider.projection.subject).toEqual(expect.objectContaining({
      kind: 'physical-repository',
      provenance: expect.objectContaining({ kind: 'git-tree' })
    }));
    expect(warmProvider.projection.projectionDigest)
      .toBe(coldProvider.projection.projectionDigest);
    expect(warmProvider.projection.moduleGraph.files)
      .toContain('src/candidate/candidate-only.ts');
    expect(warmProvider.projection.moduleGraph.files)
      .toContain('tests/unit/candidate-only.test.ts');
    expect(selectTestsForSources(['src/candidate/candidate-only.ts'], warmProvider)).toEqual({
      fast: ['tests/unit/candidate-only.test.ts'],
      slow: [],
      owners: ['candidate']
    });
    expect(selectSlowTestRiskClosure(['docs/candidate.md'], warmProvider).resolved).toBe(true);
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
