export const REGISTRY_KINDS = ['official', 'private', 'community'] as const;
export const REGISTRY_LOCATIONS = ['compiler', 'workspace'] as const;

export type RegistryKind = (typeof REGISTRY_KINDS)[number];
export type RegistryLocation = (typeof REGISTRY_LOCATIONS)[number];
