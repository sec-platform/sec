import type { RegistryKind, RegistryLocation } from '../../contracts/registry-source.ts';
import type { AcceptanceItem } from '../../semantics/acceptance/types.ts';
import type { ManifestGenerator } from '../../semantics/generation/types.ts';

import type { PlanApp, PlanBlock, PlanRegistry } from './plan-schema.ts';
export type { AppMode, PlanRegistry, PlanRegistrySource } from './plan-schema.ts';

export const MANIFEST_KINDS = ['capability', 'strategy', 'infra', 'governance'] as const;
export type ManifestKind = (typeof MANIFEST_KINDS)[number];

export interface PlanFile {
  app: PlanApp;
  registry: PlanRegistry;
  blocks: PlanBlock[];
  acceptance: AcceptanceItem[];
}

export interface ManifestPin { id: string; type: string; required?: boolean; }
interface ManifestContractReference { path: string; }
interface InstallInstruction { kind: string; from: string; to: string; }

interface ManifestCompatibility {
  blockApi: string;
  compilerApi: string;
  stackProfiles: string[];
}

interface ManifestPins { inputs: ManifestPin[]; outputs: ManifestPin[]; }

export interface UpgradeMigration {
  id: string;
  kind: string;
  entry: string;
  fromVersion?: string;
  toVersion?: string;
  requiresVerification?: boolean;
}

interface UpgradeConfig {
  from: string[];
  migrations: UpgradeMigration[];
}

interface BlockManifestBase {
  id: string;
  version: string;
  kind: ManifestKind;
  stackProfiles: string[];
  compatibility?: ManifestCompatibility;
  requires: string[];
  provides: string[];
  conflicts: string[];
  installs: InstallInstruction[];
  pins: ManifestPins;
  acceptance: AcceptanceItem[];
  upgrade?: UpgradeConfig;
}

export type BlockManifest = BlockManifestBase & Partial<{
  contracts: ManifestContractReference[];
  generators: ManifestGenerator[];
}>;

export interface ManifestEntry {
  manifest: BlockManifest & {
    contracts: ManifestContractReference[];
    generators: ManifestGenerator[];
  };
  manifestPath: string;
  manifestRoot: string;
  resourceRoots: string[];
  registryRoot: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}
