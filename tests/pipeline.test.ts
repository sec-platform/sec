import { afterAll, expect, test } from 'vitest';
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
}, 120000);

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('v0.1 pipeline runs end to end in a temporary workspace', { timeout: 120000 }, async () => {
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
  ) as { status: string; build: { status: string }; acceptance: { status: string }; logs: { stdout: string } };
  expect(runtimeReport.status).toBe('passed');
  expect(runtimeReport.build.status).toBe('passed');
  expect(runtimeReport.acceptance.status).toBe('passed');
  expect(runtimeReport.logs.stdout).toContain('runtime-build:passed');
  expect(runtimeReport.logs.stdout).not.toContain('Duration');
  expect(runtimeReport.logs.stdout).not.toContain('Start at');

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
  expect(reviewSummary.ciSummary.status).toBe('passed');
  expect(reviewSummary.ciSummary.failureCount).toBe(0);
  expect(reviewSummary.provenanceSummary).toMatchObject({
    overrideArtifactCount: 0,
    registryArtifactCount: expect.any(Number),
    unverifiedArtifactCount: expect.any(Number),
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

test('fast lane alone does not unlock the workspace', { timeout: 20000 }, async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-fast-lane-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('fast');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');

  await expect(lockWorkspace(workspaceRoot)).rejects.toThrow();
});

test('runtime lane runs generated service tests without full browser acceptance', { timeout: 20000 }, async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-runtime-service-lane-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'runtime' });
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('runtime');
  expect(report.fast.status).toBe('skipped');
  expect(report.runtime.status).toBe('passed');
  expect(report.runtime.build.status).toBe('skipped');
  expect(report.runtime.unit.status).toBe('passed');
  expect(report.runtime.acceptance.status).toBe('skipped');
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
  expect(projectPackage.scripts['verify:runtime:service']).toBe('npm run test:unit');
  expect(projectPackage.scripts['verify:runtime:full']).toBe(
    'npm run build && npm run test:unit && npm run test:acceptance'
  );
  expect(projectPackage.scripts['verify:runtime']).toBe('npm run verify:runtime:full');
  await expect(fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8')).resolves.toContain('workers: 1');
});

