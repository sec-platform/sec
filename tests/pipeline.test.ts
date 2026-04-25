import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initWorkspace,
  resolveWorkspace,
  composeWorkspace,
  adaptWorkspace,
  verifyWorkspace,
  lockWorkspace,
  explainWorkspace
} from '../platform/orchestrator.ts';
import { writeLocalViews } from '../platform/compiler/emit/write-local-views.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('v0.1 pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-');

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
  expect(locked.generatedPaths).toContain('generated/runtime-report.json');
  expect(locked.generatedPaths).toContain('generated/policy-report.json');
  expect(locked.generatedPaths).toContain('generated/acceptance-coverage.json');

  const provenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; originType: string }> };
  expect(
    provenance.artifacts.some(
      (artifact) => artifact.path === 'custom/customer_normalizer.ts' && artifact.originType === 'slot'
    )
  ).toBe(true);

  const runtimeReport = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'runtime-report.json'), 'utf8')
  ) as { status: string; build: { status: string }; acceptance: { status: string } };
  expect(runtimeReport.status).toBe('passed');
  expect(runtimeReport.build.status).toBe('passed');
  expect(runtimeReport.acceptance.status).toBe('passed');

  const coverage = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'acceptance-coverage.json'), 'utf8')
  ) as { status: string; uncoveredBlocks: string[]; uncoveredSlots: string[] };
  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(coverage.uncoveredSlots).toEqual([]);

  const policyReport = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'policy-report.json'), 'utf8')
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
  expect(graph.edges.some((edge) => edge.type === 'writes_to' && edge.to === 'file:custom/customer_normalizer.ts')).toBe(true);
  expect(graph.edges.some((edge) => edge.type === 'violates')).toBe(false);
  expect(graph.overlays.coverage.blocks.every((entry) => Array.isArray(entry.coveredBy))).toBe(true);
  expect(reviewSummary.formatVersion).toBe('2');
  expect(reviewSummary.failurePoints).toEqual([]);
  expect(reviewSummary.regressionRisks).toEqual([]);
  expect(reviewSummary.conflictHints).toEqual([]);

  const sourceViewExists = await fs
    .access(path.join(workspaceRoot, 'project', 'generated', 'views', 'source-view.html'))
    .then(() => true)
    .catch(() => false);
  expect(sourceViewExists).toBe(true);

  const slotRuleViewExists = await fs
    .access(path.join(workspaceRoot, 'project', 'generated', 'views', 'slot-rule-view.html'))
    .then(() => true)
    .catch(() => false);
  expect(slotRuleViewExists).toBe(true);

  const refreshedProvenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; generatedByPass?: string }> };
  expect(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === 'generated/explain-graph.json' && artifact.generatedByPass === 'explain'
    )
  ).toBe(true);

  const explainedLock = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'graph.lock.json'), 'utf8')
  ) as { generatedPaths: string[] };
  expect(explainedLock.generatedPaths).toEqual(
    expect.arrayContaining([
      'generated/verification-report.json',
      'generated/runtime-report.json',
      'generated/policy-report.json',
      'generated/acceptance-coverage.json',
      'generated/explain-graph.json',
      'generated/review-summary.json',
      'generated/views/source-view.html',
      'generated/views/slot-rule-view.html'
    ])
  );
});

test('fast lane alone does not unlock the workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-fast-lane-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('fast');

  await expect(lockWorkspace(workspaceRoot)).rejects.toThrow();
});

test('compose refreshes runtime host scaffold for an existing workspace baseline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-compose-refresh-');
  const projectRoot = path.join(workspaceRoot, 'project');

  await initWorkspace(workspaceRoot, { reset: true });
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'stale-generated-project',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  const projectPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(projectPackage.scripts.build).toBe('next build --webpack');
  expect(projectPackage.scripts['verify:runtime']).toBe('npm run build && npm run test:unit && npm run test:acceptance');
});

test('write-local-views consumes generated artifacts from disk', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-local-views-');
  const {
    acceptanceCoveragePath,
    repairPlanPath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    upgradePlanPath
  } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);
  await explainWorkspace(workspaceRoot);

  const reviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
    formatVersion: '2';
    failurePoints: Array<{ lane: 'fast' | 'runtime' | 'all'; kind: string; artifactPath: string; message: string }>;
    regressionRisks: unknown[];
    conflictHints: unknown[];
  };
  reviewSummary.failurePoints = [
    {
      lane: 'fast',
      kind: 'policy',
      artifactPath: 'generated/policy-report.json',
      message: 'disk-only <failure> & "point"'
    }
  ];
  await fs.writeFile(reviewSummaryPath, `${JSON.stringify(reviewSummary, null, 2)}\n`, 'utf8');

  const coverage = JSON.parse(await fs.readFile(acceptanceCoveragePath, 'utf8')) as {
    blocks: Array<{ id: string; coveredBy: string[] }>;
    slots: Array<{ id: string; coveredBy: string[] }>;
  };
  coverage.slots[0].coveredBy = ['disk-driven-acceptance'];
  await fs.writeFile(acceptanceCoveragePath, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    repairPlanPath,
    `${JSON.stringify(
      {
        formatVersion: '1',
        status: 'pending',
        sourceVerificationStatus: 'failed',
        tasks: [
          {
            taskId: 'repair_customer_normalizer',
            taskKind: 'repair-slot',
            phase: 'repair',
            sourceSlotId: 'customer_normalizer',
            targetBlock: 'entity/customer-basic',
            targetFile: 'custom/customer_normalizer.ts',
            allowedPaths: ['custom/customer_normalizer.ts'],
            requiredSymbols: [],
            forbiddenOperations: [],
            testsToPass: [],
            failureSummary: 'unit <failed> & needs repair',
            failurePoints: []
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await fs.writeFile(
    upgradePlanPath,
    `${JSON.stringify(
      {
        formatVersion: '1',
        blockId: 'auth/basic-session',
        fromVersion: '0.1.0',
        toVersion: '0.1.1',
        status: 'planned',
        impacts: ['src/installed/auth/session.ts'],
        migrations: [],
        migrationSummaries: [
          {
            id: 'mig-auth-session-refresh',
            kind: 'file-replace',
            target: 'src/installed/auth/session.ts',
            reason: 'Refresh <session> & expose version metadata.',
            requiresVerification: true
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  await writeLocalViews(workspaceRoot);

  const sourceView = await fs.readFile(sourceViewPath, 'utf8');
  const slotRuleView = await fs.readFile(slotRuleViewPath, 'utf8');
  expect(sourceView).toContain('disk-only &lt;failure&gt; &amp; &quot;point&quot;');
  expect(sourceView).toContain('Upgrade Plan');
  expect(sourceView).toContain('auth/basic-session 0.1.0 -&gt; 0.1.1 (planned)');
  expect(sourceView).toContain('Refresh &lt;session&gt; &amp; expose version metadata.');
  expect(sourceView).toContain('Repair Plan');
  expect(sourceView).toContain('repair_customer_normalizer');
  expect(sourceView).toContain('unit &lt;failed&gt; &amp; needs repair');
  expect(sourceView).not.toContain('disk-only <failure>');
  expect(sourceView).not.toContain('Refresh <session>');
  expect(sourceView).not.toContain('unit <failed>');
  expect(slotRuleView).toContain('disk-driven-acceptance');
});
