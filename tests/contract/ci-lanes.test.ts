import { expect, test } from 'bun:test';

import {
  buildCiContract,
  buildCiFullGatePlan,
  buildCiQuickGatePlan,
  CI_VERIFICATION_PR_DISPATCH_TYPE,
  CI_VERIFICATION_PR_EVENT,
  CodexDevelopmentBuildVerificationPlanV1,
  CodexDevelopmentCanonicalChangedFilesV1,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  parseGitChangedFileOutput,
  parseGitChangedRecordsOutput
} from '../../platform/shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../../platform/shared/ci-pr-risk-selection.ts';
import {
  getSlowTestSuitesSync,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteIds
} from '../../platform/shared/test-budget-contract.ts';
import { CodexDevelopmentBuildVerificationScopeInventoryV1 } from '../../platform/shared/verification-scope-inventory.ts';
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
  expect(CI_VERIFICATION_PR_EVENT).toBe('repository_dispatch');
  expect(CI_VERIFICATION_PR_DISPATCH_TYPE).toBe('sec-verify-frozen-v1');
  expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
  expect(contract.prDispatchType).toBe(CI_VERIFICATION_PR_DISPATCH_TYPE);
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

  expect(formatted).toContain('Verification contract revision: ci-verification-v15');
  expect(formatted).toContain('Execution model: frozen-delivery-single-runner');
  expect(formatted).toContain('PR workflow event: repository_dispatch');
  expect(formatted).toContain('PR dispatch type: sec-verify-frozen-v1');
  expect(formatted).not.toContain('Trigger labels:');
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
    resolved: true
  });
  expect(pipelineSelection.suites).toContain('e2e-pipeline');
  expect(pipelineSelection.suites).toContain('e2e-pipeline-end-to-end');
  expect(pipelineSelection.owners).toContain('pipeline');

  const runtimeSelection = selectCiPrRiskSlowSuites(['platform/compiler/verify/run-runtime-verification.ts']);
  expect(runtimeSelection).toMatchObject({
    slowTests: [],
    resolved: true
  });
  expect(runtimeSelection.suites).toContain('e2e-verify-lock');
  expect(runtimeSelection.owners).toContain('verify');
  expect(runtimeSelection.affectedSlowTests).toContain('tests/e2e/verification.test.ts');

  expect(selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts'])).toMatchObject({
    suites: ['e2e-dry-run-plan'],
    slowTests: [],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts'],
    reasons: ['direct-slow-test'],
    resolved: true
  });
});

test('CI impact ownership includes mandatory validation sentinels and roadmap authority', () => {
  const workflowSelection = selectCiPrRiskSlowSuites(['.github/workflows/compiler-pr-validation.yml']);
  expect(workflowSelection.suites).toEqual(slowTestPrRiskBaselineSuiteIds());
  expect(workflowSelection.owners).toEqual(expect.arrayContaining(['bounded-slow-risk', 'verification-infrastructure']));
  expect(workflowSelection.reasons).toEqual(['mandatory-sentinel', 'ownership-impact']);
  expect(workflowSelection.resolved).toBe(true);

  expect(selectCiPrRiskSlowSuites(['docs/03-MVP实施计划与路线图.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['roadmap-authority'],
    reasons: ['ownership-impact'],
    resolved: true
  });
});

test('V1 Quick resolves the complete PR #133 documentation and control-plane path set', () => {
  const plan = CodexDevelopmentBuildVerificationPlanV1('quick', [
    'README.md',
    'docs/00-文档索引与一致性规则.md',
    'docs/02-工程编译器-MVP-PRD与架构稿.md',
    'docs/03-MVP实施计划与路线图.md',
    'docs/04-AI自主实现执行蓝图.md',
    'docs/09-AI Runtime、任务信封与治理规范.md',
    'docs/11-Workbench与可视化规范.md',
    'docs/14-Engineering IR与语义事实规范.md',
    'docs/architecture/brownfield-import.md',
    'docs/architecture/engineering-workspace-ir.md',
    'docs/architecture/sec-ts-ir-layers.md',
    'docs/goals/SEC-Engineering-Workspace-Compiler.md',
    'docs/governance/nexus-absorption-and-conformance.md',
    'docs/work/current-state.yaml',
    'docs/governance/nexus-absorption-ledger.yaml',
    'docs/governance/nexus-absorption-report.md',
    'docs/work/active-work-package.md',
    'docs/work/rolling-plan.md',
    'docs/work-packages/phase-0-current-reality-rebase-v1.md'
  ]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.selectionReasons).toEqual(['ownership-impact']);
  expect(plan.affectedOwners).toEqual(['roadmap-authority']);
  expect(plan.gates.map((gate) => gate.id)).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
  ]);
});

test('V1 changed-file canonicalization shares the repository path contract', () => {
  expect(CodexDevelopmentCanonicalChangedFilesV1([
    'docs/work/current-state.yaml',
    'README.md',
    'README.md'
  ])).toEqual(['README.md', 'docs/work/current-state.yaml']);

  for (const file of [
    '',
    '/docs/work/current-state.yaml',
    'C:/absolute.md',
    'C:relative.md',
    'file:/docs/readme.md',
    'docs\\work\\current-state.yaml',
    'docs/file:stream.md',
    'docs//x.md',
    'docs/./x.md',
    'docs/work/../evidence/probe.yaml',
    'docs/work/\0state.yaml',
    'docs/e\u0301.md'
  ]) {
    expect(() => CodexDevelopmentCanonicalChangedFilesV1([file])).toThrow(
      'not canonical repository-relative POSIX'
    );
  }
});

