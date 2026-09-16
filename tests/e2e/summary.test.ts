import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import { publishReviewSummary } from '../../src/compiler/emit/publish-review-summary.ts';
import { buildReviewSummary } from '../../src/compiler/emit/write-review-summary.ts';
import { verifyWorkspace } from '../../src/compiler/orchestration/cli.ts';
import type { AcceptanceCoverageReport } from '../../src/semantic/acceptance/contract/types.ts';
import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { parseReviewSummaryJson, validateReviewSummary } from '../../src/verification/review/contract/summary.ts';
import { readJson, writeJson } from '../../src/workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { buildOfficialCopyInstallStep, buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import {
  buildPassingReviewCoverage,
  buildPassingReviewReport,
  buildReviewInputs,
  buildReviewLock,
  buildReviewProvenance,
  buildRuntimeVerificationReport
} from '../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess, expectCliText, runCliInProcess } from '../testkit/cli.ts';
import { createWorkspace, prepareComposedWorkspace, prepareLockedWorkspace, withTempWorkspace } from '../testkit/workspace.ts';

async function readReviewInputs(workspaceRoot: string): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
}> {
  const acceptanceCoveragePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
  const [lock, provenance, report, coverage] = await Promise.all([
    readJson<LockFile>(lockPath),
    readJson<ProvenanceFile>(provenancePath),
    readJson<VerificationReport>(verificationReportPath),
    readJson<AcceptanceCoverageReport>(acceptanceCoveragePath)
  ]);

  return { lock, provenance, report, coverage };
}

