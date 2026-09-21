import type { AcceptanceCoverageReport } from '../../../assurance/acceptance/coverage.ts';
import type { ProvenanceFile } from '../../../semantics/provenance/types.ts';
import type { VerificationReport } from '../../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../../assurance/verification/review/contract/types.ts';
import {
  buildReviewSummaryFromEvidence,
  reviewRuntimeAttributionTargets
} from '../../../assurance/verification/review/build-summary.ts';
export {
  buildProvenanceSummary,
  buildSemanticViewSummary
} from '../../../assurance/verification/review/summary-derivations.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { loadOverrideManifest } from '../../workspace/sources/load-override-manifest.ts';
import { readReviewArtifactSummary } from './read-review-artifact-summary.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions } from './runtime-attribution.ts';

/**
 * Capture the current physical Review inputs, then delegate Review semantics to
 * Assurance. No risk/conflict/summary interpretation is owned by this adapter.
 */
export async function buildReviewSummary(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport
): Promise<ReviewSummary> {
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const governance = readReviewGovernanceReports(workspaceRoot);
  const allRuntimeEntries = await buildRuntimeAttributions(
    lock,
    reviewRuntimeAttributionTargets(provenance, overrideManifest),
    workspaceRoot
  );
  return buildReviewSummaryFromEvidence({
    lock,
    provenance,
    report,
    coverage,
    overrideManifest,
    ...governance,
    allRuntimeEntries,
    artifactSummary: readReviewArtifactSummary(workspaceRoot)
  });
}
