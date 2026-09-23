import { countPositiveValues } from '../../../../contracts/collections.ts';
import type { CiArtifactMissingEntry, CiArtifactSummary, CiArtifactUploadGroup } from '../../ci-artifacts/contract/types.ts';

export interface ReviewArtifactSummary
  extends Pick<CiArtifactSummary, 'artifactCount' | 'governanceCount' | 'missingCount'>,
    Partial<Pick<CiArtifactSummary,
      | 'artifactStatus'
      | 'testCount'
      | 'contractCount'
      | 'contractPaths'
      | 'uploadGroupCount'
      | 'missingReasonTypeCount'
      | 'missingReasonCounts'
    >> {
  uploadGroups?: CiArtifactUploadGroup[];
  missing?: CiArtifactMissingEntry[];
}

export function reviewArtifactMissingReasonTypeCount(summary?: ReviewArtifactSummary): number {
  return summary?.missingReasonTypeCount
    ?? countPositiveValues(Object.values(summary?.missingReasonCounts ?? {}));
}

export function reviewArtifactUploadGroupCount(summary?: ReviewArtifactSummary): number {
  return summary?.uploadGroupCount ?? summary?.uploadGroups?.length ?? 0;
}