test('write-local-views consumes generated artifacts from disk', { timeout: 120000 }, async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-local-views-');
  const {
    acceptanceCoveragePath,
    repairPlanPath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    upgradeDiagnosticsPath,
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
    ciSummary: {
      status: 'passed' | 'attention' | 'failed';
      failureCount: number;
      regressionRiskCount: number;
      conflictHintCount: number;
      impactedBlockCount: number;
      impactedSlotCount: number;
      runtimeEntryCount: number;
    };
    chainSummary: {
      status: 'passed' | 'attention' | 'failed';
      stageCount: number;
      passedStageCount: number;
      attentionStageCount: number;
      failedStageCount: number;
      stageSummaries: Array<{ id: string; status: string; detail: string }>;
    };
    artifactSummary?: {
      artifactStatus?: 'passed' | 'attention';
      artifactCount: number;
      governanceCount: number;
      viewCount: number;
      contractCount?: number;
      contractPaths?: string[];
      missingCount: number;
      missingReasonCounts?: Record<string, number>;
      uploadGroups?: Array<{ kind: string; count: number; paths: string[] }>;
      missing?: Array<{ path: string; reason: string; declaredBy: string }>;
    };
    coverageSummary?: {
      status: 'passed' | 'failed' | 'skipped';
      acceptancePassedCount: number;
      blockCount: number;
      slotCount: number;
      coveredBlockCount: number;
      coveredSlotCount: number;
      uncoveredBlockCount: number;
      uncoveredSlotCount: number;
      acceptancePassed: string[];
      uncoveredBlocks: string[];
      uncoveredSlots: string[];
      blockSummaries: Array<{
        id: string;
        declaredAcceptanceCount: number;
        coveredByCount: number;
        declaredAcceptance: string[];
        coveredBy: string[];
      }>;
      slotSummaries: Array<{
        id: string;
        declaredAcceptanceCount: number;
        coveredByCount: number;
        declaredAcceptance: string[];
        coveredBy: string[];
      }>;
    };
    provenanceSummary?: {
      artifactCount: number;
      verifiedArtifactCount: number;
      unverifiedArtifactCount: number;
      overrideArtifactCount: number;
      registryArtifactCount: number;
      generatedPassCount: number;
      originSummaries: Array<{ originType: string; count: number; paths: string[] }>;
      overrideSummaries: Array<{ overrideStatus: string; count: number; paths: string[] }>;
      registrySummaries: Array<{
        registrySourceId: string;
        registryKind?: string;
        registryLocation?: string;
        count: number;
        paths: string[];
      }>;
      generatedPassSummaries: Array<{ pass: string; count: number; paths: string[] }>;
      unverifiedArtifacts: string[];
    };
    repairSummary?: {
      status: 'pending' | 'applied' | 'skipped' | 'blocked';
      sourceVerificationStatus: 'passed' | 'failed';
      requiresVerification: boolean;
      taskCount: number;
      blockerCount: number;
      previewCount: number;
      changedPreviewCount: number;
      failurePointCount: number;
      verificationTrace: {
        pendingReason: 'repair-not-applied' | 'verify-required' | 'blocked' | 'none';
        nextAction: 'apply-repair' | 'rerun-verify' | 'resolve-blocker' | 'none';
      };
      failureTaxonomy: {
        laneSummaries: Array<{ id: string; count: number }>;
        kindSummaries: Array<{ id: string; count: number }>;
        issueTypeSummaries: Array<{ id: string; count: number }>;
        repairabilitySummaries: Array<{ id: string; count: number }>;
      };
      targetSummaries: Array<{ id: string; targetType: string; count: number }>;
      taskCategorySummaries: Array<{ id: string; count: number }>;
      targetFiles: string[];
      taskSummaries: Array<{
        taskId: string;
        sourceSlotId: string;
        targetBlock: string;
        targetFile: string;
        category: string;
        previewStatus: 'changed' | 'unchanged' | 'missing';
        addedLines: number;
        removedLines: number;
        failurePointCount: number;
        targetIds: string[];
      }>;
      blockerSummaries: Array<{
        blockerId: string;
        boundary: string;
        reason: string;
        decisionRequired: string;
        failurePointCount: number;
      }>;
    };
    upgradeSummary?: {
      status: 'planned' | 'applied' | 'blocked';
      blockId: string;
      fromVersion?: string;
      toVersion: string;
      preflightCheckCount: number;
      preflightEvidenceCount: number;
      migrationCount: number;
      migrationKindCounts: Record<string, number>;
      requiresVerification: boolean;
      requiresVerificationCount: number;
      impactCount: number;
      impacts: string[];
      verificationSummaries: Array<{ id: string; count: number }>;
      preflightSummaries: Array<{ group: string; checkCount: number; evidenceCount: number }>;
      migrationSummaries: Array<{
        id: string;
        kind: string;
        source?: string;
        target: string;
        reason: string;
        requiresVerification: boolean;
      }>;
      diagnostics?: { status: 'blocked'; failedCheck: string; errorCode: string; message: string; details?: unknown };
    };
    policySummary?: {
      status: 'passed' | 'failed' | 'skipped';
      officialPolicyCount: number;
      projectPolicyCount: number;
      mergedPolicyCount: number;
      sourceCount: number;
      violationCount: number;
      severityCounts: Record<string, number>;
      sourceSummaries: Array<{ scope: 'official' | 'project'; path: string; policyIds: string[] }>;
      mergedSummaries: Array<{ id: string; sourceScope: 'official' | 'project'; sourcePath: string; targetCount: number; targets: string[] }>;
      violationSummaries: Array<{
        id: string;
        severity: string;
        rule: string;
        fileCount: number;
        files: string[];
        appliesTo: string[];
        message: string;
        sourceScope: 'official' | 'project';
        sourcePath: string;
      }>;
    };
    runtimeEntries: Array<{ path: string; kind: 'page' | 'api'; vertical?: string; relatedBlocks: string[] }>;
    verticalSlices: Array<{ id: string; runtimeEntries: string[]; relatedBlocks: string[] }>;
    installImpacts: Array<{ blockId: string; actionKinds: string[]; sourceRoots: string[]; verticals: string[]; runtimeEntries: string[]; targetPaths: string[] }>;
    installImpactSummary: {
      impactCount: number;
      blockCount: number;
      actionKindCount: number;
      sourceRootCount: number;
      targetPathCount: number;
      verticalCount: number;
      runtimeEntryCount: number;
      groupCount: number;
      blocks: string[];
      actionKinds: string[];
      sourceRoots: string[];
      targetPaths: string[];
      verticals: string[];
      runtimeEntries: string[];
      groupSummaries: Array<{
        vertical: string;
        blockCount: number;
        actionKindCount: number;
        runtimeEntryCount: number;
        targetPathCount: number;
        blocks: string[];
        actionKinds: string[];
        runtimeEntries: string[];
        targetPaths: string[];
      }>;
    };
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
  reviewSummary.ciSummary = {
    ...reviewSummary.ciSummary,
    status: 'failed',
    failureCount: reviewSummary.failurePoints.length
  };
  reviewSummary.chainSummary = {
    status: 'failed',
    stageCount: 4,
    passedStageCount: 2,
    attentionStageCount: 1,
    failedStageCount: 1,
    stageSummaries: [
      { id: 'verification', status: 'failed', detail: 'lane=fast; failed=fast' },
      { id: 'coverage', status: 'failed', detail: 'blocks=1/2; slots=1/1' },
      { id: 'artifacts', status: 'attention', detail: 'total=7; missing=1' },
      { id: 'review', status: 'passed', detail: 'review-summary=generated' }
    ]
  };
  reviewSummary.provenanceSummary = {
    artifactCount: 4,
    verifiedArtifactCount: 1,
    unverifiedArtifactCount: 3,
    overrideArtifactCount: 1,
    registryArtifactCount: 1,
    generatedPassCount: 3,
    originSummaries: [
      {
        originType: 'block',
        count: 1,
        paths: ['src/installed/auth/session.ts']
      },
      {
        originType: 'override',
        count: 1,
        paths: ['app/tickets/page.tsx']
      }
    ],
    overrideSummaries: [
      {
        overrideStatus: 'manual',
        count: 1,
        paths: ['app/tickets/page.tsx']
      },
      {
        overrideStatus: 'none',
        count: 3,
        paths: ['custom/customer_normalizer.ts', 'generated/review-summary.json', 'src/installed/auth/session.ts']
      }
    ],
    registrySummaries: [
      {
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        count: 1,
        paths: ['src/installed/auth/session.ts']
      }
    ],
    generatedPassSummaries: [
      {
        pass: 'compose',
        count: 2,
        paths: ['app/tickets/page.tsx', 'src/installed/auth/session.ts']
      },
      {
        pass: 'review',
        count: 1,
        paths: ['generated/review-summary.json']
      }
    ],
    unverifiedArtifacts: ['app/tickets/page.tsx', 'custom/customer_normalizer.ts', 'generated/review-summary.json']
  };
  reviewSummary.coverageSummary = {
    status: 'failed',
    acceptancePassedCount: 2,
    blockCount: 2,
    slotCount: 1,
    coveredBlockCount: 1,
    coveredSlotCount: 1,
    uncoveredBlockCount: 1,
    uncoveredSlotCount: 0,
    acceptancePassed: ['disk-driven-acceptance', 'slot <coverage> & smoke'],
    uncoveredBlocks: ['entity/customer-basic'],
    uncoveredSlots: [],
    blockSummaries: [
      {
        id: 'entity/customer-basic',
        declaredAcceptanceCount: 2,
        coveredByCount: 1,
        declaredAcceptance: ['disk-driven-acceptance', 'missing-block-coverage'],
        coveredBy: ['disk-driven-acceptance']
      },
      {
        id: 'tenant/basic-workspace',
        declaredAcceptanceCount: 1,
        coveredByCount: 0,
        declaredAcceptance: ['missing-block-coverage'],
        coveredBy: []
      }
    ],
    slotSummaries: [
      {
        id: 'customer_normalizer',
        declaredAcceptanceCount: 1,
        coveredByCount: 1,
        declaredAcceptance: ['slot <coverage> & smoke'],
        coveredBy: ['slot <coverage> & smoke']
      }
    ]
  };
  reviewSummary.artifactSummary = {
    artifactStatus: 'attention',
    artifactCount: 7,
    governanceCount: 5,
    viewCount: 2,
    contractCount: 1,
    contractPaths: ['generated/postgres-contract.json'],
    missingCount: 1,
    missingReasonCounts: {
      'declared-generated-missing': 1,
      'fixed-governance-missing': 0,
      'fixed-view-missing': 0
    },
    uploadGroups: [
      {
        kind: 'governance',
        count: 5,
        paths: ['generated/review-summary.json', 'generated/ci-artifacts.json']
      },
      {
        kind: 'view',
        count: 2,
        paths: ['generated/views/source-view.html', 'generated/views/slot-rule-view.html']
      }
    ],
    missing: [
      {
        path: 'generated/missing-<artifact>.json',
        reason: 'declared-generated-missing',
        declaredBy: 'graph.lock.json'
      }
    ]
  };
  reviewSummary.repairSummary = {
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    taskCount: 1,
    blockerCount: 1,
    previewCount: 1,
    changedPreviewCount: 1,
    failurePointCount: 2,
    verificationTrace: {
      pendingReason: 'repair-not-applied',
      nextAction: 'apply-repair'
    },
    failureTaxonomy: {
      laneSummaries: [{ id: 'fast', count: 2 }],
      kindSummaries: [
        { id: 'policy', count: 1 },
        { id: 'unit', count: 1 }
      ],
      issueTypeSummaries: [
        { id: 'slot', count: 1 },
        { id: 'spec', count: 1 }
      ],
      repairabilitySummaries: [
        { id: 'blocked', count: 1 },
        { id: 'repairable', count: 1 }
      ]
    },
    targetSummaries: [
      { id: 'customer-normalizer.test.ts', targetType: 'slot-target', count: 1 }
    ],
    taskCategorySummaries: [{ id: 'slot-rewrite', count: 1 }],
    targetFiles: ['custom/customer_normalizer.ts'],
    taskSummaries: [
      {
        taskId: 'repair_customer_normalizer',
        sourceSlotId: 'customer_normalizer',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/customer_normalizer.ts',
        category: 'slot-rewrite',
        previewStatus: 'changed',
        addedLines: 4,
        removedLines: 1,
        failurePointCount: 1,
        targetIds: ['customer-normalizer.test.ts']
      }
    ],
    blockerSummaries: [
      {
        blockerId: 'repair_blocker_policy',
        boundary: 'spec',
        reason: 'policy <boundary> & manual decision',
        decisionRequired: 'Decide whether policy/spec or project code changes first',
        failurePointCount: 1
      }
    ]
  };
  reviewSummary.policySummary = {
    status: 'failed',
    officialPolicyCount: 1,
    projectPolicyCount: 1,
    mergedPolicyCount: 2,
    sourceCount: 2,
    violationCount: 1,
    severityCounts: {
      error: 1
    },
    sourceSummaries: [
      {
        scope: 'official',
        path: 'platform/policies/official/policy.spec.yaml',
        policyIds: ['tenant-scope-required']
      },
      {
        scope: 'project',
        path: 'project/policies/custom.spec.yaml',
        policyIds: ['project-only']
      }
    ],
    mergedSummaries: [
      {
        id: 'project-only',
        sourceScope: 'project',
        sourcePath: 'project/policies/custom.spec.yaml',
        targetCount: 1,
        targets: ['custom/customer_normalizer.ts']
      },
      {
        id: 'tenant-scope-required',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml',
        targetCount: 1,
        targets: ['src/installed/entity/customer-service.ts']
      }
    ],
    violationSummaries: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        rule: 'tenant_context_must_flow_to_query',
        fileCount: 1,
        files: ['src/installed/entity/customer-service.ts'],
        appliesTo: ['entity/customer-basic'],
        message: 'disk-only <policy> & violation',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      }
    ]
  };
  reviewSummary.upgradeSummary = {
    status: 'blocked',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    preflightCheckCount: 5,
    preflightEvidenceCount: 3,
    migrationCount: 1,
    migrationKindCounts: {
      'file-replace': 1
    },
    requiresVerification: true,
    requiresVerificationCount: 1,
    impactCount: 1,
    impacts: ['src/installed/auth/session.ts'],
    verificationSummaries: [
      { id: 'required', count: 1 },
      { id: 'skipped', count: 0 }
    ],
    preflightSummaries: [
      {
        group: 'migration',
        checkCount: 2,
        evidenceCount: 1
      },
      {
        group: 'override',
        checkCount: 1,
        evidenceCount: 0
      }
    ],
    migrationSummaries: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh <session> & expose version metadata.',
        requiresVerification: true,
        source: 'files/src/installed/auth/session.ts'
      }
    ],
    diagnostics: {
      status: 'blocked',
      failedCheck: 'override-conflicts',
      errorCode: 'UPGRADE-CONFLICT-001',
      message: 'Override <hotfix> & blocks upgrade',
      details: {
        failedCheck: 'override-conflicts',
        overrideId: 'manual-auth-session-hotfix'
      }
    }
  };
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
        requiresVerification: false,
        tasks: [
          {
            taskId: 'repair_customer_normalizer',
            taskKind: 'repair-slot',
            phase: 'repair',
            sourceSlotId: 'customer_normalizer',
            targetBlock: 'entity/customer-basic',
            targetFile: 'custom/customer_normalizer.ts',
            allowedPaths: ['custom/customer_normalizer.ts'],
            requiredSymbols: ['normalizeCustomerInput'],
            forbiddenOperations: ['write outside custom/customer_normalizer.ts'],
            testsToPass: [],
            failureSummary: 'unit <failed> & needs repair',
            failurePoints: [
              {
                lane: 'fast',
                kind: 'unit',
                issueType: 'slot',
                repairable: true,
                artifactPath: 'tests/unit',
                message: 'unit <failed> & needs repair',
                targetIds: ['customer-normalizer.test.ts']
              }
            ],
            preview: {
              beforeLines: 1,
              afterLines: 4,
              addedLines: 4,
              removedLines: 1,
              changed: true
            }
          }
        ],
        blockers: [
          {
            blockerId: 'repair_blocker_policy',
            boundary: 'spec',
            reason: 'policy <boundary> & manual decision',
            decisionRequired: 'Decide whether policy/spec or project code changes first',
            failurePoints: [
              {
                lane: 'fast',
                kind: 'policy',
                issueType: 'spec',
                repairable: false,
                artifactPath: 'generated/policy-report.json',
                message: 'policy <boundary> & manual decision',
                targetIds: ['tenant-scope-required']
              }
            ]
          }
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await fs.writeFile(
    upgradeDiagnosticsPath,
    `${JSON.stringify(
      {
        formatVersion: '1',
        status: 'blocked',
        blockId: 'auth/basic-session',
        targetVersion: '0.1.1',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001',
        message: 'Override <hotfix> & blocks upgrade',
        details: {
          failedCheck: 'override-conflicts',
          overrideId: 'manual-auth-session-hotfix'
        }
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
        preflightChecks: [
          {
            id: 'version-range',
            status: 'passed',
            message: 'Upgrade path 0.1.0 -> 0.1.1 is allowed',
            evidence: ['0.1.x']
          },
          {
            id: 'migration-entries',
            status: 'passed',
            message: '0 migration entries loaded and validated',
            evidence: []
          },
          {
            id: 'migration-targets',
            status: 'passed',
            message: '1 migration paths checked',
            evidence: ['mig-auth-session-refresh:target:src/installed/auth/session.ts:exists']
          },
          {
            id: 'impact-scan',
            status: 'passed',
            message: '1 upgrade impacts calculated',
            evidence: ['src/installed/auth/session.ts']
          },
          {
            id: 'override-conflicts',
            status: 'passed',
            message: '0 overrides scanned with no conflicts',
            evidence: []
          }
        ],
        impacts: ['src/installed/auth/session.ts'],
        migrations: [],
        migrationKindCounts: {
          'file-replace': 1
        },
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
  expect(sourceView).toContain('href="slot-rule-view.html"');
  expect(sourceView).toContain('href="source-view.html" aria-current="page"');
  expect(slotRuleView).toContain('href="source-view.html"');
  expect(slotRuleView).toContain('href="slot-rule-view.html" aria-current="page"');
  expect(sourceView).toContain('CI Summary');
  expect(sourceView).toContain('<td>Status</td><td>failed</td>');
  expect(sourceView).toContain('<td>Chain Status</td><td>failed</td>');
  expect(sourceView).toContain('<td>Chain Stages</td><td>2/4</td>');
  expect(sourceView).toContain('E2E Chain Summary');
  expect(sourceView).toContain('<th>Evidence</th>');
  expect(sourceView).toContain('<td>verification</td>');
  expect(sourceView).toContain('<td>lane=fast; failed=fast</td>');
  expect(sourceView).toContain('<td>ci=failed, failures=1</td>');
  expect(sourceView).toContain('<td>blocks=1/2, slots=1/1</td>');
  expect(sourceView).toContain('<td>total=7, missing=1</td>');
  expect(sourceView).toContain('<td>review-summary=generated</td>');
  expect(sourceView).toContain('<td>Artifact Status</td><td>attention</td>');
  expect(sourceView).toContain('<td>Artifacts</td><td>7</td>');
  expect(sourceView).toContain('<td>Upload Groups</td><td>2</td>');
  expect(sourceView).toContain('<td>Missing Artifacts</td><td>1</td>');
  expect(sourceView).toContain('<td>Missing Reason Types</td><td>1</td>');
  expect(sourceView).toContain('Provenance Summary');
  expect(sourceView).toContain('<td>Artifacts</td><td>4</td>');
  expect(sourceView).toContain('<td>Override Artifacts</td><td>1</td>');
  expect(sourceView).toContain('Provenance Origin Summary');
  expect(sourceView).toContain('Provenance Override Summary');
  expect(sourceView).toContain('Provenance Registry Summary');
  expect(sourceView).toContain('app/tickets/page.tsx');
  expect(sourceView).toContain('Acceptance Coverage Summary');
  expect(sourceView).toContain('<td>Acceptance Passed</td><td>2</td>');
  expect(sourceView).toContain('<td>Covered Blocks</td><td>1</td>');
  expect(sourceView).toContain('<td>Uncovered Blocks</td><td>1</td>');
  expect(sourceView).toContain('Block Coverage Summary');
  expect(sourceView).toContain('Slot Coverage Summary');
  expect(sourceView).toContain('slot &lt;coverage&gt; &amp; smoke');
  expect(sourceView).toContain('Missing Reason Summary');
  expect(sourceView).toContain('declared-generated-missing');
  expect(sourceView).toContain('<td>Contract Artifacts</td><td>1</td>');
  expect(sourceView).toContain('<td>Contract Paths</td><td>generated/postgres-contract.json</td>');
  expect(sourceView).toContain('Artifact Upload Groups');
  expect(sourceView).toContain('generated/review-summary.json, generated/ci-artifacts.json');
  expect(sourceView).toContain('generated/views/source-view.html, generated/views/slot-rule-view.html');
  expect(sourceView).toContain('Missing Artifact Diagnostics');
  expect(sourceView).toContain('generated/missing-&lt;artifact&gt;.json');
  expect(sourceView).toContain('declared-generated-missing');
  expect(sourceView).toContain('graph.lock.json');
  expect(sourceView).toContain('Vertical Summary');
  expect(sourceView).toContain('Block Combination Summary');
  expect(sourceView).toContain('<th>Verticals</th><th>Runtime Entries</th>');
  expect(sourceView).toContain('<td>entity/customer-basic</td>');
  expect(sourceView).toContain('<td>customer</td>');
  expect(sourceView).toContain('<td>app/customers/page.tsx</td>');
  expect(sourceView).toContain('Failure Focus');
  expect(sourceView).toContain('Failure Groups');
  expect(sourceView).toContain('Failure Details');
  expect(sourceView).toContain('<th>Lane</th><th>Kind</th><th>Count</th><th>Artifacts</th>');
  expect(sourceView).toContain('<td>fast</td>\n          <td>policy</td>\n          <td>1</td>\n          <td>generated/policy-report.json</td>');
  expect(sourceView).toContain('Review Runtime Attribution');
  expect(sourceView).toContain('Runtime Groups');
  expect(sourceView).toContain('Runtime Entries');
  expect(sourceView).toContain('<th>Vertical</th><th>Kind</th><th>Count</th><th>Related Blocks</th>');
  expect(sourceView).toContain('<td>customer</td>\n          <td>api</td>');
  expect(sourceView).toContain('entity/customer-basic');
  expect(sourceView).toContain('Install Impact Summary');
  expect(sourceView).toContain('<td>Impacts</td><td>3</td>');
  expect(sourceView).toContain('<td>Target Paths</td><td>6</td>');
  expect(sourceView).toContain('Impact Groups');
  expect(sourceView).toContain('Impact Details');
  expect(sourceView).toContain('Policy Summary');
  expect(sourceView).toContain('<td>Official Policies</td><td>1</td>');
  expect(sourceView).toContain('<td>Project Policies</td><td>1</td>');
  expect(sourceView).toContain('<td>Merged Policies</td><td>2</td>');
  expect(sourceView).toContain('<td>Violations</td><td>1</td>');
  expect(sourceView).toContain('Policy Severity Summary');
  expect(sourceView).toContain('<td>error</td><td>1</td>');
  expect(sourceView).toContain('Policy Source Summary');
  expect(sourceView).toContain('project/policies/custom.spec.yaml');
  expect(sourceView).toContain('Policy Merge Summary');
  expect(sourceView).toContain('custom/customer_normalizer.ts');
  expect(sourceView).toContain('Policy Violation Summary');
  expect(sourceView).toContain('disk-only &lt;policy&gt; &amp; violation');
  expect(sourceView).toContain('<th>Vertical</th><th>Blocks</th><th>Actions</th><th>Runtime Entries</th><th>Targets</th>');
  expect(sourceView).toContain('<td>customer</td>\n          <td>1</td>');
  expect(sourceView).toContain('app/customers/page.tsx');
  expect(sourceView).toContain('src/installed/entity/customer-service.ts');
  expect(sourceView).toContain('customer');
  expect(sourceView).toContain('customers');
  expect(sourceView).toContain('disk-only &lt;failure&gt; &amp; &quot;point&quot;');
  expect(sourceView).toContain('Upgrade Summary');
  expect(sourceView).toContain('<td>Status</td><td>blocked</td>');
  expect(sourceView).toContain('<td>Preflight Checks</td><td>5</td>');
  expect(sourceView).toContain('<td>Preflight Evidence</td><td>3</td>');
  expect(sourceView).toContain('<td>Verification Migrations</td><td>1</td>');
  expect(sourceView).toContain('Upgrade Preflight Summary');
  expect(sourceView).toContain('<td>override</td>');
  expect(sourceView).toContain('Upgrade Migration Kind Summary');
  expect(sourceView).toContain('Upgrade Verification Summary');
  expect(sourceView).toContain('<th>Verification</th><th>Count</th>');
  expect(sourceView).toContain('<td>required</td><td>1</td>');
  expect(sourceView).toContain('<td>skipped</td><td>0</td>');
  expect(sourceView).toContain('Upgrade Migration Summary');
  expect(sourceView).toContain(
    '<th>ID</th><th>Kind</th><th>Source</th><th>Target</th><th>Slot</th><th>Requires Verification</th><th>Reason</th>'
  );
  expect(sourceView).toContain('files/src/installed/auth/session.ts');
  expect(sourceView).toContain('Upgrade Blocker Summary');
  expect(sourceView).toContain('Upgrade Plan');
  expect(sourceView).toContain('Preflight Summary');
  expect(sourceView).toContain('<td>migration</td><td>2</td><td>1</td>');
  expect(sourceView).toContain('Migration Kind Summary');
  expect(sourceView).toContain('<td>file-replace</td><td>1</td>');
  expect(sourceView).toContain('Preflight Checks');
  expect(sourceView).toContain('version-range');
  expect(sourceView).toContain('impact-scan');
  expect(sourceView).toContain('auth/basic-session 0.1.0 -&gt; 0.1.1 (planned)');
  expect(sourceView).toContain('Refresh &lt;session&gt; &amp; expose version metadata.');
  expect(sourceView).toContain('Upgrade Diagnostics');
  expect(sourceView).toContain('UPGRADE-CONFLICT-001');
  expect(sourceView).toContain('Override &lt;hotfix&gt; &amp; blocks upgrade');
  expect(sourceView).toContain('manual-auth-session-hotfix');
  expect(sourceView).toContain('&quot;failedCheck&quot;: &quot;override-conflicts&quot;');
  expect(sourceView).toContain('Repair Summary');
  expect(sourceView).toContain('<td>Status</td><td>pending</td>');
  expect(sourceView).toContain('<td>Changed Previews</td><td>1</td>');
  expect(sourceView).toContain('<td>Failure Points</td><td>2</td>');
  expect(sourceView).toContain('<td>Trace Pending Reason</td><td>repair-not-applied</td>');
  expect(sourceView).toContain('<td>Trace Next Action</td><td>apply-repair</td>');
  expect(sourceView).toContain('Repair Failure Taxonomy');
  expect(sourceView).toContain('<th>Issue Type</th><th>Count</th>');
  expect(sourceView).toContain('<td>spec</td><td>1</td>');
  expect(sourceView).toContain('<td>repairable</td><td>1</td>');
  expect(sourceView).toContain('Repair Task Category Summary');
  expect(sourceView).toContain('<th>Category</th><th>Count</th>');
  expect(sourceView).toContain('<td>slot-rewrite</td><td>1</td>');
  expect(sourceView).toContain('Repair Target Attribution Summary');
  expect(sourceView).toContain('<th>Type</th><th>Target</th><th>Count</th>');
  expect(sourceView).toContain('<td>slot-target</td>');
  expect(sourceView).toContain('<td>customer-normalizer.test.ts</td>');
  expect(sourceView).toContain('Repair Task Summary');
  expect(sourceView).toContain('Repair Blocker Summary');
  expect(sourceView).toContain('Repair Plan');
  expect(sourceView).toContain('requires verification: false');
  expect(sourceView).toContain('Blockers');
  expect(sourceView).toContain('repair_blocker_policy');
  expect(sourceView).toContain('policy &lt;boundary&gt; &amp; manual decision');
  expect(sourceView).toContain('Decide whether policy/spec or project code changes first');
  expect(sourceView).toContain('Allowed Paths');
  expect(sourceView).toContain('Required Symbols');
  expect(sourceView).toContain('Forbidden Operations');
  expect(sourceView).toContain('custom/customer_normalizer.ts');
  expect(sourceView).toContain('normalizeCustomerInput');
  expect(sourceView).toContain('write outside custom/customer_normalizer.ts');
  expect(sourceView).toContain('Failure Targets');
  expect(sourceView).toContain('Category');
  expect(sourceView).toContain('customer-normalizer.test.ts');
  expect(sourceView).toContain('changed; +4/-1; 1 -&gt; 4 lines');
  expect(sourceView).toContain('repair_customer_normalizer');
  expect(sourceView).toContain('unit &lt;failed&gt; &amp; needs repair');
  expect(sourceView).not.toContain('disk-only <failure>');
  expect(sourceView).not.toContain('Refresh <session>');
  expect(sourceView).not.toContain('unit <failed>');
  expect(slotRuleView).toContain('E2E Chain Summary');
  expect(slotRuleView).toContain('<th>Evidence</th>');
  expect(slotRuleView).toContain('<td>verification</td>');
  expect(slotRuleView).toContain('<td>ci=failed, failures=1</td>');
  expect(slotRuleView).toContain('<td>blocks=1/2, slots=1/1</td>');
  expect(slotRuleView).toContain('<td>total=7, missing=1</td>');
  expect(slotRuleView).toContain('<td>review-summary=generated</td>');
  expect(slotRuleView).toContain('disk-driven-acceptance');
});
