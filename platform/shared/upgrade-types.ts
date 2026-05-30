import type { UpgradeMigration } from './plan-manifest-types.ts';

export type UpgradeMigrationOperationRole = 'file' | 'directory' | 'json' | 'text' | 'slot' | 'prisma';

export interface UpgradeMigrationOperation {
  id: string;
  kind: string;
  target: string;
  role: UpgradeMigrationOperationRole;
  source?: string;
  slotId?: string;
  inputType?: string;
  outputType?: string;
  writableZones?: string[];
  path?: string[];
  updateCount?: number;
  itemCount?: number;
  valueKeyCount?: number;
  contentLength?: number;
  searchLength?: number;
  replacementLength?: number;
  pattern?: string;
  flags?: string;
  entity?: string;
  expandField?: string;
  contractField?: string;
}

export interface UpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  slotId?: string;
  source?: string;
}

export type UpgradePreflightCheckId =
  | 'version-range'
  | 'migration-entries'
  | 'migration-targets'
  | 'migration-file-operations'
  | 'migration-json-shapes'
  | 'migration-json-structure'
  | 'migration-text-patterns'
  | 'migration-slot-contracts'
  | 'impact-scan'
  | 'override-conflicts';

export interface UpgradePreflightCheck {
  id: UpgradePreflightCheckId;
  status: 'passed';
  message: string;
  evidence: string[];
}

export interface UpgradePlan {
  formatVersion: string;
  blockId: string;
  fromVersion: string;
  toVersion: string;
  status: 'planned' | 'applied';
  preflightChecks: UpgradePreflightCheck[];
  impacts: string[];
  migrations: UpgradeMigration[];
  migrationKindCounts: Record<string, number>;
  migrationSummaries: UpgradeMigrationSummary[];
  migrationOperations: UpgradeMigrationOperation[];
}

export type UpgradeDiagnosticsPhase = 'planning' | 'apply';

export interface UpgradeDiagnostics {
  formatVersion: string;
  status: 'blocked';
  phase: UpgradeDiagnosticsPhase;
  blockId: string;
  targetVersion: string;
  failedCheck: UpgradePreflightCheckId | 'target-manifest' | 'plan-block';
  errorCode: string;
  message: string;
  details?: unknown;
}
