import { Glob } from 'bun';

import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { platformCommand } from './platform-command.ts';

export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  nextBuild: boolean;
  playwright: boolean;
  command: string;
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
  lanes: TestBudgetLane[];
  localDefault: string;
  fullRuntimeGate: string;
};

const TEST_FILE_GLOBS = [
  'tests/**/*.test.ts',
  'tests/**/*.spec.ts',
  'tests/**/*.test.tsx',
  'tests/**/*.spec.tsx'
];
const SLOW_TEST_GLOB = 'tests/e2e/**/*.slow.test.ts';
const BUN_SLOW_TEST_EXCLUDE_PATTERN = `./${SLOW_TEST_GLOB}`;

let cachedTestFiles: string[] | null = null;
let cachedFastTestFiles: string[] | null = null;
let cachedSlowTestFiles: string[] | null = null;

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
    lanes,
    localDefault: 'bun run check:changed runs changed/affected fast tests and skips broad source fallback unless PJC_CHANGED_TESTS_FULL_FAST_FALLBACK=1; use test:all or check:full for slow runtime gates',
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
