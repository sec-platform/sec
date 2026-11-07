import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  currentActiveDocumentationPaths,
  currentDocumentationVerificationBaseline
} from '../../src/adapters/self-hosting/control/documentation/active.ts';

import { assertCiVerificationNativeEnvironment } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { buildCiContract } from '../../src/adapters/verification/platform/ci/contract/core.ts';
import { bindDocumentationVerificationGateInput, buildCiFullGatePlan, buildCiQuickGatePlan, CodexDevelopmentBuildVerificationPlan as buildVerificationPlanWithProvider, CodexDevelopmentCanonicalChangedFiles, type CodexDevelopmentVerificationPlanProfile } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import {
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentCreateNotRunGate
} from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { compileTestBudgetProjection, getSlowTestSuitesSync as getSnapshotSlowTestSuites, slowTestSuiteIds, slowTestPrRiskBaselineSuiteIds as snapshotBaselineSuiteIds } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { parseGitChangedFileOutput } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { CodedFailure } from '../../src/contracts/failure.ts';
import { acquireExactRepositoryTestImpactProviderFixture } from '../helpers/test-impact-provider.ts';

let testImpactFixture: Awaited<ReturnType<typeof acquireExactRepositoryTestImpactProviderFixture>> | null = null;
let testImpactProviderPromise: Promise<ReturnType<typeof bindDocumentationVerificationGateInput>> | null = null;
const testImpactProvider = () => {
  testImpactProviderPromise ??= (async () => {
    // The private immutable tree binds the actual method rules and the source
    // package declaration/consumer being migrated together in this candidate.
    const fixtureSourceChanges = [
      'src/contracts/author-native-methods.ts',
      'src/contracts/author-kernel-verification.ts',
      'package.json',
      'src/adapters/toolchain/runtime/package-source-launcher.ts',
      'src/adapters/toolchain/runtime/package-entrypoint.ts',
      'src/adapters/toolchain/runtime/layout.ts'
    ].map(path => ({
      path,
      source: readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    }));
    testImpactFixture = await acquireExactRepositoryTestImpactProviderFixture(undefined, { fixtureSourceChanges });
    return bindDocumentationVerificationGateInput(
      testImpactFixture.provider,
      currentDocumentationVerificationBaseline()
    );
  })();
  return testImpactProviderPromise;
};
afterAll(() => testImpactFixture?.dispose());
const testBudgetProjection = async () => compileTestBudgetProjection((await testImpactProvider()).testInventory);
const buildVerificationPlanForTest = async (
  profile: CodexDevelopmentVerificationPlanProfile,
  files: readonly string[] | null
) => buildVerificationPlanWithProvider(profile, files, await testImpactProvider());
const slowTestPrRiskBaselineSuiteIds = async () => snapshotBaselineSuiteIds(await testBudgetProjection());
const getSlowTestSuitesSync = async () => getSnapshotSlowTestSuites(await testBudgetProjection());

test('CI contract keeps PR lanes bounded and full logical lane complete', () => {
  const contract = buildCiContract();
  expect(contract.prQuickLaneCommands).toEqual([
    'bun run imports:check',
    'bun run typecheck:verified',
    'bun run test -- --affected'
  ]);
  expect(contract.fullLaneCommands).toEqual(expect.arrayContaining([
    'bun run imports:check',
    'bun run typecheck:verified',
    'bun run docs:doctor',
    'bun run test -- --scope fast',
    'bun run sec -- verify --lane all --json --compact',
    'bun run sec -- reference check --json --compact'
  ]));
  for (const suiteId of slowTestSuiteIds()) {
    expect(contract.fullLaneCommands).toContain(`bun run test -- --scope slow --suite ${suiteId}`);
  }
});

