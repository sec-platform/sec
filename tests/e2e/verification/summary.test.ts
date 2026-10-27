import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { publishReviewSummary } from '../../../src/adapters/compilation/emit/publish-review-summary.ts';
import { buildReviewSummary } from '../../../src/adapters/compilation/emit/write-review-summary.ts';
import { readJson, writeJson } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import type { AcceptanceCoverageReport } from '../../../src/assurance/acceptance/coverage.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { parseReviewSummaryJson } from '../../../src/assurance/verification/review/contract/summary.ts';
import { verifyWorkspace } from '../../../src/bootstrap/engineering/cli.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { ProvenanceFile } from '../../../src/semantics/provenance/types.ts';
import {
  buildReviewInputs
} from '../../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess, expectCliText, runCliInProcess } from '../../testkit/cli.ts';
import { createWorkspace, prepareComposedWorkspace, prepareLockedWorkspace, withTempWorkspace } from '../../testkit/workspace.ts';

// Review Summary production and durable-artifact contracts.
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
  const persistedSummary = parseReviewSummaryJson(persistedSource);

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
  expect(persistedSummary).toEqual(summary);
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
// CLI overview presentation keeps the existing runtime-heavy suite and shared locked workspace.
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

  // Only lock and graph are consumed before the missing provenance error.
  await withTempWorkspace(async (tempRoot) => {
    for (const artifact of [CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.explainGraph]) {
      const target = resolveWorkspaceArtifactPath(tempRoot, artifact);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(resolveWorkspaceArtifactPath(workspaceRoot, artifact), target);
    }
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

  expect(payload.navigation.machineArtifacts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'graph' }),
    expect.objectContaining({ id: 'verification' })
  ]));
}, 120000);
