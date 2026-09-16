import { afterAll, expect, test } from 'bun:test';

import { AFFECTED_SELECTION_OPERATION_DURATION_MS } from '../../src/development/runner/affected-plan-contract.ts';
import {
  admitTestSuiteExecutionPolicy,
  issueTestSuiteExecutionPolicy
} from '../../src/development/runner/test-execution-policy.ts';
import { compileTestBudgetProjection, slowTestPrRiskBaselineSuiteIds } from '../../src/verification/test-impact/contract/budget.ts';
import { selectSlowTestRiskClosure as selectSlowTestClosureWithProvider } from '../../src/verification/test-impact/slow-risk-selection.ts';
import { compilerRoot } from '../../src/workspace/runtime/paths.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const provider = testImpactFixture.provider;
afterAll(() => testImpactFixture.dispose());
const testInventory = provider.testInventory;
const budgetProjection = compileTestBudgetProjection(testInventory);
const baselineSuites = slowTestPrRiskBaselineSuiteIds(budgetProjection);
const selectSlowTestRiskClosure = (files: string[] | null) => (
  selectSlowTestClosureWithProvider(files, provider)
);

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

test('long suite admission retains its exact issued test inventory and finite revalidation deadline', () => {
  const suite = budgetProjection.slowSuites.find(
    ({ id }) => id === 'contract-document-control-plane-lifecycle'
  )!;
  expect(suite.logicalRunTimeoutMs).toBe(1_200_000);
  const bunOptions = ['--timeout', '180000'];
  let inventoryReads = 0;
  let budgetReads = 0;
  const policy = issueTestSuiteExecutionPolicy({
    get testInventory() {
      return inventoryReads++ === 0 ? testInventory : { ...testInventory, inventoryDigest: 'sha256:forged' as const };
    },
    get budgetProjection() {
      return budgetReads++ === 0 ? budgetProjection : { ...budgetProjection, projectionDigest: 'sha256:forged' as const };
    },
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions,
    workingDirectory: compilerRoot
  });
  expect(policy.testInventoryDigest).toBe(testInventory.inventoryDigest);
  expect(policy.budgetProjectionDigest).toBe(budgetProjection.projectionDigest);
  const beforeAdmission = Date.now();
  const admission = admitTestSuiteExecutionPolicy(policy);
  const afterAdmission = Date.now();
  expect(admission.admittedAtUnixMs).toBeGreaterThanOrEqual(beforeAdmission);
  expect(admission.admittedAtUnixMs).toBeLessThanOrEqual(afterAdmission);
  expect(admission.logicalDeadlineAtUnixMs).toBe(
    admission.admittedAtUnixMs + suite.logicalRunTimeoutMs
  );
  expect(admission.revalidationDeadlineAtUnixMs).toBe(
    admission.admittedAtUnixMs + AFFECTED_SELECTION_OPERATION_DURATION_MS
  );
  expect(admission.childDeadlineAtUnixMs).toBe(
    admission.logicalDeadlineAtUnixMs - policy.settlementMarginMs
  );
  expect(() => admitTestSuiteExecutionPolicy(policy)).toThrow('single-use');

  const clonedBudget = structuredClone(budgetProjection);
  expect(() => issueTestSuiteExecutionPolicy({
    testInventory,
    budgetProjection: clonedBudget,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions,
    workingDirectory: compilerRoot
  })).toThrow('exact owner-issued test inventory projection');

  expect(() => issueTestSuiteExecutionPolicy({
    testInventory,
    budgetProjection,
    suiteId: suite.id,
    selectedFiles: suite.files,
    bunOptions: ['tests/e2e/unowned.test.ts'],
    workingDirectory: compilerRoot
  })).toThrow('extra test selector');

  const concurrentPolicy = issueTestSuiteExecutionPolicy({
    testInventory,
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