test('CI verification plans execute canonical affected Quick and ordered Full workspace chain', () => {
  expect(buildCiQuickGatePlan({
    includeImports: false,
    includeDocs: false
  })).toEqual([
    { id: 'typecheck', phase: 'quick', args: ['run', 'typecheck:verified'] },
    { id: 'affected-tests', phase: 'quick', args: ['run', 'test', '--', '--affected'] }
  ]);

  const full = buildCiFullGatePlan();
  expect(full.find((step) => step.id === 'affected-tests')).toBeUndefined();
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

test('native inventory reaches Quick risk and Full through fixed package-script gates', async () => {
  const frontend = await buildVerificationPlanForTest('quick', ['crates/gift-author-kernel/src/captured_input.rs']);
  expect(frontend.requiredNativeMethods.map(({ id }) => id)).toEqual(['cargo-tests', 'reader-check']);
  expect(frontend.gates.filter(({ id }) => id.startsWith('native-'))).toEqual([]);

  const cargo = await buildVerificationPlanForTest('quick', ['crates/gift-author-kernel/Cargo.toml']);
  expect(cargo.requiredNativeMethods.map(({ id }) => id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
  expect(cargo.gates.filter(({ id }) => id === 'native-target-check')).toEqual([{
    id: 'native-target-check', phase: 'risk',
    args: ['run', 'test', '--', '--scope', 'native', '--method', 'target-check']
  }]);
  const full = await buildVerificationPlanForTest('full', []);
  expect(full.requiredNativeMethods.map(({ id }) => id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
  expect(full.gates.filter(({ id }) => id === 'full-native')).toEqual([{
    id: 'full-native', phase: 'full', args: ['run', 'test', '--', '--scope', 'native']
  }]);
  // The exact fixture binds a physical source tree. Required but absent or
  // unresolved inputs stay visible even while a newer producer is under edit.
  for (const plan of [frontend, cargo, full]) {
    if (plan.requiredNativeMethods.some(({ unresolvedInputs }) => unresolvedInputs.length > 0)) {
      expect(plan.selectionResolved).toBe(false);
      expect(plan.selectionReasons.some((reason) => reason.startsWith('native-input-unresolved:'))).toBe(true);
    }
  }
}, 180_000);

test('Bun-only and caller-named Rust environments cannot qualify native Actions', async () => {
  const plan = await buildVerificationPlanForTest('full', []);
  expect(() => assertCiVerificationNativeEnvironment({ requiredNativeMethods: [],
    executionEnvironment: { toolchainRevision: 'bun@fixture', executionEnvironmentRevision: 'local-fixture' } }))
    .not.toThrow();
  for (const executionEnvironment of [
    { toolchainRevision: 'bun@fixture', executionEnvironmentRevision: 'local-fixture' },
    { toolchainRevision: 'bun@fixture', executionEnvironmentRevision: 'github-actions:fixture' },
    { toolchainRevision: 'bun@fixture:rust@caller-named', executionEnvironmentRevision: 'native-verification-unit-v1' }
  ]) {
    let failure: unknown;
    try {
      assertCiVerificationNativeEnvironment({ requiredNativeMethods: plan.requiredNativeMethods, executionEnvironment });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CodedFailure);
    expect((failure as CodedFailure).details).toMatchObject({ kind: 'missing-native-environment',
      requiredMethods: ['cargo-tests', 'reader-check', 'target-check'],
      toolchainRevision: executionEnvironment.toolchainRevision,
      executionEnvironmentRevision: executionEnvironment.executionEnvironmentRevision });
  }
}, 180_000);

test('CI translates owner-issued selection into executable plan gates', async () => {
  const pipeline = await buildVerificationPlanForTest('quick', [
    'src/adapters/compilation/compose/generate-runtime-library.ts'
  ]);
  expect(pipeline.selectionResolved, pipeline.selectionReasons.join('\n')).toBe(true);
  expect(pipeline.selectionReasons).toEqual(['ownership-impact']);
  expect(pipeline.affectedOwners).toContain('adapters.compilation');

  const runtime = await buildVerificationPlanForTest('quick', [
    'src/adapters/verification/run-runtime-verification.ts'
  ]);
  expect(runtime.selectionResolved, runtime.selectionReasons.join('\n')).toBe(true);
  expect(runtime.selectionReasons).toEqual(['ownership-impact']);

  const directSlow = await buildVerificationPlanForTest('quick', [
    'tests/e2e/dry-run-plan.test.ts'
  ]);
  expect(directSlow).toMatchObject({
    selectionResolved: true,
    selectionReasons: ['direct-slow-test'],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts']
  });
  expect(directSlow.gates.map(({ id }) => id)).toContain('slow-suite-e2e-dry-run-plan');
}, 180_000);

test('Quick plan resolves the canonical active documentation corpus', async () => {
  const plan = await buildVerificationPlanForTest('quick', [...currentActiveDocumentationPaths()]);

  expect(plan.selectionResolved, plan.selectionReasons.join('\n')).toBe(true);
  expect(plan.gates.map((gate) => gate.id).filter((id) => !id.startsWith('slow-suite-'))).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests',
    'native-target-check'
  ]);
  // This corpus includes the registry/boundary JSON read by the real CLI
  // closure. Their native target obligation survives documentation ownership.
  expect(plan.requiredNativeMethods.find(({ id }) => id === 'target-check')?.selectionPaths)
    .toEqual(expect.arrayContaining(['.documentation/baseline.json', '.documentation/documents.json']));
}, 180_000);

test('Quick docs gate follows the canonical documentation lifecycle owner', async () => {
  for (const file of currentActiveDocumentationPaths()) {
    const plan = await buildVerificationPlanForTest('quick', [file]);
    expect(plan.selectionResolved, `${file}\n${plan.selectionReasons.join('\n')}`).toBe(true);
    expect(plan.affectedOwners).toContain('adapters.self-hosting.control.documentation');
    expect(plan.affectedOwners).not.toContain('bounded-slow-risk');
    expect(plan.gates.map(({ id }) => id)).toContain('docs-doctor');
  }

  const unknownDocsYaml = await buildVerificationPlanForTest('quick', [
    'docs/unregistered.manifest.yaml'
  ]);
  expect(unknownDocsYaml.selectionResolved).toBe(false);
  expect(unknownDocsYaml.affectedOwners).not.toContain('adapters.self-hosting.control.documentation');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).toContain('docs-doctor');
  expect(unknownDocsYaml.gates.filter(({ id }) => id.startsWith('slow-suite-')))
    .toHaveLength((await slowTestPrRiskBaselineSuiteIds()).length);

  const documentationExample = await buildVerificationPlanForTest('quick', [
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

test('Git raw path identity reaches canonical validation without separator laundering', async () => {
  const raw = new TextEncoder().encode('M\0docs\\work\\current-state.yaml\0');
  const changedFiles = parseGitChangedFileOutput(raw);
  expect(changedFiles).toEqual(['docs\\work\\current-state.yaml']);
  await expect(buildVerificationPlanForTest('quick', changedFiles)).rejects.toThrow(
    'not canonical repository-relative POSIX'
  );
});

test('Ticket semantic Contract reaches CI through the owner-issued plan boundary', async () => {
  const selection = await buildVerificationPlanForTest('quick', [
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

test('slow suite budget distinguishes state safety from runtime resource pressure', async () => {
  const suites = await getSlowTestSuitesSync();
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
