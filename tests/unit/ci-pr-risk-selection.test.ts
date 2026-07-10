import { expect, test } from 'bun:test';

import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { slowTestPrRiskBaselineSuiteIds } from '../../platform/shared/test-budget-contract.ts';

const baselineSuites = slowTestPrRiskBaselineSuiteIds();

test('bounded slow baseline is owned by shared execution lifecycle surfaces', () => {
  for (const file of [
    'scripts/ci-pr-risk.ts',
    'platform/dev-runner/test-runner.ts',
    'platform/shared/ci-pr-risk-selection.ts',
    'platform/shared/test-budget-contract.ts',
    'tests/helpers/workspace-fixtures.ts',
    'tests/setup/runtime-deps.setup.ts',
    'tests/testkit/workspace.ts'
  ]) {
    expect(selectCiPrRiskSlowSuites([file])).toEqual({
      suites: baselineSuites,
      slowTests: [],
      affectedSlowTests: [],
      owners: ['bounded-slow-risk'],
      reason: 'baseline'
    });
  }
});

test('assertion-only testkit helpers rely on direct test impact instead of broad slow baseline', () => {
  const selection = selectCiPrRiskSlowSuites(['tests/testkit/contracts.ts']);

  expect(selection.suites).toEqual([]);
  expect(selection.slowTests).toEqual([]);
  expect(selection.affectedSlowTests).toEqual([]);
  expect(selection.owners).toContain('auto-reference');
  expect(selection.reason).toBe('none');
});
