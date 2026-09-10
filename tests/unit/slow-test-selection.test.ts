import { afterAll, expect, test } from 'bun:test';

import {
  admitTestSuiteExecutionPolicy,
  issueTestSuiteExecutionPolicy
} from '../../src/development/runner/test-execution-policy.ts';
import { compileTestBudgetProjection, slowTestPrRiskBaselineSuiteIds, TestBudgetProjectionCache, type TestBudgetProjection } from '../../src/verification/test-impact/contract/budget.ts';
import { selectSlowTestRiskClosure as selectSlowTestClosureWithProvider } from '../../src/verification/test-impact/slow-risk-selection.ts';
import { compilerRoot } from '../../src/workspace/runtime/paths.ts';
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

test('long suite admission retains its exact issued Source Program provenance and one finite deadline', () => {
  const suite = budgetProjection.slowSuites.find(
    ({ id }) => id === 'contract-document-control-plane-lifecycle'
  )!;
  expect(suite.logicalRunTimeoutMs).toBe(1_200_000);
  const bunOptions = ['--timeout', '180000'];
  const policy = issueTestSuiteExecutionPolicy({
    sourceProjection: provider.projection,
    budgetProjection,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions,
    workingDirectory: compilerRoot
  });
  const beforeAdmission = Date.now();
  const admission = admitTestSuiteExecutionPolicy(policy);
  const afterAdmission = Date.now();
  expect(admission.admittedAtUnixMs).toBeGreaterThanOrEqual(beforeAdmission);
  expect(admission.admittedAtUnixMs).toBeLessThanOrEqual(afterAdmission);
  expect(admission.logicalDeadlineAtUnixMs).toBe(
    admission.admittedAtUnixMs + suite.logicalRunTimeoutMs
  );
  expect(admission.childDeadlineAtUnixMs).toBe(
    admission.logicalDeadlineAtUnixMs - policy.settlementMarginMs
  );
  expect(() => admitTestSuiteExecutionPolicy(policy)).toThrow('single-use');

  const clonedBudget = structuredClone(budgetProjection);
  expect(() => issueTestSuiteExecutionPolicy({
    sourceProjection: provider.projection,
    budgetProjection: clonedBudget,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions,
    workingDirectory: compilerRoot
  })).toThrow('exact owner-issued Source Program projection');

  expect(() => issueTestSuiteExecutionPolicy({
    sourceProjection: provider.projection,
    budgetProjection,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions: ['tests/e2e/unowned.test.ts'],
    workingDirectory: compilerRoot
  })).toThrow('extra test selector');

  const concurrentPolicy = issueTestSuiteExecutionPolicy({
    sourceProjection: provider.projection,
    budgetProjection,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions: ['--concurrent', '--timeout', '180000'],
    workingDirectory: compilerRoot
  });
  expect(concurrentPolicy.canonicalArgv).toEqual([
    'bun', 'test', ...suite.files, '--concurrent', '--max-concurrency', '3',
    '--timeout', '180000'
  ]);

});
