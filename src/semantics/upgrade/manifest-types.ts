interface UpgradeFileReplaceMigrationEntry { id: string; kind: 'file-replace'; reason: string; source: string; target: string; }
interface UpgradeCopyFileMigrationEntry { id: string; kind: 'copy-file'; reason: string; source: string; target: string; }
interface UpgradeCopyDirectoryMigrationEntry { id: string; kind: 'copy-directory'; reason: string; source: string; target: string; }
interface UpgradeRenameDirectoryMigrationEntry { id: string; kind: 'rename-directory'; reason: string; source: string; target: string; }
interface UpgradeConfigRewriteMigrationEntry { id: string; kind: 'config-rewrite'; reason: string; target: string; updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete'; }>; }
interface UpgradeJsonArrayAppendMigrationEntry { id: string; kind: 'json-array-append'; reason: string; target: string; path: string[]; items: unknown[]; }
interface UpgradeJsonArrayRemoveMigrationEntry { id: string; kind: 'json-array-remove'; reason: string; target: string; path: string[]; items: unknown[]; }
interface UpgradeJsonObjectMergeMigrationEntry { id: string; kind: 'json-object-merge'; reason: string; target: string; path: string[]; value: Record<string, unknown>; }
interface UpgradeTextAppendMigrationEntry { id: string; kind: 'text-append'; reason: string; target: string; content: string; }
interface UpgradeTextReplaceMigrationEntry { id: string; kind: 'text-replace'; reason: string; target: string; search: string; replacement: string; }
interface UpgradeCreateDirectoryMigrationEntry { id: string; kind: 'create-directory'; reason: string; target: string; }
interface UpgradeDeleteFileMigrationEntry { id: string; kind: 'delete-file'; reason: string; target: string; }
interface UpgradeDeleteDirectoryMigrationEntry { id: string; kind: 'delete-directory'; reason: string; target: string; }
interface UpgradeRenameFileMigrationEntry { id: string; kind: 'rename-file'; reason: string; source: string; target: string; }
interface UpgradeDbExpandContractMigrationEntry { id: string; kind: 'db-expand-contract'; reason: string; target: string; entity: string; expandField: string; contractField: string; copyJobCode?: string; }

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
  | UpgradeCreateDirectoryMigrationEntry
  | UpgradeDeleteFileMigrationEntry
  | UpgradeDeleteDirectoryMigrationEntry
  | UpgradeRenameFileMigrationEntry
  | UpgradeDbExpandContractMigrationEntry;
