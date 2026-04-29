export interface ReviewArtifactMissingEntry {
  path: string;
  reason: string;
  declaredBy: string;
}

export interface ReviewArtifactUploadGroup {
  kind: string;
  count: number;
  paths: string[];
}

export interface ReviewArtifactSummary {
  artifactStatus?: 'passed' | 'attention';
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  testCount?: number;
  contractCount?: number;
  contractPaths?: string[];
  uploadGroupCount?: number;
  missingCount: number;
  missingReasonTypeCount?: number;
  missingReasonCounts?: Record<string, number>;
  uploadGroups?: ReviewArtifactUploadGroup[];
  missing?: ReviewArtifactMissingEntry[];
}
