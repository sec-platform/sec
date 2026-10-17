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

const baseText = [
  'Review summary failed; format=2; stages=2/4; attention=1; failed=1',
  'CI failed; failures=2; risks=1; conflicts=0',
  'Impact blocks=2; runtime=3; changeSources=4; installImpacts=1',
  'Coverage missing; blocks=missing',
  'Provenance artifacts=3; registry=1; generated=2; unverified=1',
  'Artifacts missing; total=0; missing=0; missingReasonTypes=0; contracts=0; uploadGroups=0',
  'Stages: verification=passed, coverage=attention, artifacts=failed, review=passed'
].join('\n');

test('review summary text preserves status, counts and missing artifact defaults', () => {
  expect(formatReviewSummary(baseView)).toBe(baseText);
});

test('review summary text retains both upgrade identity forms and blocked diagnostic attribution', () => {
  const upgrade = {
    status: 'blocked',
    blockId: 'ticket.basic',
    toVersion: '0.3.0',
    migrationCount: 1,
    impactCount: 2,
    requiresVerification: true,
    diagnostics: {
      phase: 'preflight',
      failedCheck: 'signature',
      errorCode: 'UPGRADE-SEC-001',
      message: 'invalid declaration',
      attribution: ['operation=replace', 'file=src/a.ts']
    }
  };
  expect(formatReviewSummary({ ...baseView, upgrade })).toBe([
    baseText,
    'Upgrade blocked; ticket.basic target 0.3.0; migrations=1; impacts=2; requiresVerification=true',
    'Upgrade diagnostics preflight; signature; UPGRADE-SEC-001; invalid declaration; attribution=operation=replace, file=src/a.ts'
  ].join('\n'));
  expect(formatReviewSummary({ ...baseView, upgrade: { ...upgrade, fromVersion: '0.2.0' } })).toBe([
    baseText,
    'Upgrade blocked; ticket.basic 0.2.0 -> 0.3.0; migrations=1; impacts=2; requiresVerification=true',
    'Upgrade diagnostics preflight; signature; UPGRADE-SEC-001; invalid declaration; attribution=operation=replace, file=src/a.ts'
  ].join('\n'));
});
