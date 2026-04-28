import type { ReviewSummary } from './review-types.ts';

export type E2eMatrixRow = {
  stage: string;
  status: string;
  detail: string;
  evidenceCount: number;
  evidence: string[];
};

export type E2eMatrix = {
  status: ReviewSummary['chainSummary']['status'];
  rowCount: number;
  rows: E2eMatrixRow[];
};

function countMissingReasonTypes(reviewSummary: ReviewSummary): number {
  return reviewSummary.artifactSummary?.missingReasonTypeCount
    ?? Object.values(reviewSummary.artifactSummary?.missingReasonCounts ?? {})
      .filter((count) => count > 0).length;
}

export function e2eStageEvidence(reviewSummary: ReviewSummary, stageId: string): string[] {
  const evidenceByStage: Record<string, string[]> = {
    verification: [
      `ci=${reviewSummary.ciSummary.status}`,
      `failures=${reviewSummary.ciSummary.failureCount}`
    ],
    coverage: reviewSummary.coverageSummary
      ? [
          `blocks=${reviewSummary.coverageSummary.coveredBlockCount}/${reviewSummary.coverageSummary.blockCount}`,
          `slots=${reviewSummary.coverageSummary.coveredSlotCount}/${reviewSummary.coverageSummary.slotCount}`
        ]
      : ['coverage=missing'],
    artifacts: reviewSummary.artifactSummary
      ? [
          `total=${reviewSummary.artifactSummary.artifactCount}`,
          `missing=${reviewSummary.artifactSummary.missingCount}`,
          `uploadGroups=${
            reviewSummary.artifactSummary.uploadGroupCount
              ?? reviewSummary.artifactSummary.uploadGroups?.length
              ?? 0
          }`,
          `missingReasonTypes=${countMissingReasonTypes(reviewSummary)}`
        ]
      : ['artifacts=missing'],
    review: ['review-summary=generated']
  };

  return evidenceByStage[stageId] ?? [];
}

export function buildE2eMatrix(reviewSummary: ReviewSummary): E2eMatrix {
  const rows = reviewSummary.chainSummary.stageSummaries.map((stage) => {
    const evidence = e2eStageEvidence(reviewSummary, stage.id);
    return {
      stage: stage.id,
      status: stage.status,
      detail: stage.detail,
      evidenceCount: evidence.length,
      evidence
    };
  });

  return {
    status: reviewSummary.chainSummary.status,
    rowCount: rows.length,
    rows
  };
}
