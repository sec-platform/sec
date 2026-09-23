import type { ReviewSummaryInspectView } from '../../application/review-summary-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatReviewSummary(view: ReviewSummaryInspectView): string {
  const lines = [
    formatFields([
      `Review summary ${view.chain.status}`,
      `format=${view.formatVersion}`,
      `stages=${view.chain.passedStageCount}/${view.chain.stageCount}`,
      `attention=${view.chain.attentionStageCount}`,
      `failed=${view.chain.failedStageCount}`
    ]),
    formatFields([
      `CI ${view.ci.status}`,
      `failures=${view.ci.failureCount}`,
      `risks=${view.ci.regressionRiskCount}`,
      `conflicts=${view.ci.conflictHintCount}`
    ]),
    formatFields([
      `Impact blocks=${view.impact.blockCount}`,
      `runtime=${view.impact.runtimeEntryCount}`,
      `changeSources=${view.impact.changeSourceCount}`,
      `installImpacts=${view.impact.installImpactCount}`
    ]),
    formatFields([
      `Coverage ${view.coverage?.status ?? 'missing'}`,
      `blocks=${view.coverage ? `${view.coverage.coveredBlockCount}/${view.coverage.blockCount}` : 'missing'}`
    ]),
    formatFields([
      `Provenance artifacts=${view.provenance.artifactCount}`,
      `registry=${view.provenance.registryArtifactCount}`,
      `generated=${view.provenance.generatedArtifactCount}`,
      `unverified=${view.provenance.unverifiedArtifactCount}`
    ]),
    formatFields([
      `Artifacts ${view.artifacts.artifactStatus}`,
      `total=${view.artifacts.artifactCount}`,
      `missing=${view.artifacts.missingCount}`,
      `missingReasonTypes=${view.artifacts.missingReasonTypeCount}`,
      `contracts=${view.artifacts.contractCount}`,
      `uploadGroups=${view.artifacts.uploadGroupCount}`
    ]),
    `Stages: ${view.chain.stages.map((stage) => `${stage.id}=${stage.status}`).join(', ') || 'none'}`
  ];

  const upgrade = view.upgrade;
  if (upgrade) {
    lines.push(
      formatFields([
        `Upgrade ${upgrade.status}`,
        `${upgrade.blockId} ${upgrade.fromVersion ? `${upgrade.fromVersion} -> ${upgrade.toVersion}` : `target ${upgrade.toVersion}`}`,
        `migrations=${upgrade.migrationCount}`,
        `impacts=${upgrade.impactCount}`,
        `requiresVerification=${upgrade.requiresVerification}`
      ])
    );
    if (upgrade.diagnostics) {
      lines.push(
        formatFields([
          `Upgrade diagnostics ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution=${formatList([...upgrade.diagnostics.attribution])}`
        ])
      );
    }
  }

  return lines.join('\n');
}
