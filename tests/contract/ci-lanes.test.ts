import { afterAll, expect, test } from 'bun:test';
import { currentActiveDocumentationPaths } from '../../src/control/documentation/active.ts';

import { buildCiContract, formatCiContract } from '../../src/verification/ci/contract/core.ts';
import { buildCiFullGatePlan, buildCiQuickGatePlan, CodexDevelopmentBuildVerificationPlan as buildVerificationPlanWithProvider, CodexDevelopmentCanonicalChangedFiles, type CodexDevelopmentVerificationPlanProfile } from '../../src/verification/ci/contract/plan.ts';
import {
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentCreateNotRunGate
} from '../../src/verification/ci/runtime/ci-orchestration-core.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/verification/contract/revision.ts';
import { compileTestBudgetProjection, getSlowTestSuitesSync as getSnapshotSlowTestSuites, slowTestSuiteIds, slowTestPrRiskBaselineSuiteIds as snapshotBaselineSuiteIds } from '../../src/verification/test-impact/contract/budget.ts';
import { parseGitChangedFileOutput } from '../../src/verification/test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure as selectSlowTestClosureWithProvider } from '../../src/verification/test-impact/slow-risk-selection.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';
import {
  expectCiContractSelfConsistent,
  expectFullLaneCoversCorrectnessBackstop,
  expectFullLaneCoversSlowSuites,
  expectPrFastLaneBoundary
} from '../testkit/contracts.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const testImpactProvider = testImpactFixture.provider;
afterAll(() => testImpactFixture.dispose());
const testBudgetProjection = compileTestBudgetProjection(testImpactProvider.projection);
const selectSlowTestRiskClosure = (files: string[] | null) => (
  selectSlowTestClosureWithProvider(files, testImpactProvider)
);
const CodexDevelopmentBuildVerificationPlan = (
  profile: CodexDevelopmentVerificationPlanProfile,
  files: readonly string[] | null
) => buildVerificationPlanWithProvider(profile, files, testImpactProvider);
const slowTestPrRiskBaselineSuiteIds = () => snapshotBaselineSuiteIds(testBudgetProjection);
const getSlowTestSuitesSync = () => getSnapshotSlowTestSuites(testBudgetProjection);

test('CI contract keeps PR lanes bounded and full logical lane complete', () => {
  const contract = buildCiContract();
  expectPrFastLaneBoundary(contract);
  expectFullLaneCoversCorrectnessBackstop(contract);
  expectFullLaneCoversSlowSuites(contract, slowTestSuiteIds());
});

