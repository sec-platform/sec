import { countMatching } from '../../../contracts/collections.ts';
import type { VerificationReport } from '../contract/types.ts';
import { reviewArtifactMissingReasonTypeCount, reviewArtifactUploadGroupCount } from './contract/artifact.ts';
import type { ReviewChainStageId, ReviewSummary } from './contract/types.ts';

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

type ReviewChainStageContext = {
  report: VerificationReport;
  coverageSummary: NonNullable<ReviewSummary['coverageSummary']>;
  artifactSummary: ReviewSummary['artifactSummary'];
};

const REVIEW_SUMMARY_GENERATED = 'review-summary=generated';
const REVIEW_CHAIN_STAGE_IDS = ['verification', 'coverage', 'artifacts', 'review'] satisfies readonly ReviewChainStageId[];

function buildReviewChainStage(
  id: ReviewChainStageId,
  { report, coverageSummary, artifactSummary }: ReviewChainStageContext
): ReviewSummary['chainSummary']['stageSummaries'][number] {
  if (id === 'verification') {
    return { id, status: report.summary.status, detail: `lane=${report.summary.requestedLane}; failed=${report.summary.failedLanes.join(',') || 'none'}` };
  }
  if (id === 'coverage') {
    return { id, status: coverageSummary.status === 'passed' ? 'passed' : coverageSummary.status === 'skipped' ? 'attention' : 'failed', detail: `blocks=${coverageSummary.coveredBlockCount}/${coverageSummary.blockCount}` };
  }
  if (id === 'artifacts') {
    return { id, status: artifactSummary?.artifactStatus ?? 'attention', detail: `total=${artifactSummary?.artifactCount ?? 0}; missing=${artifactSummary?.missingCount ?? 0}` };
  }
  return { id, status: 'passed', detail: REVIEW_SUMMARY_GENERATED };
}

export function buildReviewChainSummary(
  report: VerificationReport,
  coverageSummary: NonNullable<ReviewSummary['coverageSummary']>,
  artifactSummary: ReviewSummary['artifactSummary']
): ReviewSummary['chainSummary'] {
  const stageSummaries = REVIEW_CHAIN_STAGE_IDS.map((id) => buildReviewChainStage(id, { report, coverageSummary, artifactSummary }));
  const failedStageCount = countMatching(stageSummaries, (stage) => stage.status === 'failed');
  const attentionStageCount = countMatching(stageSummaries, (stage) => stage.status === 'attention');

  return {
    status: failedStageCount > 0 ? 'failed' : attentionStageCount > 0 ? 'attention' : 'passed',
    stageCount: stageSummaries.length,
    passedStageCount: countMatching(stageSummaries, (stage) => stage.status === 'passed'),
    attentionStageCount,
    failedStageCount,
    stageSummaries
  };
}

export function e2eStageEvidence(
  { ciSummary, coverageSummary, artifactSummary }: ReviewSummary,
  stageId: string
): string[] {
  if (stageId === 'verification') return [`ci=${ciSummary.status}`, `failures=${ciSummary.failureCount}`];
  if (stageId === 'coverage') {
    return coverageSummary
      ? [`blocks=${coverageSummary.coveredBlockCount}/${coverageSummary.blockCount}`]
      : ['coverage=missing'];
  }
  if (stageId === 'artifacts') {
    return artifactSummary
      ? [
          `total=${artifactSummary.artifactCount}`,
          `missing=${artifactSummary.missingCount}`,
          `uploadGroups=${reviewArtifactUploadGroupCount(artifactSummary)}`,
          `missingReasonTypes=${reviewArtifactMissingReasonTypeCount(artifactSummary)}`
        ]
      : ['artifacts=missing'];
  }
  return stageId === 'review' ? [REVIEW_SUMMARY_GENERATED] : [];
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
