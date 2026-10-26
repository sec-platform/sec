import { afterAll, expect, test } from 'bun:test';

import { AFFECTED_SELECTION_OPERATION_DURATION_MS } from '../../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import { DEFAULT_FAST_TEST_MAX_CONCURRENCY } from '../../../src/adapters/self-hosting/development/runner/fast-test-policy.ts';
import {
  admitTestSuiteExecutionPolicy,
  issueTestSuiteExecutionPolicy
} from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { compileTestBudgetProjection, slowTestPrRiskBaselineSuiteIds } from '../../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure as selectSlowTestClosureWithProvider } from '../../../src/adapters/verification/platform/test-impact/slow-risk-selection.ts';
import { compilerRoot } from "../../../src/adapters/workspace-context.ts";
import { acquireExactRepositoryTestImpactProviderFixture } from '../../helpers/test-impact-provider.ts';

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
  const selection = selectSlowTestRiskClosure(null);
  // A baseline selected and expected through the same catalog must not make
  // an empty execution closure look like a safe fallback.
  expect(selection.suites.length).toBeGreaterThan(0);
  expect(selection).toEqual({
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
  const selection = selectSlowTestRiskClosure([
    'assets/new.bin',
    'fixtures/nonexistent-affected-test.txt',
    'platform/shared/new-owner.ts',
    'scripts/codex/new-control-sink.ts',
    'src/adapters/self-hosting/development/tooling/new-runtime-owner.ts'
  ]);

  expect(selection.resolved).toBe(false);
  expect(selection.unresolvedPaths).toEqual([
    'assets/new.bin',
    'fixtures/nonexistent-affected-test.txt',
    'platform/shared/new-owner.ts',
    'scripts/codex/new-control-sink.ts',
    'src/adapters/self-hosting/development/tooling/new-runtime-owner.ts'
  ]);
  expect(selection.reasons).toContain('changed-files-unresolved');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('a directly changed slow test retains its executable suite identity', () => {
  const selection = selectSlowTestRiskClosure(['tests/e2e/workspace/dry-run-plan.test.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('direct-slow-test');
  expect(selection.suites).toContain('e2e-dry-run-plan');
});

test('global test setup changes request the bounded slow baseline', () => {
  const selection = selectSlowTestRiskClosure(['tests/setup/test-runtime.setup.ts']);

  expect(selection.resolved).toBe(true);
  expect(selection.reasons).toContain('bounded-baseline');
  expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
});

test('owner-issued projection resolves configuration, source and managed-hook suites without losing a mixed owner', () => {
  for (const source of ['package.json', 'bun.lock']) {
    const selection = selectSlowTestRiskClosure([source]);
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).not.toContain('changed-files-unresolved');
    expect(selection.reasons).toContain('ownership-impact');
  }

  const sourceSelection = selectSlowTestRiskClosure([
    'src/adapters/verification/run-runtime-verification.ts'
  ]);
  expect(sourceSelection).toMatchObject({ resolved: true });
  expect(sourceSelection.affectedSlowTests).toContain('tests/e2e/workspace/dry-run-plan.test.ts');
  expect(sourceSelection.suites).toContain('e2e-dry-run-plan');

  const hookSelection = selectSlowTestRiskClosure(['.githooks/post-merge']);
  expect(hookSelection).toMatchObject({ resolved: true });
  expect(hookSelection.owners).toContain('adapters.self-hosting.development.hooks');
  expect(hookSelection.affectedSlowTests).toContain('tests/e2e/development/install-git-hooks.test.ts');
  expect(hookSelection.suites).toContain('e2e-install-git-hooks');

  const mixed = selectSlowTestRiskClosure([
    'package.json',
    'src/adapters/verification/run-runtime-verification.ts'
  ]);
  expect(mixed.resolved).toBe(true);
  expect(mixed.owners).toEqual(expect.arrayContaining([
    'adapters.self-hosting.development.runner', 'adapters.toolchain', 'compiler', 'adapters.verification'
  ]));
  expect(mixed.suites).toContain('e2e-dry-run-plan');
});

test('module descriptors and owned sources resolve even when no runnable test consumes them', () => {
  for (const path of [
    'src/adapters/self-hosting/control/branch-lifecycle/module.json',
    'src/adapters/self-hosting/control/composition/module.json',
    'src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts',
    'src/adapters/self-hosting/development/commit/module.json'
  ]) {
    expect(selectSlowTestRiskClosure([path])).toMatchObject({
      resolved: true,
      unresolvedPaths: [],
      reasons: expect.arrayContaining(['ownership-impact'])
    });
  }
});

test('compile-only test inputs resolve without inventing runtime tests', () => {
  for (const path of [
    'tests/unit/compiler/architecture-contracts.typecheck.ts',
  ]) {
    expect(selectSlowTestRiskClosure([path])).toMatchObject({
      resolved: true,
      unresolvedPaths: [],
      slowTests: []
    });
  }

  for (const path of [
    'src/compiler/foreign.typecheck.ts',
    'tests/unit/absent.typecheck.ts'
  ]) {
    expect(selectSlowTestRiskClosure([path])).toMatchObject({
      resolved: false,
      unresolvedPaths: [path]
    });
  }
});

test('deleted and renamed slow paths preserve transition identity without becoming free-running children', () => {
  expect(selectSlowTestRiskClosure(['tests/e2e/deleted-unknown.test.ts'])).toMatchObject({
    resolved: false,
    owners: expect.arrayContaining(['bounded-slow-risk']),
    reasons: expect.arrayContaining(['changed-files-unresolved']),
    slowTests: ['tests/e2e/deleted-unknown.test.ts'],
    unresolvedPaths: ['tests/e2e/deleted-unknown.test.ts']
  });

  const transition = CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    records: [{
      status: 'renamed',
      previousPath: 'tests/e2e/old-graph-name.test.ts',
      path: 'tests/e2e/verification/graph.test.ts'
    }],
    readPathBlob: () => null
  });
  const selection = selectSlowTestClosureWithProvider([
    'tests/e2e/old-graph-name.test.ts',
    'tests/e2e/verification/graph.test.ts'
  ], provider, transition);
  expect(selection).toMatchObject({
    resolved: true,
    suites: ['e2e-graph'],
    slowTests: [],
    affectedSlowTests: [
      'tests/e2e/old-graph-name.test.ts',
      'tests/e2e/verification/graph.test.ts'
    ],
    unresolvedPaths: []
  });
});

test('long suite admission retains its exact issued test inventory and finite revalidation deadline', () => {
  const suite = budgetProjection.slowSuites.find(
    ({ id }) => id === 'contract-document-control-plane-lifecycle'
  )!;
  expect(suite.logicalRunTimeoutMs).toBe(1_200_000);
  const bunOptions = ['--timeout', '180000'];
  const policy = issueTestSuiteExecutionPolicy({
    testInventory,
    budgetProjection,
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
    'bun', 'test', ...suite.files, '--concurrent', '--max-concurrency', String(DEFAULT_FAST_TEST_MAX_CONCURRENCY),
    '--timeout', '180000'
  ]);

});
