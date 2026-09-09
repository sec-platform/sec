import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRepositoryCompilationCacheProvider } from '../../src/brownfield/source-program-model/repository-compilation-cache-provider.ts';
import { openRepositoryCompilationCacheSession } from '../../src/brownfield/source-program-model/repository-compilation-cache-session.ts';
import {
  compileRepositorySourceProgramCompilation,
  repositoryCompilationDiagnosticsForTests
} from '../../src/brownfield/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../src/brownfield/source-program-model/test-impact-projection.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence
} from '../../src/brownfield/source-program-model/workspace-source-snapshot.ts';
import { currentActiveDocumentationPaths } from '../../src/control/documentation/active.ts';
import type { AffectedTestImpactProjectionIssuer } from '../../src/development/runner/check-affected-source.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/development/runner/test-execution-policy.ts';
import { withAuthorityGitReadSession } from '../../src/external-capabilities/git-read/authority.ts';
import { isolatedGitReadEnvironment } from '../../src/external-capabilities/git-read/runtime/session.ts';
import type { ContentAddressedWorkspaceCacheSession } from '../../src/runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { isSecRepositoryTestModulePath } from '../../src/system-architecture/repository-modules/test-module-path.ts';
import {
  createRepositoryTestImpactSourceProvider,
  type CodexDevelopmentTestImpactSourceProvider
} from '../../src/verification/test-impact/runtime/impact.ts';
import { tsconfigRelativePath } from '../../src/workspace/runtime/paths.ts';

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FIXTURE_ROOT_PREFIX = 'sec-test-impact-exact-tree-';

type ExactGitFixtureBase = Readonly<{
  provider: CodexDevelopmentTestImpactSourceProvider;
  sourceCommitSha: string;
  fixtureCommitSha: string;
  repositoryRoot: string;
  dispose(): void;
}>;

export type ExactRepositoryTestImpactProviderFixture = ExactGitFixtureBase & Readonly<{
  cacheStatus: 'hit' | 'miss';
  compilationReceiptDigest: `sha256:${string}`;
  projectionDigest: `sha256:${string}`;
}>;

export type ExactGitTreeTestRunnerFixture = ExactGitFixtureBase & Readonly<{
  indexStageOutput: Uint8Array;
  deletedTrackedOutput: Uint8Array;
  affectedObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>>;
}>;

type SharedExactRepositoryFixtureState = {
  readonly fixture: Promise<ExactRepositoryTestImpactProviderFixture>;
  references: number;
};

const sharedExactRepositoryFixtures = new Map<string, SharedExactRepositoryFixtureState>();

export type ExactRepositoryTestImpactFixturePhase =
  | 'admission'
  | 'source-object-read'
  | 'fixture-repository-effect'
  | 'exact-snapshot'
  | 'dependency-retain'
  | 'project-input'
  | 'cache-open'
  | 'compile'
  | 'settlement'
  | 'complete';

export type ExactRepositoryTestImpactFixturePhaseEvent = Readonly<{
  phase: ExactRepositoryTestImpactFixturePhase;
  observedAtUnixMs: number;
  remainingMs: number;
}>;

type ExactRepositoryTestImpactFixtureOptions = Readonly<{
  deadlineAtUnixMs?: number;
  observePhase?: (event: ExactRepositoryTestImpactFixturePhaseEvent) => void;
}>;

function observeFixturePhase(
  options: ExactRepositoryTestImpactFixtureOptions,
  deadlineAtUnixMs: number,
  phase: ExactRepositoryTestImpactFixturePhase
): void {
  const observedAtUnixMs = Date.now();
  const remainingMs = deadlineAtUnixMs - observedAtUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs) || remainingMs < 1) {
    throw new Error(`Exact repository TestImpact fixture deadline expired before ${phase}.`);
  }
  options.observePhase?.(Object.freeze({ phase, observedAtUnixMs, remainingMs }));
}

function git(
  repositoryRoot: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {}
): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment(environment),
    windowsHide: true
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Exact TestImpact Git fixture command failed: git ${args.join(' ')}`
      + `: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return result.stdout.trim();
}

