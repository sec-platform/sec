import type { AcceptanceItem } from './acceptance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';
import type { ManifestGenerator } from './semantic-generator-types.ts';
import type { UpgradeConfig } from './upgrade-manifest-types.ts';

export type * from './upgrade-manifest-types.ts';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export type SlotKind = 'adapter' | 'policy' | 'ux' | 'repair';
export type ManifestKind = 'capability' | 'strategy' | 'infra' | 'governance';

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

export interface SlotParam { name: string; type: string; importFrom?: string; }

export interface ManifestSlotExport {
  symbol: string;
  params: SlotParam[];
  outputType: string;
  outputImportFrom?: string;
}

export interface ManifestSlot {
  id: string;
  kind: SlotKind;
  target: string;
  symbol: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
  exports?: ManifestSlotExport[];
  mockTemplate?: string;
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
