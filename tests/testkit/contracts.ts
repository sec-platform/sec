import { expect } from 'bun:test';

import type { BenchmarkTaskSuiteContract } from '../../platform/shared/benchmark-contract.ts';
import type { CiContract } from '../../platform/shared/ci-contract.ts';
import type { ContractFreezeContract } from '../../platform/shared/contract-freeze-contract.ts';
import type { ErrorProtocolContract } from '../../platform/shared/error-protocol-contract.ts';
import type { TestBudgetContract } from '../../platform/shared/test-budget-contract.ts';

type CountKey<T> = {
  [K in keyof T]: T[K] extends number ? K : never
}[keyof T];

type ListKey<T> = {
  [K in keyof T]: T[K] extends readonly unknown[] ? K : never
}[keyof T];

export function expectSortedUnique(values: readonly string[]): void {
  expect(values).toEqual([...values].sort((left, right) => left.localeCompare(right)));
  expect(new Set(values).size).toBe(values.length);
}

export function expectListCount<T extends object>(contract: T, countKey: CountKey<T>, listKey: ListKey<T>): void {
  expect(contract[countKey] as number).toBe((contract[listKey] as readonly unknown[]).length);
}

export function expectCiContractSelfConsistent(contract: CiContract): void {
  expectListCount(contract, 'prQuickLaneCommandCount', 'prQuickLaneCommands');
  expectListCount(contract, 'prRiskLaneCommandCount', 'prRiskLaneCommands');
  expectListCount(contract, 'fullLaneCommandCount', 'fullLaneCommands');
  expectListCount(contract, 'verifyCommandCount', 'verifyCommands');
  expectListCount(contract, 'qualityCommandCount', 'qualityCommands');
  expectListCount(contract, 'diagnosticCommandCount', 'diagnosticCommands');
  expectListCount(contract, 'artifactUploadCommandCount', 'artifactUploadCommands');
  expectListCount(contract, 'artifactPathCount', 'artifactPaths');
  expectListCount(contract, 'stepCount', 'steps');
  expectSortedUnique(contract.artifactPaths);
  for (const step of contract.steps) {
    expectListCount(step, 'producesCount', 'produces');
  }
}

export function expectPrFastLaneBoundary(contract: CiContract): void {
  expect(contract.prQuickLaneCommands).toContain('bun scripts/ci-pr-quick.ts');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:check');
  expect(contract.prQuickLaneCommands).not.toContain('bun run test:slow');
  expect(contract.prQuickLaneCommands.every((command) => !command.includes('--lane all'))).toBe(true);

  expect(contract.prRiskLaneCommands).toContain('bun scripts/ci-pr-risk.ts');
  expect(contract.prRiskLaneCommands).not.toContain('bun run test:slow');
  expect(contract.prRiskLaneCommands.every((command) => !command.includes('--lane all'))).toBe(true);
}

export function expectFullLaneCoversSlowSuites(contract: CiContract, suiteIds: readonly string[]): void {
  for (const suiteId of suiteIds) {
    expect(contract.fullLaneCommands).toContain(`bun run test:slow -- --suite ${suiteId}`);
  }
}

export function expectFullLaneCoversCorrectnessBackstop(contract: CiContract): void {
  expect(contract.fullLaneCommands).toEqual(expect.arrayContaining([
    'bun run typecheck',
    'bun run test:contract-freeze',
    'bun run sec -- verify --lane all --json --compact',
    'bun run sec -- reference check --json --compact'
  ]));
}

export function expectTestBudgetSelfConsistent(contract: TestBudgetContract): void {
  expectListCount(contract, 'laneCount', 'lanes');
  expectListCount(contract, 'slowLaneCount', 'slowLaneIds');
  expectListCount(contract, 'slowTestFileCount', 'slowTestFiles');
  expectListCount(contract, 'slowSuiteCount', 'slowSuites');
  expectSortedUnique(contract.slowTestFiles);
  for (const suite of contract.slowSuites) {
    expectSortedUnique(suite.files);
  }
}

export function expectBenchmarkTaskSuiteSelfConsistent(contract: BenchmarkTaskSuiteContract): void {
  expectListCount(contract, 'taskCount', 'tasks');
  expectListCount(contract, 'artifactPathCount', 'artifactPaths');
  expectListCount(contract, 'scoreDimensionCount', 'scoreDimensions');
  expectSortedUnique(contract.artifactPaths);
  for (const task of contract.tasks) {
    expectListCount(task, 'artifactPathCount', 'artifactPaths');
    expectListCount(task, 'scoreFocusCount', 'scoreFocus');
  }
}

export function expectContractFreezeSelfConsistent(contract: ContractFreezeContract): void {
  expectListCount(contract, 'targetFileCount', 'targetFiles');
  expectListCount(contract, 'targetCount', 'targets');
  expectSortedUnique(contract.targetFiles);
  expect(new Set(contract.targets.map((target) => target.file)).size).toBe(contract.targetFiles.length);
  expect(contract.targetFiles.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
  expect(contract.targetFiles.every((file) => file.endsWith('.test.ts'))).toBe(true);
}

export function expectErrorProtocolSelfConsistent(contract: ErrorProtocolContract): void {
  expectListCount(contract, 'exampleCount', 'examples');
  expectListCount(contract, 'issueTypeCount', 'issueTypes');
  expectListCount(contract, 'artifactPathCount', 'artifactPaths');
  expectSortedUnique(contract.issueTypes);
  expectSortedUnique(contract.artifactPaths);
  expect(new Set(contract.examples.flatMap((example) => example.output.suggestedActions)).size).toBe(contract.suggestedActionCount);
}
