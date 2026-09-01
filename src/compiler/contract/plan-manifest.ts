import type { AcceptanceItem } from '../../semantic/acceptance/contract/types.ts';
import type { ManifestGenerator } from '../../semantic/generation/contract/types.ts';
import type { RegistryKind, RegistryLocation } from '../registry/contract/types.ts';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export const MANIFEST_KINDS = ['capability', 'strategy', 'infra', 'governance'] as const;

export type ManifestKind = (typeof MANIFEST_KINDS)[number];

export interface PlanApp {
  id: string;
  name: string;
  stack: string;
  packageManager: PackageManager;
  mode: AppMode;
}

export interface PlanRegistrySource {
  id: string;
  kind: RegistryKind;
  location: RegistryLocation;
  path: string;
}

export interface PlanRegistry { sources: PlanRegistrySource[]; }
export interface PlanBlock { id: string; version?: string; }

export interface PlanFile {
  app: PlanApp;
  registry: PlanRegistry;
  blocks: PlanBlock[];
  acceptance: AcceptanceItem[];
}

export interface ManifestPin { id: string; type: string; required?: boolean; }
export interface ManifestContractReference { path: string; }
export interface InstallInstruction { kind: string; from: string; to: string; }

export interface ManifestCompatibility {
  blockApi: string;
  compilerApi: string;
  stackProfiles: string[];
}

export interface ManifestPins { inputs: ManifestPin[]; outputs: ManifestPin[]; }

export interface UpgradeMigration {
  id: string;
  kind: string;
  entry: string;
  fromVersion?: string;
  toVersion?: string;
  requiresVerification?: boolean;
}

export interface UpgradeConfig {
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
