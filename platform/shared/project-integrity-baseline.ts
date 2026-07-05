export const COMPOSITION_BASELINE_FORMAT_VERSION = '1' as const;

export interface CompositionBaselineArtifact {
  path: string;
  hash: string;
}

export interface CompositionBaselineFile {
  formatVersion: typeof COMPOSITION_BASELINE_FORMAT_VERSION;
  artifacts: CompositionBaselineArtifact[];
}
