import { expect, test } from 'bun:test';

import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import {
  getSlowTestSuitesSync,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteIds
} from '../../platform/shared/test-budget-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import {
  expectCiContractSelfConsistent,
  expectFullLaneCoversCorrectnessBackstop,
  expectFullLaneCoversSlowSuites,
  expectPrFastLaneBoundary
} from '../testkit/contracts.ts';

test('CI contract keeps PR lanes bounded and full logical lane complete', () => {
  const contract = buildCiContract();

  expectPrFastLaneBoundary(contract);
  expectFullLaneCoversCorrectnessBackstop(contract);
  expectFullLaneCoversSlowSuites(contract, slowTestSuiteIds());
  expect(contract.executionModel).toBe('frozen-delivery-single-runner');
  expect(contract.triggerLabels).toEqual(['run-full', 'run-quick']);
  expect(contract.prWorkflowCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun scripts/ci-verification.ts --profile "$profile" --expected-head "$SEC_EXPECTED_HEAD_SHA"'
  ]);
  expect(contract.releaseWorkflowCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun scripts/ci-verification.ts --profile full --expected-head "$SEC_EXPECTED_HEAD_SHA"'
  ]);
});

test('CI contract counts and produced paths are self-consistent', () => {
  expectCiContractSelfConsistent(buildCiContract());
});

test('CI contract text exposes execution and logical lane split for workflow audits', () => {
  const formatted = formatCiContract(buildCiContract());

  expect(formatted).toContain('Verification contract revision: ci-verification-v2');
  expect(formatted).toContain('Execution model: frozen-delivery-single-runner');
  expect(formatted).toContain('Trigger labels: run-full, run-quick');
  expect(formatted).toContain('PR workflow command count:');
  expect(formatted).toContain('PR workflow commands:');
  expect(formatted).toContain('Release workflow command count:');
  expect(formatted).toContain('Release workflow commands:');
  expect(formatted).toContain('PR quick lane command count:');
  expect(formatted).toContain('PR risk lane command count:');
  expect(formatted).toContain('Full lane command count:');
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

test('CI impact ownership includes validation workflows and roadmap authority', () => {
  expect(selectCiPrRiskSlowSuites(['.github/workflows/compiler-pr-validation.yml'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['verification-infrastructure'],
    reason: 'none'
  });

  expect(selectCiPrRiskSlowSuites(['docs/03-MVP实施计划与路线图.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['roadmap-authority'],
    reason: 'none'
  });
});

test('CI PR risk gate uses bounded baseline suites for broad risk changes', () => {
  const baselineSuites = slowTestPrRiskBaselineSuiteIds();
  expect(baselineSuites.length).toBeGreaterThan(0);
  expect(baselineSuites.length).toBeLessThan(slowTestSuiteIds().length);

  expect(selectCiPrRiskSlowSuites(null)).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reason: 'baseline'
  });
  expect(selectCiPrRiskSlowSuites(['package.json'])).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reason: 'baseline'
  });
  expect(selectCiPrRiskSlowSuites(['tests/helpers/workspace-fixtures.ts'])).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reason: 'baseline'
  });
  expect(selectCiPrRiskSlowSuites(['tests/setup/runtime-deps.setup.ts'])).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reason: 'baseline'
  });
  expect(selectCiPrRiskSlowSuites(['tests/testkit/workspace.ts'])).toEqual({
    suites: baselineSuites,
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    reason: 'baseline'
  });
});

test('slow suite budget distinguishes state safety from runtime resource pressure', () => {
  const suites = getSlowTestSuitesSync();
  const runtimeHeavy = suites
    .filter((suite) => suite.resourceClass === 'runtime-heavy')
    .map((suite) => suite.id);

  expect(runtimeHeavy).toEqual([
    'e2e-artifacts',
    'e2e-conflicts',
    'e2e-demo-doctor',
    'e2e-explain',
    'e2e-local-views',
    'e2e-provenance'
  ]);
  expect(
    suites
      .filter((suite) => suite.resourceClass === 'runtime-heavy')
      .every((suite) => suite.parallelSafe)
  ).toBe(true);
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

test('CI risk runner reuses bounded concurrency for impact-selected and all-slow profiles', async () => {
  const source = await readCompilerFile('scripts/ci-pr-risk.ts');

  expect(source).toContain("process.argv.includes('--all-slow')");
  expect(source).toContain('runAllSlow ? slowSuites : slowSuiteSelection.suites');
  expect(source).toContain('SEC_CI_PR_RISK_SLOW_CONCURRENCY');
  expect(source).toContain("suite.parallelSafe && suite.resourceClass === 'standard'");
  expect(source).toContain("suite.resourceClass === 'runtime-heavy'");
  expect(source).toContain('runBunStepsInParallel');
  expect(source).toContain('parallel-safe standard slow steps with concurrency ${concurrency}');
  expect(source).toContain('runtime-heavy slow steps serially');
  expect(source).toContain('SEC_TEST_WORKSPACE_NAMESPACE');
  expect(source).toContain('gateStepEnvironment(step)');
});
