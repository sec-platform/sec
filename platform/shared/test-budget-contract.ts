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
  slowLaneIds: TestBudgetLane['id'][];
  lanes: TestBudgetLane[];
  localDefault: string;
  fullRuntimeGate: string;
};

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

export function buildTestBudgetContract(): TestBudgetContract {
  const lanes = testBudgetLanes.map((lane) => ({ ...lane }));
  return {
    formatVersion: '1',
    command: 'npm run platform -- test budget --json',
    runnerCommand: 'npm run test:budget',
    defaultLane: 'fast',
    laneCount: lanes.length,
    slowLaneIds: lanes.filter((lane) => lane.nextBuild || lane.playwright).map((lane) => lane.id),
    lanes,
    localDefault: 'fast lane plus targeted named tests',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  };
}

export function formatTestBudgetContract(contract: TestBudgetContract): string {
  return [
    `Test budget default lane: ${contract.defaultLane}`,
    `Command: ${contract.command}`,
    `Runner command: ${contract.runnerCommand}`,
    `Lanes: ${contract.laneCount}`,
    `Slow lanes: ${contract.slowLaneIds.join(', ')}`,
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
