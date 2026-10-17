import { expect, test } from 'bun:test';

import type { ReviewSummaryInspectView } from '../../src/application/review-summary-inspect.ts';
import { formatReviewSummary } from '../../src/entry/cli/review-summary-inspect.ts';

// Independent, hand-reviewed public text oracle. Do not compute the expected
// CLI output with the same formatter under test.
const baseView: ReviewSummaryInspectView = {
  formatVersion: '2',
  chain: {
    status: 'failed',
    stageCount: 4,
    passedStageCount: 2,
    attentionStageCount: 1,
    failedStageCount: 1,
    stages: [
      { id: 'verification', status: 'passed' },
      { id: 'coverage', status: 'attention' },
      { id: 'artifacts', status: 'failed' },
      { id: 'review', status: 'passed' }
    ]
  },
  ci: { status: 'failed', failureCount: 2, regressionRiskCount: 1, conflictHintCount: 0 },
  impact: { blockCount: 2, runtimeEntryCount: 3, changeSourceCount: 4, installImpactCount: 1 },
  coverage: null,
  provenance: {
    artifactCount: 3,
    registryArtifactCount: 1,
    generatedArtifactCount: 2,
    unverifiedArtifactCount: 1
  },
  artifacts: {
    artifactStatus: 'missing',
    artifactCount: 0,
    missingCount: 0,
    missingReasonTypeCount: 0,
    contractCount: 0,
    uploadGroupCount: 0
  }
};

// tests/integration/review.test.ts already has an independent full CLI-text
// oracle for the ordinary populated summary and the fromVersion upgrade.
// These cases cover only the branches that integration case does not reach.
test('review summary text explicitly marks an absent coverage projection', () => {
  expect(formatReviewSummary(baseView).split('\n')).toContain('Coverage missing; blocks=missing');
});

test('review summary upgrade without a source version displays only the target version', () => {
  const upgrade = {
    status: 'blocked',
    blockId: 'ticket.basic',
    toVersion: '0.3.0',
    migrationCount: 1,
    impactCount: 2,
    requiresVerification: true
  };
  expect(formatReviewSummary({ ...baseView, upgrade }).split('\n')).toContain(
    'Upgrade blocked; ticket.basic target 0.3.0; migrations=1; impacts=2; requiresVerification=true'
  );
});
