import type { UpgradeDiagnostics } from '../../../semantics/upgrade/upgrade-artifact.ts';
import type { AcceptanceCoverageEntry, AcceptanceCoverageReport } from '../../../assurance/acceptance/coverage.ts';
import type { ProvenanceFile } from '../../../semantics/provenance/types.ts';
import type { RepairPlan, RepairTaskCategory } from '../../../semantics/repair/types.ts';
import { isCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import { countMatching, summarizeCounts } from '../../../contracts/collections.ts';
import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../../assurance/verification/contract/types.ts';
import { buildReviewPolicySummary } from '../../../assurance/verification/review/contract/policy.ts';
import type { ReviewConflictHint, ReviewFailurePoint, ReviewInstallImpact, ReviewRegressionRisk, ReviewRepairVerificationTrace, ReviewSummary } from '../../../assurance/verification/review/contract/types.ts';
import { REVIEW_SUMMARY_FORMAT_VERSION } from '../../../assurance/verification/review/contract/types.ts';
import { buildReviewUpgradeSummary, upgradeDiagnosticsAttributionParts } from '../../../assurance/verification/review/contract/upgrade.ts';
import { buildProvenanceSummary, buildSemanticViewSummary } from '../../../assurance/verification/review/summary-derivations.ts';
export { buildProvenanceSummary, buildSemanticViewSummary } from '../../../assurance/verification/review/summary-derivations.ts';
import { buildReviewChainSummary } from '../../../assurance/verification/review/matrix.ts';
import { modelRelativePath } from '../../../workspace/contract/types.ts';
import { isCanonicalWorkspaceArtifactPath, policiesRelativePath } from "../../workspace-context.ts";
import { posixPath } from '../../../contracts/relative-path.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { loadOverrideManifest } from '../../workspace/sources/load-override-manifest.ts';
import { readReviewArtifactSummary } from './read-review-artifact-summary.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import {
  buildRuntimeAttributions,
  buildVerticalSliceAttributions,
  classifyRuntimeEntry,
  type RuntimeAttribution
} from './runtime-attribution.ts';

function failurePointKey(point: ReviewFailurePoint): string {
  return `${point.kind}:${point.lane}:${point.message}:${point.artifactPath}`;
}

function regressionRiskKey(risk: ReviewRegressionRisk): string {
  return `${risk.kind}:${risk.blockId ?? ''}:${risk.message}`;
}

function conflictHintKey(hint: ReviewConflictHint): string {
  return `${hint.kind}:${hint.relatedId}:${hint.message}`;
}

function compareByKey<T>(key: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => compareCodeUnits(key(left), key(right));
}

const compareFailurePoints = compareByKey(failurePointKey);
const compareRegressionRisks = compareByKey(regressionRiskKey);
const compareConflictHints = compareByKey(conflictHintKey);

function addUnique<T>(values: Map<string, T>, value: T, key: (value: T) => string): void {
  const valueKey = key(value);
  if (!values.has(valueKey)) values.set(valueKey, value);
}

function addFailurePoint(points: Map<string, ReviewFailurePoint>, point: ReviewFailurePoint): void {
  addUnique(points, point, failurePointKey);
}

function addRegressionRisk(risks: Map<string, ReviewRegressionRisk>, risk: ReviewRegressionRisk): void {
  addUnique(risks, risk, regressionRiskKey);
}