test('CI contract counts and formatted projections are self-consistent', () => {
  const contract = buildCiContract();
  expectCiContractSelfConsistent(contract);
  const formatted = formatCiContract(contract);
  expect(formatted).toContain(`Verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
  expect(formatted).toContain('Execution model: verification-session-v2-action-closure');
  expect(formatted).toContain('PR workflow event: repository_dispatch');
  expect(formatted).toContain('PR dispatch type: sec-verify-session-v2');
  expect(formatted).not.toContain('Trigger labels:');
  for (const label of [
    'PR workflow command count:',
    'Release workflow command count:',
    'PR quick lane command count:',
    'Full lane command count:'
  ]) expect(formatted).toContain(label);
});

test('CI verification plans execute canonical affected Quick and ordered Full workspace chain', () => {
  expect(buildCiQuickGatePlan({
    includeImports: false,
    includeDocs: false
  })).toEqual([
    { id: 'typecheck', phase: 'quick', args: ['run', 'typecheck'] },
    { id: 'affected-tests', phase: 'quick', args: ['run', 'test:affected'] }
  ]);

  const full = buildCiFullGatePlan();
  expect(full.find((step) => step.id === 'affected-tests')).toMatchObject({ phase: 'quick' });
  expect(full.filter((step) => step.id.startsWith('slow-suite-'))).toHaveLength(slowTestSuiteIds().length);
  expect(full.filter((step) => step.phase === 'workspace').map((step) => step.id)).toEqual([
    'resolve',
    'compose',
    'verify-all',
    'lock',
    'explain',
    'reference-check'
  ]);
});

test('CI slow-test closure consumes exact snapshot ownership and executable suites', () => {
  const pipeline = selectSlowTestRiskClosure([
    'src/compiler/compose/generate-runtime-library.ts'
  ]);
  expect(pipeline).toMatchObject({
    slowTests: [],
    resolved: true,
    reasons: ['ownership-impact']
  });
  expect(pipeline.owners).toContain('compiler');

  const runtime = selectSlowTestRiskClosure([
    'src/compiler/verify/run-runtime-verification.ts'
  ]);
  expect(runtime).toMatchObject({
    slowTests: [],
    resolved: true,
    reasons: ['ownership-impact']
  });

  expect(selectSlowTestRiskClosure(['tests/e2e/dry-run-plan.test.ts'])).toMatchObject({
    suites: ['e2e-dry-run-plan'],
    slowTests: [],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts'],
    reasons: ['direct-slow-test'],
    resolved: true
  });
});

test('documentation trust roots select only snapshot-observed suites without fallback baselines', () => {
  for (const file of currentActiveDocumentationPaths()) {
    const selection = selectSlowTestRiskClosure([file]);
    expect(selection.suites.every((suite) => slowTestSuiteIds().includes(suite))).toBe(true);
    expect(selection.owners).toContain('control.documentation');
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).toContain('ownership-impact');
    expect(selection.resolved).toBe(true);
  }

  expect(selectSlowTestRiskClosure(['docs/product.md'])).toMatchObject({
    slowTests: [],
    owners: ['control.documentation'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectSlowTestRiskClosure(['docs/unregistered.md']).resolved).toBe(false);
});

test('Quick plan resolves the canonical active documentation corpus', () => {
  const plan = CodexDevelopmentBuildVerificationPlan('quick', [...currentActiveDocumentationPaths()]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.gates.map((gate) => gate.id).filter((id) => !id.startsWith('slow-suite-'))).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests',
    'contract-freeze'
  ]);
});

test('Quick docs gate follows the canonical documentation lifecycle owner', () => {
  for (const file of currentActiveDocumentationPaths()) {
    const plan = CodexDevelopmentBuildVerificationPlan('quick', [file]);
    expect(plan.selectionResolved).toBe(true);
    expect(plan.affectedOwners).toContain('control.documentation');
    expect(plan.gates.map(({ id }) => id)).toContain('docs-doctor');
  }

  const unknownDocsYaml = CodexDevelopmentBuildVerificationPlan('quick', [
    'docs/unregistered.manifest.yaml'
  ]);
  expect(unknownDocsYaml.selectionResolved).toBe(false);
  expect(unknownDocsYaml.affectedOwners).not.toContain('control.documentation');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).not.toContain('docs-doctor');
  expect(unknownDocsYaml.gates.filter(({ id }) => id.startsWith('slow-suite-')))
    .toHaveLength(slowTestPrRiskBaselineSuiteIds().length);
});

test('changed-file canonicalization shares the repository path contract', () => {
  expect(CodexDevelopmentCanonicalChangedFiles([
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
    expect(() => CodexDevelopmentCanonicalChangedFiles([file])).toThrow(
      'not canonical repository-relative POSIX'
    );
  }
});

test('Git raw path identity reaches canonical validation without separator laundering', () => {
  const raw = new TextEncoder().encode('M\0docs\\work\\current-state.yaml\0');
  const changedFiles = parseGitChangedFileOutput(raw);
  expect(changedFiles).toEqual(['docs\\work\\current-state.yaml']);
  expect(() => CodexDevelopmentBuildVerificationPlan('quick', changedFiles)).toThrow(
    'not canonical repository-relative POSIX'
  );
});

test('Ticket semantic Contract derives its slow suites from the owner-issued projection', () => {
  const selection = selectSlowTestRiskClosure([
    'catalog/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);
  expect(selection).toMatchObject({
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selection.owners).toContain('compiler');
  expect(selection.owners).toContain('product.semantic-model');
  expect(selection.owners).not.toContain('bounded-slow-risk');
});

test('CI slow-test closure reserves bounded fallback for unknown input and uses exact owners otherwise', () => {
  const baselineSuites = slowTestPrRiskBaselineSuiteIds();
  expect(baselineSuites.length).toBeGreaterThan(0);
  expect(baselineSuites.length).toBeLessThan(slowTestSuiteIds().length);
  expect(selectSlowTestRiskClosure(null)).toEqual({
    suites: [...baselineSuites],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['bounded-slow-risk'],
    unresolvedPaths: [],
    reasons: ['bounded-baseline', 'changed-files-unresolved'],
    resolved: false
  });
  expect(selectSlowTestRiskClosure(['package.json'])).toMatchObject({
    owners: expect.arrayContaining(['toolchain']),
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectSlowTestRiskClosure(['tests/setup/test-runtime.setup.ts'])).toMatchObject({
    suites: [
      'e2e-artifacts',
      'e2e-compiler-smoke',
      'e2e-provenance',
      'e2e-verify-lock',
      'e2e-workspace'
    ],
    owners: ['bounded-slow-risk', 'verification.tests'],
    reasons: ['bounded-baseline', 'ownership-impact'],
    resolved: true
  });
  const sharedTestkit = selectSlowTestRiskClosure(['tests/testkit/workspace.ts']);
  expect(sharedTestkit).toMatchObject({
    owners: ['verification.tests'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(sharedTestkit.suites).toContain('e2e-workspace');
  expect(sharedTestkit.suites).not.toContain('contract-document-control-plane-lifecycle');
});

test('slow suite budget distinguishes state safety from runtime resource pressure', () => {
  const suites = getSlowTestSuitesSync();
  const runtimeHeavy = suites.filter((suite) => suite.resourceClass === 'runtime-heavy');
  expect(runtimeHeavy.length).toBeGreaterThan(0);
  expect(runtimeHeavy.every((suite) => suite.files.length > 0)).toBe(true);
  expect(runtimeHeavy.some((suite) => suite.parallelSafe)).toBe(true);
  expect(runtimeHeavy.some((suite) => !suite.parallelSafe)).toBe(true);
});

test('CI changed files derive from one immutable changed-record snapshot', () => {
  const changedPath = 'scripts/fixture-ci.ts';
  const orchestrationPath = 'scripts/codex/fixture-core.ts';
  expect(CodexDevelopmentChangedFilesFromRecords([
    { status: 'changed', path: changedPath },
    {
      status: 'renamed',
      previousPath: 'scripts/old-ci.ts',
      path: changedPath
    },
    { status: 'added', path: orchestrationPath }
  ])).toEqual([
    orchestrationPath,
    changedPath,
    'scripts/old-ci.ts'
  ]);
});

test('shared CI orchestration preserves transient not-run observation', () => {
  expect(CodexDevelopmentCreateNotRunGate({
    id: 'not-run-sentinel',
    argv: ['bun', 'test', 'sentinel.test.ts']
  })).toEqual({
    id: 'not-run-sentinel',
    argv: ['bun', 'test', 'sentinel.test.ts'],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  });
});
