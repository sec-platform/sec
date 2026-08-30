export interface UpgradeFileReplaceMigrationEntry { id: string; kind: 'file-replace'; reason: string; source: string; target: string; }
export interface UpgradeCopyFileMigrationEntry { id: string; kind: 'copy-file'; reason: string; source: string; target: string; }
export interface UpgradeCopyDirectoryMigrationEntry { id: string; kind: 'copy-directory'; reason: string; source: string; target: string; }
export interface UpgradeRenameDirectoryMigrationEntry { id: string; kind: 'rename-directory'; reason: string; source: string; target: string; }
export interface UpgradeConfigRewriteMigrationEntry { id: string; kind: 'config-rewrite'; reason: string; target: string; updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete'; }>; }
export interface UpgradeJsonArrayAppendMigrationEntry { id: string; kind: 'json-array-append'; reason: string; target: string; path: string[]; items: unknown[]; }
export interface UpgradeJsonArrayRemoveMigrationEntry { id: string; kind: 'json-array-remove'; reason: string; target: string; path: string[]; items: unknown[]; }
export interface UpgradeJsonObjectMergeMigrationEntry { id: string; kind: 'json-object-merge'; reason: string; target: string; path: string[]; value: Record<string, unknown>; }
export interface UpgradeTextAppendMigrationEntry { id: string; kind: 'text-append'; reason: string; target: string; content: string; }
export interface UpgradeTextReplaceMigrationEntry { id: string; kind: 'text-replace'; reason: string; target: string; search: string; replacement: string; }
export interface UpgradeTextReplaceRegexMigrationEntry { id: string; kind: 'text-replace-regex'; reason: string; target: string; pattern: string; replacement: string; flags?: string; }
export interface UpgradeCreateDirectoryMigrationEntry { id: string; kind: 'create-directory'; reason: string; target: string; }
export interface UpgradeDeleteFileMigrationEntry { id: string; kind: 'delete-file'; reason: string; target: string; }
export interface UpgradeDeleteDirectoryMigrationEntry { id: string; kind: 'delete-directory'; reason: string; target: string; }
export interface UpgradeRenameFileMigrationEntry { id: string; kind: 'rename-file'; reason: string; source: string; target: string; }
export interface UpgradeSlotContractUpdateMigrationEntry { id: string; kind: 'slot-contract-update'; reason: string; target: string; slotId: string; inputType?: string; outputType?: string; writableZones?: string[]; }
export interface UpgradeDbExpandContractMigrationEntry { id: string; kind: 'db-expand-contract'; reason: string; target: string; entity: string; expandField: string; contractField: string; copyJobCode?: string; }

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
  | UpgradeSlotContractUpdateMigrationEntry
  | UpgradeDbExpandContractMigrationEntry;
