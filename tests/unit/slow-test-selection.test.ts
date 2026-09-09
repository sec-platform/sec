import { afterAll, expect, test } from 'bun:test';

import { compileTestBudgetProjection, slowTestPrRiskBaselineSuiteIds, TestBudgetProjectionCache, type TestBudgetProjection } from '../../src/verification/test-impact/contract/budget.ts';
import { selectSlowTestRiskClosure as selectSlowTestClosureWithProvider } from '../../src/verification/test-impact/slow-risk-selection.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const provider = testImpactFixture.provider;
afterAll(() => testImpactFixture.dispose());
const budgetProjection = compileTestBudgetProjection(provider.projection);
const baselineSuites = slowTestPrRiskBaselineSuiteIds(budgetProjection);
const selectSlowTestRiskClosure = (files: string[] | null) => (
  selectSlowTestClosureWithProvider(files, provider)
);

test('snapshot budget cache binds generation and rebuilds corrupted entries', () => {
  const cache = new TestBudgetProjectionCache();
  const first = cache.project(provider.projection);
  expect(cache.project(provider.projection)).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.generation)).toBe(true);
  expect(Object.isFrozen(first.slowSuites)).toBe(true);
  expect(first.slowSuites.every((suite) => (
    Object.isFrozen(suite) && Object.isFrozen(suite.files)
  ))).toBe(true);

  const entries = (cache as unknown as {
    projections: Map<string, TestBudgetProjection>;
  }).projections;
  entries.set(first.generationKey, {
    ...first,
    slowTestFiles: []
  });
  const rebuilt = cache.project(provider.projection);
  expect(rebuilt).not.toBe(first);
  expect(rebuilt).toEqual(first);
  expect(Object.isFrozen(rebuilt)).toBe(true);
});

test('unresolved changed-file observation fails closed to the bounded baseline', () => {
  expect(selectSlowTestRiskClosure(null)).toEqual({
    suites: [...baselineSuites],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    unresolvedPaths: [],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
});

test('unknown paths cannot be converted into a false exact selection', () => {
  const selection = selectSlowTestRiskClosure(['assets/new.bin']);

  expect(selection.resolved).toBe(false);
  expect(selection.reasons).toContain('changed-files-unresolved');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('a directly changed slow test retains its executable suite identity', () => {
  const selection = selectSlowTestRiskClosure(['tests/e2e/dry-run-plan.test.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('direct-slow-test');
  expect(selection.suites).toContain('e2e-dry-run-plan');
});

test('source changes fail closed without an owner-issued test-impact projection', () => {
  const providerlessSelection = selectSlowTestClosureWithProvider as unknown as (
    files: string[] | null
  ) => unknown;
  expect(() => providerlessSelection([
    'src/compiler/verify/run-runtime-verification.ts'
  ])).toThrow('requires an owner-issued snapshot projection');
});

test('global test setup changes request the bounded slow baseline', () => {
  const selection = selectSlowTestRiskClosure(['tests/setup/test-runtime.setup.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('bounded-baseline');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('repository configuration resolves only through the snapshot-bound owner projection', () => {
  for (const source of ['package.json', 'bun.lock']) {
    const selection = selectSlowTestRiskClosure([source]);
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).not.toContain('changed-files-unresolved');
    expect(selection.reasons).toContain('ownership-impact');
  }
});