test('Git raw path identity reaches V1 canonical validation without separator laundering', () => {
  const raw = new TextEncoder().encode('M\0docs\\work\\current-state.yaml\0');
  const changedFiles = parseGitChangedFileOutput(raw);
  expect(changedFiles).toEqual(['docs\\work\\current-state.yaml']);
  expect(() => CodexDevelopmentBuildVerificationPlanV1('quick', changedFiles)).toThrow(
    'not canonical repository-relative POSIX'
  );
  expect(() => CodexDevelopmentBuildVerificationScopeInventoryV1({
    profile: 'quick',
    changedFiles,
    runtime: 'bun@test',
    currentHead: 'a'.repeat(40),
    baseHead: 'b'.repeat(40),
    changedRecords: parseGitChangedRecordsOutput(raw),
    gitBlob: () => null
  })).toThrow('not canonical repository-relative POSIX');
});

test('Ticket semantic Contract impact selects the named mandatory vertical slow suite', () => {
  const selection = selectCiPrRiskSlowSuites([
    'platform/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);

  expect(selection).toMatchObject({ reasons: ['ownership-impact'], resolved: true });
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
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
  for (const file of [
    'package.json',
    'tests/helpers/workspace-fixtures.ts',
    'tests/setup/runtime-deps.setup.ts',
    'tests/testkit/workspace.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual(expect.arrayContaining(baselineSuites));
    expect(selection.owners).toContain('bounded-slow-risk');
    expect(selection.reasons).toContain('bounded-baseline');
    expect(selection.resolved).toBe(true);
  }
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
    reasons: [],
    resolved: true
  });
});

test('local affected runner shares canonical changed-file parsing and impact ownership', async () => {
  const source = await readCompilerFile('platform/dev-runner/test-runner.ts');

  expect(source).toContain('gitChangedFileDiffArgs');
  expect(source).toContain('gitUntrackedFileArgs');
  expect(source).toContain('parseGitChangedFileOutput');
  expect(source).toContain("from '../shared/affected-test-inventory.ts'");
  expect(source).toContain("from '../shared/ci-pr-risk-selection.ts'");
  expect(source).toContain('CodexDevelopmentBuildAffectedTestInventoryV1(files)');
  expect(source).toContain('selectCiPrRiskSlowSuites(files)');
  expect(source).toContain('selectCiPrRiskSlowSuites([file])');
  expect(source).not.toContain('isTestImpactSourceFile');
  expect(source).not.toContain('function impactSourceFile');
  expect(source).not.toContain("['diff', '--name-only', '--diff-filter=ACMR'");
});

test('CI risk runner keeps fail-fast default and supports explicit resumable local batches', async () => {
  const source = await readCompilerFile('scripts/ci-pr-risk.ts');

  expect(source).toContain("argument === '--all-slow'");
  expect(source).toContain("argument === '--continue-on-failure'");
  expect(source).toContain("argument.startsWith('--suite=')");
  expect(source).toContain("'requested-batch'");
  expect(source).toContain('cannot combine --all-slow with explicit --suite values');
  expect(source).toContain('--continue-on-failure requires at least one explicit --suite value');
  expect(source).toContain('requires a clean complete worktree before execution');
  expect(source).toContain('cannot resolve exact head/tree/two bases');
  expect(source).toContain("env.SEC_CHANGED_BASE ?? 'HEAD^1'");
  expect(source).toContain('const preSlowSteps: GateStep[] = parsed.runAllSlow || requestedBatch ? []');
  expect(source).toContain('const postSlowSteps: GateStep[] = parsed.runAllSlow || requestedBatch ? []');
  expect(source).toContain('parsed.runAllSlow ? slowSuites : selection.suites');
  expect(source).toContain('SEC_CI_PR_RISK_SLOW_CONCURRENCY');
  expect(source).toContain("suite.parallelSafe && suite.resourceClass === 'standard'");
  expect(source).toContain("suite.resourceClass === 'runtime-heavy'");
  expect(source).toContain('let stopScheduling = false');
  expect(source).toContain('(!stopScheduling || parsed!.continueOnFailure)');
  expect(source).toContain('stopScheduling = true');
  expect(source).toContain('SEC_CI_RISK_SUMMARY');
  expect(source).toContain('.tmp/ci-risk-batch-evidence.json');
  expect(source).toContain('CodexDevelopmentFinalizeVerificationEvidenceV2');
  expect(source).toContain('affectedBaseSha');
  expect(source).toContain('cleanState: { before: cleanBefore, after: cleanAfter }');
  expect(source).toContain('parallel-safe standard slow steps with concurrency ${concurrency}');
  expect(source).toContain('SEC_TEST_WORKSPACE_NAMESPACE');
  expect(source).toContain('gateEnvironment(env, step)');
  expect(source).not.toContain('process.exit(');
});
