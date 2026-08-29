import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { currentActiveDocumentationPaths } from '../../src/control/documentation/active.ts';

import { buildCiContract, formatCiContract } from '../../src/verification/ci/contract/core.ts';
import { buildCiFullGatePlan, buildCiQuickGatePlan, CodexDevelopmentBuildVerificationPlan, CodexDevelopmentCanonicalChangedFiles } from '../../src/verification/ci/contract/plan.ts';
import { parseGitChangedFileOutput, parseGitChangedRecordsOutput } from '../../src/verification/test-impact/runtime/transition.ts';
import { selectCiPrRiskSlowSuites } from '../../src/verification/ci/runtime/pr-risk-selection.ts';
import { getSlowTestSuitesSync, slowTestPrRiskBaselineSuiteIds, slowTestSuiteIds } from '../../src/verification/test-impact/contract/budget.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/verification/ci/contract/plan.ts';
import {
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentCreateNotRunGate,
  CodexDevelopmentRunGateProcess
} from '../../src/verification/ci/runtime/ci-orchestration-core.ts';
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
    phase: 'risk'
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
    'src/compiler/compose/generate-runtime-library.ts'
  ]);
  expect(pipeline).toMatchObject({ slowTests: [], resolved: true });
  expect(pipeline.suites).toEqual(expect.arrayContaining([
    'e2e-pipeline',
    'e2e-pipeline-end-to-end'
  ]));
  expect(pipeline.owners).toContain('compiler');

  const runtime = selectCiPrRiskSlowSuites([
    'src/compiler/verify/run-runtime-verification.ts'
  ]);
  expect(runtime).toMatchObject({ slowTests: [], resolved: true });
  expect(runtime.suites).toContain('e2e-verify-lock');
  expect(runtime.owners).toContain('compiler');
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
  for (const file of currentActiveDocumentationPaths()) {
    const selection = selectCiPrRiskSlowSuites([file]);
    expect(selection.suites).toEqual([]);
    expect(selection.owners).toContain('control.documentation');
    expect(selection.owners).not.toContain('bounded-slow-risk');
    expect(selection.reasons).toContain('ownership-impact');
    expect(selection.resolved).toBe(true);
  }

  expect(selectCiPrRiskSlowSuites(['docs/product.md'])).toEqual({
    suites: [],
    slowTests: [],
    affectedSlowTests: [],
    owners: ['control.documentation'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectCiPrRiskSlowSuites(['docs/unregistered.md']).resolved).toBe(false);
});

test('Quick plan resolves the canonical active documentation corpus', () => {
  const plan = CodexDevelopmentBuildVerificationPlan('quick', [...currentActiveDocumentationPaths()]);

  expect(plan.selectionResolved).toBe(true);
  expect(plan.gates.map((gate) => gate.id)).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
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
  expect(unknownDocsYaml.gates.map(({ id }) => id)).toContain('impact-risk');
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

test('Ticket semantic Contract impact selects the mandatory vertical slow suite', () => {
  const selection = selectCiPrRiskSlowSuites([
    'catalog/registry/official/ticket.basic/contracts/ticket.yaml'
  ]);
  expect(selection).toMatchObject({ reasons: ['ownership-impact'], resolved: true });
  expect(selection.owners).toEqual(expect.arrayContaining([
    'compiler.registry.official-content',
    'product.semantic-model'
  ]));
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
    owners: expect.arrayContaining(['toolchain']),
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(selectCiPrRiskSlowSuites(['package.json']).suites)
    .toContain('integration-shared-runtime-dependencies');
  expect(selectCiPrRiskSlowSuites(['tests/setup/test-runtime.setup.ts'])).toMatchObject({
    suites: [
      'e2e-artifacts',
      'e2e-compiler-smoke',
      'e2e-provenance',
      'e2e-verify-lock',
      'e2e-workspace'
    ],
    owners: expect.arrayContaining(['bounded-slow-risk', 'verification.tests']),
    reasons: ['bounded-baseline', 'ownership-impact'],
    resolved: true
  });
  const sharedTestkit = selectCiPrRiskSlowSuites(['tests/testkit/workspace.ts']);
  expect(sharedTestkit).toMatchObject({
    owners: ['verification.tests'],
    reasons: ['ownership-impact'],
    resolved: true
  });
  expect(sharedTestkit.suites).toContain('integration-shared-runtime-dependencies');
  expect(sharedTestkit.suites).toContain('e2e-workspace');
  expect(sharedTestkit.suites).not.toContain('contract-document-control-plane-lifecycle');
  expect(sharedTestkit.suites.length).toBeGreaterThan(baselineSuites.length);
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

test('shared CI orchestration preserves child cwd, raw output digest and V2 not-run shape', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-ci-orchestration-'));
  try {
    const output = `${repositoryRoot}\n`;
    const result = await CodexDevelopmentRunGateProcess(repositoryRoot, {
      id: 'cwd-sentinel',
      argv: [process.execPath, '-e', 'console.log(process.cwd())'],
      env: process.env
    });
    expect(result).toEqual({
      code: 0,
      rawOutputDigest: `sha256:${createHash('sha256').update(output).digest('hex')}`,
      failureTail: repositoryRoot
    });
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
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});
