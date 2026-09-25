import {
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../../../../contracts/canonical.ts';
import { isRepositoryTestModulePath, normalizeRepositoryTestModulePath } from '../../../../../contracts/repository-test-path.ts';
import { sourceProgramSurfaceForPath } from '../../../../repository/source-program-model/contract.ts';
import {
  assertWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot
} from '../../../../repository/source-program-model/workspace-source-snapshot.ts';
import { platformCommand } from '../../command.ts';

export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  command: string;
};

export type SlowTestResourceClass = 'standard' | 'runtime-heavy';

export type SlowTestSuite = {
  id: string;
  owner: string;
  /** Admission through terminal observer settlement. */
  logicalRunTimeoutMs: number;
  parallelSafe: boolean;
  resourceClass: SlowTestResourceClass;
  prRiskBaseline: boolean;
  files: readonly string[];
};

export type TestBudgetSnapshotGeneration = Readonly<{
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  testInventoryDigest: `sha256:${string}`;
}>;

export type IssuedTestInventoryProjection = Readonly<{
  schema: 'sec-test-inventory-projection-v1';
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  testFiles: readonly string[];
  inventoryDigest: `sha256:${string}`;
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
  logicalRunTimeoutMs: number;
  parallelSafe: boolean;
  resourceClass: SlowTestResourceClass;
  prRiskBaseline: boolean;
  files: readonly string[];
};

export const DOCUMENT_CONTROL_PLANE_LIFECYCLE_TEST_FILE =
  'tests/contract/document-control-plane-lifecycle.test.ts';
export const FAST_TEST_PROCESS_POLICY_TEST_FILE = 'tests/unit/test-runner.test.ts';
export const TEST_ARCHITECTURE_POLICY_TEST_FILE = 'src/adapters/repository/source-program-model/test-value.test.ts';

function e2eTestFile(name: string): string {
  return `tests/e2e/${name}.test.ts`;
}

