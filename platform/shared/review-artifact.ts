import type {
  CiArtifactMissingEntry,
  CiArtifactSummary,
  CiArtifactUploadGroup
} from './ci-artifact-types.ts';

export type ReviewArtifactMissingEntry = CiArtifactMissingEntry;
export type ReviewArtifactUploadGroup = CiArtifactUploadGroup;

export interface ReviewArtifactSummary
  extends Pick<CiArtifactSummary, 'artifactCount' | 'governanceCount' | 'viewCount' | 'missingCount'>,
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
