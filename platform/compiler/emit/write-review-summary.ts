import { groupBy } from 'lodash-es';
import type { AcceptanceCoverageEntry, AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { countMatching, summarizeCounts, uniqueSorted } from '../../shared/collections.ts';
import { writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { OverrideStatus, ProvenanceFile, ProvenanceOriginType } from '../../shared/provenance-types.ts';
import type { RepairPlan, RepairTaskCategory } from '../../shared/repair-types.ts';
import { buildReviewChainSummary } from '../../shared/review-matrix.ts';
import { buildReviewPolicySummary } from '../../shared/review-policy.ts';
import type {
  ReviewConflictHint,
  ReviewFailurePoint,
  ReviewInstallImpact,
  ReviewRegressionRisk,
  ReviewRepairVerificationTrace,
  ReviewSummary
} from '../../shared/review-types.ts';
import { buildReviewUpgradeSummary, upgradeDiagnosticsAttributionParts } from '../../shared/review-upgrade.ts';
import type { UpgradeDiagnostics } from '../../shared/upgrade-types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import { readReviewArtifactSummary } from './read-review-artifact-summary.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import {
  buildRuntimeAttribution,
  buildRuntimeAttributions,
  buildVerticalSliceAttributions,
  classifyRuntimeEntry,
  detectVerticalFromPath
} from './runtime-attribution.ts';

function failurePointKey(point: ReviewFailurePoint): string {
  return `${point.kind}:${point.lane}:${point.message}:${point.artifactPath}`;
}

function regressionRiskKey(risk: ReviewRegressionRisk): string {
  return `${risk.kind}:${risk.blockId ?? ''}:${risk.slotId ?? ''}:${risk.message}`;
}

function conflictHintKey(hint: ReviewConflictHint): string {
  return `${hint.kind}:${hint.relatedId}:${hint.message}`;
}

function compareByKey<T>(key: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => key(left).localeCompare(key(right));
}

const compareFailurePoints = compareByKey(failurePointKey);
const compareRegressionRisks = compareByKey(regressionRiskKey);
const compareConflictHints = compareByKey(conflictHintKey);

function addUnique<T>(values: T[], value: T, key: (value: T) => string): void {
  const valueKey = key(value);
  if (!values.some((entry) => key(entry) === valueKey)) {
    values.push(value);
  }
}

function addFailurePoint(points: ReviewFailurePoint[], point: ReviewFailurePoint): void {
  addUnique(points, point, failurePointKey);
}

function addRegressionRisk(risks: ReviewRegressionRisk[], risk: ReviewRegressionRisk): void {
  addUnique(risks, risk, regressionRiskKey);
}

function addConflictHint(hints: ReviewConflictHint[], hint: ReviewConflictHint): void {
  addUnique(hints, hint, conflictHintKey);
}

type VerificationFailurePointSpec = {
  lane: ReviewFailurePoint['lane'];
  kind: ReviewFailurePoint['kind'];
  status: 'passed' | 'failed' | 'skipped';
  summaryMessage: string;
  artifactPath: string;
  failedTargets?: readonly string[];
  targetMessage?: string;
};

function addVerificationFailurePoint(points: ReviewFailurePoint[], spec: VerificationFailurePointSpec): void {
  if (spec.status !== 'failed') return;
  addFailurePoint(points, { lane: spec.lane, kind: spec.kind, message: spec.summaryMessage, artifactPath: spec.artifactPath });
  if (spec.targetMessage) {
    for (const target of spec.failedTargets ?? []) {
      addFailurePoint(points, { lane: spec.lane, kind: spec.kind, message: `${spec.targetMessage}: ${target}`, artifactPath: spec.artifactPath });
    }
  }
}

function mapOverrideTarget(lock: LockFile, target: string): Pick<ReviewRegressionRisk, 'blockId' | 'slotId'> {
  const slotTask = lock.slotTasks.find((task) => task.target === target);
  if (slotTask) return { blockId: slotTask.block, slotId: slotTask.id };
  const installStep = lock.installPlan.find((step) => step.to === target);
  if (installStep) return { blockId: installStep.blockId };
  const runtimeEntry = buildRuntimeAttribution(lock, target);
  if (runtimeEntry?.relatedBlocks.length) {
    const verticalBlock = runtimeEntry.vertical ? `${runtimeEntry.vertical}/basic` : null;
    return { blockId: verticalBlock && runtimeEntry.relatedBlocks.includes(verticalBlock) ? verticalBlock : runtimeEntry.relatedBlocks[0] };
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
    failureCount, regressionRiskCount, conflictHintCount,
    impactedBlockCount: impactedBlocks.length, impactedSlotCount: impactedSlots.length, runtimeEntryCount: runtimeEntries.length
  };
}

function buildPathGroupSummaries<T, K extends string, S>(
  values: readonly T[],
  key: (value: T) => K,
  buildSummary: (group: K, values: readonly T[]) => S,
  sortKey: (summary: S) => string
): S[] {
  const groups = groupBy([...values], key);
  return Object.entries(groups)
    .map(([group, groupValues]) => buildSummary(group as K, groupValues))
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)));
}

