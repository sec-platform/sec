import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import { validateProvenanceFile } from '../../semantic/provenance/authority.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import { validateAcceptanceCoverageReport } from '../../verification/acceptance/runtime/coverage-authority.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import type { ReviewSummary } from '../../verification/review/contract/types.ts';
import { formatJsonFile, publishExistingParentCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace/paths.ts';
import type { LockFile } from '../contract.ts';
import { writeGeneratedArtifactWithLock } from '../lock.ts';
import { buildReviewSummary } from './write-review-summary.ts';

/**
 * Canonical Review Summary publication seam. Review planning remains in
 * buildReviewSummary(); this owner binds validated projection inputs to one
 * retained durable artifact publication and keeps Lock publication last via
 * writeGeneratedArtifactWithLock(). Multi-artifact atomicity still belongs to
 * the wider composition/transaction owner.
 */
export async function publishReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenanceInput: ProvenanceFile,
  report: VerificationReport,
  coverageInput: AcceptanceCoverageReport,
  commitFence?: CommitFence
): Promise<ReviewSummary> {
  const provenance = validateProvenanceFile(provenanceInput);
  const coverage = validateAcceptanceCoverageReport(coverageInput);
  const reviewSummaryPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.reviewSummary
  );
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );

  return writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.reviewSummary],
    async () => {
      const summary = await buildReviewSummary(
        workspaceRoot,
        lock,
        provenance,
        report,
        coverage
      );
      await publishExistingParentCanonicalWorkspaceFile({
        workspaceRoot,
        targetPath: reviewSummaryPath,
        bytes: Buffer.from(formatJsonFile(summary), 'utf8'),
        label: 'Review Summary',
        commitFence
      });
      return summary;
    },
    commitFence
  );
}
