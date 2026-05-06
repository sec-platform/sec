import { expect, test } from 'bun:test';

import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { slowTestSuiteIds } from '../../platform/shared/test-budget-contract.ts';

test('CI contract separates PR quick lane commands from release full lane commands', () => {
  const contract = buildCiContract();

  expect(contract.prQuickLaneCommands).toContain('bun scripts/ci-pr-quick.ts');
  expect(contract.prQuickLaneCommands).toContain('bun run imports:organize');
  expect(contract.prQuickLaneCommands).not.toContain('bun run imports:check');
  expect(contract.prQuickLaneCommands).not.toContain('bun run platform -- verify --json --compact');
  expect(contract.prQuickLaneCommands).not.toContain('bun run platform -- verify --lane all --json --compact');
  expect(contract.prQuickLaneCommands).not.toContain('bun run test:slow');

  expect(contract.prRiskLaneCommands).toContain('bun scripts/ci-pr-risk.ts');
  expect(contract.prRiskLaneCommands).not.toContain('bun run test:slow');
  expect(contract.prRiskLaneCommands).not.toContain('bun run platform -- verify --lane all --json --compact');

  expect(contract.fullLaneCommands).toEqual(
    expect.arrayContaining([
      'bun run typecheck',
      'bun run test:contract-freeze',
      'bun run platform -- verify --lane all --json --compact',
      'bun run platform -- reference check --json --compact'
    ])
  );
  for (const suiteId of slowTestSuiteIds()) {
    expect(contract.fullLaneCommands).toContain(`bun run test:slow -- --suite ${suiteId}`);
  }
});

test('CI contract command counts match their command arrays', () => {
  const contract = buildCiContract();

  expect(contract.prQuickLaneCommandCount).toBe(contract.prQuickLaneCommands.length);
  expect(contract.prRiskLaneCommandCount).toBe(contract.prRiskLaneCommands.length);
  expect(contract.fullLaneCommandCount).toBe(contract.fullLaneCommands.length);
});

test('CI contract text exposes lane command split for workflow audits', () => {
  const formatted = formatCiContract(buildCiContract());

  expect(formatted).toContain('PR quick lane command count:');
  expect(formatted).toContain('PR quick lane commands:');
  expect(formatted).toContain('PR risk lane command count:');
  expect(formatted).toContain('PR risk lane commands:');
  expect(formatted).toContain('Full lane command count:');
  expect(formatted).toContain('Full lane commands:');
});

test('CI PR risk gate selects slow suites from the test impact contract', () => {
  const pipelineSelection = selectCiPrRiskSlowSuites(['platform/compiler/compose/generate-runtime-host.ts']);
  expect(pipelineSelection).toMatchObject({
    slowTests: [],
    reason: 'impact'
  });
  expect(pipelineSelection.suites).toContain('pipeline');
  expect(pipelineSelection.owners).toContain('pipeline');

  const runtimeSelection = selectCiPrRiskSlowSuites(['platform/compiler/verify/run-runtime-verification.ts']);
  expect(runtimeSelection).toMatchObject({
    slowTests: [],
    reason: 'impact'
  });
  expect(runtimeSelection.suites).toContain('runtime');
  expect(runtimeSelection.owners).toContain('verify');
  expect(runtimeSelection.affectedSlowTests).toContain('tests/e2e/verification.slow.test.ts');

  expect(selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.slow.test.ts'])).toMatchObject({
    suites: [],
    slowTests: ['tests/e2e/dry-run-plan.slow.test.ts'],
    affectedSlowTests: ['tests/e2e/dry-run-plan.slow.test.ts'],
    reason: 'impact'
  });
  expect(selectCiPrRiskSlowSuites(['tests/e2e/compiler-smoke.slow.test.ts'])).toMatchObject({
    suites: [],
    slowTests: ['tests/e2e/compiler-smoke.slow.test.ts'],
    affectedSlowTests: ['tests/e2e/compiler-smoke.slow.test.ts'],
    reason: 'impact'
  });
});

test('CI PR risk gate keeps repository-wide changes on all slow suites', () => {
  expect(selectCiPrRiskSlowSuites(null)).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: [],
    reason: 'all'
  });
  expect(selectCiPrRiskSlowSuites(['package.json'])).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: ['all-slow-suites'],
    reason: 'all'
  });
  expect(selectCiPrRiskSlowSuites(['tests/helpers/workspace-fixtures.ts'])).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: ['all-slow-suites'],
    reason: 'all'
  });
});

test('CI PR risk gate skips slow suites when no source or slow test impact exists', () => {
  expect(selectCiPrRiskSlowSuites(['docs/usage.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: [],
    reason: 'none'
  });
});
