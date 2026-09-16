import { expect } from 'bun:test';

import type { ErrorProtocolContract } from '../../src/interface/cli/error-protocol-contract.ts';
import { compareCodeUnits } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import type { BenchmarkTaskSuiteContract } from '../../src/verification/benchmark/contract.ts';
import type { CiContract } from '../../src/verification/ci/contract/core.ts';
import type { ContractFreezeContract } from '../../src/verification/freeze.ts';
import type { TestBudgetContract } from '../../src/verification/test-impact/contract/budget.ts';

function expectSortedUnique(values: readonly string[]): void {
  expect(values).toEqual([...values].sort(compareCodeUnits));
  expect(new Set(values).size).toBe(values.length);
}

export function expectCiContractSelfConsistent(contract: CiContract): void {
  expectSortedUnique(contract.artifactPaths);
}

export function expectPrFastLaneBoundary(contract: CiContract): void {
  expect(contract.prQuickLaneCommands).toContain('bun run imports:check');
  expect(contract.prQuickLaneCommands).toContain('bun run typecheck');
  expect(contract.prQuickLaneCommands).toContain('bun run test:affected');
  expect(contract.prQuickLaneCommands).not.toContain('bun scripts/ci-pr-quick.ts');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:prepare');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:organize');
  expect(contract.prQuickLaneCommands).not.toContain('bun run test:slow');
  expect(contract.prQuickLaneCommands.every((command) => !command.includes('--lane all'))).toBe(true);

}

export function expectFullLaneCoversSlowSuites(contract: CiContract, suiteIds: readonly string[]): void {
  for (const suiteId of suiteIds) {
    expect(contract.fullLaneCommands).toContain(`bun run test:slow -- --suite ${suiteId}`);
  }
  expect(contract.fullLaneCommands).toContain('bun run test:slow -- --suite e2e-ticket-semantic-vertical');
}

export function expectFullLaneCoversCorrectnessBackstop(contract: CiContract): void {
  expect(contract.fullLaneCommands).not.toContain('bun run imports:prepare');
  expect(contract.fullLaneCommands).toEqual(expect.arrayContaining([
    'bun run imports:check',
    'bun run typecheck',
    'bun run docs:doctor',
    'bun run test:fast',
    'bun run test:contract-freeze',
    'bun run sec -- verify --lane all --json --compact',
    'bun run sec -- reference check --json --compact'
  ]));
}

export function expectTestBudgetSelfConsistent(contract: TestBudgetContract): void {
  expectSortedUnique(contract.slowTestFiles);
  for (const suite of contract.slowSuites) {
    expectSortedUnique(suite.files);
  }
}

export function expectBenchmarkTaskSuiteSelfConsistent(contract: BenchmarkTaskSuiteContract): void {
  expectSortedUnique(contract.artifactPaths);
}

export function expectContractFreezeSelfConsistent(contract: ContractFreezeContract): void {
  expectSortedUnique(contract.targetFiles);
  expectSortedUnique(contract.contractIds);
  expect(new Set(contract.targets.map((target) => target.file)).size).toBe(contract.targetFiles.length);
  expect(new Set(contract.targets.map((target) => target.contractId)).size).toBe(contract.targets.length);
  expect(contract.targets.every((target) => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(target.contractId))).toBe(true);
  expect(contract.targetFiles.some((file) => file.startsWith('tests/e2e/'))).toBe(false);
  expect(contract.targetFiles.every((file) => file.endsWith('.test.ts'))).toBe(true);
}

export function expectErrorProtocolSelfConsistent(contract: ErrorProtocolContract): void {
  expectSortedUnique(contract.issueTypes);
  expectSortedUnique(contract.artifactPaths);
  expect(new Set(contract.examples.flatMap((example) => example.output.suggestedActions)).size).toBe(contract.suggestedActionCount);
}
