import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import {
  buildRuntimeAttribution,
  buildRuntimeAttributions,
  buildVerticalSliceAttributions,
  classifyRuntimeEntry,
  detectVerticalFromPath
} from './runtime-attribution.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  ReviewConflictHint,
  ReviewInstallImpact,
  RepairPlan,
  ReviewFailurePoint,
  ReviewRegressionRisk,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport,
  VerificationStepReport
} from '../../shared/types.ts';

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareFailurePoints(left: ReviewFailurePoint, right: ReviewFailurePoint): number {
  return `${left.kind}:${left.lane}:${left.message}:${left.artifactPath}`.localeCompare(
    `${right.kind}:${right.lane}:${right.message}:${right.artifactPath}`
  );
}

function compareRegressionRisks(left: ReviewRegressionRisk, right: ReviewRegressionRisk): number {
  return `${left.kind}:${left.blockId ?? ''}:${left.slotId ?? ''}:${left.message}`.localeCompare(
    `${right.kind}:${right.blockId ?? ''}:${right.slotId ?? ''}:${right.message}`
  );
}

function compareConflictHints(left: ReviewConflictHint, right: ReviewConflictHint): number {
  return `${left.kind}:${left.relatedId}:${left.message}`.localeCompare(
    `${right.kind}:${right.relatedId}:${right.message}`
  );
}

function addFailurePoint(
  points: ReviewFailurePoint[],
  point: ReviewFailurePoint
): void {
  if (
    !points.some(
      (entry) =>
        entry.lane === point.lane &&
        entry.kind === point.kind &&
        entry.message === point.message &&
        entry.artifactPath === point.artifactPath
    )
  ) {
    points.push(point);
  }
}

function addRegressionRisk(
  risks: ReviewRegressionRisk[],
  risk: ReviewRegressionRisk
): void {
  if (
    !risks.some(
      (entry) =>
        entry.kind === risk.kind &&
        entry.message === risk.message &&
        entry.blockId === risk.blockId &&
        entry.slotId === risk.slotId
    )
  ) {
    risks.push(risk);
  }
}

function addConflictHint(
  hints: ReviewConflictHint[],
  hint: ReviewConflictHint
): void {
  if (
    !hints.some(
      (entry) =>
        entry.kind === hint.kind &&
        entry.relatedId === hint.relatedId &&
        entry.message === hint.message
    )
  ) {
    hints.push(hint);
  }
}

function addFailedTargets(
  points: ReviewFailurePoint[],
  lane: ReviewFailurePoint['lane'],
  kind: ReviewFailurePoint['kind'],
  step: VerificationStepReport,
  label: string,
  artifactPath: string
): void {
  for (const target of step.failed) {
    addFailurePoint(points, {
      lane,
      kind,
      message: `${label}: ${target}`,
      artifactPath
    });
  }
}

function mapOverrideTarget(
  lock: LockFile,
  target: string
): Pick<ReviewRegressionRisk, 'blockId' | 'slotId'> {
  const slotTask = lock.slotTasks.find((task) => task.target === target);
  if (slotTask) {
    return {
      blockId: slotTask.block,
      slotId: slotTask.id
    };
  }

  const installStep = lock.installPlan.find((step) => step.to === target);
  if (installStep) {
    return {
      blockId: installStep.blockId
    };
  }

  const runtimeEntry = buildRuntimeAttribution(lock, target);
  if (runtimeEntry?.relatedBlocks.length) {
    const verticalBlock = runtimeEntry.vertical ? `${runtimeEntry.vertical}/basic` : null;
    return {
      blockId:
        verticalBlock && runtimeEntry.relatedBlocks.includes(verticalBlock)
          ? verticalBlock
          : runtimeEntry.relatedBlocks[0]
    };
  }

  return {};
}

function buildReviewCiSummary(
  failurePoints: ReviewFailurePoint[],
  regressionRisks: ReviewRegressionRisk[],
  conflictHints: ReviewConflictHint[],
  impactedBlocks: string[],
  impactedSlots: string[],
  runtimeEntries: ReviewSummary['runtimeEntries']
): ReviewSummary['ciSummary'] {
  const failureCount = failurePoints.length;
  const regressionRiskCount = regressionRisks.length;
  const conflictHintCount = conflictHints.length;
  return {
    status: failureCount > 0 ? 'failed' : regressionRiskCount > 0 || conflictHintCount > 0 ? 'attention' : 'passed',
    failureCount,
    regressionRiskCount,
    conflictHintCount,
    impactedBlockCount: impactedBlocks.length,
    impactedSlotCount: impactedSlots.length,
    runtimeEntryCount: runtimeEntries.length
  };
}

