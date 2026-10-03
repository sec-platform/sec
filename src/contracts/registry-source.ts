export const REGISTRY_KINDS = ['official', 'private', 'community'] as const;
export const REGISTRY_LOCATIONS = ['compiler', 'workspace'] as const;

export type RegistryKind = (typeof REGISTRY_KINDS)[number];
export type RegistryLocation = (typeof REGISTRY_LOCATIONS)[number];

/** A competing eligible manifest's identity, never another copy of its body. */
export interface RegistryManifestIdentity {
  version: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}

/** The containing entry is the winner. Only eligible lower-priority sources
 * are retained, in the caller's source order. This observation grants no access. */
export interface RegistrySourceResolution {
  policy: 'source-order';
  shadowed: RegistryManifestIdentity[];
}

/** Invocation output for diagnostics; it is not part of the binding lock. */
export interface RegistryManifestResolution {
  blockId: string;
  selected: RegistryManifestIdentity;
  resolution: RegistrySourceResolution;
}
