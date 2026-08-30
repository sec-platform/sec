import { Glob } from 'bun';

import { platformCommand } from '../../../interface/cli/contract.ts';
import { compareCodeUnits } from '../../../system-architecture/foundation/runtime/canonical.ts';

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
  files: string[];
};

export type TestBudgetContract = {
  command: string;
  runnerCommand: string;
  defaultLane: TestBudgetLane['id'];
  laneCount: number;
  slowLaneCount: number;
  slowLaneIds: TestBudgetLane['id'][];
  slowTestFileCount: number;
  slowTestFiles: string[];
  slowSuiteCount: number;
  slowSuites: SlowTestSuite[];
  lanes: TestBudgetLane[];
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
  files: string[];
};

const TEST_FILE_GLOBS = [
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.test.tsx',
  'src/**/*.spec.tsx',
  'tests/**/*.test.ts',
  'tests/**/*.spec.ts',
  'tests/**/*.test.tsx',
  'tests/**/*.spec.tsx'
];

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
const slowTestSuiteDefinitions: SlowTestSuiteDefinition[] = [
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
];

const explicitSlowTestFiles = new Set(
  slowTestSuiteDefinitions.flatMap((suite) => suite.files)
);

function scanTestFilesSync(): string[] {
  const files = new Set<string>();
  for (const pattern of TEST_FILE_GLOBS) {
    const glob = new Glob(pattern);
    for (const file of glob.scanSync()) {
      files.add(file.replaceAll('\\', '/'));
    }
  }
  return [...files].sort(compareCodeUnits);
}

export class TestBudgetCache {
  private cachedTestFiles: string[] | null = null;
  private cachedFastTestFiles: string[] | null = null;
  private cachedSlowTestFiles: string[] | null = null;
  private cachedSlowTestSuites: SlowTestSuite[] | null = null;

  getTestFilesSync(): string[] {
    if (this.cachedTestFiles) return this.cachedTestFiles;
    this.cachedTestFiles = scanTestFilesSync();
    return this.cachedTestFiles;
  }

  async getTestFiles(): Promise<string[]> {
    return this.getTestFilesSync();
  }

  getSlowTestFilesSync(): string[] {
    if (this.cachedSlowTestFiles) return this.cachedSlowTestFiles;
    this.cachedSlowTestFiles = this.getTestFilesSync().filter(isSlowTestFile);
    return this.cachedSlowTestFiles;
  }

  async getSlowTestFiles(): Promise<string[]> {
    return this.getSlowTestFilesSync();
  }

  getFastTestFilesSync(): string[] {
    if (this.cachedFastTestFiles) return this.cachedFastTestFiles;
    this.cachedFastTestFiles = this.getTestFilesSync().filter(isFastTestFile);
    return this.cachedFastTestFiles;
  }

  async getFastTestFiles(): Promise<string[]> {
    return this.getFastTestFilesSync();
  }

  getSlowTestSuitesSync(): SlowTestSuite[] {
    if (this.cachedSlowTestSuites) return this.cachedSlowTestSuites;
    this.cachedSlowTestSuites = this.buildSlowTestSuites();
    return this.cachedSlowTestSuites;
  }

  async getSlowTestSuites(): Promise<SlowTestSuite[]> {
    return this.getSlowTestSuitesSync();
  }

  private buildSlowTestSuites(): SlowTestSuite[] {
    const slowFiles = this.getSlowTestFilesSync();
    const slowFileSet = new Set(slowFiles);
    const assigned = new Set<string>();
    const suites: SlowTestSuite[] = slowTestSuiteDefinitions
      .map((definition) => {
        const files = definition.files.filter((file) => slowFileSet.has(file)).sort(compareCodeUnits);
        if (files.length !== definition.files.length) {
          const missing = definition.files.filter((file) => !slowFileSet.has(file));
          throw new Error(
            `Slow test suite ${definition.id} references missing test files: ${missing.join(', ')}`
          );
        }
        for (const file of files) {
          if (assigned.has(file)) {
            throw new Error(`Slow test file assigned to multiple suites: ${file}`);
          }
          assigned.add(file);
        }
        return {
          id: definition.id,
          owner: definition.owner,
          timeoutMs: definition.timeoutMs,
          parallelSafe: definition.parallelSafe,
          resourceClass: definition.resourceClass,
          prRiskBaseline: definition.prRiskBaseline,
          files
        };
      });

    const unmatched = slowFiles.filter((file) => !assigned.has(file));
    if (unmatched.length > 0) {
      throw new Error(
        `Slow test files require one explicit suite owner: ${unmatched.join(', ')}`
      );
    }

    return suites;
  }
}

const defaultTestBudgetCache = new TestBudgetCache();

export function getTestFiles(): Promise<string[]> {
  return defaultTestBudgetCache.getTestFiles();
}

export function getTestFilesSync(): string[] {
  return defaultTestBudgetCache.getTestFilesSync();
}

export function getSlowTestFiles(): Promise<string[]> {
  return defaultTestBudgetCache.getSlowTestFiles();
}

export function getSlowTestFilesSync(): string[] {
  return defaultTestBudgetCache.getSlowTestFilesSync();
}

export function getFastTestFiles(): Promise<string[]> {
  return defaultTestBudgetCache.getFastTestFiles();
}

export function getFastTestFilesSync(): string[] {
  return defaultTestBudgetCache.getFastTestFilesSync();
}

export function getSlowTestSuitesSync(): SlowTestSuite[] {
  return defaultTestBudgetCache.getSlowTestSuitesSync();
}

export async function getSlowTestSuites(): Promise<SlowTestSuite[]> {
  return defaultTestBudgetCache.getSlowTestSuites();
}

export function isKnownSlowTestSuiteId(suiteId: string): boolean {
  return slowTestSuiteIds().includes(suiteId);
}

export function slowTestSuiteIds(): string[] {
  return getSlowTestSuitesSync().map((suite) => suite.id);
}

/** Canonical suite identity for a live, removed, or renamed test path. */
export function slowTestSuiteIdsForFile(file: string): string[] {
  return slowTestSuiteDefinitions
    .filter((suite) => suite.files.includes(file))
    .map((suite) => suite.id);
}

export function slowTestSuiteFiles(suiteId: string): string[] {
  return getSlowTestSuitesSync().find((suite) => suite.id === suiteId)?.files ?? [];
}

export function slowTestPrRiskBaselineSuiteIds(): string[] {
  return getSlowTestSuitesSync().filter((suite) => suite.prRiskBaseline).map((suite) => suite.id);
}

export function isTestFile(file: string): boolean {
  return /^tests\/.+\.(test|spec)\.tsx?$/.test(file);
}

export function isSlowTestFile(file: string): boolean {
  return explicitSlowTestFiles.has(file) || /^tests\/e2e\/.+\.(test|spec)\.tsx?$/.test(file);
}

export function isFastTestFile(file: string): boolean {
  return isTestFile(file) && !isSlowTestFile(file);
}

export async function buildTestBudgetContract(): Promise<TestBudgetContract> {
  const lanes = testBudgetLanes.map((lane) => ({ ...lane }));
  const slowLaneIds: TestBudgetLane['id'][] = ['runtime', 'all'];
  const slowFiles = await getSlowTestFiles();
  const slowSuites = await getSlowTestSuites();
  return {
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
  };
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

const testBudgetLanes: TestBudgetLane[] = [
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
];
