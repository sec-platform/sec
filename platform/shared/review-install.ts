export interface ReviewInstallImpact {
  blockId: string;
  actionKinds: string[];
  sourceRoots: string[];
  targetPaths: string[];
  verticals: string[];
  runtimeEntries: string[];
}

export interface ReviewInstallImpactGroupSummary {
  vertical: string;
  blockCount: number;
  actionKindCount: number;
  runtimeEntryCount: number;
  targetPathCount: number;
  blocks: string[];
  actionKinds: string[];
  runtimeEntries: string[];
  targetPaths: string[];
}

export interface ReviewInstallImpactSummary {
  impactCount: number;
  blockCount: number;
  actionKindCount: number;
  sourceRootCount: number;
  targetPathCount: number;
  verticalCount: number;
  runtimeEntryCount: number;
  groupCount: number;
  blocks: string[];
  actionKinds: string[];
  sourceRoots: string[];
  targetPaths: string[];
  verticals: string[];
  runtimeEntries: string[];
  groupSummaries: ReviewInstallImpactGroupSummary[];
}