function slowPathSuite(
  id: string,
  file: string,
  owner: string,
  logicalRunTimeoutMs = 180_000,
  options: {
    parallelSafe?: boolean;
    resourceClass?: SlowTestResourceClass;
    prRiskBaseline?: boolean;
  } = {}
): SlowTestSuiteDefinition {
  return {
    id,
    owner,
    logicalRunTimeoutMs,
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
  logicalRunTimeoutMs = 180_000,
  options: {
    parallelSafe?: boolean;
    resourceClass?: SlowTestResourceClass;
    prRiskBaseline?: boolean;
  } = {}
): SlowTestSuiteDefinition {
  return slowPathSuite(id, e2eTestFile(fileName), owner, logicalRunTimeoutMs, options);
}

// Slow e2e suites are file-granular by default so CI can shard them with the
// highest useful parallelism while PR risk gates run only the impacted files.
const slowTestSuiteDefinitions: readonly SlowTestSuiteDefinition[] = deepFreeze([
  // These suites acquire the full repository semantic graph. Keep them out of
  // fast batches and serialize their resource-heavy execution through this owner.
  slowPathSuite('contract-ci-lanes', 'tests/contract/ci-lanes.test.ts', 'ci-plan-and-selection', 180_000, {
    resourceClass: 'runtime-heavy'
  }),
  slowPathSuite('contract-ci-trust-closure', 'tests/contract/ci-trust-closure-contract.test.ts', 'ci-trust-closure', 180_000, {
    resourceClass: 'runtime-heavy'
  }),
  slowPathSuite('unit-slow-test-selection', 'tests/unit/slow-test-selection.test.ts', 'test-impact-selection', 180_000, {
    resourceClass: 'runtime-heavy'
  }),
  slowPathSuite('unit-verification-session-runtime', 'tests/unit/verification-session-runtime.test.ts', 'verification-session-runtime', 180_000, {
    resourceClass: 'runtime-heavy'
  }),
  slowPathSuite(
    'source-program-workspace-snapshot',
    'src/adapters/repository/source-program-model/workspace-source-snapshot.test.ts',
    'source-program-workspace-snapshot',
    180_000,
    { resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'compiler-dependency-fixture',
    'src/adapters/toolchain/dependencies/test/compiler-dependency-fixture.test.ts',
    'compiler-dependency-fixture',
    180_000,
    { resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'unit-dev-runner-dependency-bootstrap',
    'tests/unit/dev-runner-dependency-bootstrap.test.ts',
    'development-runner-dependency-bootstrap',
    300_000,
    { resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'unit-branch-local-residue-closeout',
    'tests/unit/branch-local-residue-closeout.test.ts',
    'local-branch-residue-closeout',
    180_000,
    { resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'unit-dependency-rollover-capacity',
    'tests/unit/dependency-rollover-capacity.test.ts',
    'compiler-dependency-transition-rollover',
    300_000
  ),
  slowPathSuite(
    'integration-release-set-portable',
    'tests/integration/release-set-portable.test.ts',
    'release-set-portability',
    120_000,
    { parallelSafe: true, resourceClass: 'runtime-heavy' }
  ),
  slowPathSuite(
    'integration-upgrade-validation',
    'tests/integration/validation.test.ts',
    'upgrade-transaction-validation',
    300_000,
    { resourceClass: 'runtime-heavy' }
  ),
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

// This index derives only from the immutable definitions above. Its maps never
// escape; query results are frozen and retain declaration order. Do not rebuild
// the same suite identity/path tables for every changed-file lookup.
const slowTestSuiteIndex = (() => {
  const ids = Object.freeze(slowTestSuiteDefinitions.map(({ id }) => id));
  const mutable = new Map<string, string[]>();
  for (const suite of slowTestSuiteDefinitions) {
    for (const file of suite.files) {
      const matches = mutable.get(file);
      if (matches === undefined) mutable.set(file, [suite.id]);
      else matches.push(suite.id);
    }
  }
  const idsByFile: ReadonlyMap<string, readonly string[]> = new Map(
    [...mutable].map(([file, matches]) => [file, Object.freeze(matches)] as const)
  );
  return { ids, knownIds: new Set(ids), idsByFile };
})();
const NO_SLOW_TEST_SUITES: readonly string[] = Object.freeze([]);

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
          logicalRunTimeoutMs: definition.logicalRunTimeoutMs,
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

const issuedTestInventories = new WeakSet<object>();

function testFilesFromSnapshotFiles(files: readonly { path: string }[]): readonly string[] {
  return uniqueSorted(files.map(({ path }) => path).filter((path) => (
    sourceProgramSurfaceForPath(path) === 'test'
      && isRepositoryTestModulePath(path)
  )));
}

function issueTestInventory(input: Omit<IssuedTestInventoryProjection, 'schema' | 'inventoryDigest'>): IssuedTestInventoryProjection {
  const unsigned = deepFreeze({
    schema: 'sec-test-inventory-projection-v1' as const,
    workspaceSnapshotIdentityDigest: input.workspaceSnapshotIdentityDigest,
    snapshotDigest: input.snapshotDigest,
    testFiles: uniqueSorted([...input.testFiles])
  });
  const inventory = deepFreeze({
    ...unsigned,
    inventoryDigest: sha256(unsigned) as `sha256:${string}`
  });
  issuedTestInventories.add(inventory);
  return inventory;
}

export function issueTestInventoryProjection(input: Readonly<{
  snapshot: WorkspaceSourceSnapshot;
}>): IssuedTestInventoryProjection {
  const snapshot = input.snapshot;
  assertWorkspaceSourceSnapshot(snapshot);
  return issueTestInventory({
    workspaceSnapshotIdentityDigest: snapshot.identityDigest,
    snapshotDigest: snapshot.snapshotDigest,
    testFiles: testFilesFromSnapshotFiles(snapshot.files)
  });
}

export function assertIssuedTestInventoryProjection(
  inventory: IssuedTestInventoryProjection
): void {
  if (!issuedTestInventories.has(inventory)) {
    throw new Error('Test inventory requires its owner-issued workspace snapshot projection.');
  }
}

function projectionGeneration(source: IssuedTestInventoryProjection): TestBudgetSnapshotGeneration {
  return Object.freeze({
    workspaceSnapshotIdentityDigest: source.workspaceSnapshotIdentityDigest as `sha256:${string}`,
    testInventoryDigest: source.inventoryDigest
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

type CapturedTestBudgetInput = Readonly<{
  generation: TestBudgetSnapshotGeneration;
  generationKey: `sha256:${string}`;
  testFiles: ReadonlySet<string>;
}>;

function captureTestBudgetInput(source: IssuedTestInventoryProjection): CapturedTestBudgetInput {
  assertIssuedTestInventoryProjection(source);
  const generation = projectionGeneration(source);
  return {
    generation,
    generationKey: projectionGenerationKey(generation),
    testFiles: new Set(source.testFiles.filter(isRepositoryTestModulePath)
      .map(normalizeRepositoryTestModulePath))
  };
}

const compiledTestBudgetProjections = new WeakSet<TestBudgetProjection>();
const issuedTestBudgetSources = new WeakMap<TestBudgetProjection, IssuedTestInventoryProjection>();

function compileExactTestBudgetProjection(
  input: CapturedTestBudgetInput,
  issuedSource: IssuedTestInventoryProjection
): TestBudgetProjection {
  const { generation, generationKey } = input;
  const testFiles = uniqueSorted([...input.testFiles]);
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
  const compiled = deepFreeze({
    ...unsigned,
    projectionDigest: budgetProjectionDigest(unsigned)
  });
  compiledTestBudgetProjections.add(compiled);
  issuedTestBudgetSources.set(compiled, issuedSource);
  return compiled;
}

export function compileTestBudgetProjection(
  source: IssuedTestInventoryProjection
): TestBudgetProjection {
  return compileExactTestBudgetProjection(
    captureTestBudgetInput(source), source
  );
}

/**
 * Execution provenance is stronger than derivation provenance: the exact
 * budget instance must retain the owner-issued test inventory projection from
 * which it was compiled. A DTO that reproduces the same bytes cannot acquire
 * this association.
 */
export function assertTestBudgetExecutionProvenance(
  projection: TestBudgetProjection,
  source: IssuedTestInventoryProjection
): void {
  assertIssuedTestInventoryProjection(source);
  if (!compiledTestBudgetProjections.has(projection)
      || issuedTestBudgetSources.get(projection) !== source) {
    throw new Error('Test budget execution requires its exact owner-issued test inventory projection.');
  }
  const generation = projectionGeneration(source);
  if (projection.generationKey !== projectionGenerationKey(generation)
      || projection.generation.workspaceSnapshotIdentityDigest !== generation.workspaceSnapshotIdentityDigest
      || projection.generation.testInventoryDigest !== generation.testInventoryDigest) {
    throw new Error('Test budget generation differs from its issued test inventory projection.');
  }
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
  return slowTestSuiteIndex.knownIds.has(suiteId);
}

export function slowTestSuiteIds(): readonly string[] {
  return slowTestSuiteIndex.ids;
}

/** Canonical suite identity for a live, removed, or renamed test path. */
export function slowTestSuiteIdsForFile(file: string): readonly string[] {
  file = normalizeRepositoryTestModulePath(file);
  return slowTestSuiteIndex.idsByFile.get(file) ?? NO_SLOW_TEST_SUITES;
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
  const normalized = normalizeRepositoryTestModulePath(file);
  return isRepositoryTestModulePath(normalized)
    && (slowTestSuiteIndex.idsByFile.has(normalized) || normalized.startsWith('tests/e2e/'));
}

export function isFastTestFile(file: string): boolean {
  return isRepositoryTestModulePath(file) && !isSlowTestFile(file);
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
    localDefault: 'bun run check -- --affected runs affected fast tests and skips broad source fallback unless SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1; use test -- --scope slow --suite <id>, test -- --scope full, or check -- --scope full for slow runtime gates',
    fullRuntimeGate: 'affected runtime changes or explicit release/demo verification'
  });
}const testBudgetLanes: readonly TestBudgetLane[] = deepFreeze([
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
