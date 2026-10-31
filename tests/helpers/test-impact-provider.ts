import { afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { isolatedGitReadEnvironment } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { gitEnvironmentValue } from '../../src/adapters/providers/git/environment.ts';
import { createSourceProgramCompilationOperation } from '../../src/adapters/repository/source-program-model/compilation-operation.ts';
import { compileRepositorySourceProgramWithCache } from '../../src/adapters/repository/source-program-model/repository-compilation-cache-session.ts';
import {
  compileRepositorySourceProgramCompilation,
  repositoryCompilationDiagnosticsForTests
} from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../src/adapters/repository/source-program-model/test-impact-projection.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence
} from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import {
  activeDocumentationPaths,
  currentActiveDocumentationPaths,
  DOCUMENTATION_IDENTITY_PATH,
  parseDocumentationIdentityRegistry
} from '../../src/adapters/self-hosting/control/documentation/active.ts';
import type { AffectedTestImpactProjectionIssuer } from '../../src/adapters/self-hosting/development/runner/check-affected-source.ts';
import {
  DEFAULT_TEST_TIMEOUT_MS,
  EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS,
  TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS
} from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { issueTestInventoryProjection } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import {
  issueAffectedTestImpactSource,
  readIssuedAffectedTestImpactBinding
} from '../../src/adapters/verification/platform/test-impact/runtime/affected-source.ts';
import {
  createRepositoryTestImpactSourceProvider,
  type CodexDevelopmentTestImpactSourceProvider
} from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';
import {
  CodexDevelopmentCreateTestImpactTransitionObservation,
  type CodexDevelopmentTestImpactTransitionObservation
} from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { tsconfigRelativePath } from "../../src/adapters/workspace-context.ts";
import { settleResources, withAcquiredResource } from '../../src/execution/resource-settlement.ts';
import { isSecRepositoryTestModulePath } from '../../src/contracts/repository-test-path.ts';

const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FIXTURE_ROOT_PREFIX = 'sec-test-impact-exact-tree-';

type ExactGitFixtureBase = Readonly<{
  provider: CodexDevelopmentTestImpactSourceProvider;
  sourceCommitSha: string;
  fixtureCommitSha: string;
  repositoryRoot: string;
  dispose(): void;
}>;

type ExactRepositoryTestImpactProviderFixture = ExactGitFixtureBase & Readonly<{
  cacheStatus: 'hit' | 'miss';
  compilationReceiptDigest: `sha256:${string}`;
  projectionDigest: `sha256:${string}`;
}>;

type ExactGitTreeTestRunnerFixture = ExactGitFixtureBase & Readonly<{
  workspaceSnapshot: ReturnType<typeof acquireExactGitTreeWorkspaceSourceSnapshot>;
  workingTreeSnapshot: Awaited<ReturnType<typeof acquireWorkingTreeWorkspaceSourceSnapshot>>;
  indexStageOutput: Uint8Array;
  deletedTrackedOutput: Uint8Array;
  affectedObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>>;
}>;

type RemovedDocumentationTestImpactFixture = Readonly<{
  provider: CodexDevelopmentTestImpactSourceProvider;
  transition: CodexDevelopmentTestImpactTransitionObservation;
  dispose(): void;
}>;

type SharedExactRepositoryFixtureState = {
  readonly fixture: Promise<ExactRepositoryTestImpactProviderFixture>;
  references: number;
};

const sharedExactRepositoryFixtures = new Map<string, SharedExactRepositoryFixtureState>();

type ExactRepositoryTestImpactFixturePhase =
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

function observeFixturePhase(
  deadlineAtUnixMs: number,
  phase: ExactRepositoryTestImpactFixturePhase
): void {
  const observedAtUnixMs = Date.now();
  const remainingMs = deadlineAtUnixMs - observedAtUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs) || remainingMs < 1) {
    throw new Error(`Exact repository TestImpact fixture deadline expired before ${phase}.`);
  }
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

// Only the empty native Git configuration is shared. Every TestImpact
// fixture copies its own .git before the first fetch, commit, index write,
// source-object observation and compilation. The executable lookup environment
// participates in the seed key rather than borrowing another test's Git.
const testImpactGitInitBases = new Map<string, string>();

