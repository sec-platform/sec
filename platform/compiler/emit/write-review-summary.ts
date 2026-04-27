import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import type { CiArtifactManifest } from './ci-artifacts.ts';
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
  PolicyReport,
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

async function readArtifactSummary(workspaceRoot: string): Promise<ReviewSummary['artifactSummary']> {
  const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(ciArtifactsPath))) {
    return undefined;
  }
  const manifest = await readJson<CiArtifactManifest>(ciArtifactsPath);
  return {
    ...manifest.summary,
    ...(manifest.uploadGroups.length > 0 ? { uploadGroups: manifest.uploadGroups } : {}),
    ...(manifest.missing.length > 0 ? { missing: manifest.missing } : {})
  };
}

function buildCoverageSummary(coverage: AcceptanceCoverageReport): ReviewSummary['coverageSummary'] {
  const blockSummaries = coverage.blocks
    .map((entry) => ({
      id: entry.id,
      declaredAcceptanceCount: entry.declaredAcceptance.length,
      coveredByCount: entry.coveredBy.length,
      declaredAcceptance: unique(entry.declaredAcceptance),
      coveredBy: unique(entry.coveredBy)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const slotSummaries = coverage.slots
    .map((entry) => ({
      id: entry.id,
      declaredAcceptanceCount: entry.declaredAcceptance.length,
      coveredByCount: entry.coveredBy.length,
      declaredAcceptance: unique(entry.declaredAcceptance),
      coveredBy: unique(entry.coveredBy)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    status: coverage.status,
    acceptancePassedCount: coverage.acceptancePassed.length,
    blockCount: coverage.blocks.length,
    slotCount: coverage.slots.length,
    coveredBlockCount: coverage.blocks.length - coverage.uncoveredBlocks.length,
    coveredSlotCount: coverage.slots.length - coverage.uncoveredSlots.length,
    uncoveredBlockCount: coverage.uncoveredBlocks.length,
    uncoveredSlotCount: coverage.uncoveredSlots.length,
    acceptancePassed: unique(coverage.acceptancePassed),
    uncoveredBlocks: unique(coverage.uncoveredBlocks),
    uncoveredSlots: unique(coverage.uncoveredSlots),
    blockSummaries,
    slotSummaries
  };
}

function buildRepairSummary(repairPlan: RepairPlan): ReviewSummary['repairSummary'] {
  const taskSummaries = repairPlan.tasks
    .map((task) => {
      const targetIds = unique(task.failurePoints.flatMap((point) => point.targetIds ?? []));
      const previewStatus: 'changed' | 'unchanged' | 'missing' = task.preview
        ? task.preview.changed ? 'changed' : 'unchanged'
        : 'missing';
      return {
        taskId: task.taskId,
        sourceSlotId: task.sourceSlotId,
        targetBlock: task.targetBlock,
        targetFile: task.targetFile,
        previewStatus,
        addedLines: task.preview?.addedLines ?? 0,
        removedLines: task.preview?.removedLines ?? 0,
        failurePointCount: task.failurePoints.length,
        targetIds
      };
    })
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  const blockerSummaries = (repairPlan.blockers ?? [])
    .map((blocker) => ({
      blockerId: blocker.blockerId,
      boundary: blocker.boundary,
      reason: blocker.reason,
      decisionRequired: blocker.decisionRequired,
      failurePointCount: blocker.failurePoints.length
    }))
    .sort((left, right) => left.blockerId.localeCompare(right.blockerId));

  return {
    status: repairPlan.status,
    sourceVerificationStatus: repairPlan.sourceVerificationStatus,
    requiresVerification: repairPlan.requiresVerification,
    taskCount: repairPlan.tasks.length,
    blockerCount: repairPlan.blockers?.length ?? 0,
    previewCount: repairPlan.tasks.filter((task) => task.preview).length,
    changedPreviewCount: repairPlan.tasks.filter((task) => task.preview?.changed).length,
    failurePointCount: repairPlan.tasks.reduce(
      (total, task) => total + task.failurePoints.length,
      blockerSummaries.reduce((total, blocker) => total + blocker.failurePointCount, 0)
    ),
    targetFiles: unique(repairPlan.tasks.map((task) => task.targetFile)),
    taskSummaries,
    blockerSummaries
  };
}

function preflightSummaryGroup(checkId: string): string {
  return checkId.startsWith('migration-') ? 'migration' : checkId.split('-')[0];
}

function buildPolicySummary(policyReport: PolicyReport | null): ReviewSummary['policySummary'] {
  if (!policyReport) {
    return undefined;
  }

  const sourceSummaries = [
    ...policyReport.official.sources.map((source) => ({
      scope: 'official' as const,
      path: source.path,
      policyIds: unique(source.policyIds)
    })),
    ...policyReport.project.sources.map((source) => ({
      scope: 'project' as const,
      path: source.path,
      policyIds: unique(source.policyIds)
    }))
  ].sort((left, right) => `${left.scope}:${left.path}`.localeCompare(`${right.scope}:${right.path}`));
  const severityCounts = policyReport.violations.reduce<NonNullable<ReviewSummary['policySummary']>['severityCounts']>(
    (counts, violation) => {
      counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
      return counts;
    },
    {}
  );

  return {
    status: policyReport.status,
    officialPolicyCount: policyReport.official.policies.length,
    projectPolicyCount: policyReport.project.policies.length,
    mergedPolicyCount: policyReport.merged.policies.length,
    sourceCount: sourceSummaries.length,
    violationCount: policyReport.violations.length,
    severityCounts,
    sourceSummaries,
    mergedSummaries: policyReport.merged.policies
      .map((policy) => ({
        id: policy.id,
        sourceScope: policy.sourceScope,
        sourcePath: policy.sourcePath,
        targetCount: policy.targets.length,
        targets: unique(policy.targets)
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    violationSummaries: policyReport.violations
      .map((violation) => ({
        id: violation.id,
        severity: violation.severity,
        rule: violation.rule,
        fileCount: violation.files.length,
        files: unique(violation.files),
        appliesTo: unique(violation.appliesTo),
        message: violation.message,
        sourceScope: violation.sourceScope,
        sourcePath: violation.sourcePath
      }))
      .sort((left, right) => `${left.id}:${left.rule}:${left.message}`.localeCompare(`${right.id}:${right.rule}:${right.message}`))
  };
}

function buildUpgradeSummary(
  upgradePlan: UpgradePlan | null,
  diagnostics: UpgradeDiagnostics | null
): ReviewSummary['upgradeSummary'] {
  if (!upgradePlan && !diagnostics) {
    return undefined;
  }

  if (!upgradePlan && diagnostics) {
    return {
      status: 'blocked',
      blockId: diagnostics.blockId,
      toVersion: diagnostics.targetVersion,
      preflightCheckCount: 0,
      preflightEvidenceCount: 0,
      migrationCount: 0,
      migrationKindCounts: {},
      requiresVerification: false,
      requiresVerificationCount: 0,
      impactCount: 0,
      impacts: [],
      preflightSummaries: [],
      migrationSummaries: [],
      diagnostics: {
        status: diagnostics.status,
        failedCheck: diagnostics.failedCheck,
        errorCode: diagnostics.errorCode,
        message: diagnostics.message
      }
    };
  }

  const plan = upgradePlan as UpgradePlan;
  const migrationKindCounts = Object.keys(plan.migrationKindCounts).length > 0
    ? plan.migrationKindCounts
    : plan.migrationSummaries.reduce<Record<string, number>>((counts, migration) => {
        counts[migration.kind] = (counts[migration.kind] ?? 0) + 1;
        return counts;
      }, {});
  const preflightGroups = plan.preflightChecks.reduce<Map<string, { checkCount: number; evidenceCount: number }>>(
    (groups, check) => {
      const group = preflightSummaryGroup(check.id);
      const current = groups.get(group) ?? { checkCount: 0, evidenceCount: 0 };
      current.checkCount += 1;
      current.evidenceCount += check.evidence.length;
      groups.set(group, current);
      return groups;
    },
    new Map()
  );
  const requiresVerificationCount = plan.migrationSummaries.filter(
    (migration) => migration.requiresVerification
  ).length;

  return {
    status: diagnostics ? 'blocked' : plan.status,
    blockId: plan.blockId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    preflightCheckCount: plan.preflightChecks.length,
    preflightEvidenceCount: plan.preflightChecks.reduce(
      (total, check) => total + check.evidence.length,
      0
    ),
    migrationCount: plan.migrationSummaries.length,
    migrationKindCounts,
    requiresVerification: requiresVerificationCount > 0 || plan.status === 'applied',
    requiresVerificationCount,
    impactCount: plan.impacts.length,
    impacts: unique(plan.impacts),
    preflightSummaries: [...preflightGroups.entries()]
      .map(([group, summary]) => ({ group, ...summary }))
      .sort((left, right) => left.group.localeCompare(right.group)),
    migrationSummaries: plan.migrationSummaries
      .map((migration) => ({
        id: migration.id,
        kind: migration.kind,
        target: migration.target,
        reason: migration.reason,
        requiresVerification: migration.requiresVerification,
        ...(migration.source ? { source: migration.source } : {}),
        ...(migration.slotId ? { slotId: migration.slotId } : {})
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    ...(diagnostics
      ? {
          diagnostics: {
            status: diagnostics.status,
            failedCheck: diagnostics.failedCheck,
            errorCode: diagnostics.errorCode,
            message: diagnostics.message
          }
        }
      : {})
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
  const { policyReportPath, repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const policyReport = (await pathExists(policyReportPath))
    ? await readJson<PolicyReport>(policyReportPath)
    : null;
  const repairPlan = (await pathExists(repairPlanPath))
    ? await readJson<RepairPlan>(repairPlanPath)
    : null;
  const upgradePlan = (await pathExists(upgradePlanPath))
    ? await readJson<UpgradePlan>(upgradePlanPath)
    : null;
  const upgradeDiagnostics = (await pathExists(upgradeDiagnosticsPath))
    ? await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath)
    : null;
  const coverageSummary = buildCoverageSummary(coverage);
  const policySummary = buildPolicySummary(policyReport);
  const repairSummary = repairPlan ? buildRepairSummary(repairPlan) : undefined;
  const upgradeSummary = buildUpgradeSummary(upgradePlan, upgradeDiagnostics);
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

  if (upgradePlan) {
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

  if (upgradeDiagnostics) {
    addFailurePoint(failurePoints, {
      lane: 'all',
      kind: 'upgrade',
      message: `Upgrade blocked at ${upgradeDiagnostics.failedCheck}: ${upgradeDiagnostics.errorCode} ${upgradeDiagnostics.message}`,
      artifactPath: 'generated/upgrade-diagnostics.json'
    });
  }

  if (repairPlan) {
    if (repairPlan.requiresVerification) {
      addRegressionRisk(regressionRisks, {
        kind: 'repair-verification',
        message: 'Repair applied and requires verification rerun'
      });
    }
    for (const blocker of repairPlan.blockers ?? []) {
      addFailurePoint(failurePoints, {
        lane: 'all',
        kind: 'repair',
        artifactPath: 'generated/repair-plan.json',
        message: `Repair blocked at ${blocker.boundary}: ${blocker.reason}`
      });
      addConflictHint(conflictHints, {
        kind: 'repair-blocked',
        relatedId: blocker.blockerId,
        message: `Repair blocked: ${blocker.reason}; decision ${blocker.decisionRequired}`
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
  const artifactSummary = await readArtifactSummary(workspaceRoot);
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
    ...(artifactSummary ? { artifactSummary } : {}),
    coverageSummary,
    ...(policySummary ? { policySummary } : {}),
    ...(repairSummary ? { repairSummary } : {}),
    ...(upgradeSummary ? { upgradeSummary } : {}),
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
