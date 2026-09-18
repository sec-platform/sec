import {
  reviewArtifactMissingReasonTypeCount,
  reviewArtifactUploadGroupCount
} from '../assurance/verification/review/contract/artifact.ts';
import type { ReviewSummary } from '../assurance/verification/review/contract/types.ts';
import { upgradeDiagnosticsAttributionParts } from '../assurance/verification/review/contract/upgrade.ts';

export type ReviewSummaryInspectView = Readonly<{
  formatVersion: string;
  chain: Readonly<{
    status: string;
    stageCount: number;
    passedStageCount: number;
    attentionStageCount: number;
    failedStageCount: number;
    stages: readonly Readonly<{ id: string; status: string }>[];
  }>;
  ci: Readonly<{
    status: string;
    failureCount: number;
    regressionRiskCount: number;
    conflictHintCount: number;
  }>;
  impact: Readonly<{
    blockCount: number;
    runtimeEntryCount: number;
    changeSourceCount: number;
    installImpactCount: number;
  }>;
  coverage: Readonly<{
    status: string;
    coveredBlockCount: number;
    blockCount: number;
  }> | null;
  provenance: Readonly<{
    artifactCount: number;
    registryArtifactCount: number;
    generatedArtifactCount: number;
    unverifiedArtifactCount: number;
  }>;
  artifacts: Readonly<{
    artifactStatus: string;
    artifactCount: number;
    missingCount: number;
    missingReasonTypeCount: number;
    contractCount: number;
    uploadGroupCount: number;
  }>;
  upgrade?: Readonly<{
    status: string;
    blockId: string;
    fromVersion?: string;
    toVersion: string;
    migrationCount: number;
    impactCount: number;
    requiresVerification: boolean;
    diagnostics?: Readonly<{
      phase: string;
      failedCheck: string;
      errorCode: string;
      message: string;
      attribution: readonly string[];
    }>;
  }>;
}>;

export function projectReviewSummary(summary: ReviewSummary): ReviewSummaryInspectView {
  const coverage = summary.coverageSummary;
  const provenance = summary.provenanceSummary;
  const artifacts = summary.artifactSummary;
  const upgrade = summary.upgradeSummary;

  return {
    formatVersion: summary.formatVersion,
    chain: {
      status: summary.chainSummary.status,
      stageCount: summary.chainSummary.stageCount,
      passedStageCount: summary.chainSummary.passedStageCount,
      attentionStageCount: summary.chainSummary.attentionStageCount,
      failedStageCount: summary.chainSummary.failedStageCount,
      stages: summary.chainSummary.stageSummaries.map((stage) => ({
        id: stage.id,
        status: stage.status
      }))
    },
    ci: {
      status: summary.ciSummary.status,
      failureCount: summary.ciSummary.failureCount,
      regressionRiskCount: summary.ciSummary.regressionRiskCount,
      conflictHintCount: summary.ciSummary.conflictHintCount
    },
    impact: {
      blockCount: summary.impactedBlocks.length,
      runtimeEntryCount: summary.runtimeEntryCount,
      changeSourceCount: summary.changeSourceCount,
      installImpactCount: summary.installImpactCount
    },
    coverage: coverage ? {
      status: coverage.status,
      coveredBlockCount: coverage.coveredBlockCount,
      blockCount: coverage.blockCount
    } : null,
    provenance: {
      artifactCount: provenance?.artifactCount ?? 0,
      registryArtifactCount: provenance?.registryArtifactCount ?? 0,
      generatedArtifactCount: provenance?.generatedArtifactCount ?? 0,
      unverifiedArtifactCount: provenance?.unverifiedArtifactCount ?? 0
    },
    artifacts: {
      artifactStatus: artifacts?.artifactStatus ?? 'missing',
      artifactCount: artifacts?.artifactCount ?? 0,
      missingCount: artifacts?.missingCount ?? 0,
      missingReasonTypeCount: reviewArtifactMissingReasonTypeCount(artifacts),
      contractCount: artifacts?.contractCount ?? 0,
      uploadGroupCount: reviewArtifactUploadGroupCount(artifacts)
    },
    ...(upgrade ? {
      upgrade: {
        status: upgrade.status,
        blockId: upgrade.blockId,
        ...(upgrade.fromVersion ? { fromVersion: upgrade.fromVersion } : {}),
        toVersion: upgrade.toVersion,
        migrationCount: upgrade.migrationCount,
        impactCount: upgrade.impactCount,
        requiresVerification: upgrade.requiresVerification,
        ...(upgrade.diagnostics ? {
          diagnostics: {
            phase: upgrade.diagnostics.phase,
            failedCheck: upgrade.diagnostics.failedCheck,
            errorCode: upgrade.diagnostics.errorCode,
            message: upgrade.diagnostics.message,
            attribution: upgradeDiagnosticsAttributionParts(upgrade.diagnostics.details)
          }
        } : {})
      }
    } : {})
  };
}
