import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { expectGraphEdge, expectGraphNode, expectNoGraphEdge } from '../helpers/graph-assertions.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

test('v0.1 pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-');
  const {
    acceptanceCoveragePath,
    lockPath,
    policyReportPath,
    provenancePath,
    runtimeReportPath,
    sourceViewPath,
    slotRuleViewPath
  } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.length).toBe(3);
  expect(resolvedLock.slotTasks.length).toBe(1);

  await composeWorkspace(workspaceRoot);
  const skeleton = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  expect(skeleton).toMatch(/Not implemented/);

  await adaptWorkspace(workspaceRoot);
  const synthesized = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  expect(synthesized).toMatch(/normalizeCustomerInput/);
  expect(synthesized).toMatch(/Unknown/);

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('all');
  expect(report.build.status).toBe('passed');
  expect(report.policy.status).toBe('passed');
  expect(report.fast.status).toBe('passed');
  expect(report.runtime.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  expect(locked.passStatus.emit).toBe('succeeded');
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.runtimeReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.policyReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.acceptanceCoverage);

  const provenance = await readJson<{
    artifacts: Array<{ path: string; originType: string }>;
  }>(provenancePath);
  expect(
    provenance.artifacts.some(
      (artifact) => artifact.path === 'custom/customer_normalizer.ts' && artifact.originType === 'slot'
    )
  ).toBe(true);

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
    uncoveredSlots: string[];
  }>(acceptanceCoveragePath);
  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(coverage.uncoveredSlots).toEqual([]);

  const policyReport = await readJson<{
    status: string;
    merged: { policies: Array<{ id: string; sourceScope: string; sourcePath: string; targets: string[] }> };
    violations: unknown[];
  }>(policyReportPath);
  expect(policyReport.status).toBe('passed');
  expect(policyReport.violations).toEqual([]);
  expect(policyReport.merged.policies.find((policy) => policy.id === 'tenant-scope-required')).toEqual({
    id: 'tenant-scope-required',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml',
    targets: ['src/installed/entity/customer-service.ts']
  });

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expectGraphNode(graph, { id: 'slot:customer_normalizer' });
  expectGraphNode(graph, { type: 'pin' });
  expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
  expectGraphEdge(graph, {
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expectGraphEdge(graph, { type: 'writes_to', to: 'file:source/code/slots/customer_normalizer.ts' });
  expectGraphEdge(graph, {
    type: 'connects_to',
    from: 'file:source/code/slots/customer_normalizer.ts',
    to: 'file:custom/customer_normalizer.ts'
  });
  expectNoGraphEdge(graph, { type: 'violates' });
  expect(graph.overlays.coverage.blocks.every((entry) => Array.isArray(entry.coveredBy))).toBe(true);
  expect(reviewSummary.formatVersion).toBe('2');
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
      expect.objectContaining({ originType: 'block' }),
      expect.objectContaining({ originType: 'slot' })
    ])
  });
  expect(reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
  expect(reviewSummary.coverageSummary).toMatchObject({
    status: 'passed',
    blockCount: 3,
    slotCount: 1,
    coveredBlockCount: 3,
    coveredSlotCount: 1,
    uncoveredBlockCount: 0,
    uncoveredSlotCount: 0,
    slotSummaries: [
      {
        id: 'customer_normalizer',
        coveredByCount: 2,
        coveredBy: ['tenant_only_sees_own_customers', 'user_can_create_customer']
      }
    ]
  });
  expect(reviewSummary.failurePoints).toEqual([]);
  expect(reviewSummary.regressionRisks).toEqual([]);
  expect(reviewSummary.conflictHints).toEqual([]);

  const sourceViewExists = await fs
    .access(sourceViewPath)
    .then(() => true)
    .catch(() => false);
  expect(sourceViewExists).toBe(true);

  const slotRuleViewExists = await fs
    .access(slotRuleViewPath)
    .then(() => true)
    .catch(() => false);
  expect(slotRuleViewExists).toBe(true);

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
      CI_ARTIFACT_FILES.reviewSummary,
      CI_ARTIFACT_FILES.sourceView,
      CI_ARTIFACT_FILES.slotRuleView
    ])
  );
}, 180000);
