import type { TestImpactProjectionReceipt } from '../../../brownfield/source-program-model/test-impact-projection.ts';
import { platformCommand } from '../../../interface/cli/contract/command.ts';
import {
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../../system-architecture/foundation/runtime/canonical.ts';
import { isSecRepositoryTestModulePath } from '../../../system-architecture/repository-modules/test-module-path.ts';

export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  command: string;
};

export type SlowTestResourceClass = 'standard' | 'runtime-heavy';

export type SlowTestSuite = {
  id: string;
  owner: string;
  timeoutMs: number;
  parallelSafe: boolean;
  resourceClass: SlowTestResourceClass;
  prRiskBaseline: boolean;
  files: readonly string[];
};

export type TestBudgetSnapshotGeneration = Readonly<{
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  testObservationDigest: `sha256:${string}`;
  sourceProjectionDigest: `sha256:${string}`;
}>;

export type TestBudgetProjection = Readonly<{
  generation: TestBudgetSnapshotGeneration;
  generationKey: `sha256:${string}`;
  testFiles: readonly string[];
  fastTestFiles: readonly string[];
  slowTestFiles: readonly string[];
  slowSuites: readonly SlowTestSuite[];
  projectionDigest: `sha256:${string}`;
}>;

export type TestBudgetContract = {
  command: string;
  runnerCommand: string;
  defaultLane: TestBudgetLane['id'];
  laneCount: number;
  slowLaneCount: number;
  slowLaneIds: TestBudgetLane['id'][];
  slowTestFileCount: number;
  slowTestFiles: readonly string[];
  slowSuiteCount: number;
  slowSuites: readonly SlowTestSuite[];
  lanes: readonly TestBudgetLane[];
  localDefault: string;
  fullRuntimeGate: string;
};

type SlowTestSuiteDefinition = {
  id: string;
  owner: string;
  timeoutMs: number;
  parallelSafe: boolean;
  resourceClass: SlowTestResourceClass;
  prRiskBaseline: boolean;
  files: readonly string[];
};

export const DOCUMENT_CONTROL_PLANE_LIFECYCLE_TEST_FILE =
  'tests/contract/document-control-plane-lifecycle.test.ts';
export const FAST_TEST_PROCESS_POLICY_TEST_FILE = 'tests/unit/test-runner.test.ts';
export const TEST_ARCHITECTURE_POLICY_TEST_FILE = 'src/brownfield/source-program-model/test-value.test.ts';

function e2eTestFile(name: string): string {
  return `tests/e2e/${name}.test.ts`;
}

function slowPathSuite(
  id: string,
  file: string,
  owner: string,
  timeoutMs = 180_000,
  options: {
    parallelSafe?: boolean;
    resourceClass?: SlowTestResourceClass;
    prRiskBaseline?: boolean;
  } = {}
): SlowTestSuiteDefinition {
  return {
    id,
    owner,
    timeoutMs,
    parallelSafe: options.parallelSafe ?? false,
    resourceClass: options.resourceClass ?? 'standard',
    prRiskBaseline: options.prRiskBaseline ?? false,
    files: [file]
  };
}

function slowFileSuite(
  id: string,
  fileName: string,
  owner: string,
  timeoutMs = 180_000,
  options: {
    parallelSafe?: boolean;
    resourceClass?: SlowTestResourceClass;
    prRiskBaseline?: boolean;
  } = {}
): SlowTestSuiteDefinition {
  return slowPathSuite(id, e2eTestFile(fileName), owner, timeoutMs, options);
}

