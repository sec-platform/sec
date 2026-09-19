import { countMatching, summarizeCounts } from '../contracts/collections.ts';
import type { ExplainGraph } from '../semantics/projection/explain.ts';
import { reviewArtifactMissingReasonTypeCount, reviewArtifactUploadGroupCount } from '../assurance/verification/review/contract/artifact.ts';
import type { ReviewSummary } from '../assurance/verification/review/contract/types.ts';
import { upgradeDiagnosticsAttributionParts } from '../assurance/verification/review/contract/upgrade.ts';
import type { E2eMatrix } from '../assurance/verification/review/matrix.ts';
import { projectE2eMatrix } from './e2e-matrix-inspect.ts';

export type ExplainSummarySource = Readonly<{
  graph: ExplainGraph;
  reviewSummary: ReviewSummary;
  e2eMatrix: E2eMatrix;
}>;

function copyCounts(entries: readonly { id: string; count: number }[]) {
  return entries.map(({ id, count }) => ({ id, count }));
}

/** Project the live explanation without retaining mutable graph or review objects.
 * The caller supplies the matrix already used by the JSON response, so text and
 * machine output cannot derive different matrix instances for one result. */
export function projectExplainSummary(graph: ExplainGraph, summary: ReviewSummary, matrix: E2eMatrix) {
  const coverage = summary.coverageSummary;
  const provenance = summary.provenanceSummary;
  const artifacts = summary.artifactSummary;
  const policy = summary.policySummary;
  const repair = summary.repairSummary;
  const upgrade = summary.upgradeSummary;
  const ci = summary.ciSummary;
  const chain = summary.chainSummary;
  const install = summary.installImpactSummary;

  return {
    graph: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypeCounts: summarizeCounts(graph.nodes.map((node) => node.type)),
      edgeTypeCounts: summarizeCounts(graph.edges.map((edge) => edge.type)),
      provenanceOriginCounts: summarizeCounts(graph.overlays.provenance.map((artifact) => artifact.originType))
    },
    blockCount: coverage?.blockCount ?? graph.overlays.coverage.blocks.length,
    uncoveredBlocks: coverage?.uncoveredBlockCount ?? countMatching(graph.overlays.coverage.blocks, (block) => block.coveredBy.length === 0),
    coverageSummary: coverage ? {
      status: coverage.status,
      acceptancePassedCount: coverage.acceptancePassedCount,
      coveredBlockCount: coverage.coveredBlockCount,
      blockCount: coverage.blockCount
    } : null,
    ciSummary: {
      status: ci.status,
      failureCount: ci.failureCount,
      regressionRiskCount: ci.regressionRiskCount,
      conflictHintCount: ci.conflictHintCount,
      impactedBlockCount: ci.impactedBlockCount,
      runtimeEntryCount: ci.runtimeEntryCount
    },
    chainSummary: {
      status: chain.status,
      passedStageCount: chain.passedStageCount,
      stageCount: chain.stageCount,
      attentionStageCount: chain.attentionStageCount,
      failedStageCount: chain.failedStageCount
    },
    e2eMatrix: projectE2eMatrix(matrix),
    installImpactSummary: {
      impactCount: install.impactCount,
      groupCount: install.groupCount,
      actionKinds: [...install.actionKinds],
      runtimeEntryCount: install.runtimeEntryCount,
      targetPathCount: install.targetPathCount
    },
    provenanceSummary: provenance ? {
      artifactCount: provenance.artifactCount,
      overrideArtifactCount: provenance.overrideArtifactCount,
      registryArtifactCount: provenance.registryArtifactCount,
      unverifiedArtifactCount: provenance.unverifiedArtifactCount
    } : null,
    artifactSummary: artifacts ? {
      artifactStatus: artifacts.artifactStatus ?? 'passed',
      artifactCount: artifacts.artifactCount,
      missingCount: artifacts.missingCount,
      missingReasonTypeCount: reviewArtifactMissingReasonTypeCount(artifacts),
      contractCount: artifacts.contractCount ?? 0,
      uploadGroupCount: reviewArtifactUploadGroupCount(artifacts),
      uploadGroups: artifacts.uploadGroups?.map(({ kind, count }) => ({ kind, count })) ?? []
    } : null,
    policySummary: policy ? {
      status: policy.status,
      officialPolicyCount: policy.officialPolicyCount,
      projectPolicyCount: policy.projectPolicyCount,
      mergedPolicyCount: policy.mergedPolicyCount,
      violationCount: policy.violationCount
    } : null,
    repairSummary: repair ? {
      status: repair.status,
      taskCount: repair.taskCount,
      blockerCount: repair.blockerCount,
      changedPreviewCount: repair.changedPreviewCount,
      requiresVerification: repair.requiresVerification,
      verificationTrace: {
        pendingReason: repair.verificationTrace.pendingReason,
        nextAction: repair.verificationTrace.nextAction
      },
      taskCategorySummaries: copyCounts(repair.taskCategorySummaries),
      issueTypeSummaries: copyCounts(repair.failureTaxonomy.issueTypeSummaries),
      // Preserve the live CLI's count of target-summary entries, not their weights.
      targetSummaries: summarizeCounts(repair.targetSummaries.map((target) => target.targetType)),
      repairabilitySummaries: copyCounts(repair.failureTaxonomy.repairabilitySummaries)
    } : null,
    upgradeSummary: upgrade ? {
      status: upgrade.status,
      blockId: upgrade.blockId,
      fromVersion: upgrade.fromVersion,
      toVersion: upgrade.toVersion,
      migrationCount: upgrade.migrationCount,
      preflightCheckCount: upgrade.preflightCheckCount,
      preflightEvidenceCount: upgrade.preflightEvidenceCount,
      impactCount: upgrade.impactCount,
      migrationOperationCount: upgrade.migrationOperationCount,
      operationRoleSummaries: summarizeCounts(upgrade.migrationOperationSummaries.map((operation) => operation.role)),
      sourceMigrationCount: upgrade.sourceMigrationCount,
      requiresVerification: upgrade.requiresVerification,
      verificationSummaries: copyCounts(upgrade.verificationSummaries),
      diagnostics: upgrade.diagnostics ? {
        phase: upgrade.diagnostics.phase,
        failedCheck: upgrade.diagnostics.failedCheck,
        errorCode: upgrade.diagnostics.errorCode,
        message: upgrade.diagnostics.message,
        attribution: upgradeDiagnosticsAttributionParts(upgrade.diagnostics.details)
      } : null
    } : null
  };
}

export type ExplainSummaryView = ReturnType<typeof projectExplainSummary>;
