import { afterAll, expect, test } from 'bun:test';
import {
  currentActiveDocumentationPaths,
  currentDocumentationVerificationBaseline
} from '../../src/adapters/self-hosting/control/documentation/active.ts';

import { buildCiContract } from '../../src/adapters/verification/platform/ci/contract/core.ts';
import { bindDocumentationVerificationGateInput, buildCiFullGatePlan, buildCiQuickGatePlan, CodexDevelopmentBuildVerificationPlan as buildVerificationPlanWithProvider, CodexDevelopmentCanonicalChangedFiles, type CodexDevelopmentVerificationPlanProfile } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import {
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentCreateNotRunGate
} from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { compileTestBudgetProjection, getSlowTestSuitesSync as getSnapshotSlowTestSuites, slowTestSuiteIds, slowTestPrRiskBaselineSuiteIds as snapshotBaselineSuiteIds } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { parseGitChangedFileOutput } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';
import {
  expectFullLaneCoversCorrectnessBackstop,
  expectFullLaneCoversSlowSuites,
  expectPrFastLaneBoundary
} from '../testkit/contracts.ts';

const testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture();
const testImpactProvider = bindDocumentationVerificationGateInput(
  testImpactFixture.provider,
  currentDocumentationVerificationBaseline()
);
afterAll(() => testImpactFixture.dispose());
const testBudgetProjection = compileTestBudgetProjection(testImpactProvider.testInventory);
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

test('CI translates owner-issued selection into executable plan gates', () => {
  const pipeline = CodexDevelopmentBuildVerificationPlan('quick', [
    'src/adapters/compilation/compose/generate-runtime-library.ts'
  ]);
  expect(pipeline.selectionResolved).toBe(true);
  expect(pipeline.selectionReasons).toEqual(['ownership-impact']);
  expect(pipeline.affectedOwners).toContain('adapters.compilation');

  const runtime = CodexDevelopmentBuildVerificationPlan('quick', [
    'src/adapters/verification/run-runtime-verification.ts'
  ]);
  expect(runtime.selectionResolved).toBe(true);
  expect(runtime.selectionReasons).toEqual(['ownership-impact']);

  const directSlow = CodexDevelopmentBuildVerificationPlan('quick', [
    'tests/e2e/dry-run-plan.test.ts'
  ]);
  expect(directSlow).toMatchObject({
    selectionResolved: true,
    selectionReasons: ['direct-slow-test'],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts']
  });
  expect(directSlow.gates.map(({ id }) => id)).toContain('slow-suite-e2e-dry-run-plan');
});

test('Quick plan resolves the canonical active documentation corpus', () => {
  const plan = CodexDevelopmentBuildVerificationPlan('quick', [...currentActiveDocumentationPaths()]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.gates.map((gate) => gate.id).filter((id) => !id.startsWith('slow-suite-'))).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
  ]);
});

test('Quick docs gate follows the canonical documentation lifecycle owner', () => {
  for (const file of currentActiveDocumentationPaths()) {
    const plan = CodexDevelopmentBuildVerificationPlan('quick', [file]);
    expect(plan.selectionResolved).toBe(true);
    expect(plan.affectedOwners).toContain('adapters.self-hosting.control.documentation');
    expect(plan.affectedOwners).not.toContain('bounded-slow-risk');
    expect(plan.gates.map(({ id }) => id)).toContain('docs-doctor');
  }

  const unknownDocsYaml = CodexDevelopmentBuildVerificationPlan('quick', [
    'docs/unregistered.manifest.yaml'
  ]);
  expect(unknownDocsYaml.selectionResolved).toBe(false);
  expect(unknownDocsYaml.affectedOwners).not.toContain('adapters.self-hosting.control.documentation');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).toContain('docs-doctor');
  expect(unknownDocsYaml.gates.filter(({ id }) => id.startsWith('slow-suite-')))
    .toHaveLength(slowTestPrRiskBaselineSuiteIds().length);

  const documentationExample = CodexDevelopmentBuildVerificationPlan('quick', [
    'examples/documentation-example.ts'
  ]);
  expect(documentationExample.gates.map(({ id }) => id)).toContain('docs-doctor');
  expect(documentationExample.gates.map(({ id }) => id)).not.toContain('imports');
});

test('changed-file canonicalization shares the repository path contract', () => {
  expect(CodexDevelopmentCanonicalChangedFiles([
    'config/repository/current-state.yaml',
    'README.md',
    'README.md'
  ])).toEqual(['README.md', 'config/repository/current-state.yaml']);

  for (const file of [
    '',
    '/config/repository/current-state.yaml',
    'C:/absolute.md',
    'C:relative.md',
    'file:/docs/readme.md',
    'docs\\work\\current-state.yaml',
    'docs/file:stream.md',
    'docs//x.md',
    'docs/./x.md',
    'config/repository/../evidence/probe.yaml',
    'config/repository/\0state.yaml',
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

test('Ticket semantic Contract reaches CI through the owner-issued plan boundary', () => {
  const selection = CodexDevelopmentBuildVerificationPlan('quick', [
    'catalog/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);
  expect(selection).toMatchObject({
    selectionReasons: ['ownership-impact'],
    selectionResolved: true
  });
  expect(selection.affectedOwners).toContain('compiler');
  expect(selection.affectedOwners).toContain('semantics.definitions');
  expect(selection.affectedOwners).not.toContain('bounded-slow-risk');
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
