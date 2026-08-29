import { expect, test } from 'bun:test';

import { selectCiPrRiskSlowSuites } from '../../src/verification/ci/runtime/pr-risk-selection.ts';
import { slowTestPrRiskBaselineSuiteIds } from '../../src/verification/test-impact/contract/budget.ts';

const baselineSuites = slowTestPrRiskBaselineSuiteIds();

test('unresolved changed-file observation fails closed to the bounded baseline', () => {
  expect(selectCiPrRiskSlowSuites(null)).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
});

test('unknown paths cannot be converted into a false exact selection', () => {
  const selection = selectCiPrRiskSlowSuites(['assets/new.bin']);

  expect(selection.resolved).toBe(false);
  expect(selection.reasons).toContain('changed-files-unresolved');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('a directly changed slow test retains its executable suite identity', () => {
  const selection = selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('direct-slow-test');
  expect(selection.suites).toContain('e2e-dry-run-plan');
});

test('source changes reach slow evidence through real imports', () => {
  const selection = selectCiPrRiskSlowSuites([
    'src/compiler/verify/run-runtime-verification.ts'
  ]);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('ownership-impact');
  expect(selection.affectedSlowTests).toContain('tests/e2e/verification.test.ts');
  expect(selection.suites).toContain('e2e-verify-lock');
});

test('global test setup changes request the bounded slow baseline', () => {
  const selection = selectCiPrRiskSlowSuites(['tests/setup/test-runtime.setup.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('bounded-baseline');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('repository configuration routes through module owners rather than literal test lists', () => {
  for (const source of ['package.json', 'bun.lock']) {
    const selection = selectCiPrRiskSlowSuites([source]);
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).toContain('ownership-impact');
  }
});