function gitBytes(repositoryRoot: string, args: readonly string[]): Uint8Array {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: isolatedGitReadEnvironment(),
    windowsHide: true
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Exact TestImpact Git fixture command failed: git ${args.join(' ')}`
      + `: ${result.error?.message ?? Buffer.from(result.stderr ?? []).toString('utf8').trim()}`
    );
  }
  return Uint8Array.from(Buffer.from(result.stdout ?? []));
}

function exactObjectId(value: string, label: string): string {
  if (!GIT_OBJECT_ID.test(value)) {
    throw new Error(`${label} is not one full lowercase Git object ID.`);
  }
  return value;
}

function exactTestPaths(repositoryRoot: string, commitSha: string): readonly string[] {
  const bytes = gitBytes(repositoryRoot, [
    'ls-tree', '-r', '-z', '--name-only', '--full-tree', commitSha
  ]);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.length > 0 && !source.endsWith('\0')) {
    throw new Error('Exact TestImpact path census is not NUL terminated.');
  }
  const paths = source.length === 0 ? [] : source.slice(0, -1).split('\0');
  const tests = paths.filter(isSecRepositoryTestModulePath);
  if (tests.length === 0) {
    throw new Error('Exact TestImpact source tree contains no test modules.');
  }
  return Object.freeze(tests);
}

function initializeFixtureRepository(repositoryRoot: string): void {
  mkdirSync(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  git(repositoryRoot, ['config', 'core.longpaths', 'true']);
}

function fixtureIdentityEnvironment(): NodeJS.ProcessEnv {
  return Object.freeze({
    GIT_AUTHOR_NAME: 'SEC TestImpact Fixture',
    GIT_AUTHOR_EMAIL: 'test-impact@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_NAME: 'SEC TestImpact Fixture',
    GIT_COMMITTER_EMAIL: 'test-impact@example.invalid',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z'
  });
}

function guardedFixtureDisposer(fixtureRoot: string): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const resolvedFixtureRoot = path.resolve(fixtureRoot);
    if (path.dirname(resolvedFixtureRoot) !== path.resolve(tmpdir())
        || !path.basename(resolvedFixtureRoot).startsWith(FIXTURE_ROOT_PREFIX)) {
      throw new Error('Refusing to dispose an unrecognized TestImpact fixture root.');
    }
    rmSync(resolvedFixtureRoot, { recursive: true, force: true });
  };
}

function writeRunnerProgram(repositoryRoot: string, testPaths: readonly string[]): void {
  const source = [
    "import { test } from 'bun:test';",
    "test('exact source program fixture', () => {});",
    ''
  ].join('\n');
  for (const repositoryPath of testPaths) {
    const target = path.resolve(repositoryRoot, ...repositoryPath.split('/'));
    const relative = path.relative(repositoryRoot, target);
    if (relative === '' || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`Exact TestImpact fixture path escapes its repository: ${repositoryPath}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, 'utf8');
  }
  writeFileSync(path.join(repositoryRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: { noEmit: true, strict: true },
    include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx']
  })}\n`, 'utf8');
}

/**
 * Runner-only fixture. Its immutable synthetic tree models test membership and
 * a clean Git index; it does not claim the repository's production source graph.
 */
export async function createExactGitTreeTestRunnerFixture(
  sourceRepositoryRoot = process.cwd()
): Promise<ExactGitTreeTestRunnerFixture> {
  const normalizedSourceRoot = path.resolve(sourceRepositoryRoot);
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), FIXTURE_ROOT_PREFIX));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  const dispose = guardedFixtureDisposer(fixtureRoot);
  try {
    const sourceCommitSha = exactObjectId(
      git(normalizedSourceRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
      'TestImpact source commit'
    );
    initializeFixtureRepository(repositoryRoot);
    writeRunnerProgram(repositoryRoot, exactTestPaths(normalizedSourceRoot, sourceCommitSha));
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'SEC exact TestImpact runner fixture'],
      fixtureIdentityEnvironment());
    const fixtureCommitSha = exactObjectId(
      git(repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
      'TestImpact runner fixture commit'
    );
    const indexStageOutput = gitBytes(repositoryRoot, [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      'ls-files', '--cached', '--stage', '-z'
    ]);
    const deletedTrackedOutput = gitBytes(repositoryRoot, [
      '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      'ls-files', '--deleted', '-z'
    ]);
    const exactSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot,
      commitSha: fixtureCommitSha
    });
    const exactCompilation = compileRepositorySourceProgramCompilation({
      workspaceSnapshot: exactSnapshot,
      repositoryRoot
    });
    const provider = createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot: exactSnapshot,
        repositoryModel: exactCompilation.model,
        typeScriptModel: exactCompilation.typeScriptCompilation.model,
        testObservations: exactCompilation.testObservations
      }),
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
    const previousWorkingDirectory = process.cwd();
    let affectedObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>>;
    try {
      process.chdir(repositoryRoot);
      affectedObservation = await withAuthorityGitReadSession({
        cwd: repositoryRoot,
        budget: { deadlineMs: 120_000 }
      }, async (session) => {
        const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
        const projectInput = compileWorkspaceTypeScriptProjectInput(
          workspaceSnapshot,
          tsconfigRelativePath
        );
        const compilation = compileRepositorySourceProgramCompilation({
          workspaceSnapshot,
          projectInput,
          repositoryRoot
        });
        return Object.freeze({
          projection: issueTestImpactProjection({
            workspaceSnapshot,
            projectGeneration: compilation.projectGeneration,
            repositoryModel: compilation.model,
            typeScriptModel: compilation.typeScriptCompilation.model,
            testObservations: compilation.testObservations
          }),
          projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(
            workspaceSnapshot,
            projectInput
          )
        });
      });
    } finally {
      process.chdir(previousWorkingDirectory);
    }
    const fixture = Object.freeze({
      provider,
      sourceCommitSha,
      fixtureCommitSha,
      indexStageOutput,
      deletedTrackedOutput,
      affectedObservation,
      repositoryRoot,
      dispose
    });
    return fixture;
  } catch (error) {
    dispose();
    throw error;
  }
}

/**
 * Imports one immutable source commit into a fixture-owned object database and
 * issues the complete repository TestImpact graph from that exact tree. No
 * mutable working-tree bytes or structural caller objects become authority.
 */
async function createExactRepositoryTestImpactProviderFixture(
  sourceRepositoryRoot: string,
  options: ExactRepositoryTestImpactFixtureOptions
): Promise<ExactRepositoryTestImpactProviderFixture> {
  const normalizedSourceRoot = path.resolve(sourceRepositoryRoot);
  const deadlineAtUnixMs = options.deadlineAtUnixMs
    ?? Date.now() + DEFAULT_TEST_TIMEOUT_MS;
  observeFixturePhase(options, deadlineAtUnixMs, 'admission');
  observeFixturePhase(options, deadlineAtUnixMs, 'source-object-read');
  const sourceCommitSha = exactObjectId(
    git(normalizedSourceRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
    'TestImpact source commit'
  );
  exactTestPaths(normalizedSourceRoot, sourceCommitSha);
  observeFixturePhase(options, deadlineAtUnixMs, 'fixture-repository-effect');
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), FIXTURE_ROOT_PREFIX));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  const dispose = guardedFixtureDisposer(fixtureRoot);
  try {
    initializeFixtureRepository(repositoryRoot);
    git(repositoryRoot, [
      'fetch', '--quiet', '--no-tags', '--depth=1', normalizedSourceRoot, sourceCommitSha
    ]);
    const sourceTreeSha = exactObjectId(
      git(repositoryRoot, ['rev-parse', '--verify', `${sourceCommitSha}^{tree}`]),
      'TestImpact source tree'
    );
    const fixtureCommitSha = exactObjectId(
      git(repositoryRoot, [
        'commit-tree', sourceTreeSha, '-m', 'SEC exact repository TestImpact fixture'
      ], fixtureIdentityEnvironment()),
      'TestImpact fixture commit'
    );
    git(repositoryRoot, ['update-ref', 'refs/heads/main', fixtureCommitSha]);
    observeFixturePhase(options, deadlineAtUnixMs, 'exact-snapshot');
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot,
      commitSha: fixtureCommitSha
    });
    observeFixturePhase(options, deadlineAtUnixMs, 'dependency-retain');
    const runtime = await import('../../src/toolchain/dependencies/runtime.ts');
    const dependencyAuthority = await runtime.observeCompilerDependencyExecutionGenerationAuthority({
      deadlineAtUnixMs
    });
    if (dependencyAuthority === null) {
      throw new Error(
        'Exact repository TestImpact fixture requires one admitted compiler dependency generation.'
      );
    }
    const retainedDependency = await runtime.retainCompilerDependencyExecutionGeneration(
      dependencyAuthority,
      { deadlineAtUnixMs }
    );
    let cacheSession: ContentAddressedWorkspaceCacheSession | null = null;
    let compilation: ReturnType<typeof compileRepositorySourceProgramCompilation>;
    try {
      observeFixturePhase(options, deadlineAtUnixMs, 'project-input');
      const projectInput = compileWorkspaceTypeScriptProjectInput(
        workspaceSnapshot,
        tsconfigRelativePath,
        {
          dependencyGeneration: retainedDependency.physicalGeneration,
          dependencyGenerationDigest: retainedDependency.generationDigest
        }
      );
      observeFixturePhase(options, deadlineAtUnixMs, 'cache-open');
      cacheSession = openRepositoryCompilationCacheSession({
        repositoryRoot: normalizedSourceRoot,
        workspaceSnapshot,
        deadlineAtUnixMs
      });
      observeFixturePhase(options, deadlineAtUnixMs, 'compile');
      compilation = compileRepositorySourceProgramCompilation({
        workspaceSnapshot,
        projectInput,
        cacheProvider: createRepositoryCompilationCacheProvider({ session: cacheSession }),
        repositoryRoot: normalizedSourceRoot
      });
      observeFixturePhase(options, deadlineAtUnixMs, 'settlement');
    } finally {
      cacheSession?.close();
      await retainedDependency.retire();
    }
    const diagnostics = repositoryCompilationDiagnosticsForTests(workspaceSnapshot);
    const provider = createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: compilation.model,
        typeScriptModel: compilation.typeScriptCompilation.model,
        testObservations: compilation.testObservations
      }),
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
    const fixture = Object.freeze({
      provider,
      sourceCommitSha,
      fixtureCommitSha,
      cacheStatus: diagnostics === null ? 'miss' : 'hit',
      compilationReceiptDigest: compilation.receiptDigest,
      projectionDigest: provider.projection.projectionDigest as `sha256:${string}`,
      repositoryRoot,
      dispose
    });
    observeFixturePhase(options, deadlineAtUnixMs, 'complete');
    return fixture;
  } catch (error) {
    dispose();
    throw error;
  }
}

/** One process-local lease over the complete exact repository graph. */
export async function acquireExactRepositoryTestImpactProviderFixture(
  sourceRepositoryRoot = process.cwd(),
  options: ExactRepositoryTestImpactFixtureOptions = {}
): Promise<ExactRepositoryTestImpactProviderFixture> {
  const fixtureKey = path.resolve(sourceRepositoryRoot);
  let state = sharedExactRepositoryFixtures.get(fixtureKey);
  if (state === undefined) {
    state = {
      fixture: createExactRepositoryTestImpactProviderFixture(fixtureKey, options),
      references: 0
    };
    sharedExactRepositoryFixtures.set(fixtureKey, state);
  }
  state.references += 1;
  let fixture: ExactRepositoryTestImpactProviderFixture;
  try {
    fixture = await state.fixture;
  } catch (error) {
    state.references -= 1;
    if (state.references === 0 && sharedExactRepositoryFixtures.get(fixtureKey) === state) {
      sharedExactRepositoryFixtures.delete(fixtureKey);
    }
    throw error;
  }
  let released = false;
  return Object.freeze({
    ...fixture,
    dispose: () => {
      if (released) return;
      released = true;
      const current = sharedExactRepositoryFixtures.get(fixtureKey);
      if (current !== state) {
        throw new Error('Exact TestImpact fixture lease no longer matches its shared owner.');
      }
      current.references -= 1;
      if (current.references === 0) {
        sharedExactRepositoryFixtures.delete(fixtureKey);
        fixture.dispose();
      }
    }
  });
}
