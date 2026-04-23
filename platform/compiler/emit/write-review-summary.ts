import fs from 'node:fs/promises';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  ReviewSummary,
  UpgradePlan,
  VerificationReport
} from '../../shared/types.ts';

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export async function buildReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport
): Promise<ReviewSummary> {
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const failurePoints: string[] = [];
  const regressionRisks: string[] = [];
  const conflictHints: string[] = [];

  if (report.summary.status === 'failed') {
    failurePoints.push(`Verification failed in lanes: ${report.summary.failedLanes.join(', ')}`);
  }
  if (report.fast.policy.status === 'failed') {
    for (const violation of report.fast.policy.violations) {
      failurePoints.push(`Policy ${violation.id}: ${violation.message}`);
    }
  }
  if (report.runtime.build.status === 'failed') {
    failurePoints.push('Runtime build failed');
  }
  if (report.runtime.unit.status === 'failed') {
    failurePoints.push('Runtime unit tests failed');
  }
  if (report.runtime.acceptance.status === 'failed') {
    failurePoints.push('Runtime Playwright acceptance failed');
  }

  for (const entry of coverage.uncoveredBlocks) {
    regressionRisks.push(`Block ${entry} has no runtime acceptance coverage`);
  }
  for (const entry of coverage.uncoveredSlots) {
    regressionRisks.push(`Slot ${entry} has no runtime acceptance coverage`);
  }
  for (const override of overrideManifest.overrides) {
    regressionRisks.push(`Override active: ${override.id} -> ${override.target}`);
    for (const conflict of override.conflictsWith) {
      conflictHints.push(`Override ${override.id} conflicts with ${conflict}`);
    }
  }

  if (await pathExists(upgradePlanPath)) {
    const upgradePlan = await readJson<UpgradePlan>(upgradePlanPath);
    conflictHints.push(
      `Upgrade plan present: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
    );
  }

  return {
    formatVersion: '1',
    changeSources: provenance.artifacts.map((artifact) => ({
      path: artifact.path,
      originType: artifact.originType,
      originId: artifact.originId
    })),
    impactedBlocks: unique(lock.resolvedBlocks.map((block) => block.id)),
    impactedSlots: unique(lock.slotTasks.map((task) => task.id)),
    failurePoints: unique(failurePoints),
    regressionRisks: unique(regressionRisks),
    conflictHints: unique(conflictHints)
  };
}

export async function writeReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport
): Promise<ReviewSummary> {
  const { reviewSummaryPath, lockPath } = getWorkspacePaths(workspaceRoot);
  if (!lock.generatedPaths.includes('generated/review-summary.json')) {
    lock.generatedPaths.push('generated/review-summary.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  await fs.writeFile(reviewSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return summary;
}
