import type { AcceptanceItem } from './acceptance-types.ts';
import type { RegistryKind, RegistryLocation } from './registry-types.ts';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';
export type AppMode = 'single-tenant' | 'multi-tenant';
export type SlotKind = 'adapter' | 'policy' | 'ux' | 'repair';
export type ManifestKind = 'capability' | 'strategy' | 'infra' | 'governance';

export interface PlanApp {
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

export interface PlanRegistry {
  sources: PlanRegistrySource[];
}

export interface PlanBlock {
  id: string;
  version?: string;
}

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

export interface ManifestPin {
  id: string;
  type: string;
  required?: boolean;
}

export interface InstallInstruction {
  kind: string;
  from: string;
  to: string;
}

export interface ManifestCompatibility {
  blockApi: string;
  compilerApi: string;
  stackProfiles: string[];
}

export interface UpgradeMigration {
  id: string;
  kind: string;
  entry: string;
  fromVersion?: string;
  toVersion?: string;
  requiresVerification?: boolean;
}

export interface UpgradeFileReplaceMigrationEntry {
  id: string;
  kind: 'file-replace';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeCopyFileMigrationEntry {
  id: string;
  kind: 'copy-file';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeCopyDirectoryMigrationEntry {
  id: string;
  kind: 'copy-directory';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeRenameDirectoryMigrationEntry {
  id: string;
  kind: 'rename-directory';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeConfigRewriteMigrationEntry {
  id: string;
  kind: 'config-rewrite';
  reason: string;
  target: string;
  updates: Array<{
    path: string[];
    value?: unknown;
    operation?: 'set' | 'delete';
  }>;
}

export interface UpgradeJsonArrayAppendMigrationEntry {
  id: string;
  kind: 'json-array-append';
  reason: string;
  target: string;
  path: string[];
  items: unknown[];
}

export interface UpgradeJsonArrayRemoveMigrationEntry {
  id: string;
  kind: 'json-array-remove';
  reason: string;
  target: string;
  path: string[];
  items: unknown[];
}

export interface UpgradeJsonObjectMergeMigrationEntry {
  id: string;
  kind: 'json-object-merge';
  reason: string;
  target: string;
  path: string[];
  value: Record<string, unknown>;
}

export interface UpgradeTextAppendMigrationEntry {
  id: string;
  kind: 'text-append';
  reason: string;
  target: string;
  content: string;
}

export interface UpgradeTextReplaceMigrationEntry {
  id: string;
  kind: 'text-replace';
  reason: string;
  target: string;
  search: string;
  replacement: string;
}

export interface UpgradeTextReplaceRegexMigrationEntry {
  id: string;
  kind: 'text-replace-regex';
  reason: string;
  target: string;
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface UpgradeCreateDirectoryMigrationEntry {
  id: string;
  kind: 'create-directory';
  reason: string;
  target: string;
}

export interface UpgradeDeleteFileMigrationEntry {
  id: string;
  kind: 'delete-file';
  reason: string;
  target: string;
}

export interface UpgradeDeleteDirectoryMigrationEntry {
  id: string;
  kind: 'delete-directory';
  reason: string;
  target: string;
}

export interface UpgradeRenameFileMigrationEntry {
  id: string;
  kind: 'rename-file';
  reason: string;
  source: string;
  target: string;
}

export interface UpgradeSlotContractUpdateMigrationEntry {
  id: string;
  kind: 'slot-contract-update';
  reason: string;
  target: string;
  slotId: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
}

export type UpgradeMigrationEntry =
  | UpgradeFileReplaceMigrationEntry
  | UpgradeCopyFileMigrationEntry
  | UpgradeCopyDirectoryMigrationEntry
  | UpgradeRenameDirectoryMigrationEntry
  | UpgradeConfigRewriteMigrationEntry
  | UpgradeJsonArrayAppendMigrationEntry
  | UpgradeJsonArrayRemoveMigrationEntry
  | UpgradeJsonObjectMergeMigrationEntry
  | UpgradeTextAppendMigrationEntry
  | UpgradeTextReplaceMigrationEntry
  | UpgradeTextReplaceRegexMigrationEntry
  | UpgradeCreateDirectoryMigrationEntry
  | UpgradeDeleteFileMigrationEntry
  | UpgradeDeleteDirectoryMigrationEntry
  | UpgradeRenameFileMigrationEntry
  | UpgradeSlotContractUpdateMigrationEntry;

export interface UpgradeConfig {
  from: string[];
  migrations: UpgradeMigration[];
}

export interface SlotParam {
  name: string;
  type: string;
  importFrom?: string;
}

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

export interface ManifestRoute {
  path: string;
  file: string;
}

export interface ManifestPins {
  inputs: ManifestPin[];
  outputs: ManifestPin[];
}

export interface ManifestUiPortal {
  id: string;
  description?: string;
}

export interface ManifestUiHook {
  targetPortal: string;
  component: string;
  importFrom: string;
  dataBinder?: string;
  renderSnippet?: string;
}

export interface BlockManifest {
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

export interface ManifestEntry {
  manifest: BlockManifest;
  manifestPath: string;
  manifestRoot: string;
  registryRoot: string;
  registrySourceId: string;
  registryKind: RegistryKind;
  registryLocation: RegistryLocation;
  registryPath: string;
}