function addConflictHint(hints: Map<string, ReviewConflictHint>, hint: ReviewConflictHint): void {
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

function addVerificationFailurePoint(points: Map<string, ReviewFailurePoint>, spec: VerificationFailurePointSpec): void {
  if (spec.status !== 'failed') return;
  addFailurePoint(points, { lane: spec.lane, kind: spec.kind, message: spec.summaryMessage, artifactPath: spec.artifactPath });
  if (spec.targetMessage) {
    for (const target of spec.failedTargets ?? []) {
      addFailurePoint(points, { lane: spec.lane, kind: spec.kind, message: `${spec.targetMessage}: ${target}`, artifactPath: spec.artifactPath });
    }
  }
}

type ReviewTargetIdentity = Readonly<{ blockId: string }>;

interface ReviewTargetIndex {
  readonly installByTarget: ReadonlyMap<string, ReviewTargetIdentity | null>;
  readonly runtimeEntryByPath: ReadonlyMap<string, RuntimeAttribution>;
}

function addUniqueTargetIdentity(
  index: Map<string, ReviewTargetIdentity | null>,
  target: string,
  identity: ReviewTargetIdentity
): void {
  const existing = index.get(target);
  if (existing === undefined && !index.has(target)) {
    index.set(target, identity);
    return;
  }
  if (existing === null || existing === undefined
    || existing.blockId !== identity.blockId) {
    index.set(target, null);
  }
}

function buildReviewTargetIndex(
  lock: LockFile,
  runtimeEntryByPath: ReadonlyMap<string, RuntimeAttribution>
): ReviewTargetIndex {
  const installByTarget = new Map<string, ReviewTargetIdentity | null>();
  for (const step of lock.installPlan) {
    addUniqueTargetIdentity(installByTarget, step.to, { blockId: step.blockId });
  }
  return { installByTarget, runtimeEntryByPath };
}

function mapOverrideTarget(
  target: string,
  index: ReviewTargetIndex
): Pick<ReviewRegressionRisk, 'blockId'> {
  const installIdentity = index.installByTarget.get(target);
  if (installIdentity) return installIdentity;
  const runtimeEntry = index.runtimeEntryByPath.get(target);
  if (runtimeEntry?.relatedBlocks.length) {
    const verticalBlock = runtimeEntry.vertical ? `${runtimeEntry.vertical}/basic` : null;
    return {
      blockId: verticalBlock && runtimeEntry.relatedBlocks.includes(verticalBlock)
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
  runtimeEntries: ReviewSummary['runtimeEntries']
): ReviewSummary['ciSummary'] {
  const failureCount = failurePoints.length;
  const regressionRiskCount = regressionRisks.length;
  const conflictHintCount = conflictHints.length;
  return {
    status: failureCount > 0 ? 'failed' : regressionRiskCount > 0 || conflictHintCount > 0 ? 'attention' : 'passed',
    failureCount, regressionRiskCount, conflictHintCount,
    impactedBlockCount: impactedBlocks.length, runtimeEntryCount: runtimeEntries.length
  };
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
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

function buildCoverageSummary(coverage: AcceptanceCoverageReport): NonNullable<ReviewSummary['coverageSummary']> {
  return {
    status: coverage.status,
    acceptancePassedCount: coverage.acceptancePassed.length,
    blockCount: coverage.blocks.length,
    coveredBlockCount: coverage.blocks.length - coverage.uncoveredBlocks.length,
    uncoveredBlockCount: coverage.uncoveredBlocks.length,
    acceptancePassed: uniqueSorted(coverage.acceptancePassed),
    uncoveredBlocks: uniqueSorted(coverage.uncoveredBlocks),
    blockSummaries: buildCoverageTargetSummaries(coverage.blocks)
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
  if (isCanonicalWorkspaceArtifactPath(targetId)) return 'generated-file';
  if (targetId.startsWith(`${posixPath(policiesRelativePath)}/`)) return 'policy-target';
  if (targetId.startsWith(`${modelRelativePath}/`)) return point.kind === 'policy' ? 'policy-target' : 'unknown';
  if (point.kind === 'acceptance' || targetId.endsWith('.spec.ts')) return 'acceptance-case';
  if (point.kind === 'runtime-unit' || point.kind === 'runtime-acceptance') return 'runtime-target';
  if (point.kind === 'policy') return 'policy-target';
  if (isCanonicalPortableLogicalPath(targetId)) return 'file-target';
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
    .sort((left, right) => compareCodeUnits(`${left.targetType}:${left.id}`, `${right.targetType}:${right.id}`));
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

function repairTaskCategory(task: RepairPlan['tasks'][number]): RepairTaskCategory {
  return task.category ?? 'file-repair';
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
        taskId: task.taskId, category: repairTaskCategory(task),
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
    .sort((left, right) => compareCodeUnits(left.taskId, right.taskId));
  const blockerSummaries = (repairPlan.blockers ?? [])
    .map((b) => ({ blockerId: b.blockerId, boundary: b.boundary, reason: b.reason, decisionRequired: b.decisionRequired, failurePointCount: b.failurePoints.length }))
    .sort((left, right) => compareCodeUnits(left.blockerId, right.blockerId));
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

interface InstallImpactAccumulator {
  readonly blockId: string;
  readonly actionKinds: Set<string>;
  readonly sourceRoots: Set<string>;
  readonly targetPaths: Set<string>;
  readonly verticals: Set<string>;
  readonly runtimeEntries: Set<string>;
}

function buildInstallImpacts(lock: LockFile): ReviewInstallImpact[] {
  const impacts = new Map<string, InstallImpactAccumulator>();
  for (const step of lock.installPlan) {
    let impact = impacts.get(step.blockId);
    if (!impact) {
      impact = {
        blockId: step.blockId,
        actionKinds: new Set<string>(),
        sourceRoots: new Set<string>(),
        targetPaths: new Set<string>(),
        verticals: new Set<string>(),
        runtimeEntries: new Set<string>()
      };
      impacts.set(step.blockId, impact);
    }
    impact.actionKinds.add(step.action);
    impact.sourceRoots.add(step.sourceRoot);
    impact.targetPaths.add(step.to);
    if (classifyRuntimeEntry(step.to)) impact.runtimeEntries.add(step.to);
  }
  return [...impacts.values()]
    .map((impact) => ({
      blockId: impact.blockId,
      actionKinds: uniqueSorted([...impact.actionKinds]),
      sourceRoots: uniqueSorted([...impact.sourceRoots]),
      targetPaths: uniqueSorted([...impact.targetPaths]),
      verticals: uniqueSorted([...impact.verticals]),
      runtimeEntries: uniqueSorted([...impact.runtimeEntries])
    }))
    .sort((left, right) => compareCodeUnits(left.blockId, right.blockId));
}

function buildInstallImpactSummary(installImpacts: ReviewInstallImpact[]): ReviewSummary['installImpactSummary'] {
  const flatField = (field: keyof ReviewInstallImpact) => uniqueSorted(installImpacts.flatMap((i) => i[field] as string[]));
  const blocks = uniqueSorted(installImpacts.map((i) => i.blockId));
  const actionKinds = flatField('actionKinds');
  const sourceRoots = flatField('sourceRoots');
  const targetPaths = flatField('targetPaths');
  const verticals = flatField('verticals');
  const runtimeEntries = flatField('runtimeEntries');

  const groupMap = new Map<string, {
    blocks: Set<string>;
    actionKinds: Set<string>;
    runtimeEntries: Set<string>;
    targetPaths: Set<string>;
  }>();
  for (const impact of installImpacts) {
    for (const vertical of impact.verticals.length > 0 ? impact.verticals : ['none']) {
      const group = groupMap.get(vertical) ?? {
        blocks: new Set<string>(),
        actionKinds: new Set<string>(),
        runtimeEntries: new Set<string>(),
        targetPaths: new Set<string>()
      };
      group.blocks.add(impact.blockId);
      for (const actionKind of impact.actionKinds) group.actionKinds.add(actionKind);
      for (const runtimeEntry of impact.runtimeEntries) group.runtimeEntries.add(runtimeEntry);
      for (const targetPath of impact.targetPaths) group.targetPaths.add(targetPath);
      groupMap.set(vertical, group);
    }
  }

  const groupSummaries = [...groupMap.entries()]
    .map(([vertical, group]) => {
      const groupBlocks = uniqueSorted([...group.blocks]);
      const groupActionKinds = uniqueSorted([...group.actionKinds]);
      const groupRuntimeEntries = uniqueSorted([...group.runtimeEntries]);
      const groupTargetPaths = uniqueSorted([...group.targetPaths]);
      return {
        vertical,
        blockCount: groupBlocks.length,
        actionKindCount: groupActionKinds.length,
        runtimeEntryCount: groupRuntimeEntries.length,
        targetPathCount: groupTargetPaths.length,
        blocks: groupBlocks,
        actionKinds: groupActionKinds,
        runtimeEntries: groupRuntimeEntries,
        targetPaths: groupTargetPaths
      };
    })
    .sort((left, right) => compareCodeUnits(left.vertical, right.vertical));

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
  const {
    policyReport,
    repairPlan,
    upgradePlan,
    upgradeExecutionTerminal,
    upgradeDiagnostics
  } = readReviewGovernanceReports(workspaceRoot);
  const attributionTargets = uniqueSorted([
    ...provenance.artifacts.map((artifact) => artifact.path),
    ...overrideManifest.overrides.map((override) => override.target)
  ]);
  const allRuntimeEntries = await buildRuntimeAttributions(lock, attributionTargets, workspaceRoot);
  const runtimeEntryByPath = new Map(allRuntimeEntries.map((entry) => [entry.path, entry] as const));
  const reviewTargetIndex = buildReviewTargetIndex(lock, runtimeEntryByPath);
  const provenancePaths = new Set(provenance.artifacts.map((artifact) => artifact.path));
  const runtimeEntries = allRuntimeEntries.filter((entry) => provenancePaths.has(entry.path));

  const coverageSummary = buildCoverageSummary(coverage);
  const provenanceSummary = buildProvenanceSummary(provenance);
  const policySummary = policyReport ? buildReviewPolicySummary(policyReport) : undefined;
  const repairSummary = repairPlan ? buildRepairSummary(repairPlan) : undefined;
  const upgradeSummary = buildReviewUpgradeSummary(
    upgradePlan,
    upgradeExecutionTerminal,
    upgradeDiagnostics
  );
  const failurePoints = new Map<string, ReviewFailurePoint>();
  const regressionRisks = new Map<string, ReviewRegressionRisk>();
  const conflictHints = new Map<string, ReviewConflictHint>();

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
  for (const override of overrideManifest.overrides) {
    addRegressionRisk(regressionRisks, {
      kind: 'override-active',
      message: `Override active: ${override.id} -> ${override.target}`,
      ...mapOverrideTarget(override.target, reviewTargetIndex)
    });
    for (const conflict of override.conflictsWith) {
      addConflictHint(conflictHints, { kind: 'override-conflict', relatedId: conflict, message: `Override ${override.id} conflicts with ${conflict}` });
    }
  }

  if (upgradePlan) {
    addConflictHint(conflictHints, {
      kind: 'upgrade-plan-present', relatedId: upgradePlan.blockId,
      message: upgradeExecutionTerminal?.settlement === 'applied'
        ? `Upgrade applied, verify pending: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
        : `Upgrade plan present: ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
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
  const artifactSummary = readReviewArtifactSummary(workspaceRoot);
  const installImpacts = buildInstallImpacts(lock);
  const installImpactSummary = buildInstallImpactSummary(installImpacts);
  const impactedBlocks = uniqueSorted(lock.resolvedBlocks.map((b) => b.id));
  const sortedFailurePoints = [...failurePoints.values()].sort(compareFailurePoints);
  const sortedRegressionRisks = [...regressionRisks.values()].sort(compareRegressionRisks);
  const sortedConflictHints = [...conflictHints.values()].sort(compareConflictHints);
  const semanticViewSummary = buildSemanticViewSummary(lock);

  return {
    formatVersion: REVIEW_SUMMARY_FORMAT_VERSION,
    ciSummary: buildReviewCiSummary(sortedFailurePoints, sortedRegressionRisks, sortedConflictHints, impactedBlocks, runtimeEntries),
    chainSummary: buildReviewChainSummary(report, coverageSummary, artifactSummary),
    ...(semanticViewSummary ? { semanticViewSummary } : {}),
    ...(artifactSummary ? { artifactSummary } : {}),
    coverageSummary, provenanceSummary,
    ...(policySummary ? { policySummary } : {}),
    ...(repairSummary ? { repairSummary } : {}),
    ...(upgradeSummary ? { upgradeSummary } : {}),
    changeSourceCount: changeSources.length, runtimeEntryCount: runtimeEntries.length, installImpactCount: installImpacts.length,
    changeSources, runtimeEntries, verticalSlices: buildVerticalSliceAttributions(runtimeEntries),
    installImpacts, installImpactSummary, impactedBlocks,
    failurePoints: sortedFailurePoints, regressionRisks: sortedRegressionRisks, conflictHints: sortedConflictHints
  };
}
