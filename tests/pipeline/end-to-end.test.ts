import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  initWorkspace,
  resolveWorkspace,
  composeWorkspace,
  adaptWorkspace,
  verifyWorkspace,
  lockWorkspace,
  explainWorkspace
} from '../../platform/orchestrator.ts';
import { writeLocalViews } from '../../platform/compiler/emit/write-local-views.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
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
  expect(locked.generatedPaths).toContain('control/evidence/runtime-report.json');
  expect(locked.generatedPaths).toContain('control/evidence/policy-report.json');
  expect(locked.generatedPaths).toContain('control/evidence/acceptance-coverage.json');

  const provenance = JSON.parse(
    await fs.readFile(provenancePath, 'utf8')
  ) as { artifacts: Array<{ path: string; originType: string }> };
  expect(
    provenance.artifacts.some(
      (artifact) => artifact.path === 'custom/customer_normalizer.ts' && artifact.originType === 'slot'
    )
  ).toBe(true);

  const runtimeReport = JSON.parse(
    await fs.readFile(runtimeReportPath, 'utf8')
  ) as { status: string; build: { status: string }; acceptance: { status: string }; logs: { stdout: string } };
  expect(runtimeReport.status).toBe('passed');
  expect(runtimeReport.build.status).toBe('passed');
  expect(runtimeReport.acceptance.status).toBe('passed');
  expect(runtimeReport.logs.stdout).toContain('runtime-build:passed');
  expect(runtimeReport.logs.stdout).not.toContain('Duration');
  expect(runtimeReport.logs.stdout).not.toContain('Start at');

  const coverage = JSON.parse(
    await fs.readFile(acceptanceCoveragePath, 'utf8')
  ) as { status: string; uncoveredBlocks: string[]; uncoveredSlots: string[] };
  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(coverage.uncoveredSlots).toEqual([]);

  const policyReport = JSON.parse(
    await fs.readFile(policyReportPath, 'utf8')
  ) as { status: string; merged: { policies: Array<{ id: string; sourceScope: string; sourcePath: string; targets: string[] }> }; violations: unknown[] };
  expect(policyReport.status).toBe('passed');
  expect(policyReport.violations).toEqual([]);
  expect(policyReport.merged.policies.find((policy) => policy.id === 'tenant-scope-required')).toEqual({
    id: 'tenant-scope-required',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml',
    targets: ['src/installed/entity/customer-service.ts']
  });

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expect(graph.nodes.some((node) => node.id === 'slot:customer_normalizer')).toBe(true);
  expect(graph.nodes.some((node) => node.type === 'pin')).toBe(true);
  expect(graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
  expect(graph.edges).toContainEqual({
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expect(graph.edges.some((edge) => edge.type === 'writes_to' && edge.to === 'file:source/code/slots/customer_normalizer.ts')).toBe(true);
  expect(
    graph.edges.some(
      (edge) =>
        edge.type === 'connects_to' &&
        edge.from === 'file:source/code/slots/customer_normalizer.ts' &&
        edge.to === 'file:custom/customer_normalizer.ts'
    )
  ).toBe(true);
  expect(graph.edges.some((edge) => edge.type === 'violates')).toBe(false);
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

  const refreshedProvenance = JSON.parse(
    await fs.readFile(provenancePath, 'utf8')
  ) as { artifacts: Array<{ path: string; generatedByPass?: string }> };
  expect(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === 'control/graph/explain-graph.json' && artifact.generatedByPass === 'explain'
    )
  ).toBe(true);

  const explainedLock = JSON.parse(
    await fs.readFile(lockPath, 'utf8')
  ) as { generatedPaths: string[] };
  expect(explainedLock.generatedPaths).toEqual(
    expect.arrayContaining([
      'control/evidence/verification-report.json',
      'control/evidence/runtime-report.json',
      'control/evidence/policy-report.json',
      'control/evidence/acceptance-coverage.json',
      'control/graph/explain-graph.json',
      'control/evidence/review-summary.json',
      'control/workbench/views/source-view.html',
      'control/workbench/views/slot-rule-view.html'
    ])
  );
}, 180000);
