import { expect, test } from 'bun:test';

import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';

test('test impact selector includes tests that directly import changed sources', () => {
  const selection = selectTestsForSources(['platform/shared/test-impact-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/contract/test-impact.test.ts');
  expect(selection.slow).not.toContain('tests/contract/test-impact.test.ts');
});

test('test impact selector includes tests that dynamically import changed sources', () => {
  const selection = selectTestsForSources(['platform/dev-runner/test-runner.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.fast).toContain('tests/unit/test-runner.test.ts');
});

test('test impact selector uses auto-reference for CI contract coverage', () => {
  const selection = selectTestsForSources(['platform/shared/ci-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('ci-contract');
  expect(selection.fast).toContain('tests/contract/ci-contract.test.ts');
  expect(selection.fast).toContain('tests/contract/ci-lanes.test.ts');
  expect(selection.slow).toEqual([]);
});

test('test impact selector uses auto-reference for test budget coverage', () => {
  const selection = selectTestsForSources(['platform/shared/test-budget-contract.ts']);

  expect(selection.owners).toContain('auto-reference');
  expect(selection.owners).not.toContain('test-budget');
  expect(selection.fast).toContain('tests/contract/benchmark-budget.test.ts');
});

test('test impact selector keeps slow coverage as notice-only selection', () => {
  const selection = selectTestsForSources(['platform/compiler/upgrade/plan.ts']);

  expect(selection.owners).toContain('upgrade');
  expect(selection.fast).toContain('tests/integration/migration-files.test.ts');
  expect(selection.slow).toContain('tests/e2e/upgrade.slow.test.ts');
  expect(selection.slow).toContain('tests/e2e/dry-run-plan.slow.test.ts');
});

test('test impact selector does not invent broad fallback for unmapped sources', () => {
  const selection = selectTestsForSources(['platform/shared/unmapped-helper.ts']);

  expect(selection).toEqual({
    fast: [],
    slow: [],
    owners: []
  });
});
