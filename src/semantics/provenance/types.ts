import type { RegistryKind, RegistryLocation } from '../../contracts/registry-source.ts';
import type { OverrideManifest, OverrideSource } from './override-schema.ts';
export type { OverrideEntry, OverrideManifest, OverrideSource } from './override-schema.ts';

export const PROVENANCE_FORMAT_VERSION = '1' as const;

export type ProvenanceOriginType = 'block' | 'generated' | 'override';
export type OverrideStatus = 'none' | OverrideSource;

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

export function emptyOverrideManifest(): OverrideManifest {
  return { overrides: [] };
}
