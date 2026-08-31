import { expect, test } from 'bun:test';

import { selectCiSlowTestClosure } from '../../src/verification/ci/runtime/slow-test-selection.ts';
import { slowTestPrRiskBaselineSuiteIds } from '../../src/verification/test-impact/contract/budget.ts';

const baselineSuites = slowTestPrRiskBaselineSuiteIds();

test('unresolved changed-file observation fails closed to the bounded baseline', () => {
  expect(selectCiSlowTestClosure(null)).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
});

test('unknown paths cannot be converted into a false exact selection', () => {
  const selection = selectCiSlowTestClosure(['assets/new.bin']);

  expect(selection.resolved).toBe(false);
  expect(selection.reasons).toContain('changed-files-unresolved');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('a directly changed slow test retains its executable suite identity', () => {
  const selection = selectCiSlowTestClosure(['tests/e2e/dry-run-plan.test.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('direct-slow-test');
  expect(selection.suites).toContain('e2e-dry-run-plan');
});

test('source changes fail closed without an owner-issued test-impact projection', () => {
  const selection = selectCiSlowTestClosure([
    'src/compiler/verify/run-runtime-verification.ts'
  ]);

  expect(selection.resolved).toBe(false);
  expect(selection.reasons).toContain('changed-files-unresolved');
  expect(selection.owners).toContain('bounded-slow-risk');
});

test('global test setup changes request the bounded slow baseline', () => {
  const selection = selectCiSlowTestClosure(['tests/setup/test-runtime.setup.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('bounded-baseline');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('repository configuration cannot self-authorize from fallback ownership', () => {
  for (const source of ['package.json', 'bun.lock']) {
    const selection = selectCiSlowTestClosure([source]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
    expect(selection.reasons).toContain('ownership-impact');
  }
});
