import type { AcceptanceItem } from '../../semantic/acceptance/contract/types.ts';
import type { RegistryKind, RegistryLocation } from '../registry/contract/types.ts';
import type { ManifestGenerator } from '../../semantic/generation/contract/types.ts';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export const SLOT_KINDS = ['adapter', 'policy', 'ux', 'repair'] as const;
export const MANIFEST_KINDS = ['capability', 'strategy', 'infra', 'governance'] as const;

export type SlotKind = (typeof SLOT_KINDS)[number];
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

export interface PlanSlot {
  id: string;
  block: string;
  kind: SlotKind;
  target: string;
  sourcePath?: string;
  symbol: string;
  description: string;
}

export interface PlanFile {
  app: PlanApp;
  registry: PlanRegistry;
  blocks: PlanBlock[];
  slots: PlanSlot[];
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

export interface ManifestSlot {
  id: string;
  kind: SlotKind;
  target: string;
  symbol: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
}

export interface ManifestRoute { path: string; file: string; }
export interface ManifestPins { inputs: ManifestPin[]; outputs: ManifestPin[]; }
export interface ManifestUiPortal { id: string; description?: string; }

export interface ManifestUiHook {
  targetPortal: string;
  component: string;
  importFrom: string;
  dataBinder?: string;
  renderSnippet?: string;
}

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
  slots: ManifestSlot[];
  acceptance: AcceptanceItem[];
  routes: ManifestRoute[];
  upgrade?: UpgradeConfig;
  uiPortals?: ManifestUiPortal[];
  uiHooks?: ManifestUiHook[];
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