test('canonical Review Summary publication persists the artifact and generated path', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-write-');
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const reviewSummaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
  const { lock, provenance, report, coverage } = buildReviewInputs({
    lock: {
      app: { stack: 'typescript-library' },
      passStatus: { lock: 'succeeded' }
    }
  });
  await fs.mkdir(path.dirname(reviewSummaryPath), { recursive: true });
  await writeJson(lockPath, lock);

  const summary = await publishReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  const persistedLock = await readJson<LockFile>(lockPath);
  const persistedSource = await fs.readFile(reviewSummaryPath, 'utf8');
  const persistedSummary = await readJson<typeof summary>(reviewSummaryPath);

  expect(summary.ciSummary).toEqual({
    status: 'passed',
    failureCount: 0,
    regressionRiskCount: 0,
    conflictHintCount: 0,
    impactedBlockCount: 0,
    runtimeEntryCount: 0
  });
  expect(summary).toMatchObject({
    changeSourceCount: 0,
    runtimeEntryCount: 0,
    installImpactCount: 0
  });
  expect(summary.conflictHints).toHaveLength(0);
  expect(parseReviewSummaryJson(persistedSource)).toEqual(summary);
  expect(validateReviewSummary(persistedSummary)).toEqual(summary);
  expect(() => parseReviewSummaryJson(JSON.stringify({ ...persistedSummary, formatVersion: 'unknown' }))).toThrow();
  expect(() => parseReviewSummaryJson(JSON.stringify({ ...persistedSummary, undeclared: true }))).toThrow();
  const formatVersion = JSON.stringify(summary.formatVersion);
  const duplicateFormatVersion = `{"formatVersion":${formatVersion},"formatVersion":${formatVersion}}`;
  expect(() => parseReviewSummaryJson(duplicateFormatVersion)).toThrow(
    'duplicate key "formatVersion"'
  );
  await fs.writeFile(reviewSummaryPath, duplicateFormatVersion, 'utf8');
  const rejectedReview = await runCliInProcess(workspaceRoot, ['review', '--json', '--compact']);
  expect(rejectedReview.code).toBe(1);
  expect(rejectedReview.stdout).toBe('');
  expect(rejectedReview.stderr).toContain('duplicate key "formatVersion"');
  expect(persistedLock.generatedPaths).toContain(CI_ARTIFACT_FILES.reviewSummary);
}, 180000);
test('buildReviewSummary captures fast-lane policy failures as structured failure points', async () => {
  const workspaceRoot = await prepareComposedWorkspace({ prefix: 'engineering-compiler-review-fast-' });
  const projectRoot = workspaceRoot;
  const customerServicePath = path.join(
    projectRoot,
    'src',
    'installed',
    'entity',
    'customer-service.ts'
  );
  const customerService = await fs.readFile(customerServicePath, 'utf8');
  const policyViolatingCustomerService = customerService
    .replace("import { currentTenant } from '../tenant/context.ts';\n", '')
    .replaceAll('const tenantId = currentTenant(session);', 'const tenantId = session.tenantId;');
  if (policyViolatingCustomerService === customerService) {
    throw new Error('Customer service fixture no longer exposes the tenant-policy mutation boundary');
  }

  await fs.writeFile(
    customerServicePath,
    policyViolatingCustomerService,
    'utf8'
  );

  await expect(verifyWorkspace(workspaceRoot)).rejects.toThrow();

  const { lock, provenance, report, coverage } = await readReviewInputs(workspaceRoot);
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary.ciSummary.status).toBe('failed');
  expect(summary.ciSummary.failureCount).toBeGreaterThanOrEqual(2);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'all',
        kind: 'summary',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Verification failed in lanes: fast'
      },
      {
        lane: 'fast',
        kind: 'policy',
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        message: 'Policy tenant-scope-required: Tenant-scoped queries must derive tenant context and filter by tenantId.'
      }
    ])
  );
}, 180000);
test('buildReviewSummary adds failed verification targets as structured failure points', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-runtime-targets-');
  const lock = buildReviewLock({
    app: { stack: 'typescript-library' },
    resolvedBlocks: [buildOfficialResolvedBlock({ id: 'entity/customer-basic', installOrder: 1 })],
    passStatus: {
      verify: 'failed',
      repair: 'pending'
    }
  });
  const provenance = buildReviewProvenance();
  const coverage = buildPassingReviewCoverage({
    status: 'failed',
    uncoveredBlocks: ['entity/customer-basic']
  });
  const report = buildPassingReviewReport({
    fast: {
      status: 'failed',
      acceptance: {
        status: 'failed',
        passed: [],
        failed: ['tests/acceptance/customer-normalizer.test.ts', 'tests/acceptance/customer-normalizer.test.ts']
      },
      logs: { stdout: '', stderr: 'fast failed' }
    },
    runtime: buildRuntimeVerificationReport({
      status: 'failed',
      build: { passed: ['runtime unit'] },
      unit: {
        status: 'failed',
        failed: ['tests/runtime/unit/customer-runtime.test.ts', 'tests/runtime/unit/customer-runtime.test.ts']
      },
      acceptance: {
        status: 'failed',
        failed: ['tests/acceptance/customer-flow.test.ts']
      },
      logs: { stdout: '', stderr: 'runtime failed' }
    }),
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: ['fast', 'runtime']
    },
    logs: { stdout: '', stderr: 'runtime failed' }
  });

  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(
    summary.failurePoints.filter(
      (point) => point.message === 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
    )
  ).toHaveLength(1);
  expect(
    summary.failurePoints.filter((point) => point.message === 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts')
  ).toHaveLength(1);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'fast',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit tests failed'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime acceptance test failed: tests/acceptance/customer-flow.test.ts'
      }
    ])
  );
  expect(summary.regressionRisks).toContainEqual({
    kind: 'coverage-gap',
    blockId: 'entity/customer-basic',
    message: 'Block entity/customer-basic has no runtime acceptance coverage'
  });
}, 180000);
test('buildReviewSummary attributes runtime entries only from explicit ownership and capability edges', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-review-ticket-attribution-');
  const { lock, provenance, coverage, report } = buildReviewInputs({
    lock: {
      app: { stack: 'typescript-library' },
      resolvedBlocks: [
        buildOfficialResolvedBlock({ id: 'ticket/basic', installOrder: 1 }),
        buildOfficialResolvedBlock({ id: 'export/csv-basic', installOrder: 2 }),
        buildOfficialResolvedBlock({ id: 'reporting/ticket-summary', installOrder: 3 })
      ],
      installPlan: [
        buildOfficialCopyInstallStep({
          stepId: 'ticket/basic:1',
          blockId: 'ticket/basic',
          sourceRoot: 'ticket.basic',
          from: 'files/src/installed/ticket/ticket-service.ts',
          to: 'src/installed/ticket/ticket-service.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'export/csv-basic:2',
          blockId: 'export/csv-basic',
          sourceRoot: 'export.csv-basic',
          from: 'files/src/installed/export/customer-csv.ts',
          to: 'src/installed/export/customer-csv.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:3',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/src/installed/reporting/ticket-summary.ts',
          to: 'src/installed/reporting/ticket-summary.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:4',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/src/installed/reporting/ticket-summary.ts',
          to: 'src/installed/reporting/ticket-summary.ts'
        })
      ],
      generatedPaths: [
        'src/installed/ticket/ticket-service.ts',
        'src/installed/ticket/ticket-command.ts',
        'src/installed/export/customer-csv.ts',
        'src/installed/reporting/ticket-summary.ts',
        'src/installed/composed/ticket-export.ts'
      ],
      passStatus: { lock: 'succeeded' }
    },
    provenance: [
      {
        path: 'src/installed/ticket/ticket-service.ts',
        originType: 'generated',
        originId: 'src/installed/ticket/ticket-service.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/reporting/ticket-summary.ts',
        originType: 'generated',
        originId: 'src/installed/reporting/ticket-summary.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/composed/ticket-export.ts',
        originType: 'generated',
        originId: 'src/installed/composed/ticket-export.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      }
    ],
    report: {
      runtime: buildRuntimeVerificationReport(),
      summary: {
        requestedLane: 'all'
      }
    }
  });

  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary).toMatchObject({
    changeSourceCount: 3,
    runtimeEntryCount: 3,
    installImpactCount: 3
  });
  expect(summary.runtimeEntries).toEqual(
    expect.arrayContaining([
      {
        path: 'src/installed/reporting/ticket-summary.ts',
        kind: 'service',
        vertical: 'ticket',
        relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
      },
      {
        path: 'src/installed/composed/ticket-export.ts',
        kind: 'service',
        relatedBlocks: []
      }
    ])
  );
  expect(summary.verticalSlices).toEqual([
    {
      id: 'ticket',
      runtimeEntries: ['src/installed/reporting/ticket-summary.ts', 'src/installed/ticket/ticket-service.ts'],
      relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
    }
  ]);
  expect(summary.installImpacts).toEqual([
    {
      blockId: 'export/csv-basic',
      actionKinds: ['copy'],
      sourceRoots: ['export.csv-basic'],
      targetPaths: ['src/installed/export/customer-csv.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/export/customer-csv.ts']
    },
    {
      blockId: 'reporting/ticket-summary',
      actionKinds: ['copy'],
      sourceRoots: ['reporting.ticket-summary'],
      targetPaths: ['src/installed/reporting/ticket-summary.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/reporting/ticket-summary.ts']
    },
    {
      blockId: 'ticket/basic',
      actionKinds: ['copy'],
      sourceRoots: ['ticket.basic'],
      targetPaths: ['src/installed/ticket/ticket-service.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/ticket/ticket-service.ts']
    }
  ]);
  expect(summary.installImpactSummary).toEqual({
    impactCount: 3,
    blockCount: 3,
    actionKindCount: 1,
    sourceRootCount: 3,
    targetPathCount: 3,
    verticalCount: 0,
    runtimeEntryCount: 3,
    groupCount: 1,
    blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
    actionKinds: ['copy'],
    sourceRoots: ['export.csv-basic', 'reporting.ticket-summary', 'ticket.basic'],
    targetPaths: [
      'src/installed/export/customer-csv.ts',
      'src/installed/reporting/ticket-summary.ts',
      'src/installed/ticket/ticket-service.ts'
    ],
    verticals: [],
    runtimeEntries: [
      'src/installed/export/customer-csv.ts',
      'src/installed/reporting/ticket-summary.ts',
      'src/installed/ticket/ticket-service.ts'
    ],
    groupSummaries: [
      {
        vertical: 'none',
        blockCount: 3,
        actionKindCount: 1,
        runtimeEntryCount: 3,
        targetPathCount: 3,
        blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
        actionKinds: ['copy'],
        runtimeEntries: [
          'src/installed/export/customer-csv.ts',
          'src/installed/reporting/ticket-summary.ts',
          'src/installed/ticket/ticket-service.ts'
        ],
        targetPaths: [
          'src/installed/export/customer-csv.ts',
          'src/installed/reporting/ticket-summary.ts',
          'src/installed/ticket/ticket-service.ts'
        ]
      }
    ]
  });
  expect(summary.changeSources.find((source) => source.path === 'src/installed/composed/ticket-export.ts')).toEqual({
    path: 'src/installed/composed/ticket-export.ts',
    originType: 'generated',
    originId: 'src/installed/composed/ticket-export.ts',
    runtimeKind: 'service',
    relatedBlocks: []
  });
}, 180000);