function buildCoverageTargetSummaries(
  entries: readonly AcceptanceCoverageEntry[]
): NonNullable<ReviewSummary['coverageSummary']>['blockSummaries'] {
  return entries
    .map((entry) => ({
      id: entry.id,
      declaredAcceptanceCount: entry.declaredAcceptance.length,
      coveredByCount: entry.coveredBy.length,
      declaredAcceptance: uniqueSorted(entry.declaredAcceptance),
      coveredBy: uniqueSorted(entry.coveredBy)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildCoverageSummary(coverage: AcceptanceCoverageReport): NonNullable<ReviewSummary['coverageSummary']> {
  return {
    status: coverage.status,
    acceptancePassedCount: coverage.acceptancePassed.length,
    blockCount: coverage.blocks.length,
    slotCount: coverage.slots.length,
    coveredBlockCount: coverage.blocks.length - coverage.uncoveredBlocks.length,
    coveredSlotCount: coverage.slots.length - coverage.uncoveredSlots.length,
    uncoveredBlockCount: coverage.uncoveredBlocks.length,
    uncoveredSlotCount: coverage.uncoveredSlots.length,
    acceptancePassed: uniqueSorted(coverage.acceptancePassed),
    uncoveredBlocks: uniqueSorted(coverage.uncoveredBlocks),
    uncoveredSlots: uniqueSorted(coverage.uncoveredSlots),
    blockSummaries: buildCoverageTargetSummaries(coverage.blocks),
    slotSummaries: buildCoverageTargetSummaries(coverage.slots)
  };
}

function buildProvenanceSummary(provenance: ProvenanceFile): ReviewSummary['provenanceSummary'] {
  const originSummaries = buildPathGroupSummaries(
    provenance.artifacts, (a) => a.originType,
    (originType: ProvenanceOriginType, artifacts) => ({ originType, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.originType
  );
  const overrideSummaries = buildPathGroupSummaries(
    provenance.artifacts, (a) => a.overrideStatus,
    (overrideStatus: OverrideStatus, artifacts) => ({ overrideStatus, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.overrideStatus
  );
  const registryArtifacts = provenance.artifacts.filter((a) => a.registrySourceId);
  const registrySummaries = buildPathGroupSummaries(
    registryArtifacts, (a) => a.registrySourceId ?? '',
    (registrySourceId, artifacts) => ({
      registrySourceId,
      ...(artifacts[0].registryKind ? { registryKind: artifacts[0].registryKind } : {}),
      ...(artifacts[0].registryLocation ? { registryLocation: artifacts[0].registryLocation } : {}),
      count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path))
    }),
    (s) => s.registrySourceId
  );
  const generatedPassArtifacts = provenance.artifacts.filter((a) => a.generatedByPass);
  const generatedPassSummaries = buildPathGroupSummaries(
    generatedPassArtifacts, (a) => a.generatedByPass ?? '',
    (pass, artifacts) => ({ pass, count: artifacts.length, paths: uniqueSorted(artifacts.map((a) => a.path)) }),
    (s) => s.pass
  );
  const unverifiedArtifacts = provenance.artifacts.filter((a) => a.verifiedBy.length === 0);

  return {
    artifactCount: provenance.artifacts.length,
    verifiedArtifactCount: provenance.artifacts.length - unverifiedArtifacts.length,
    unverifiedArtifactCount: unverifiedArtifacts.length,
    overrideArtifactCount: countMatching(provenance.artifacts, (a) => a.overrideStatus !== 'none'),
    registryArtifactCount: registryArtifacts.length,
    generatedArtifactCount: generatedPassArtifacts.length,
    generatedPassCount: generatedPassSummaries.length,
    originSummaryCount: originSummaries.length, originSummaries,
    overrideSummaryCount: overrideSummaries.length, overrideSummaries,
    registrySummaryCount: registrySummaries.length, registrySummaries,
    generatedPassSummaries,
    unverifiedArtifacts: uniqueSorted(unverifiedArtifacts.map((a) => a.path))
  };
}

function repairFailurePoints(repairPlan: RepairPlan) {
  return [...repairPlan.tasks.flatMap((t) => t.failurePoints), ...(repairPlan.blockers ?? []).flatMap((b) => b.failurePoints)];
}

function buildRepairFailureTaxonomy(repairPlan: RepairPlan): NonNullable<ReviewSummary['repairSummary']>['failureTaxonomy'] {
  const fps = repairFailurePoints(repairPlan);
  return {
    laneSummaries: summarizeCounts(fps.map((p) => p.lane)),
    kindSummaries: summarizeCounts(fps.map((p) => p.kind)),
    issueTypeSummaries: summarizeCounts(fps.map((p) => p.issueType)),
    repairabilitySummaries: summarizeCounts(fps.map((p) => p.repairable ? 'repairable' : 'blocked'))
  };
}

function repairTargetType(
  point: ReturnType<typeof repairFailurePoints>[number],
  targetId: string
): NonNullable<ReviewSummary['repairSummary']>['targetSummaries'][number]['targetType'] {
  if (targetId.startsWith('generated/')) return 'generated-file';
  if (targetId.startsWith('custom/') || targetId.startsWith('src/')) return point.kind === 'policy' ? 'policy-target' : 'slot-target';
  if (point.kind === 'acceptance' || targetId.endsWith('.spec.ts')) return 'acceptance-case';
  if (point.kind === 'runtime-unit' || point.kind === 'runtime-acceptance') return 'runtime-target';
  if (point.kind === 'policy') return 'policy-target';
  if (point.issueType === 'slot') return 'slot-target';
  return 'unknown';
}

function buildRepairTargetSummaries(repairPlan: RepairPlan): NonNullable<ReviewSummary['repairSummary']>['targetSummaries'] {
  const counts = new Map<string, { targetType: ReturnType<typeof repairTargetType>; count: number }>();
  for (const point of repairFailurePoints(repairPlan)) {
    for (const targetId of point.targetIds ?? []) {
      const targetType = repairTargetType(point, targetId);
      const key = `${targetType}:${targetId}`;
      const current = counts.get(key) ?? { targetType, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
  }
  return [...counts.entries()]
    .map(([key, summary]) => ({ id: key.slice(summary.targetType.length + 1), targetType: summary.targetType, count: summary.count }))
    .sort((left, right) => `${left.targetType}:${left.id}`.localeCompare(`${right.targetType}:${right.id}`));
}

function repairTaskCategory(task: RepairPlan['tasks'][number]): RepairTaskCategory {
  return task.category ?? 'slot-rewrite';
}

function repairTaskReview(task: RepairPlan['tasks'][number]): NonNullable<RepairPlan['tasks'][number]['review']> {
  const failureTargets = uniqueSorted(task.failurePoints.flatMap((p) => p.targetIds ?? []));
  return task.review ?? {
    allowedPathCount: task.allowedPaths.length, requiredSymbolCount: task.requiredSymbols.length,
    forbiddenOperationCount: task.forbiddenOperations.length, testCount: task.testsToPass.length,
    failureTargetCount: failureTargets.length,
    writeBounds: uniqueSorted(task.allowedPaths), requiredSymbols: uniqueSorted(task.requiredSymbols),
    forbiddenOperations: uniqueSorted(task.forbiddenOperations), testsToPass: uniqueSorted(task.testsToPass),
    failureTargets
  };
}

const PENDING_ACTION_MAP: Record<string, ReviewRepairVerificationTrace['nextAction']> = {
  blocked: 'resolve-blocker',
  'verify-required': 'rerun-verify',
  'repair-not-applied': 'apply-repair',
  none: 'none'
};

function buildRepairVerificationTrace(repairPlan: RepairPlan): ReviewRepairVerificationTrace {
  const pendingReason = repairPlan.status === 'blocked' ? 'blocked'
    : repairPlan.requiresVerification ? 'verify-required'
    : repairPlan.status === 'pending' ? 'repair-not-applied' : 'none';
  return { pendingReason, nextAction: PENDING_ACTION_MAP[pendingReason] };
}

function buildRepairSummary(repairPlan: RepairPlan): ReviewSummary['repairSummary'] {
  const taskSummaries = repairPlan.tasks
    .map((task) => {
      const review = repairTaskReview(task);
      const previewStatus: 'changed' | 'unchanged' | 'missing' = task.preview
        ? task.preview.changed ? 'changed' : 'unchanged' : 'missing';
      return {
        taskId: task.taskId, category: repairTaskCategory(task), sourceSlotId: task.sourceSlotId,
        targetBlock: task.targetBlock, targetFile: task.targetFile, previewStatus,
        addedLines: task.preview?.addedLines ?? 0, removedLines: task.preview?.removedLines ?? 0,
        failurePointCount: task.failurePoints.length, targetIds: review.failureTargets,
        allowedPathCount: review.allowedPathCount, requiredSymbolCount: review.requiredSymbolCount,
        forbiddenOperationCount: review.forbiddenOperationCount, testCount: review.testCount,
        failureTargetCount: review.failureTargetCount, writeBounds: review.writeBounds,
        requiredSymbols: review.requiredSymbols, forbiddenOperations: review.forbiddenOperations,
        testsToPass: review.testsToPass, failureTargets: review.failureTargets
      };
    })
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
  const blockerSummaries = (repairPlan.blockers ?? [])
    .map((b) => ({ blockerId: b.blockerId, boundary: b.boundary, reason: b.reason, decisionRequired: b.decisionRequired, failurePointCount: b.failurePoints.length }))
    .sort((left, right) => left.blockerId.localeCompare(right.blockerId));
  const changedPreviewCount = countMatching(repairPlan.tasks, (t) => t.preview?.changed === true);
  const targetFiles = uniqueSorted(repairPlan.tasks.map((t) => t.targetFile));

  return {
    status: repairPlan.status, sourceVerificationStatus: repairPlan.sourceVerificationStatus,
    requiresVerification: repairPlan.requiresVerification, taskCount: repairPlan.tasks.length,
    blockerCount: repairPlan.blockers?.length ?? 0,
    previewCount: countMatching(repairPlan.tasks, (t) => t.preview !== undefined),
    changedPreviewCount,
    failurePointCount: repairPlan.tasks.reduce((total, t) => total + t.failurePoints.length, blockerSummaries.reduce((total, b) => total + b.failurePointCount, 0)),
    verificationTrace: buildRepairVerificationTrace(repairPlan),
    failureTaxonomy: buildRepairFailureTaxonomy(repairPlan),
    targetSummaries: buildRepairTargetSummaries(repairPlan),
    taskCategorySummaries: summarizeCounts(repairPlan.tasks.map(repairTaskCategory)),
    targetFileCount: targetFiles.length, targetFiles, taskSummaries, blockerSummaries
  };
}

function formatUpgradeDiagnosticsFailureMessage(diagnostics: UpgradeDiagnostics): string {
  const attribution = upgradeDiagnosticsAttributionParts(diagnostics.details);
  const attributionSuffix = attribution.length > 0 ? `; ${attribution.join('; ')}` : '';
  return [`Upgrade blocked at ${diagnostics.failedCheck}:`, diagnostics.errorCode, `${diagnostics.message}${attributionSuffix}`].join(' ');
}

function buildInstallImpacts(lock: LockFile): ReviewInstallImpact[] {
  const impacts = new Map<string, ReviewInstallImpact>();
  for (const step of lock.installPlan) {
    let impact = impacts.get(step.blockId);
    if (!impact) {
      impact = { blockId: step.blockId, actionKinds: [], sourceRoots: [], targetPaths: [], verticals: [], runtimeEntries: [] };
      impacts.set(step.blockId, impact);
    }
    impact.actionKinds = uniqueSorted([...impact.actionKinds, step.action]);
    impact.sourceRoots = uniqueSorted([...impact.sourceRoots, step.sourceRoot]);
    impact.targetPaths = uniqueSorted([...impact.targetPaths, step.to]);
    const vertical = detectVerticalFromPath(step.to) ?? detectVerticalFromPath(step.blockId);
    if (vertical) impact.verticals = uniqueSorted([...impact.verticals, vertical]);
    if (classifyRuntimeEntry(step.to)) impact.runtimeEntries = uniqueSorted([...impact.runtimeEntries, step.to]);
  }
  return [...impacts.values()].sort((left, right) => left.blockId.localeCompare(right.blockId));
}

function buildInstallImpactSummary(installImpacts: ReviewInstallImpact[]): ReviewSummary['installImpactSummary'] {
  const flatField = (field: keyof ReviewInstallImpact) => uniqueSorted(installImpacts.flatMap((i) => i[field] as string[]));
  const blocks = uniqueSorted(installImpacts.map((i) => i.blockId));
  const actionKinds = flatField('actionKinds');
  const sourceRoots = flatField('sourceRoots');
  const targetPaths = flatField('targetPaths');
  const verticals = flatField('verticals');
  const runtimeEntries = flatField('runtimeEntries');

  const groupMap = new Map<string, { blocks: string[]; actionKinds: string[]; runtimeEntries: string[]; targetPaths: string[] }>();
  for (const impact of installImpacts) {
    for (const vertical of impact.verticals.length > 0 ? impact.verticals : ['none']) {
      const group = groupMap.get(vertical) ?? { blocks: [], actionKinds: [], runtimeEntries: [], targetPaths: [] };
      group.blocks = uniqueSorted([...group.blocks, impact.blockId]);
      group.actionKinds = uniqueSorted([...group.actionKinds, ...impact.actionKinds]);
      group.runtimeEntries = uniqueSorted([...group.runtimeEntries, ...impact.runtimeEntries]);
      group.targetPaths = uniqueSorted([...group.targetPaths, ...impact.targetPaths]);
      groupMap.set(vertical, group);
    }
  }

  const groupSummaries = [...groupMap.entries()]
    .map(([vertical, group]) => ({
      vertical, blockCount: group.blocks.length, actionKindCount: group.actionKinds.length,
      runtimeEntryCount: group.runtimeEntries.length, targetPathCount: group.targetPaths.length,
      blocks: group.blocks, actionKinds: group.actionKinds, runtimeEntries: group.runtimeEntries, targetPaths: group.targetPaths
    }))
    .sort((left, right) => left.vertical.localeCompare(right.vertical));

  return {
    impactCount: installImpacts.length, blockCount: blocks.length, actionKindCount: actionKinds.length,
    sourceRootCount: sourceRoots.length, targetPathCount: targetPaths.length, verticalCount: verticals.length,
    runtimeEntryCount: runtimeEntries.length, groupCount: groupSummaries.length,
    blocks, actionKinds, sourceRoots, targetPaths, verticals, runtimeEntries, groupSummaries
  };
}

export async function buildReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport
): Promise<ReviewSummary> {
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const { policyReport, repairPlan, upgradePlan, upgradeDiagnostics } = await readReviewGovernanceReports(workspaceRoot);
  const coverageSummary = buildCoverageSummary(coverage);
  const provenanceSummary = buildProvenanceSummary(provenance);
  const policySummary = policyReport ? buildReviewPolicySummary(policyReport) : undefined;
  const repairSummary = repairPlan ? buildRepairSummary(repairPlan) : undefined;
  const upgradeSummary = buildReviewUpgradeSummary(upgradePlan, upgradeDiagnostics);
  const failurePoints: ReviewFailurePoint[] = [];
  const regressionRisks: ReviewRegressionRisk[] = [];
  const conflictHints: ReviewConflictHint[] = [];

  if (report.summary.failedLanes.length > 0) {
    addFailurePoint(failurePoints, { lane: 'all', kind: 'summary', message: `Verification failed in lanes: ${report.summary.failedLanes.join(', ')}`, artifactPath: CI_ARTIFACT_FILES.verificationReport });
  }

  for (const violation of report.fast.policy.violations) {
    addFailurePoint(failurePoints, { lane: 'fast', kind: 'policy', message: `Policy ${violation.id}: ${violation.message}`, artifactPath: CI_ARTIFACT_FILES.policyReport });
  }

  for (const failure of [
    { lane: 'fast', kind: 'build', status: report.fast.build.status, summaryMessage: 'Fast-lane typecheck failed', artifactPath: CI_ARTIFACT_FILES.verificationReport },
    { lane: 'fast', kind: 'unit', status: report.fast.unit.status, summaryMessage: 'Fast-lane unit tests failed', artifactPath: CI_ARTIFACT_FILES.verificationReport },
    { lane: 'fast', kind: 'acceptance', status: report.fast.acceptance.status, summaryMessage: 'Fast-lane acceptance tests failed', artifactPath: CI_ARTIFACT_FILES.verificationReport, failedTargets: report.fast.acceptance.failed, targetMessage: 'Fast-lane acceptance test failed' },
    { lane: 'runtime', kind: 'build', status: report.runtime.build.status, summaryMessage: 'Runtime build failed', artifactPath: CI_ARTIFACT_FILES.runtimeReport, failedTargets: report.runtime.build.failed, targetMessage: 'Runtime build failed' },
    { lane: 'runtime', kind: 'unit', status: report.runtime.unit.status, summaryMessage: 'Runtime unit tests failed', artifactPath: CI_ARTIFACT_FILES.runtimeReport, failedTargets: report.runtime.unit.failed, targetMessage: 'Runtime unit test failed' },
    { lane: 'runtime', kind: 'acceptance', status: report.runtime.acceptance.status, summaryMessage: 'Runtime acceptance tests failed', artifactPath: CI_ARTIFACT_FILES.runtimeReport, failedTargets: report.runtime.acceptance.failed, targetMessage: 'Runtime acceptance test failed' }
  ] satisfies VerificationFailurePointSpec[]) {
    addVerificationFailurePoint(failurePoints, failure);
  }

  for (const blockId of coverage.uncoveredBlocks) {
    addRegressionRisk(regressionRisks, { kind: 'coverage-gap', blockId, message: `Block ${blockId} has no runtime acceptance coverage` });
  }
  for (const slotId of coverage.uncoveredSlots) {
    addRegressionRisk(regressionRisks, { kind: 'coverage-gap', slotId, message: `Slot ${slotId} has no runtime acceptance coverage` });
  }

  for (const override of overrideManifest.overrides) {
    addRegressionRisk(regressionRisks, { kind: 'override-active', message: `Override active: ${override.id} -> ${override.target}`, ...mapOverrideTarget(lock, override.target) });
    for (const conflict of override.conflictsWith) {
      addConflictHint(conflictHints, { kind: 'override-conflict', relatedId: conflict, message: `Override ${override.id} conflicts with ${conflict}` });
    }
  }

  if (upgradePlan) {
    addConflictHint(conflictHints, {
      kind: 'upgrade-plan-present', relatedId: upgradePlan.blockId,
      message: upgradePlan.status === 'applied' ? `Upgrade plan applied, verify pending: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}` : `Upgrade plan present: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
    });
    if (upgradePlan.preflightChecks.length > 0) {
      addConflictHint(conflictHints, { kind: 'upgrade-preflight-passed', relatedId: upgradePlan.blockId, message: `Upgrade preflight passed: ${upgradePlan.preflightChecks.map((c) => c.id).join(', ')}` });
    }
    for (const impact of upgradePlan.impacts) {
      addRegressionRisk(regressionRisks, { kind: 'upgrade-impact', blockId: upgradePlan.blockId, message: `Upgrade ${upgradePlan.blockId} impacts ${impact}` });
    }
    for (const migration of upgradePlan.migrationSummaries) {
      if (migration.requiresVerification) {
        addRegressionRisk(regressionRisks, { kind: 'upgrade-verification', blockId: upgradePlan.blockId, message: `Upgrade migration ${migration.id} requires verification for ${migration.target}` });
      }
    }
  }

  if (upgradeDiagnostics) {
    addFailurePoint(failurePoints, { lane: 'all', kind: 'upgrade', message: formatUpgradeDiagnosticsFailureMessage(upgradeDiagnostics), artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics });
  }

  if (repairPlan) {
    if (repairPlan.requiresVerification) {
      addRegressionRisk(regressionRisks, { kind: 'repair-verification', message: 'Repair applied and requires verification rerun' });
    }
    for (const blocker of repairPlan.blockers ?? []) {
      addFailurePoint(failurePoints, { lane: 'all', kind: 'repair', artifactPath: CI_ARTIFACT_FILES.repairPlan, message: `Repair blocked at ${blocker.boundary}: ${blocker.reason}` });
      addConflictHint(conflictHints, { kind: 'repair-blocked', relatedId: blocker.blockerId, message: `Repair blocked: ${blocker.reason}; decision ${blocker.decisionRequired}` });
    }
    for (const task of repairPlan.tasks) {
      const preview = task.preview ? `; preview ${task.preview.changed ? 'changed' : 'unchanged'} +${task.preview.addedLines}/-${task.preview.removedLines}` : '';
      const targetIds = uniqueSorted(task.failurePoints.flatMap((p) => p.targetIds ?? []));
      const targets = targetIds.length > 0 ? `; targets ${targetIds.join(', ')}` : '';
      addConflictHint(conflictHints, {
        kind: 'repair-plan-present', relatedId: task.taskId,
        message: repairPlan.status === 'applied' ? `Repair task applied, verify pending: ${task.taskId} -> ${task.targetFile}${preview}${targets}` : `Repair task pending: ${task.taskId} -> ${task.targetFile}${preview}${targets}`
      });
    }
  }

  const runtimeEntries = buildRuntimeAttributions(lock, provenance.artifacts.map((a) => a.path));
  const runtimeEntryByPath = new Map(runtimeEntries.map((e) => [e.path, e]));
  const changeSources = provenance.artifacts.map((artifact) => {
    const runtimeEntry = runtimeEntryByPath.get(artifact.path);
    return {
      path: artifact.path, originType: artifact.originType, originId: artifact.originId,
      ...(artifact.sourcePath ? { sourcePath: artifact.sourcePath } : {}),
      ...(artifact.runtimeTarget ? { runtimeTarget: artifact.runtimeTarget } : {}),
      ...(artifact.registrySourceId ? { registrySourceId: artifact.registrySourceId, registryKind: artifact.registryKind, registryLocation: artifact.registryLocation } : {}),
      ...(runtimeEntry ? { runtimeKind: runtimeEntry.kind, ...(runtimeEntry.vertical ? { vertical: runtimeEntry.vertical } : {}), relatedBlocks: runtimeEntry.relatedBlocks } : {})
    };
  });
  const artifactSummary = await readReviewArtifactSummary(workspaceRoot);
  const installImpacts = buildInstallImpacts(lock);
  const installImpactSummary = buildInstallImpactSummary(installImpacts);
  const impactedBlocks = uniqueSorted(lock.resolvedBlocks.map((b) => b.id));
  const impactedSlots = uniqueSorted(lock.slotTasks.map((t) => t.id));
  const sortedFailurePoints = [...failurePoints].sort(compareFailurePoints);
  const sortedRegressionRisks = [...regressionRisks].sort(compareRegressionRisks);
  const sortedConflictHints = [...conflictHints].sort(compareConflictHints);

  return {
    formatVersion: '2',
    ciSummary: buildReviewCiSummary(sortedFailurePoints, sortedRegressionRisks, sortedConflictHints, impactedBlocks, impactedSlots, runtimeEntries),
    chainSummary: buildReviewChainSummary(report, coverageSummary, artifactSummary),
    ...(artifactSummary ? { artifactSummary } : {}),
    coverageSummary, provenanceSummary,
    ...(policySummary ? { policySummary } : {}),
    ...(repairSummary ? { repairSummary } : {}),
    ...(upgradeSummary ? { upgradeSummary } : {}),
    changeSourceCount: changeSources.length, runtimeEntryCount: runtimeEntries.length, installImpactCount: installImpacts.length,
    changeSources, runtimeEntries, verticalSlices: buildVerticalSliceAttributions(runtimeEntries),
    installImpacts, installImpactSummary, impactedBlocks, impactedSlots,
    failurePoints: sortedFailurePoints, regressionRisks: sortedRegressionRisks, conflictHints: sortedConflictHints
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
  return writeGeneratedArtifactWithLock(lockPath, lock, [CI_ARTIFACT_FILES.reviewSummary], async () => {
    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);
    await writeJson(reviewSummaryPath, summary);
    return summary;
  });
}
