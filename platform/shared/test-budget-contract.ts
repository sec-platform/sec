export type TestBudgetLane = {
  id: 'fast' | 'runtime' | 'all';
  nextBuild: boolean;
  playwright: boolean;
  command: string;
};

export type TestBudgetContract = {
  formatVersion: '1';
  defaultLane: TestBudgetLane['id'];
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
  return {
    formatVersion: '1',
    defaultLane: 'fast',
    lanes: testBudgetLanes.map((lane) => ({ ...lane })),
    localDefault: 'fast lane plus targeted named tests',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  };
}

export function formatTestBudgetContract(contract: TestBudgetContract): string {
  return [
    `Test budget default lane: ${contract.defaultLane}`,
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