// 只有 overview acceptance 被选中时才创建一次 locked + explained Workspace。
// 文件内其他 lightweight summary sentinel 不为未选择的完整 Pipeline 付费。
let sharedOverviewWorkspace: Promise<string> | null = null;

async function getSharedOverviewWorkspace(): Promise<string> {
  sharedOverviewWorkspace ??= (async () => {
    const workspaceRoot = await prepareLockedWorkspace({
      prefix: 'engineering-compiler-overview-shared-'
    });
    await expectCliSuccess(workspaceRoot, ['explain']);
    return workspaceRoot;
  })();
  return await sharedOverviewWorkspace;
}

afterAll(async () => {
  if (!sharedOverviewWorkspace) return;
  const workspaceRoot = await sharedOverviewWorkspace.catch(() => null);
  if (workspaceRoot) await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test('CLI exposes project overview as text summary and reports missing governance artifacts', async () => {
  const workspaceRoot = await getSharedOverviewWorkspace();
  await expectCliText(workspaceRoot, ['overview'], ['Project overview', 'Workspace:', 'Verification:', 'Graph:', 'Views:', 'Next:']);

  // 复制共享 workspace 的一份副本来测试"缺失产物"路径（避免污染共享状态）
  await withTempWorkspace(async (tempRoot) => {
    await fs.cp(workspaceRoot, tempRoot, { recursive: true });
    const provenancePath = resolveWorkspaceArtifactPath(tempRoot, CI_ARTIFACT_FILES.provenance);
    await fs.rm(provenancePath);
    const missingArtifactResult = await runCliInProcess(tempRoot, ['overview']);
    expect(missingArtifactResult.code).toBe(1);
    expect(missingArtifactResult.stdout).toBe('');
    expect(missingArtifactResult.stderr).toContain('Provenance report is missing');
    expect(missingArtifactResult.stderr).toContain('run the refresh chain, then bun run sec -- explain');
  });
}, 120000);

test('CLI exposes project overview as compact JSON contract', async () => {
  const workspaceRoot = await getSharedOverviewWorkspace();
  const payload = await expectCliJson<{
    formatVersion: string;
    navigation: { machineArtifacts: Array<{ id: string; path?: string }> };
  }>(workspaceRoot, ['overview', '--json', '--compact'], { formatVersion: '1' }, { compact: true });

  expect(payload.navigation.machineArtifacts[0]?.id).toBe('graph');
  expect(payload.navigation.machineArtifacts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'verification' })]));
}, 120000);
