import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
import {
  CodexDevelopmentBuildVerificationScopeInventoryV1
} from '../../platform/shared/verification-scope-inventory.ts';
import {
  CodexDevelopmentChangedFilesFromRecordsV1,
  CodexDevelopmentCreateNotRunGateV2,
  CodexDevelopmentRunGateProcessV1
} from '../../scripts/codex/ci-orchestration-core.ts';
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
  expect(contract.executionModel).toBe('verification-session-v2-action-closure');
  expect(CI_VERIFICATION_PR_EVENT).toBe('repository_dispatch');
  expect(CI_VERIFICATION_PR_DISPATCH_TYPE).toBe('sec-verify-session-v2');
  expect(contract.prWorkflowCommands).toEqual([
    'bun scripts/codex/verification-session.ts observe-hosted',
    'bun scripts/codex/verification-session.ts prepare-hosted',
    'bun scripts/ci-verification.ts ensure-hosted-action-provider',
    'bun scripts/ci-verification.ts resolve-hosted-action',
    'install --frozen-lockfile --ignore-scripts',
    'bun scripts/ci-verification.ts prepare-hosted-action-inputs',
    'bun scripts/ci-verification.ts self-test-hosted-action-sandbox',
    'bun scripts/ci-verification.ts execute-hosted-action-sut',
    'bun scripts/ci-verification.ts assemble-hosted-action-terminal',
    'bun scripts/ci-verification.ts compose-hosted-evidence',
    'bun scripts/codex/verification-session.ts finalize-hosted'
  ]);
  expect(contract.releaseWorkflowCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun scripts/ci-verification.ts --profile full --expected-head "$SEC_EXPECTED_HEAD_SHA"'
  ]);
});

test('CI contract counts and formatted projections are self-consistent', () => {
  const contract = buildCiContract();
  expectCiContractSelfConsistent(contract);
  const formatted = formatCiContract(contract);
  expect(formatted).toContain('Verification contract revision: ci-verification-v19');
  expect(formatted).toContain('Execution model: verification-session-v2-action-closure');
  expect(formatted).toContain('PR workflow event: repository_dispatch');
  expect(formatted).toContain('PR dispatch type: sec-verify-session-v2');
  expect(formatted).not.toContain('Trigger labels:');
  for (const label of [
    'PR workflow command count:',
    'Release workflow command count:',
    'PR quick lane command count:',
    'PR risk lane command count:',
    'Full lane command count:'
  ]) expect(formatted).toContain(label);
});

