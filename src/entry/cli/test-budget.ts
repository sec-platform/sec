export type TestBudgetPresentationSource = Readonly<{
  command: string;
  runnerCommand: string;
  defaultLane: string;
  laneCount: number;
  slowLaneCount: number;
  slowLaneIds: readonly string[];
  slowTestFileCount: number;
  slowTestFiles: readonly string[];
  slowSuiteCount: number;
  slowSuites: readonly Readonly<{
    id: string;
    owner: string;
    logicalRunTimeoutMs: number;
    parallelSafe: boolean;
    resourceClass: string;
    prRiskBaseline: boolean;
    files: readonly string[];
  }>[];
  lanes: readonly Readonly<{
    id: string;
    command: string;
  }>[];
  localDefault: string;
  fullRuntimeGate: string;
}>;

export function formatTestBudgetContract(
  contract: TestBudgetPresentationSource
): string {
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
    ...contract.slowSuites.map(suite => [
      `Slow suite ${suite.id}`,
      `owner=${suite.owner}`,
      `logicalRunTimeoutMs=${suite.logicalRunTimeoutMs}`,
      `parallelSafe=${suite.parallelSafe}`,
      `resourceClass=${suite.resourceClass}`,
      `prRiskBaseline=${suite.prRiskBaseline}`,
      `files=${suite.files.join(', ')}`
    ].join('; ')),
    `Local default: ${contract.localDefault}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    ...contract.lanes.map(lane =>
      `Lane ${lane.id}; command=${lane.command}`
    )
  ].join('\n');
}
