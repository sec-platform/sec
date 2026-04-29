export const CI_ARTIFACT_KINDS = [
  'governance',
  'view',
  'test',
  'contract'
] as const;

export type CiArtifactKind = typeof CI_ARTIFACT_KINDS[number];

export const CI_ARTIFACT_MISSING_REASON = {
  declaredGeneratedMissing: 'declared-generated-missing',
  fixedGovernanceMissing: 'fixed-governance-missing',
  fixedViewMissing: 'fixed-view-missing'
} as const;

export type CiArtifactMissingReason = typeof CI_ARTIFACT_MISSING_REASON[keyof typeof CI_ARTIFACT_MISSING_REASON];

export const CI_ARTIFACT_MISSING_REASONS = [
  CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
  CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing,
  CI_ARTIFACT_MISSING_REASON.fixedViewMissing
] as const satisfies readonly CiArtifactMissingReason[];

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
