import { expect, test } from 'bun:test';

import {
  buildCiContract,
  buildCiFullGatePlan,
  buildCiQuickGatePlan,
  CI_VERIFICATION_PR_TRIGGER_TYPES,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
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
  expect(CI_VERIFICATION_PR_TRIGGER_TYPES).toEqual(['labeled', 'synchronize']);
  expect(contract.prTriggerTypes).toEqual(['labeled', 'synchronize']);
  expect(contract.prSynchronizeRequiredLabel).toBe('run-full');
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

  expect(formatted).toContain('Verification contract revision: ci-verification-v3');
  expect(formatted).toContain('Execution model: frozen-delivery-single-runner');
  expect(formatted).toContain('Trigger labels: run-full, run-quick');
  expect(formatted).toContain('PR trigger types: labeled, synchronize');
  expect(formatted).toContain('PR synchronize required label: run-full');
  expect(formatted).toContain('PR workflow command count:');
  expect(formatted).toContain('PR workflow commands:');
  expect(formatted).toContain('Release workflow command count:');
  expect(formatted).toContain('Release workflow commands:');
  expect(formatted).toContain('PR quick lane command count:');
  expect(formatted).toContain('PR risk lane command count:');
  expect(formatted).toContain('Full lane command count:');
});

test('CI verification plans execute canonical affected Quick and one ordered fail-stop Full workspace chain', () => {
  expect(buildCiQuickGatePlan({ includeImports: false, includeDocs: false, includeRisk: false })).toEqual([
    { id: 'typecheck', phase: 'quick', args: ['run', 'typecheck'] },
    { id: 'affected-tests', phase: 'quick', args: ['run', 'test:affected'] }
  ]);

  const full = buildCiFullGatePlan();
  expect(full.find((step) => step.id === 'affected-tests')).toMatchObject({ phase: 'quick' });
  expect(full.find((step) => step.id === 'all-slow-risk')).toMatchObject({
    phase: 'risk',
    args: ['scripts/ci-pr-risk.ts', '--all-slow']
  });
  expect(full.filter((step) => step.phase === 'workspace').map((step) => step.id)).toEqual([
    'resolve',
    'compose',
    'adapt',
    'verify-all',
    'lock',
    'explain',
    'reference-check'
  ]);
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

test('Ticket semantic Contract impact selects the named mandatory vertical slow suite', () => {
  const selection = selectCiPrRiskSlowSuites([
    'platform/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);

  expect(selection).toMatchObject({ reason: 'impact' });
  expect(selection.owners).toEqual(expect.arrayContaining(['semantic-contract', 'ticket-core']));
  expect(selection.suites).toContain('e2e-ticket-semantic-vertical');
  expect(selection.affectedSlowTests).toContain('tests/e2e/semantic-runtime-contract.test.ts');
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

test('local affected runner shares canonical changed-file parsing and impact ownership', async () => {
  const source = await readCompilerFile('platform/dev-runner/test-runner.ts');

  expect(source).toContain('gitChangedFileDiffArgs');
  expect(source).toContain('gitUntrackedFileArgs');
  expect(source).toContain('parseGitChangedFileOutput');
  expect(source).toContain('files.filter(isTestImpactSourceFile)');
  expect(source).not.toContain('function impactSourceFile');
  expect(source).not.toContain("['diff', '--name-only', '--diff-filter=ACMR'");
});

test('CI risk runner keeps fail-fast default and supports explicit resumable local batches', async () => {
  const source = await readCompilerFile('scripts/ci-pr-risk.ts');

  expect(source).toContain("process.argv.includes('--all-slow')");
  expect(source).toContain("process.argv.includes('--continue-on-failure')");
  expect(source).toContain("argumentValues('--suite')");
  expect(source).toContain('argument.startsWith(inlinePrefix)');
  expect(source).toContain("'requested-batch'");
  expect(source).toContain('cannot combine --all-slow with explicit --suite values');
  expect(source).toContain('--continue-on-failure requires at least one explicit --suite value');
  expect(source).toContain('requested batch requires a clean tracked HEAD');
  expect(source).toContain('requested batch cannot resolve exact head/base');
  expect(source).toContain('process.env.SEC_CHANGED_BASE ?? process.env.SEC_AFFECTED_TESTS_BASE');
  expect(source).toContain('const preSlowSteps: GateStep[] = runAllSlow || runRequestedSlow ? []');
  expect(source).toContain('const postSlowSteps: GateStep[] = runAllSlow || runRequestedSlow ? []');
  expect(source).toContain('runAllSlow ? slowSuites : slowSuiteSelection.suites');
  expect(source).toContain('SEC_CI_PR_RISK_SLOW_CONCURRENCY');
  expect(source).toContain("suite.parallelSafe && suite.resourceClass === 'standard'");
  expect(source).toContain("suite.resourceClass === 'runtime-heavy'");
  expect(source).toContain('runBunStepsInParallel');
  expect(source).toContain('let stopScheduling = false');
  expect(source).toContain('while ((continueAfterFailure || !stopScheduling) && nextIndex < steps.length)');
  expect(source).toContain('if (result.code !== 0 && !continueAfterFailure)');
  expect(source).toContain('stopScheduling = true');
  expect(source).toContain('stopped scheduling after failure');
  expect(source).toContain('SEC_CI_RISK_SUMMARY');
  expect(source).toContain('.tmp/ci-risk-batch-evidence.json');
  expect(source).toContain('completedSlowSteps');
  expect(source).toContain('failedSlowSteps');
  expect(source).toContain('baseSha: evidenceBaseSha');
  expect(source).toContain('trackedTreeCleanAfter');
  expect(source).toContain('parallel-safe standard slow steps with concurrency ${concurrency}');
  expect(source).toContain('runtime-heavy slow steps serially');
  expect(source).toContain('SEC_TEST_WORKSPACE_NAMESPACE');
  expect(source).toContain('gateStepEnvironment(step)');
});
