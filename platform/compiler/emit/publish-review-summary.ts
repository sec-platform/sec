import { validateAcceptanceCoverageReportV1 } from '../../shared/acceptance-coverage-authority.ts';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { formatJsonFile, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { validateProvenanceFileV1 } from '../../shared/provenance-authority.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import type { AcceptanceCoverageReport, VerificationReport } from '../../shared/types.ts';
import { publishCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';
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
  const provenance = validateProvenanceFileV1(provenanceInput);
  const coverage = validateAcceptanceCoverageReportV1(coverageInput);
  const { reviewSummaryPath, lockPath } = getWorkspacePaths(workspaceRoot);

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
      await publishCanonicalWorkspaceFileV1({
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