test('CI verification plans execute canonical affected Quick and ordered Full workspace chain', () => {
  expect(buildCiQuickGatePlan({
    includeImports: false,
    includeDocs: false,
    includeRisk: false
  })).toEqual([
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

test('CI PR risk gate selects slow suites from test impact ownership', () => {
  const pipeline = selectCiPrRiskSlowSuites([
    'platform/compiler/compose/generate-runtime-host.ts'
  ]);
  expect(pipeline).toMatchObject({ slowTests: [], resolved: true });
  expect(pipeline.suites).toEqual(expect.arrayContaining([
    'e2e-pipeline',
    'e2e-pipeline-end-to-end'
  ]));
  expect(pipeline.owners).toContain('pipeline');

  const runtime = selectCiPrRiskSlowSuites([
    'platform/compiler/verify/run-runtime-verification.ts'
  ]);
  expect(runtime).toMatchObject({ slowTests: [], resolved: true });
  expect(runtime.suites).toContain('e2e-verify-lock');
  expect(runtime.owners).toContain('verify');
  expect(runtime.affectedSlowTests).toContain('tests/e2e/verification.test.ts');

  expect(selectCiPrRiskSlowSuites(['tests/e2e/dry-run-plan.test.ts'])).toMatchObject({
    suites: ['e2e-dry-run-plan'],
    slowTests: [],
    affectedSlowTests: ['tests/e2e/dry-run-plan.test.ts'],
    reasons: ['direct-slow-test'],
    resolved: true
  });
});

test('documentation trust roots select exact sentinels without unrelated slow baselines', () => {
  for (const file of [
    'docs/authority.json',
    'docs/scripts/docs-doctor.ts',
    'docs/scripts/docs-doctor-ledgers.ts',
    'docs/scripts/docs-doctor-shared.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/documentation-authority-contract.ts'
  ]) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual([]);
    expect(selection.owners).toContain('agent-governance');
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).toEqual(expect.arrayContaining([
      'mandatory-sentinel',
      'ownership-impact'
    ]));
    expect(selection.resolved).toBe(true);
  }

  expect(selectCiPrRiskSlowSuites(['docs/product.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['documentation-authority'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectCiPrRiskSlowSuites(['docs/unregistered.md']).resolved).toBe(false);
});

test('V1 Quick resolves the active corpus and control-plane path set', () => {
  const plan = CodexDevelopmentBuildVerificationPlanV1('quick', [
    'README.md',
    'AGENTS.md',
    'docs/authority.json',
    'docs/README.md',
    'docs/product.md',
    'docs/roadmap.md',
    'docs/system-architecture.md',
    'docs/semantic-model.md',
    'docs/delta-and-impact.md',
    'docs/semantic-mutation.md',
    'docs/compiler-target-ir.md',
    'docs/capability-and-block-model.md',
    'docs/brownfield-import.md',
    'docs/workbench-and-ai-operations.md',
    'docs/runtime-and-distribution.md',
    'docs/change-management.md',
    'docs/verification-governance.md',
    'docs/development-governance.md',
    'docs/external-provider-policy.md',
    'docs/corpus/nexus/contract.md',
    'docs/governance/external-capability-ledger.yaml',
    'docs/governance/nexus-absorption-ledger.yaml',
    'docs/work/current-state.yaml',
    'docs/work/active-work-package.md',
    'docs/work/rolling-plan.md',
    'docs/work-packages/active-documentation-corpus-v1.md'
  ]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.gates.map((gate) => gate.id)).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
  ]);
});

test('V1 Quick docs gate follows explicit documentation lifecycle ownership', () => {
  for (const [file, owner] of [
    ['docs/product.md', 'documentation-authority'],
    ['docs/03-MVP实施计划与路线图.md', 'documentation-authority'],
    ['docs/archive/example.md', 'historical-documentation'],
    ['docs/evidence/documentation/example.md', 'documentation-evidence'],
    ['docs/work-packages/example-v1.md', 'frozen-work-package']
  ] as const) {
    const plan = CodexDevelopmentBuildVerificationPlanV1('quick', [file]);
    expect(plan.selectionResolved).toBe(true);
    expect(plan.affectedOwners).toContain(owner);
    expect(plan.gates.map(({ id }) => id)).toContain('docs-doctor');
  }

  const unknownDocsYaml = CodexDevelopmentBuildVerificationPlanV1('quick', [
    'docs/unregistered.manifest.yaml'
  ]);
  expect(unknownDocsYaml.selectionResolved).toBe(false);
  expect(unknownDocsYaml.affectedOwners).not.toContain('documentation-authority');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).not.toContain('docs-doctor');
  expect(unknownDocsYaml.gates.map(({ id }) => id)).toContain('impact-risk');
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

test('Ticket semantic Contract impact selects the mandatory vertical slow suite', () => {
  const selection = selectCiPrRiskSlowSuites([
    'platform/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);
  expect(selection).toMatchObject({ reasons: ['ownership-impact'], resolved: true });
  expect(selection.owners).toEqual(expect.arrayContaining(['semantic-contract', 'ticket-core']));
  expect(selection.suites).toContain('e2e-ticket-semantic-vertical');
  expect(selection.affectedSlowTests).toContain(
    'tests/e2e/semantic-runtime-contract.test.ts'
  );
});

test('CI PR risk gate reserves bounded fallback for unknown input and uses exact owners otherwise', () => {
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
  expect(selectCiPrRiskSlowSuites(['package.json'])).toMatchObject({
    suites: ['integration-shared-runtime-dependencies'],
    owners: ['repository-package-contract'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectCiPrRiskSlowSuites(['tests/helpers/workspace-fixtures.ts'])).toMatchObject({
    suites: ['e2e-artifacts', 'e2e-compiler-smoke', 'e2e-provenance', 'e2e-verify-lock', 'e2e-workspace'],
    owners: ['bounded-slow-risk'],
    reasons: ['bounded-baseline'],
    resolved: true
  });
  expect(selectCiPrRiskSlowSuites(['tests/setup/test-runtime.setup.ts'])).toMatchObject({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['test-process-runtime'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  const sharedTestkit = selectCiPrRiskSlowSuites(['tests/testkit/workspace.ts']);
  expect(sharedTestkit).toMatchObject({
    owners: ['bounded-slow-risk', 'module-graph'],
    reasons: ['bounded-baseline', 'ownership-impact'],
    resolved: true
  });
  expect(sharedTestkit.suites).toContain('integration-shared-runtime-dependencies');
  expect(sharedTestkit.suites).toContain('e2e-workspace');
  expect(sharedTestkit.suites).not.toContain('contract-document-control-plane-lifecycle');
  expect(sharedTestkit.suites.length).toBeGreaterThan(baselineSuites.length);
});

test('slow suite budget distinguishes state safety from runtime resource pressure', () => {
  const suites = getSlowTestSuitesSync();
  const runtimeHeavy = suites
    .filter((suite) => suite.resourceClass === 'runtime-heavy')
    .map((suite) => suite.id);
  expect(runtimeHeavy).toEqual([
    'contract-dev-runner-live-authority',
    'contract-dev-runner-authority-program',
    'integration-shared-runtime-dependencies',
    'contract-document-control-plane-lifecycle',
    'unit-worktree-closeout-crash-recovery',
    'unit-worktree-closeout-temp-repo',
    'e2e-artifacts',
    'e2e-conflicts',
    'e2e-demo-doctor',
    'e2e-explain',
    'e2e-local-views',
    'e2e-provenance',
    'e2e-runtime-host',
    'e2e-summary',
    'e2e-windows-appcontainer-executor'
  ]);
  expect(suites.find((suite) => suite.id === 'e2e-windows-appcontainer-executor'))
    .toMatchObject({ parallelSafe: false });
  expect(
    suites
      .filter((suite) =>
        suite.resourceClass === 'runtime-heavy'
        && suite.id !== 'e2e-windows-appcontainer-executor')
      .every((suite) => suite.parallelSafe)
  ).toBe(true);

});

test('CI changed files derive from one immutable changed-record snapshot', () => {
  expect(CodexDevelopmentChangedFilesFromRecordsV1([
    { status: 'changed', path: 'scripts/ci-verification.ts' },
    {
      status: 'renamed',
      previousPath: 'scripts/old-ci.ts',
      path: 'scripts/ci-verification.ts'
    },
    { status: 'added', path: 'scripts/codex/ci-orchestration-core.ts' }
  ])).toEqual([
    'scripts/ci-verification.ts',
    'scripts/codex/ci-orchestration-core.ts',
    'scripts/old-ci.ts'
  ]);
});

test('shared CI orchestration preserves child cwd, raw output digest and V2 not-run shape', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-ci-orchestration-'));
  try {
    const output = `${repositoryRoot}\n`;
    const result = await CodexDevelopmentRunGateProcessV1(repositoryRoot, {
      id: 'cwd-sentinel',
      argv: [process.execPath, '-e', 'console.log(process.cwd())'],
      env: process.env
    });
    expect(result).toEqual({
      code: 0,
      rawOutputDigest: `sha256:${createHash('sha256').update(output).digest('hex')}`,
      failureTail: repositoryRoot
    });
    expect(CodexDevelopmentCreateNotRunGateV2({
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
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});
