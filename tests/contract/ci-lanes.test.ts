import { expect, test } from 'bun:test';

import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';
import { selectCiFullGateSlowSuites } from '../../platform/shared/ci-full-gate-selection.ts';
import { slowTestSuiteIds } from '../../platform/shared/test-budget-contract.ts';

test('CI contract keeps lane boundaries', () => {
  const contract = buildCiContract();

  expect(contract.prFastLaneCommands).toContain('bun scripts/ci-pr-gate.ts');
  expect(contract.prFastLaneCommands).toContain('bun run imports:organize');
  expect(contract.prFastLaneCommands).not.toContain('bun run imports:check');
  expect(contract.prFastLaneCommands).not.toContain('bun run platform -- verify --json --compact');
  expect(contract.prFastLaneCommands).not.toContain('bun run platform -- verify --lane all --json --compact');
  expect(contract.prFastLaneCommands).not.toContain('bun run test:slow');

  expect(contract.prFullLaneCommands).toContain('bun scripts/ci-full-gate.ts');
  expect(contract.prFullLaneCommands).not.toContain('bun run test:slow');
  expect(contract.prFullLaneCommands).not.toContain('bun run platform -- verify --lane all --json --compact');

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

  expect(contract.prFastLaneCommandCount).toBe(contract.prFastLaneCommands.length);
  expect(contract.prFullLaneCommandCount).toBe(contract.prFullLaneCommands.length);
  expect(contract.fullLaneCommandCount).toBe(contract.fullLaneCommands.length);
});

test('CI contract text exposes lane command split for workflow audits', () => {
  const formatted = formatCiContract(buildCiContract());

  expect(formatted).toContain('PR fast lane command count:');
  expect(formatted).toContain('PR fast lane commands:');
  expect(formatted).toContain('PR full lane command count:');
  expect(formatted).toContain('PR full lane commands:');
  expect(formatted).toContain('Full lane command count:');
  expect(formatted).toContain('Full lane commands:');
});

test('CI PR full gate selects slow suites from the test impact contract', () => {
  expect(selectCiFullGateSlowSuites(['platform/compiler/compose/generate-runtime-host.ts'])).toMatchObject({
    suites: ['pipeline'],
    slowTests: [],
    owners: ['pipeline'],
    reason: 'impact'
  });
  expect(selectCiFullGateSlowSuites(['platform/compiler/verify/run-runtime-verification.ts'])).toMatchObject({
    suites: ['runtime'],
    slowTests: [],
    owners: ['verify'],
    reason: 'impact'
  });
  expect(selectCiFullGateSlowSuites(['tests/e2e/dry-run-plan.slow.test.ts'])).toMatchObject({
    suites: [],
    slowTests: ['tests/e2e/dry-run-plan.slow.test.ts'],
    affectedSlowTests: ['tests/e2e/dry-run-plan.slow.test.ts'],
    reason: 'impact'
  });
  expect(selectCiFullGateSlowSuites(['tests/e2e/compiler-smoke.slow.test.ts'])).toMatchObject({
    suites: [],
    slowTests: ['tests/e2e/compiler-smoke.slow.test.ts'],
    affectedSlowTests: ['tests/e2e/compiler-smoke.slow.test.ts'],
    reason: 'impact'
  });
});

test('CI PR full gate keeps repository-wide changes on all slow suites', () => {
  expect(selectCiFullGateSlowSuites(null)).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: [],
    reason: 'all'
  });
  expect(selectCiFullGateSlowSuites(['package.json'])).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: ['all-slow-suites'],
    reason: 'all'
  });
  expect(selectCiFullGateSlowSuites(['tests/helpers/workspace-fixtures.ts'])).toEqual({
    suites: slowTestSuiteIds(),
    slowTests: [],
    affectedSlowTests: [],
    owners: ['all-slow-suites'],
    reason: 'all'
  });
});

test('CI PR full gate skips slow suites when no source or slow test impact exists', () => {
  expect(selectCiFullGateSlowSuites(['docs/usage.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: [],
    reason: 'none'
  });
});
