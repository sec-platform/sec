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
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
    expect(selection.slowTests).toEqual([]);
    expect(selection.owners).toContain('bounded-slow-risk');
    expect(selection.resolved).toBe(true);
    expect(selection.reasons).toContain(
      file.startsWith('tests/') ? 'bounded-baseline' : 'mandatory-sentinel'
    );
  }
});

test('assertion-only testkit helpers rely on direct test impact instead of broad slow baseline', () => {
  const selection = selectCiPrRiskSlowSuites(['tests/testkit/contracts.ts']);

  expect(selection.suites).toEqual([]);
  expect(selection.slowTests).toEqual([]);
  expect(selection.affectedSlowTests).toEqual([]);
  expect(selection.owners).toContain('auto-reference');
  expect(selection.reasons).toContain('ownership-impact');
  expect(selection.resolved).toBe(true);
});

test('mixed broad and direct slow changes form a stable union instead of returning early', () => {
  const selection = selectCiPrRiskSlowSuites([
    'package.json',
    'tests/e2e/dry-run-plan.test.ts',
    'platform/compiler/verify/run-runtime-verification.ts'
  ]);

  expect(selection.suites).toEqual(expect.arrayContaining([
    ...baselineSuites,
    'e2e-dry-run-plan',
    'e2e-verify-lock'
  ]));
  expect(selection.affectedSlowTests).toEqual(expect.arrayContaining([
    'tests/e2e/dry-run-plan.test.ts',
    'tests/e2e/verification.test.ts'
  ]));
  expect(selection.reasons).toEqual([
    'bounded-baseline',
    'direct-slow-test',
    'ownership-impact'
  ]);
  expect(selection.resolved).toBe(true);
});

test('unresolved file discovery selects bounded sentinels but is never exact selection success', () => {
  expect(selectCiPrRiskSlowSuites(null)).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
});

test('every unmapped changed path fails closed even when another path has known impact', () => {
  for (const file of ['assets/new.bin', 'platform/new-unreferenced.ts']) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
    expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
  }

  const mixed = selectCiPrRiskSlowSuites([
    'platform/compiler/verify/run-runtime-verification.ts',
    'assets/new.bin'
  ]);
  expect(mixed.resolved).toBe(false);
  expect(mixed.reasons).toEqual(expect.arrayContaining([
    'changed-files-unresolved',
    'ownership-impact'
  ]));
  expect(mixed.suites).toEqual(expect.arrayContaining([
    ...baselineSuites,
    'e2e-verify-lock'
  ]));
});

test('explicit documentation ownership and direct slow tests remain resolved', () => {
  const documentation = selectCiPrRiskSlowSuites(['docs/03-MVP实施计划与路线图.md']);
  expect(documentation.resolved).toBe(true);
  expect(documentation.reasons).not.toContain('changed-files-unresolved');

  const directSlowTest = selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts']);
  expect(directSlowTest.resolved).toBe(true);
  expect(directSlowTest.reasons).toContain('direct-slow-test');
  expect(directSlowTest.suites).toContain('e2e-dry-run-plan');
});

test('verification evidence is non-executable without generalizing JSON ownership', () => {
  const evidence = selectCiPrRiskSlowSuites([
    'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json',
    'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json'
  ]);
  expect(evidence.resolved).toBe(true);
  expect(evidence.reasons).not.toContain('changed-files-unresolved');
  expect(evidence.suites).toEqual([]);

  for (const file of ['docs/project-state.json', 'docs/evidence/archive/probe.json']) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.resolved).toBe(false);
    expect(selection.reasons).toContain('changed-files-unresolved');
  }
});
