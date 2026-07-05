export const PROJECT_BASELINE_FORMAT_VERSION = '1' as const;

export interface ProjectBaselineArtifact {
  path: string;
  hash: string;
}

export interface ProjectBaselineFile {
  formatVersion: typeof PROJECT_BASELINE_FORMAT_VERSION;
  artifacts: ProjectBaselineArtifact[];
}