function buildInstallImpacts(lock: LockFile): ReviewInstallImpact[] {
  const impacts = new Map<string, ReviewInstallImpact>();

  for (const step of lock.installPlan) {
    let impact = impacts.get(step.blockId);
    if (!impact) {
      impact = {
        blockId: step.blockId,
        actionKinds: [],
        sourceRoots: [],
        targetPaths: [],
        verticals: [],
        runtimeEntries: []
      };
      impacts.set(step.blockId, impact);
    }

    impact.actionKinds = unique([...impact.actionKinds, step.action]);
    impact.sourceRoots = unique([...impact.sourceRoots, step.sourceRoot]);
    impact.targetPaths = unique([...impact.targetPaths, step.to]);

    const vertical = detectVerticalFromPath(step.to) ?? detectVerticalFromPath(step.blockId);
    if (vertical) {
      impact.verticals = unique([...impact.verticals, vertical]);
    }

    if (classifyRuntimeEntry(step.to)) {
      impact.runtimeEntries = unique([...impact.runtimeEntries, step.to]);
    }
  }

  return [...impacts.values()].sort((left, right) => left.blockId.localeCompare(right.blockId));
}

export async function buildReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport
): Promise<ReviewSummary> {
  const { repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const failurePoints: ReviewFailurePoint[] = [];
  const regressionRisks: ReviewRegressionRisk[] = [];
  const conflictHints: ReviewConflictHint[] = [];

  if (report.summary.failedLanes.length > 0) {
    addFailurePoint(failurePoints, {
      lane: 'all',
      kind: 'summary',
      message: `Verification failed in lanes: ${report.summary.failedLanes.join(', ')}`,
      artifactPath: 'generated/verification-report.json'
    });
  }

  for (const violation of report.fast.policy.violations) {
    addFailurePoint(failurePoints, {
      lane: 'fast',
      kind: 'policy',
      message: `Policy ${violation.id}: ${violation.message}`,
      artifactPath: 'generated/policy-report.json'
    });
  }

  if (report.fast.build.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'fast',
      kind: 'build',
      message: 'Fast-lane typecheck failed',
      artifactPath: 'generated/verification-report.json'
    });
  }
  if (report.fast.unit.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'fast',
      kind: 'unit',
      message: 'Fast-lane unit tests failed',
      artifactPath: 'generated/verification-report.json'
    });
  }
  if (report.fast.acceptance.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'fast',
      kind: 'acceptance',
      message: 'Fast-lane acceptance tests failed',
      artifactPath: 'generated/verification-report.json'
    });
    for (const target of report.fast.acceptance.failed) {
      addFailurePoint(failurePoints, {
        lane: 'fast',
        kind: 'acceptance',
        message: `Fast-lane acceptance test failed: ${target}`,
        artifactPath: 'generated/verification-report.json'
      });
    }
  }
  if (report.runtime.build.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'runtime',
      kind: 'build',
      message: 'Runtime build failed',
      artifactPath: 'generated/runtime-report.json'
    });
    addFailedTargets(
      failurePoints,
      'runtime',
      'build',
      report.runtime.build,
      'Runtime build failed',
      'generated/runtime-report.json'
    );
  }
  if (report.runtime.unit.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'runtime',
      kind: 'unit',
      message: 'Runtime unit tests failed',
      artifactPath: 'generated/runtime-report.json'
    });
    addFailedTargets(
      failurePoints,
      'runtime',
      'unit',
      report.runtime.unit,
      'Runtime unit test failed',
      'generated/runtime-report.json'
    );
  }
  if (report.runtime.acceptance.status === 'failed') {
    addFailurePoint(failurePoints, {
      lane: 'runtime',
      kind: 'acceptance',
      message: 'Runtime acceptance tests failed',
      artifactPath: 'generated/runtime-report.json'
    });
    addFailedTargets(
      failurePoints,
      'runtime',
      'acceptance',
      report.runtime.acceptance,
      'Runtime acceptance test failed',
      'generated/runtime-report.json'
    );
  }

  for (const blockId of coverage.uncoveredBlocks) {
    addRegressionRisk(regressionRisks, {
      kind: 'coverage-gap',
      blockId,
      message: `Block ${blockId} has no runtime acceptance coverage`
    });
  }

  for (const slotId of coverage.uncoveredSlots) {
    addRegressionRisk(regressionRisks, {
      kind: 'coverage-gap',
      slotId,
      message: `Slot ${slotId} has no runtime acceptance coverage`
    });
  }

  for (const override of overrideManifest.overrides) {
    addRegressionRisk(regressionRisks, {
      kind: 'override-active',
      message: `Override active: ${override.id} -> ${override.target}`,
      ...mapOverrideTarget(lock, override.target)
    });

    for (const conflict of override.conflictsWith) {
      addConflictHint(conflictHints, {
        kind: 'override-conflict',
        relatedId: conflict,
        message: `Override ${override.id} conflicts with ${conflict}`
      });
    }
  }

  if (await pathExists(upgradePlanPath)) {
    const upgradePlan = await readJson<UpgradePlan>(upgradePlanPath);
    addConflictHint(conflictHints, {
      kind: 'upgrade-plan-present',
      relatedId: upgradePlan.blockId,
      message:
        upgradePlan.status === 'applied'
          ? `Upgrade plan applied, verify pending: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
          : `Upgrade plan present: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
    });
    if (upgradePlan.preflightChecks.length > 0) {
      addConflictHint(conflictHints, {
        kind: 'upgrade-preflight-passed',
        relatedId: upgradePlan.blockId,
        message: `Upgrade preflight passed: ${upgradePlan.preflightChecks.map((check) => check.id).join(', ')}`
      });
    }
    for (const impact of upgradePlan.impacts) {
      addRegressionRisk(regressionRisks, {
        kind: 'upgrade-impact',
        blockId: upgradePlan.blockId,
        message: `Upgrade ${upgradePlan.blockId} impacts ${impact}`
      });
    }
    for (const migration of upgradePlan.migrationSummaries) {
      if (!migration.requiresVerification) {
        continue;
      }
      addRegressionRisk(regressionRisks, {
        kind: 'upgrade-verification',
        blockId: upgradePlan.blockId,
        message: `Upgrade migration ${migration.id} requires verification for ${migration.target}`
      });
    }
  }

  if (await pathExists(upgradeDiagnosticsPath)) {
    const diagnostics = await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
    addFailurePoint(failurePoints, {
      lane: 'all',
      kind: 'upgrade',
      message: `Upgrade blocked at ${diagnostics.failedCheck}: ${diagnostics.errorCode} ${diagnostics.message}`,
      artifactPath: 'generated/upgrade-diagnostics.json'
    });
  }

  if (await pathExists(repairPlanPath)) {
    const repairPlan = await readJson<RepairPlan>(repairPlanPath);
    if (repairPlan.requiresVerification) {
      addRegressionRisk(regressionRisks, {
        kind: 'repair-verification',
        message: 'Repair applied and requires verification rerun'
      });
    }
    for (const task of repairPlan.tasks) {
      const preview = task.preview
        ? `; preview ${task.preview.changed ? 'changed' : 'unchanged'} +${task.preview.addedLines}/-${task.preview.removedLines}`
        : '';
      const targetIds = unique(task.failurePoints.flatMap((point) => point.targetIds ?? []));
      const targets = targetIds.length > 0 ? `; targets ${targetIds.join(', ')}` : '';
      addConflictHint(conflictHints, {
        kind: 'repair-plan-present',
        relatedId: task.taskId,
        message:
          repairPlan.status === 'applied'
            ? `Repair task applied, verify pending: ${task.taskId} -> ${task.targetFile}${preview}${targets}`
            : `Repair task pending: ${task.taskId} -> ${task.targetFile}${preview}${targets}`
      });
    }
  }

  const runtimeEntries = buildRuntimeAttributions(lock, provenance.artifacts.map((artifact) => artifact.path));
  const runtimeEntryByPath = new Map(runtimeEntries.map((entry) => [entry.path, entry]));
  const installImpacts = buildInstallImpacts(lock);
  const impactedBlocks = unique(lock.resolvedBlocks.map((block) => block.id));
  const impactedSlots = unique(lock.slotTasks.map((task) => task.id));
  const sortedFailurePoints = [...failurePoints].sort(compareFailurePoints);
  const sortedRegressionRisks = [...regressionRisks].sort(compareRegressionRisks);
  const sortedConflictHints = [...conflictHints].sort(compareConflictHints);

  return {
    formatVersion: '2',
    ciSummary: buildReviewCiSummary(
      sortedFailurePoints,
      sortedRegressionRisks,
      sortedConflictHints,
      impactedBlocks,
      impactedSlots,
      runtimeEntries
    ),
    changeSources: provenance.artifacts.map((artifact) => {
      const runtimeEntry = runtimeEntryByPath.get(artifact.path);
      return {
        path: artifact.path,
        originType: artifact.originType,
        originId: artifact.originId,
        ...(artifact.registrySourceId
          ? {
              registrySourceId: artifact.registrySourceId,
              registryKind: artifact.registryKind,
              registryLocation: artifact.registryLocation
            }
          : {}),
        ...(runtimeEntry
          ? {
              runtimeKind: runtimeEntry.kind,
              ...(runtimeEntry.vertical ? { vertical: runtimeEntry.vertical } : {}),
              relatedBlocks: runtimeEntry.relatedBlocks
            }
          : {})
      };
    }),
    runtimeEntries,
    verticalSlices: buildVerticalSliceAttributions(runtimeEntries),
    installImpacts,
    impactedBlocks,
    impactedSlots,
    failurePoints: sortedFailurePoints,
    regressionRisks: sortedRegressionRisks,
    conflictHints: sortedConflictHints
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
  await fs.mkdir(path.dirname(reviewSummaryPath), { recursive: true });
  await fs.writeFile(reviewSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return summary;
}
