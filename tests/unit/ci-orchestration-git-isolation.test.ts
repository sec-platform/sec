import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  GitReadAuthorityError,
  withAuthorityGitReadOperation,
  withAuthorityGitReadSession
} from '../../src/adapters/providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { currentDocumentationVerificationBaseline } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import {
  bindDocumentationVerificationGateInput,
  BuildVerificationPlan
} from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import {
  DefaultChangedPaths,
  DefaultGitRevision,
  DefaultTrackedTreeIsClean,
  ExactGitWorkspaceSourceSnapshot,
  TestImpactSourceProviderFromSnapshot
} from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { selectTestsForSources } from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';
import { selectSlowTestRiskClosure } from '../../src/adapters/verification/platform/test-impact/slow-risk-selection.ts';

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
      expect(await DefaultGitRevision(session, 'HEAD')).toBe(headSha);
      expect(await DefaultTrackedTreeIsClean(session)).toBe(true);
      const changed = await DefaultChangedPaths(session, baseSha, headSha);
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
          DefaultGitRevision(session, 'HEAD'));
        await operation.runPhase('readback', (session) =>
          DefaultGitRevision(session, 'HEAD'));
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
    mkdirSync(path.join(repositoryRoot, '.documentation'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'docs'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'tests', 'unit'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'src', 'candidate', 'module.json'), JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: []
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'module.json'), JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: []
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, '.documentation', 'documents.json'), JSON.stringify({
      schema: 'sec.documentation-identity/1',
      scope: 'fixture',
      documents: [{
        document_id: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        path: 'docs/candidate.md',
      }]
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, '.documentation', 'baseline.json'), JSON.stringify({
      schema: 'sec.documentation-baseline/2',
      source_root: '..',
      source_roots: ['README.md', '.documentation', 'docs/candidate.md', 'candidate-doc-assets', 'src'],
      source_manifest: 'source-manifest.json',
      excluded_from_source_hash: [
        '.documentation/figures.json',
        '.documentation/requirements.json',
        '.documentation/source-manifest.json'
      ],
      audited_namespaces: ['docs'],
      non_documentation_roots: [],
      entry: '../README.md',
      delivery_number: '086',
      archive_name: 'SEC-086.zip',
      scope: 'fixture',
      authority_limit: 'fixture'
    }), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'docs', 'candidate.md'), '# Candidate\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'src', 'candidate', 'candidate-only.ts'),
      'export const candidateOnly = 1;\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'tests', 'unit', 'candidate-only.test.ts'),
      "import { candidateOnly } from '../../src/candidate/candidate-only.ts'; void candidateOnly;\n", 'utf8');
    git(repositoryRoot, ['add', 'src/candidate', 'tests', 'docs', '.documentation']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateSha = git(repositoryRoot, ['rev-parse', 'HEAD']);

    // The physical checkout is old-main. Only immutable candidate objects may
    // contribute source bytes to the provider.
    git(repositoryRoot, ['checkout', '--quiet', '--detach', baseSha]);
    await withAuthorityGitReadSession(
      { cwd: repositoryRoot, budget: {} },
      async (session) => {
        await expect(ExactGitWorkspaceSourceSnapshot(session, baseSha))
          .rejects.toThrow('documentation verification baseline was not observed');
      }
    );
    const snapshots = await withAuthorityGitReadSession(
      { cwd: repositoryRoot, budget: {} },
      async (session) => Object.freeze([
        await ExactGitWorkspaceSourceSnapshot(session, candidateSha),
        await ExactGitWorkspaceSourceSnapshot(session, candidateSha)
      ] as const)
    );
    const coldProvider = TestImpactSourceProviderFromSnapshot(
      snapshots[0],
      repositoryRoot
    );
    const warmProvider = TestImpactSourceProviderFromSnapshot(
      snapshots[1],
      repositoryRoot
    );
    expect(() => bindDocumentationVerificationGateInput(
      warmProvider,
      currentDocumentationVerificationBaseline()
    )).toThrow('already bound to this exact candidate provider');
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
    expect(BuildVerificationPlan(
      'quick',
      ['candidate-doc-assets/new.txt'],
      warmProvider
    ).gates.map(({ id }) => id)).toContain('docs-doctor');
    expect(BuildVerificationPlan(
      'quick',
      ['src/candidate/candidate-only.ts'],
      warmProvider
    ).gates.map(({ id }) => id)).toContain('imports');
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
