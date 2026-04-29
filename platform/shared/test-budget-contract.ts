export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  nextBuild: boolean;
  playwright: boolean;
  command: string;
};

export type TestBudgetContract = {
  formatVersion: '1';
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

const slowTestFiles = [
  'tests/cli/artifacts.test.ts',
  'tests/cli/demo-doctor.test.ts',
  'tests/cli/explain.test.ts',
  'tests/cli/provenance.test.ts',
  'tests/cli/repair.test.ts',
  'tests/cli/upgrade.test.ts',
  'tests/cli/verification.test.ts',
  'tests/cli/workspace.test.ts',
  'tests/explain/graph.test.ts',
  'tests/override/manifest.test.ts',
  'tests/pipeline/end-to-end.test.ts',
  'tests/pipeline/lanes.test.ts',
  'tests/pipeline/local-views.test.ts',
  'tests/pipeline/runtime-host.test.ts',
  'tests/policy/policy.test.ts',
  'tests/registry/expanded-blocks.test.ts',
  'tests/registry/private-registry.test.ts',
  'tests/registry/registry.test.ts',
  'tests/review/summary.test.ts',
  'tests/upgrade/conflicts.test.ts',
  'tests/upgrade/dry-run-plan.test.ts',
  'tests/upgrade/pipeline.test.ts'
];

const testBudgetLanes: TestBudgetLane[] = [
  {
    id: 'fast',
    nextBuild: false,
    playwright: false,
    command: 'npm run platform -- verify'
  },
  {
    id: 'runtime',
    nextBuild: false,
    playwright: false,
    command: 'npm run platform -- verify --lane runtime'
  },
  {
    id: 'all',
    nextBuild: true,
    playwright: true,
    command: 'npm run platform -- verify --lane all'
  }
];

export function getSlowTestFiles(): string[] {
  return [...slowTestFiles];
}

export function buildTestBudgetContract(): TestBudgetContract {
  const lanes = testBudgetLanes.map((lane) => ({ ...lane }));
  const slowLaneIds = lanes.filter((lane) => lane.nextBuild || lane.playwright).map((lane) => lane.id);
  return {
    formatVersion: '1',
    command: 'npm run platform -- test budget --json',
    runnerCommand: 'npm run test:budget',
    defaultLane: 'fast',
    laneCount: lanes.length,
    slowLaneCount: slowLaneIds.length,
    slowLaneIds,
    slowTestFileCount: slowTestFiles.length,
    slowTestFiles: getSlowTestFiles(),
    lanes,
    localDefault: 'npm test / npm run check stay on fast tests; use test:all or check:full for slow runtime gates',
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
