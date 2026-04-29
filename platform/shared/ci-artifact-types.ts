export type CiArtifactKind = 'governance' | 'view' | 'test' | 'contract';

export type CiArtifactMissingReason =
  | 'declared-generated-missing'
  | 'fixed-governance-missing'
  | 'fixed-view-missing';

export type CiArtifactDeclaredBy = 'graph.lock.json' | 'artifact-manifest';

export interface CiArtifactEntry {
  path: string;
  kind: CiArtifactKind;
  uploadName: string;
  exists: boolean;
}

export interface CiArtifactUploadGroup {
  kind: CiArtifactKind;
  count: number;
  paths: string[];
}

export interface CiArtifactMissingEntry {
  path: string;
  reason: CiArtifactMissingReason;
  declaredBy: CiArtifactDeclaredBy;
}

export interface CiArtifactSummary {
  artifactStatus: 'passed' | 'attention';
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  testCount: number;
  contractCount: number;
  contractPaths: string[];
  uploadGroupCount: number;
  missingCount: number;
  missingReasonTypeCount: number;
  missingReasonCounts: Record<CiArtifactMissingReason, number>;
}

export interface CiArtifactManifest {
  formatVersion: '1';
  root: 'workspace';
  summary: CiArtifactSummary;
  artifacts: CiArtifactEntry[];
  uploadGroups: CiArtifactUploadGroup[];
  missing: CiArtifactMissingEntry[];
}
