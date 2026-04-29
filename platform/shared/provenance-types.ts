import type { RegistryKind, RegistryLocation } from './registry-types.ts';

export type ProvenanceOriginType = 'block' | 'slot' | 'generated' | 'override';
export type OverrideStatus = 'none' | 'manual' | 'rule-backed';
export type OverrideSource = 'manual' | 'rule-backed';
export type OverrideApplyPhase = 'compose' | 'adapt';

export interface ProvenanceArtifact {
  path: string;
  originType: ProvenanceOriginType;
  originId: string;
  sourceBlock?: string;
  registrySourceId?: string;
  registryKind?: RegistryKind;
  registryLocation?: RegistryLocation;
  registryPath?: string;
  sourcePath?: string;
  runtimeTarget?: string;
  generatedByPass?: string;
  generatorTaskId?: string;
  verifiedBy: string[];
  overrideStatus: OverrideStatus;
}

export interface ProvenanceFile {
  formatVersion: string;
  artifacts: ProvenanceArtifact[];
}

export interface OverrideEntry {
  id: string;
  entry: string;
  target: string;
  reason: string;
  source: OverrideSource;
  appliesAfter: OverrideApplyPhase[];
  conflictsWith: string[];
}

export interface OverrideManifest {
  overrides: OverrideEntry[];
}

export function emptyOverrideManifest(): OverrideManifest {
  return { overrides: [] };
}