function initializedTestImpactGitBase(): string {
  const environment = isolatedGitReadEnvironment();
  const key = JSON.stringify([
    gitEnvironmentValue(environment, 'PATH') ?? null,
    gitEnvironmentValue(environment, 'SystemRoot') ?? null
  ]);
  const existing = testImpactGitInitBases.get(key);
  if (existing !== undefined) return existing;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-test-impact-git-base-'));
  try {
    git(root, ['init', '--quiet', '--initial-branch=main']);
    git(root, ['config', 'core.autocrlf', 'false']);
    git(root, ['config', 'core.longpaths', 'true']);
    testImpactGitInitBases.set(key, root);
    return root;
  } catch (primary) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch (cleanup) {
      throw new AggregateError([primary, cleanup], 'TestImpact Git seed and cleanup both failed');
    }
    throw primary;
  }
}

afterAll(() => {
  const failures: unknown[] = [];
  for (const [key, root] of testImpactGitInitBases) {
    try {
      rmSync(root, { recursive: true, force: true });
      testImpactGitInitBases.delete(key);
    } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'TestImpact Git seed cleanup failed');
});

function initializeFixtureRepository(repositoryRoot: string): void {
  cpSync(initializedTestImpactGitBase(), repositoryRoot, { recursive: true });
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

export async function createRemovedDocumentationTestImpactFixture(
  descriptorChanged = false,
  includeConsumer = true
): Promise<RemovedDocumentationTestImpactFixture> {
  const sourceRepositoryRoot = process.cwd();
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), FIXTURE_ROOT_PREFIX));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  const dispose = guardedFixtureDisposer(fixtureRoot);
  const documentationPath = 'src/adapters/providers/docker/README.md';
  const descriptorPath = 'src/adapters/providers/docker/module.json';
  try {
    initializeFixtureRepository(repositoryRoot);
    const sources = new Map<string, string>([
      [descriptorPath, readFileSync(path.join(sourceRepositoryRoot, ...descriptorPath.split('/')), 'utf8')],
      ['src/adapters/providers/docker/runtime/fixture.ts', 'export const dockerFixture = true;\n'],
      [documentationPath, '# Docker fixture\n']
    ]);
    if (includeConsumer) {
      sources.set('tests/unit/verification/trusted-runtime-container.test.ts', [
        "import { test } from 'bun:test';",
        "import { dockerFixture } from '../../../src/adapters/providers/docker/runtime/fixture.ts';",
        "test('docker owner', () => { if (!dockerFixture) throw new Error(); });",
        ''
      ].join('\n'));
    }
    for (const [repositoryPath, source] of sources) {
      const target = path.join(repositoryRoot, ...repositoryPath.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, 'utf8');
    }
    writeFileSync(path.join(repositoryRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: { noEmit: true, strict: true },
      include: ['src/**/*.ts', 'tests/**/*.ts']
    })}\n`, 'utf8');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'TestImpact documentation base'], fixtureIdentityEnvironment());
    const baseSha = exactObjectId(git(repositoryRoot, ['rev-parse', 'HEAD']), 'documentation base');
    const baseBlobSha = exactObjectId(
      git(repositoryRoot, ['rev-parse', `${baseSha}:${documentationPath}`]),
      'documentation blob'
    );
    unlinkSync(path.join(repositoryRoot, ...documentationPath.split('/')));
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'Remove TestImpact documentation'], fixtureIdentityEnvironment());
    const headSha = exactObjectId(git(repositoryRoot, ['rev-parse', 'HEAD']), 'documentation head');
    if (descriptorChanged) {
      writeFileSync(
        path.join(repositoryRoot, ...descriptorPath.split('/')),
        `${sources.get(descriptorPath)!}\n`,
        'utf8'
      );
      git(repositoryRoot, ['add', '--', descriptorPath]);
    }
    const records = Object.freeze([{ status: 'removed' as const, path: documentationPath }]);
    const transition = CodexDevelopmentCreateTestImpactTransitionObservation({
      baseSha,
      headSha,
      records,
      readPathBlob: (revision, repositoryPath) => (
        revision === baseSha && repositoryPath === documentationPath
          ? { mode: '100644', blobSha: baseBlobSha }
          : null
      )
    });
    const affectedSource = await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      budget: { deadlineMs: 120_000 }
    }, async (session) => {
      return issueAffectedTestImpactSource({
        compilationOperation: createSourceProgramCompilationOperation({
          deadlineAtUnixMs: Date.now() + 120_000
        }),
        repositoryRoot,
        session,
        baseRef: baseSha
      });
    });
    if (affectedSource === null) throw new Error('Removed documentation TestImpact source was unavailable.');
    const binding = readIssuedAffectedTestImpactBinding(affectedSource);
    if (binding === null) throw new Error('Removed documentation TestImpact binding was unavailable.');
    if (JSON.stringify(binding.transition) !== JSON.stringify(transition)) {
      throw new Error('Removed documentation transition differs from its Git/source binding.');
    }
    const provider = createRepositoryTestImpactSourceProvider({
      projection: affectedSource.projection,
      testInventory: affectedSource.testInventory,
      activeDocumentationPaths: [],
      affectedSource
    });
    return Object.freeze({ provider, transition: binding.transition, dispose });
  } catch (error) {
    settleResources({ primary: { label: 'test-impact-fixture-construction', error },
      cleanup: [{ label: 'test-impact-fixture-root', settle: dispose }] });
    throw error;
  }
}

/**
 * Runner-only fixture. Its immutable synthetic tree models test membership and
 * a clean Git index; it does not claim the repository's production source graph.
 */
export async function createExactGitTreeTestRunnerFixture(): Promise<ExactGitTreeTestRunnerFixture> {
  const normalizedSourceRoot = path.resolve(process.cwd());
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
      testInventory: issueTestInventoryProjection({ snapshot: exactSnapshot }),
      activeDocumentationPaths: currentActiveDocumentationPaths()
    });
    const previousWorkingDirectory = process.cwd();
    let affectedObservation: Awaited<ReturnType<AffectedTestImpactProjectionIssuer>>;
    let workingTreeSnapshot: Awaited<ReturnType<typeof acquireWorkingTreeWorkspaceSourceSnapshot>> | undefined;
    try {
      process.chdir(repositoryRoot);
      affectedObservation = await withAuthorityGitReadSession({
        cwd: repositoryRoot,
        budget: { deadlineMs: 120_000 }
      }, async (session) => {
        const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
        workingTreeSnapshot = workspaceSnapshot;
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
          testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
          projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(
            workspaceSnapshot,
            projectInput
          )
        });
      });
    } finally {
      process.chdir(previousWorkingDirectory);
    }
    if (workingTreeSnapshot === undefined) {
      throw new Error('Exact TestImpact fixture lost its working-tree snapshot.');
    }
    const fixture = Object.freeze({
      workspaceSnapshot: exactSnapshot,
      workingTreeSnapshot,
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
    settleResources({ primary: { label: 'test-impact-fixture-construction', error },
      cleanup: [{ label: 'test-impact-fixture-root', settle: dispose }] });
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
  sourceCommitSha: string,
  deadlineAtUnixMs: number
): Promise<ExactRepositoryTestImpactProviderFixture> {
  const normalizedSourceRoot = path.resolve(sourceRepositoryRoot);
  const operationDeadlineAtUnixMs = deadlineAtUnixMs
    - TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS
    - EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS;
  observeFixturePhase(deadlineAtUnixMs, 'admission');
  if (!Number.isSafeInteger(operationDeadlineAtUnixMs)
      || operationDeadlineAtUnixMs <= Date.now()) {
    throw new Error(
      'Exact repository TestImpact fixture deadline cannot reserve compilation cleanup settlement.'
    );
  }
  observeFixturePhase(deadlineAtUnixMs, 'source-object-read');
  exactTestPaths(normalizedSourceRoot, sourceCommitSha);
  observeFixturePhase(deadlineAtUnixMs, 'fixture-repository-effect');
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
    observeFixturePhase(deadlineAtUnixMs, 'exact-snapshot');
    const workspaceSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot,
      commitSha: fixtureCommitSha
    });
    const documentationIdentity = workspaceSnapshot.file(DOCUMENTATION_IDENTITY_PATH);
    if (documentationIdentity === null) {
      throw new Error('Exact repository TestImpact fixture lacks its documentation identity source.');
    }
    const exactActiveDocumentationPaths = activeDocumentationPaths(
      parseDocumentationIdentityRegistry(documentationIdentity.source)
    );
    observeFixturePhase(deadlineAtUnixMs, 'dependency-retain');
    const runtime = await import('../../src/adapters/toolchain/dependencies/runtime.ts');
    const dependencyAuthority = await runtime.observeCompilerDependencyExecutionGenerationAuthority({
      deadlineAtUnixMs: operationDeadlineAtUnixMs
    });
    if (dependencyAuthority === null) {
      throw new Error(
        'Exact repository TestImpact fixture requires one admitted compiler dependency generation.'
      );
    }
    const compilation = await withAcquiredResource({
      operationLabel: 'test-impact-fixture-compilation',
      resourceLabel: 'test-impact-fixture-dependency-retirement',
      acquire: () => runtime.retainCompilerDependencyReadGeneration(
        dependencyAuthority,
        { deadlineAtUnixMs: operationDeadlineAtUnixMs }
      ),
      use: (retainedDependency) => {
        observeFixturePhase(deadlineAtUnixMs, 'project-input');
        const projectInput = compileWorkspaceTypeScriptProjectInput(
          workspaceSnapshot,
          tsconfigRelativePath,
          {
            dependencyGeneration: retainedDependency.physicalGeneration,
            dependencyGenerationDigest: retainedDependency.generationDigest
          }
        );
        observeFixturePhase(deadlineAtUnixMs, 'cache-open');
        observeFixturePhase(deadlineAtUnixMs, 'compile');
        const compilation = compileRepositorySourceProgramWithCache({
          workspaceSnapshot,
          operation: createSourceProgramCompilationOperation({
            deadlineAtUnixMs: operationDeadlineAtUnixMs
          }),
          projectInput,
          cacheAccess: 'read-only',
          repositoryRoot: normalizedSourceRoot
        });
        observeFixturePhase(deadlineAtUnixMs, 'settlement');
        return compilation;
      },
      release: async (retainedDependency) => { await retainedDependency.retire(); }
    });
    const diagnostics = repositoryCompilationDiagnosticsForTests(workspaceSnapshot);
    const provider = createRepositoryTestImpactSourceProvider({
      projection: issueTestImpactProjection({
        workspaceSnapshot,
        repositoryModel: compilation.model,
        typeScriptModel: compilation.typeScriptCompilation.model,
        testObservations: compilation.testObservations
      }),
      testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
      activeDocumentationPaths: exactActiveDocumentationPaths
    });
    const fixture = Object.freeze({
      provider,
      sourceCommitSha,
      fixtureCommitSha,
      cacheStatus: diagnostics !== null && diagnostics.cache.physicalBytes > 0 ? 'hit' : 'miss',
      compilationReceiptDigest: compilation.receiptDigest,
      projectionDigest: provider.projection.projectionDigest as `sha256:${string}`,
      repositoryRoot,
      dispose
    });
    observeFixturePhase(deadlineAtUnixMs, 'complete');
    return fixture;
  } catch (error) {
    settleResources({ primary: { label: 'test-impact-fixture-construction', error },
      cleanup: [{ label: 'test-impact-fixture-root', settle: dispose }] });
    throw error;
  }
}

/** One process-local lease over the complete exact repository graph. */
export async function acquireExactRepositoryTestImpactProviderFixture(): Promise<ExactRepositoryTestImpactProviderFixture> {
  const normalizedSourceRoot = path.resolve(process.cwd());
  const leaseDeadlineAtUnixMs = Date.now() + DEFAULT_TEST_TIMEOUT_MS;
  const sourceCommitSha = exactObjectId(
    git(normalizedSourceRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
    'TestImpact source commit'
  );
  const fixtureKey = JSON.stringify([normalizedSourceRoot, sourceCommitSha]);
  let state = sharedExactRepositoryFixtures.get(fixtureKey);
  const createsFixture = state === undefined;
  if (state === undefined) {
    state = {
      fixture: createExactRepositoryTestImpactProviderFixture(
        normalizedSourceRoot,
        sourceCommitSha,
        leaseDeadlineAtUnixMs
      ),
      references: 0
    };
    sharedExactRepositoryFixtures.set(fixtureKey, state);
  }
  state.references += 1;
  let fixture: ExactRepositoryTestImpactProviderFixture | undefined;
  try {
    fixture = await state.fixture;
    if (!createsFixture) observeFixturePhase(leaseDeadlineAtUnixMs, 'complete');
  } catch (error) {
    state.references -= 1;
    if (state.references === 0 && sharedExactRepositoryFixtures.get(fixtureKey) === state) {
      sharedExactRepositoryFixtures.delete(fixtureKey);
      if (fixture !== undefined) {
        settleResources({ primary: { label: 'test-impact-fixture-lease-admission', error },
          cleanup: [{ label: 'test-impact-fixture-root', settle: fixture.dispose }] });
      }
    }
    throw error;
  }
  const acquiredFixture = fixture;
  let released = false;
  return Object.freeze({
    ...acquiredFixture,
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
        acquiredFixture.dispose();
      }
    }
  });
}
