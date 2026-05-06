import { Glob } from 'bun';

import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { platformCommand } from './platform-command.ts';

export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  nextBuild: boolean;
  playwright: boolean;
  command: string;
};

export type SlowTestSuite = {
  id: string;
  owner: string;
  timeoutMs: number;
  files: string[];
};

export type TestBudgetContract = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
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
  match: RegExp;
};

const TEST_FILE_GLOBS = [
  'tests/**/*.test.ts',
  'tests/**/*.spec.ts',
  'tests/**/*.test.tsx',
  'tests/**/*.spec.tsx'
];
const SLOW_TEST_GLOB = 'tests/e2e/**/*.slow.test.ts';
const BUN_SLOW_TEST_EXCLUDE_PATTERN = `./${SLOW_TEST_GLOB}`;

const slowTestSuiteDefinitions: SlowTestSuiteDefinition[] = [
  { id: 'upgrade', owner: 'platform/compiler/upgrade', timeoutMs: 120_000, match: /\/(upgrade|dry-run-plan)\.slow\.test\.ts$/ },
  { id: 'runtime', owner: 'platform/shared/runtime-dependencies', timeoutMs: 90_000, match: /\/(runtime-host|verification)\.slow\.test\.ts$/ },
  { id: 'pipeline', owner: 'platform/compiler/pipeline', timeoutMs: 120_000, match: /\/(pipeline|end-to-end|expanded-blocks)\.slow\.test\.ts$/ },
  { id: 'repair', owner: 'platform/compiler/repair', timeoutMs: 90_000, match: /\/repair\.slow\.test\.ts$/ },
  { id: 'registry', owner: 'platform/registry', timeoutMs: 90_000, match: /\/(registry|private-registry)\.slow\.test\.ts$/ },
  { id: 'explain', owner: 'platform/compiler/explain', timeoutMs: 90_000, match: /\/(explain|provenance)\.slow\.test\.ts$/ }
];

let cachedTestFiles: string[] | null = null;
let cachedFastTestFiles: string[] | null = null;
let cachedSlowTestFiles: string[] | null = null;
let cachedSlowTestSuites: SlowTestSuite[] | null = null;

function scanTestFilesSync(): string[] {
  const files = new Set<string>();
  for (const pattern of TEST_FILE_GLOBS) {
    const glob = new Glob(pattern);
    for (const file of glob.scanSync()) {
      files.add(file.replaceAll('\\', '/'));
    }
  }
  return [...files].sort();
}

export async function getTestFiles(): Promise<string[]> {
  if (cachedTestFiles) return cachedTestFiles;
  cachedTestFiles = scanTestFilesSync();
  return cachedTestFiles;
}

export function getTestFilesSync(): string[] {
  if (cachedTestFiles) return cachedTestFiles;
  cachedTestFiles = scanTestFilesSync();
  return cachedTestFiles;
}

export async function getSlowTestFiles(): Promise<string[]> {
  if (cachedSlowTestFiles) return cachedSlowTestFiles;
  cachedSlowTestFiles = getTestFilesSync().filter(isSlowTestFile);
  return cachedSlowTestFiles;
}

export function getSlowTestFilesSync(): string[] {
  if (cachedSlowTestFiles) return cachedSlowTestFiles;
  cachedSlowTestFiles = getTestFilesSync().filter(isSlowTestFile);
  return cachedSlowTestFiles;
}

export async function getFastTestFiles(): Promise<string[]> {
  if (cachedFastTestFiles) return cachedFastTestFiles;
  cachedFastTestFiles = getTestFilesSync().filter(isFastTestFile);
  return cachedFastTestFiles;
}

export function getFastTestFilesSync(): string[] {
  if (cachedFastTestFiles) return cachedFastTestFiles;
  cachedFastTestFiles = getTestFilesSync().filter(isFastTestFile);
  return cachedFastTestFiles;
}

function buildSlowTestSuites(): SlowTestSuite[] {
  const slowFiles = getSlowTestFilesSync();
  const assigned = new Set<string>();
  const suites: SlowTestSuite[] = slowTestSuiteDefinitions
    .map((definition) => {
      const files = slowFiles.filter((file) => definition.match.test(file));
      for (const file of files) {
        assigned.add(file);
      }
      return {
        id: definition.id,
        owner: definition.owner,
        timeoutMs: definition.timeoutMs,
        files
      };
    })
    .filter((suite) => suite.files.length > 0);

  const unmatched = slowFiles.filter((file) => !assigned.has(file));
  if (unmatched.length > 0) {
    suites.push({
      id: 'other',
      owner: 'unmapped-slow-e2e',
      timeoutMs: 120_000,
      files: unmatched
    });
  }

  return suites;
}

export function getSlowTestSuitesSync(): SlowTestSuite[] {
  if (cachedSlowTestSuites) return cachedSlowTestSuites;
  cachedSlowTestSuites = buildSlowTestSuites();
  return cachedSlowTestSuites;
}

export async function getSlowTestSuites(): Promise<SlowTestSuite[]> {
  return getSlowTestSuitesSync();
}

const ALL_KNOWN_SLOW_SUITE_IDS = [...slowTestSuiteDefinitions.map((d) => d.id), 'other'];

export function isKnownSlowTestSuiteId(suiteId: string): boolean {
  return ALL_KNOWN_SLOW_SUITE_IDS.includes(suiteId);
}

export function slowTestSuiteIds(): string[] {
  return [...ALL_KNOWN_SLOW_SUITE_IDS];
}

export function slowTestSuiteFiles(suiteId: string): string[] {
  return getSlowTestSuitesSync().find((suite) => suite.id === suiteId)?.files ?? [];
}

export function slowTestExcludePattern(): string {
  return BUN_SLOW_TEST_EXCLUDE_PATTERN;
}

export function isTestFile(file: string): boolean {
  return /^tests\/.+\.(test|spec)\.tsx?$/.test(file);
}

export function isSlowTestFile(file: string): boolean {
  return /^tests\/e2e\/.+\.slow\.(test|spec)\.tsx?$/.test(file);
}

export function isFastTestFile(file: string): boolean {
  return isTestFile(file) && !isSlowTestFile(file);
}

export async function buildTestBudgetContract(): Promise<TestBudgetContract> {
  const lanes = testBudgetLanes.map((lane) => ({ ...lane }));
  const slowLaneIds = lanes.filter((lane) => lane.nextBuild || lane.playwright).map((lane) => lane.id);
  const slowFiles = await getSlowTestFiles();
  const slowSuites = await getSlowTestSuites();
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
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
    localDefault: 'bun run check:affected runs affected fast tests and skips broad source fallback unless PJC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1; use test:slow -- --suite <id>, test:full, or check:full for slow runtime gates',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
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
      `files=${suite.files.join(', ')}`
    ].join('; ')),
    `Local default: ${contract.localDefault}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    ...contract.lanes.map((lane) => [
      `Lane ${lane.id}`,
      `nextBuild=${lane.nextBuild}`,
      `playwright=${lane.playwright}`,
      `command=${lane.command}`
    ].join('; '))
  ].join('\n');
}

const testBudgetLanes: TestBudgetLane[] = [
  {
    id: 'fast',
    nextBuild: false,
    playwright: false,
    command: platformCommand('verify')
  },
  {
    id: 'runtime',
    nextBuild: false,
    playwright: false,
    command: platformCommand('verify', '--lane', 'runtime')
  },
  {
    id: 'all',
    nextBuild: true,
    playwright: true,
    command: platformCommand('verify', '--lane', 'all')
  }
];