// Slow e2e suites are file-granular by default so CI can shard them with the
// highest useful parallelism while PR risk gates run only the impacted files.
const slowTestSuiteDefinitions: readonly SlowTestSuiteDefinition[] = deepFreeze([
  slowPathSuite(
    'integration-shared-runtime-dependencies',
    'tests/integration/project-dependency-runtime.test.ts',
    'shared-runtime-dependency-integration',
    300_000,
    { parallelSafe: true, resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'contract-document-control-plane-lifecycle',
    DOCUMENT_CONTROL_PLANE_LIFECYCLE_TEST_FILE,
    'document-control-plane-lifecycle',
    1_200_000,
    { parallelSafe: true, resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'unit-worktree-closeout-crash-recovery',
    'tests/unit/worktree-physical-closeout-crash-recovery.test.ts',
    'git-worktree-physical-closeout',
    180_000,
    { parallelSafe: true, resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'unit-worktree-closeout-temp-repo',
    'tests/unit/worktree-physical-closeout-temp-repo.test.ts',
    'git-worktree-physical-closeout',
    180_000,
    { parallelSafe: true, resourceClass: 'runtime-heavy' }
  ),
  slowFileSuite('e2e-artifacts', 'artifacts', 'compiler-artifacts-e2e', 120_000, {
    parallelSafe: true,
    resourceClass: 'runtime-heavy',
    prRiskBaseline: true
  }),
  slowFileSuite('e2e-compiler-smoke', 'compiler-smoke', 'compiler-smoke-e2e', 120_000, { parallelSafe: true, prRiskBaseline: true }),
  slowFileSuite('e2e-demo-doctor', 'demo-doctor', 'compiler-demo-doctor-e2e', 120_000, {
    parallelSafe: true,
    resourceClass: 'runtime-heavy'
  }),
  slowFileSuite('e2e-dry-run-plan', 'dry-run-plan', 'compiler-dry-run-plan-e2e', 180_000, { parallelSafe: true }),
  slowFileSuite('e2e-pipeline-end-to-end', 'end-to-end', 'compiler-pipeline-end-to-end-e2e'),
  slowFileSuite('e2e-expanded-blocks', 'expanded-blocks', 'compiler-expanded-blocks-e2e', 180_000, { parallelSafe: true }),
  slowFileSuite('e2e-explain', 'explain', 'compiler-explain-e2e', 120_000, {
    parallelSafe: true,
    resourceClass: 'runtime-heavy'
  }),
  slowFileSuite('e2e-graph', 'graph', 'compiler-graph-e2e', 120_000, { parallelSafe: true }),
  {
    ...slowFileSuite('e2e-import-organizer-staged', 'import-organizer-staged', 'compiler-import-organizer-staged-e2e', 120_000, {
      parallelSafe: true
    }),
    files: [
      e2eTestFile('import-organizer-staged'),
      e2eTestFile('import-organizer-worktree-isolation')
    ]
  },
  slowFileSuite('e2e-install-git-hooks', 'install-git-hooks', 'managed-git-hooks-e2e', 120_000, {
    parallelSafe: true
  }),
  slowFileSuite('e2e-lanes', 'lanes', 'compiler-lanes-e2e', 120_000, { parallelSafe: true }),
  slowFileSuite('e2e-manifest', 'manifest', 'compiler-manifest-e2e'),
  slowFileSuite('e2e-pipeline', 'pipeline', 'compiler-pipeline-e2e'),
  slowFileSuite('e2e-policy', 'policy', 'compiler-policy-e2e', 180_000, { parallelSafe: true }),
  slowFileSuite('e2e-prisma-merge', 'prisma-merge', 'compiler-prisma-merge-e2e'),
  slowFileSuite('e2e-private-registry', 'private-registry', 'compiler-private-registry-e2e'),
  slowFileSuite('e2e-provenance', 'provenance', 'compiler-provenance-e2e', 120_000, {
    parallelSafe: true,
    resourceClass: 'runtime-heavy',
    prRiskBaseline: true
  }),
  slowFileSuite('e2e-registry', 'registry', 'compiler-registry-e2e'),
  slowFileSuite('e2e-repair', 'repair', 'compiler-repair-e2e', 180_000, { parallelSafe: true }),
  slowFileSuite('e2e-summary', 'summary', 'compiler-summary-e2e', 120_000, {
    parallelSafe: true,
    resourceClass: 'runtime-heavy'
  }),
  slowFileSuite(
    'e2e-ticket-semantic-vertical',
    'semantic-runtime-contract',
    'ticket-semantic-vertical',
    300_000
  ),
  slowFileSuite('e2e-upgrade', 'upgrade', 'compiler-upgrade-e2e', 180_000, { parallelSafe: true }),
  {
    ...slowFileSuite('e2e-verify-lock', 'verification', 'compiler-verify-lock-e2e', 900_000, {
      parallelSafe: true,
      prRiskBaseline: true
    }),
    files: [
      e2eTestFile('verification'),
      e2eTestFile('verification-session-closeout-cli')
    ]
  },
  slowFileSuite('e2e-windows-appcontainer-executor', 'windows-appcontainer-executor', 'windows-appcontainer-native-e2e', 180_000, {
    resourceClass: 'runtime-heavy'
  }),
  slowFileSuite('e2e-workspace', 'workspace', 'compiler-workspace-e2e', 120_000, { parallelSafe: true, prRiskBaseline: true })
]);

const explicitSlowTestFiles: ReadonlySet<string> = new Set(
  slowTestSuiteDefinitions.flatMap((suite) => suite.files)
);

function buildSlowTestSuites(slowFiles: readonly string[]): readonly SlowTestSuite[] {
    const slowFileSet = new Set(slowFiles);
    const assigned = new Set<string>();
    const suites: SlowTestSuite[] = slowTestSuiteDefinitions
      .flatMap((definition) => {
        const files = definition.files.filter((file) => slowFileSet.has(file)).sort(compareCodeUnits);
        if (files.length !== definition.files.length) {
          return [];
        }
        for (const file of files) {
          if (assigned.has(file)) {
            throw new Error(`Slow test file assigned to multiple suites: ${file}`);
          }
          assigned.add(file);
        }
        return [{
          id: definition.id,
          owner: definition.owner,
          timeoutMs: definition.timeoutMs,
          parallelSafe: definition.parallelSafe,
          resourceClass: definition.resourceClass,
          prRiskBaseline: definition.prRiskBaseline,
          files
        }];
      });

    const unmatched = slowFiles.filter((file) => !assigned.has(file));
    if (unmatched.length > 0) {
      throw new Error(
        `Slow test files require one explicit suite owner: ${unmatched.join(', ')}`
      );
    }

    return suites;
}

function projectionGeneration(
  source: TestImpactProjectionReceipt
): TestBudgetSnapshotGeneration {
  return Object.freeze({
    workspaceSnapshotIdentityDigest: source.workspaceSnapshotIdentityDigest as `sha256:${string}`,
    testObservationDigest: source.testObservationDigest as `sha256:${string}`,
    sourceProjectionDigest: source.projectionDigest as `sha256:${string}`
  });
}

function projectionGenerationKey(
  generation: TestBudgetSnapshotGeneration
): `sha256:${string}` {
  return sha256(generation) as `sha256:${string}`;
}

function budgetProjectionDigest(
  projection: Omit<TestBudgetProjection, 'projectionDigest'>
): `sha256:${string}` {
  return sha256(projection) as `sha256:${string}`;
}

function compileExactTestBudgetProjection(
  source: TestImpactProjectionReceipt
): TestBudgetProjection {
  const generation = projectionGeneration(source);
  const generationKey = projectionGenerationKey(generation);
  const testFiles = uniqueSorted(source.testFiles.filter(isSecRepositoryTestModulePath));
  const fastTestFiles = testFiles.filter(isFastTestFile);
  const slowTestFiles = testFiles.filter(isSlowTestFile);
  const slowSuites = buildSlowTestSuites(slowTestFiles);
  const unsigned = deepFreeze({
    generation,
    generationKey,
    testFiles,
    fastTestFiles,
    slowTestFiles,
    slowSuites
  });
  return deepFreeze({
    ...unsigned,
    projectionDigest: budgetProjectionDigest(unsigned)
  });
}

function isCurrentCachedProjection(
  cached: TestBudgetProjection,
  source: TestImpactProjectionReceipt,
  generationKey: `sha256:${string}`
): boolean {
  if (!Object.isFrozen(cached)
      || cached.generationKey !== generationKey
      || cached.generation.sourceProjectionDigest !== source.projectionDigest
      || cached.generation.testObservationDigest !== source.testObservationDigest
      || cached.generation.workspaceSnapshotIdentityDigest !== source.workspaceSnapshotIdentityDigest) {
    return false;
  }
  const { projectionDigest, ...unsigned } = cached;
  return projectionDigest === budgetProjectionDigest(unsigned)
    && cached.testFiles.every((file) => source.testFiles.includes(file))
    && cached.testFiles.length === source.testFiles.filter(isSecRepositoryTestModulePath).length
    && cached.fastTestFiles.every(isFastTestFile)
    && cached.slowTestFiles.every(isSlowTestFile)
    && cached.slowSuites.every((suite) => Object.isFrozen(suite) && Object.isFrozen(suite.files));
}

/**
 * Invocation-owned cache. Its key is the complete Source Snapshot/Test
 * Observation generation; cached values never become membership authority.
 */
export class TestBudgetProjectionCache {
  private readonly projections = new Map<`sha256:${string}`, TestBudgetProjection>();

  project(source: TestImpactProjectionReceipt): TestBudgetProjection {
    const generationKey = projectionGenerationKey(projectionGeneration(source));
    const cached = this.projections.get(generationKey);
    if (cached !== undefined && isCurrentCachedProjection(cached, source, generationKey)) {
      return cached;
    }
    const exact = compileExactTestBudgetProjection(source);
    this.projections.set(generationKey, exact);
    return exact;
  }
}

export function compileTestBudgetProjection(
  source: TestImpactProjectionReceipt
): TestBudgetProjection {
  return compileExactTestBudgetProjection(source);
}

export function getTestFilesSync(projection: TestBudgetProjection): readonly string[] {
  return projection.testFiles;
}

export function getSlowTestFilesSync(projection: TestBudgetProjection): readonly string[] {
  return projection.slowTestFiles;
}

export function getFastTestFilesSync(projection: TestBudgetProjection): readonly string[] {
  return projection.fastTestFiles;
}

export function getSlowTestSuitesSync(projection: TestBudgetProjection): readonly SlowTestSuite[] {
  return projection.slowSuites;
}

export function isKnownSlowTestSuiteId(suiteId: string): boolean {
  return slowTestSuiteIds().includes(suiteId);
}

export function slowTestSuiteIds(): readonly string[] {
  return Object.freeze(slowTestSuiteDefinitions.map((suite) => suite.id));
}

/** Canonical suite identity for a live, removed, or renamed test path. */
export function slowTestSuiteIdsForFile(file: string): readonly string[] {
  return Object.freeze(slowTestSuiteDefinitions
    .filter((suite) => suite.files.includes(file))
    .map((suite) => suite.id));
}

export function slowTestSuiteFiles(
  projection: TestBudgetProjection,
  suiteId: string
): readonly string[] {
  return projection.slowSuites.find((suite) => suite.id === suiteId)?.files ?? Object.freeze([]);
}

export function slowTestPrRiskBaselineSuiteIds(
  projection: TestBudgetProjection
): readonly string[] {
  return Object.freeze(projection.slowSuites
    .filter((suite) => suite.prRiskBaseline)
    .map((suite) => suite.id));
}

export function isSlowTestFile(file: string): boolean {
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//u, '');
  return isSecRepositoryTestModulePath(normalized)
    && (explicitSlowTestFiles.has(normalized) || normalized.startsWith('tests/e2e/'));
}

export function isFastTestFile(file: string): boolean {
  return isSecRepositoryTestModulePath(file) && !isSlowTestFile(file);
}

export function buildTestBudgetContract(
  projection: TestBudgetProjection
): TestBudgetContract {
  const lanes = Object.freeze(testBudgetLanes.map((lane) => Object.freeze({ ...lane })));
  const slowLaneIds: TestBudgetLane['id'][] = ['runtime', 'all'];
  const slowFiles = projection.slowTestFiles;
  const slowSuites = projection.slowSuites;
  return deepFreeze({
    command: platformCommand('test', 'budget', '--json'),
    runnerCommand: 'bun run test:budget',
    defaultLane: 'fast',
    laneCount: lanes.length,
    slowLaneCount: slowLaneIds.length,
    slowLaneIds,
    slowTestFileCount: slowFiles.length,
    slowTestFiles: slowFiles,
    slowSuiteCount: slowSuites.length,
    slowSuites,
    lanes,
    localDefault: 'bun run check:affected runs affected fast tests and skips broad source fallback unless SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1; use test:slow -- --suite <id>, test:full, or check:full for slow runtime gates',
    fullRuntimeGate: 'affected runtime changes or explicit release/demo verification'
  });
}

export function formatTestBudgetContract(contract: TestBudgetContract): string {
  return [
    `Test budget default lane: ${contract.defaultLane}`,
    `Command: ${contract.command}`,
    `Runner command: ${contract.runnerCommand}`,
    `Lanes: ${contract.laneCount}`,
    `Slow lane count: ${contract.slowLaneCount}`,
    `Slow lanes: ${contract.slowLaneIds.join(', ')}`,
    `Slow test files: ${contract.slowTestFileCount}`,
    `Slow test file list: ${contract.slowTestFiles.join(', ')}`,
    `Slow suites: ${contract.slowSuiteCount}`,
    ...contract.slowSuites.map((suite) => [
      `Slow suite ${suite.id}`,
      `owner=${suite.owner}`,
      `timeoutMs=${suite.timeoutMs}`,
      `parallelSafe=${suite.parallelSafe}`,
      `resourceClass=${suite.resourceClass}`,
      `prRiskBaseline=${suite.prRiskBaseline}`,
      `files=${suite.files.join(', ')}`
    ].join('; ')),
    `Local default: ${contract.localDefault}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    ...contract.lanes.map((lane) => [
      `Lane ${lane.id}`,
      `command=${lane.command}`
    ].join('; '))
  ].join('\n');
}

const testBudgetLanes: readonly TestBudgetLane[] = deepFreeze([
  {
    id: 'fast',
    command: platformCommand('verify')
  },
  {
    id: 'runtime',
    command: platformCommand('verify', '--lane', 'runtime')
  },
  {
    id: 'all',
    command: platformCommand('verify', '--lane', 'all')
  }
]);
