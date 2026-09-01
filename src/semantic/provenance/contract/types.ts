import type { RegistryKind, RegistryLocation } from '../../../compiler/registry/contract/types.ts';

export const PROVENANCE_FORMAT_VERSION = '1' as const;

export type ProvenanceOriginType = 'block' | 'generated' | 'override';
export type OverrideStatus = 'none' | 'manual' | 'rule-backed';
export type OverrideSource = 'manual' | 'rule-backed';

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
  generatorEntityId?: string;
  artifactEntityId?: string;
  semanticRevision?: string;
  compilationTransactionId?: string;
  verifiedBy: string[];
  overrideStatus: OverrideStatus;
  hash?: string;
}

export interface ProvenanceFile {
  formatVersion: typeof PROVENANCE_FORMAT_VERSION;
  artifacts: ProvenanceArtifact[];
}

export interface OverrideEntry {
  id: string;
  entry: string;
  target: string;
  reason: string;
  source: OverrideSource;
  conflictsWith: string[];
}

export interface OverrideManifest {
  overrides: OverrideEntry[];
}

export function emptyOverrideManifest(): OverrideManifest {
  return { overrides: [] };
}
