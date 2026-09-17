import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../src/application/engineering/cli.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { expectGraphEdge, expectGraphNode, expectNoGraphEdge } from '../helpers/graph-assertions.ts';
import { createWorkspace } from '../testkit/workspace.ts';

test('v0.1 reference pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-');
  const { workspaceRoot: resolvedWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
  const acceptanceCoveragePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const runtimeReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport);

  await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.length).toBe(3);

  await composeWorkspace(workspaceRoot);
  const installedCustomerService = await fs.readFile(
    path.join(resolvedWorkspaceRoot, 'src', 'installed', 'entity', 'customer-service.ts'),
    'utf8'
  );
  expect(installedCustomerService).toMatch(/normalizeCustomerInput/);
  expect(installedCustomerService).toMatch(/Unknown/);

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('all');
  expect(report.build.status).toBe('passed');
  expect(report.policy.status).toBe('passed');
  expect(report.fast.status).toBe('passed');
  expect(report.runtime.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  expect(locked.passStatus.emit).toBe('pending');
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.runtimeReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.policyReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.acceptanceCoverage);

  const provenance = await readJson<{
    artifacts: Array<{ path: string; originType: string }>;
  }>(provenancePath);
  expect(provenance.artifacts).toContainEqual(expect.objectContaining({
    path: 'src/installed/entity/customer-service.ts',
    originType: 'block'
  }));

  const runtimeReport = await readJson<{
    status: string;
    build: { status: string };
    acceptance: { status: string };
    logs: { stdout: string };
  }>(runtimeReportPath);
  expect(runtimeReport.status).toBe('passed');
  expect(runtimeReport.build.status).toBe('passed');
  expect(runtimeReport.acceptance.status).toBe('passed');
  expect(runtimeReport.logs.stdout).toContain('runtime-build:passed');
  expect(runtimeReport.logs.stdout).not.toContain('Duration');
  expect(runtimeReport.logs.stdout).not.toContain('Start at');

  const coverage = await readJson<{
    status: string;
    uncoveredBlocks: string[];
  }>(acceptanceCoveragePath);
  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toHaveLength(0);

  const policyReport = await readJson<{
    status: string;
    merged: { policies: Array<{ id: string; sourceScope: string; sourcePath: string; targets: string[] }> };
    violations: unknown[];
  }>(policyReportPath);
  expect(policyReport.status).toBe('passed');
  expect(policyReport.violations).toHaveLength(0);
  expect(policyReport.merged.policies.find((policy) => policy.id === 'tenant-scope-required')).toEqual({
    id: 'tenant-scope-required',
    sourceScope: 'official',
    sourcePath: 'catalog/policies/official/policy.spec.yaml',
    targets: ['src/installed/entity/customer-service.ts']
  });

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  const explainedLockState = await readJson<{ passStatus: { emit: string } }>(lockPath);
  expect(explainedLockState.passStatus.emit).toBe('succeeded');
  expectGraphNode(graph, { id: 'port:entity/customer-basic:input:tenant_context', type: 'port' });
  expectGraphNode(graph, { id: 'pin:entity/customer-basic:input:tenant_context', type: 'pin' });
  expectGraphEdge(graph, {
    from: 'block:entity/customer-basic',
    to: 'pin:entity/customer-basic:input:tenant_context',
    type: 'depends_on'
  });
  const canonicalPortNode = graph.nodes.find((node) => node.id === 'port:entity/customer-basic:input:tenant_context');
  const legacyPinNode = graph.nodes.find((node) => node.id === 'pin:entity/customer-basic:input:tenant_context');
  const canonicalPortEdge = graph.edges.find((edge) =>
    edge.from === 'block:entity/customer-basic' &&
    edge.to === 'port:entity/customer-basic:input:tenant_context' &&
    edge.type === 'requires'
  );
  const legacyPinEdge = graph.edges.find((edge) =>
    edge.from === 'block:entity/customer-basic' &&
    edge.to === 'pin:entity/customer-basic:input:tenant_context' &&
    edge.type === 'depends_on'
  );
  expect(canonicalPortNode?.references).toBeDefined();
  expect(canonicalPortEdge?.references).toBeDefined();
  expect(legacyPinNode?.references).toEqual(canonicalPortNode?.references);
  expect(legacyPinEdge?.references).toEqual(canonicalPortEdge?.references);
  expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
  expectGraphEdge(graph, {
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expectNoGraphEdge(graph, { type: 'violates' });
  expect(graph.overlays.coverage.blocks.every((entry) => Array.isArray(entry.coveredBy))).toBe(true);
  expect(reviewSummary.ciSummary.status).toBe('passed');
  expect(reviewSummary.ciSummary.failureCount).toBe(0);
  expect(reviewSummary.provenanceSummary).toMatchObject({
    overrideArtifactCount: 0,
    registryArtifactCount: expect.any(Number),
    unverifiedArtifactCount: expect.any(Number),
    originSummaryCount: expect.any(Number),
    overrideSummaryCount: expect.any(Number),
    registrySummaryCount: expect.any(Number),
    originSummaries: expect.arrayContaining([
      expect.objectContaining({ originType: 'block' })
    ])
  });
  expect(reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
  expect(reviewSummary.coverageSummary).toMatchObject({
    status: 'passed',
    blockCount: 3,
    coveredBlockCount: 3,
    uncoveredBlockCount: 0
  });
  expect(reviewSummary.failurePoints).toHaveLength(0);
  expect(reviewSummary.regressionRisks).toHaveLength(0);
  expect(reviewSummary.conflictHints).toHaveLength(0);

  const refreshedProvenance = await readJson<{
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  }>(provenancePath);
  expect(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === CI_ARTIFACT_FILES.explainGraph && artifact.generatedByPass === 'explain'
    )
  ).toBe(true);

  const explainedLock = await readJson<{ generatedPaths: string[] }>(lockPath);
  expect(explainedLock.generatedPaths).toEqual(
    expect.arrayContaining([
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.runtimeReport,
      CI_ARTIFACT_FILES.policyReport,
      CI_ARTIFACT_FILES.acceptanceCoverage,
      CI_ARTIFACT_FILES.explainGraph,
      CI_ARTIFACT_FILES.explainGraphMermaid,
      CI_ARTIFACT_FILES.explainGraphDot,
      CI_ARTIFACT_FILES.reviewSummary
    ])
  );
}, 180000);
