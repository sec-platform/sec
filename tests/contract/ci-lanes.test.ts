import { expect, test } from 'bun:test';

import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import { slowTestSuiteIds } from '../../platform/shared/test-budget-contract.ts';
import {
  expectCiContractSelfConsistent,
  expectFullLaneCoversCorrectnessBackstop,
  expectFullLaneCoversSlowSuites,
  expectPrFastLaneBoundary
} from '../testkit/contracts.ts';

test('CI contract keeps PR lanes fast and full lane complete', () => {
  const contract = buildCiContract();

  expectPrFastLaneBoundary(contract);
  expectFullLaneCoversCorrectnessBackstop(contract);
  expectFullLaneCoversSlowSuites(contract, slowTestSuiteIds());
});

test('CI contract counts and produced paths are self-consistent', () => {
  expectCiContractSelfConsistent(buildCiContract());
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
  expect(pipelineSelection.suites).toContain('e2e-pipeline');
  expect(pipelineSelection.suites).toContain('e2e-pipeline-end-to-end');
  expect(pipelineSelection.owners).toContain('pipeline');

  const runtimeSelection = selectCiPrRiskSlowSuites(['platform/compiler/verify/run-runtime-verification.ts']);
  expect(runtimeSelection).toMatchObject({
    slowTests: [],
    reason: 'impact'
  });
  expect(runtimeSelection.suites).toContain('e2e-verify-lock');
  expect(runtimeSelection.owners).toContain('verify');
  expect(runtimeSelection.affectedSlowTests).toContain('tests/e2e/verification.test.ts');

  expect(selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts'])).toMatchObject({
    suites: ['e2e-dry-run-plan'],
    slowTests: [],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts'],
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
  expect(selectCiPrRiskSlowSuites(['tests/setup/runtime-deps.setup.ts'])).toEqual({
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
