import { expect, test } from 'bun:test';

import { projectReviewSummary } from '../../src/application/review-summary-inspect.ts';
import { formatReviewSummary } from '../../src/entry/cli/review-summary-inspect.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('review summary application projection and entry renderer preserve the frozen text contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const view = projectReviewSummary(summary);

    const expected = [
      `Review summary ${view.chain.status}; format=${view.formatVersion}; stages=${view.chain.passedStageCount}/${view.chain.stageCount}; attention=${view.chain.attentionStageCount}; failed=${view.chain.failedStageCount}`,
      `CI ${view.ci.status}; failures=${view.ci.failureCount}; risks=${view.ci.regressionRiskCount}; conflicts=${view.ci.conflictHintCount}`,
      `Impact blocks=${view.impact.blockCount}; runtime=${view.impact.runtimeEntryCount}; changeSources=${view.impact.changeSourceCount}; installImpacts=${view.impact.installImpactCount}`,
      `Coverage ${view.coverage?.status ?? 'missing'}; blocks=${view.coverage ? `${view.coverage.coveredBlockCount}/${view.coverage.blockCount}` : 'missing'}`,
      `Provenance artifacts=${view.provenance.artifactCount}; registry=${view.provenance.registryArtifactCount}; generated=${view.provenance.generatedArtifactCount}; unverified=${view.provenance.unverifiedArtifactCount}`,
      `Artifacts ${view.artifacts.artifactStatus}; total=${view.artifacts.artifactCount}; missing=${view.artifacts.missingCount}; missingReasonTypes=${view.artifacts.missingReasonTypeCount}; contracts=${view.artifacts.contractCount}; uploadGroups=${view.artifacts.uploadGroupCount}`,
      `Stages: ${view.chain.stages.map((stage) => `${stage.id}=${stage.status}`).join(', ') || 'none'}`
    ];
    if (view.upgrade) {
      expected.push(
        `Upgrade ${view.upgrade.status}; ${view.upgrade.blockId} ${view.upgrade.fromVersion ? `${view.upgrade.fromVersion} -> ${view.upgrade.toVersion}` : `target ${view.upgrade.toVersion}`}; migrations=${view.upgrade.migrationCount}; impacts=${view.upgrade.impactCount}; requiresVerification=${view.upgrade.requiresVerification}`
      );
      if (view.upgrade.diagnostics) {
        expected.push(
          `Upgrade diagnostics ${view.upgrade.diagnostics.phase}; ${view.upgrade.diagnostics.failedCheck}; ${view.upgrade.diagnostics.errorCode}; ${view.upgrade.diagnostics.message}; attribution=${view.upgrade.diagnostics.attribution.join(', ') || 'none'}`
        );
      }
    }

    expect(formatReviewSummary(view)).toBe(expected.join('\n'));
    expect(view.chain.stages).toEqual(
      summary.chainSummary.stageSummaries.map((stage) => ({ id: stage.id, status: stage.status }))
    );
    expect(view.impact.blockCount).toBe(summary.impactedBlocks.length);
  });
});
