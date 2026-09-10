import { expect, test } from 'bun:test';
import { buildBenchmarkTaskSuiteContract, formatBenchmarkTaskSuiteContract } from '../../src/verification/benchmark/contract.ts';
import { buildTestBudgetContract, formatTestBudgetContract } from '../../src/verification/test-impact/contract/budget.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import {
  expectBenchmarkTaskSuiteSelfConsistent,
  expectTestBudgetSelfConsistent
} from '../testkit/contracts.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI exposes benchmark task-suite as text and JSON contracts', async () => {
  const contract = buildBenchmarkTaskSuiteContract();
  const formatted = formatBenchmarkTaskSuiteContract(contract);
  expectBenchmarkTaskSuiteSelfConsistent(contract);

  await withTempWorkspace(async (workspaceRoot) => {
    const variants = await expectCliVariants(workspaceRoot, ['benchmark', 'suite'], {
      text: [formatted]
    });
    expect(variants.json).toEqual(contract);
    expect(variants.compactJson).toEqual(contract);
  });
});

test('CLI exposes test budget as text and JSON contracts', async () => {
  const { issueCurrentTestBudgetProjection } = await import('../../src/development/runner/test-runner.ts');
  const budgetProjection = await issueCurrentTestBudgetProjection();
  const contract = buildTestBudgetContract(budgetProjection);
  const formatted = formatTestBudgetContract(contract);

  expectTestBudgetSelfConsistent(contract);

  await withTempWorkspace(async (workspaceRoot) => {
    const variants = await expectCliVariants(workspaceRoot, ['test', 'budget'], {
      text: [formatted]
    });
    expect(variants.json).toEqual(contract);
    expect(variants.compactJson).toEqual(contract);
  });
});
