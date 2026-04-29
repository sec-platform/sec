import type {
  UpgradeDiagnosticsPhase,
  UpgradeMigrationOperation
} from './upgrade-types.ts';

export interface ReviewUpgradePreflightSummary {
  group: string;
  checkCount: number;
  evidenceCount: number;
}

export interface ReviewUpgradeMigrationSummary {
  id: string;
  kind: string;
  target: string;
  reason: string;
  requiresVerification: boolean;
  source?: string;
  slotId?: string;
}

export type ReviewUpgradeMigrationOperationSummary = UpgradeMigrationOperation;

export interface ReviewUpgradeVerificationSummary {
  id: 'required' | 'skipped';
  count: number;
}

export interface ReviewUpgradeDiagnosticsSummary {
  status: 'blocked';
  phase: UpgradeDiagnosticsPhase;
  failedCheck: string;
  errorCode: string;
  message: string;
  details?: unknown;
}

export interface ReviewUpgradeSummary {
  status: 'planned' | 'applied' | 'blocked';
  blockId: string;
  fromVersion?: string;
  toVersion: string;
  preflightCheckCount: number;
  preflightEvidenceCount: number;
  migrationCount: number;
  migrationKindCounts: Record<string, number>;
  requiresVerification: boolean;
  requiresVerificationCount: number;
  impactCount: number;
  impacts: string[];
  sourceMigrationCount: number;
  slotMigrationCount: number;
  verificationSummaries: ReviewUpgradeVerificationSummary[];
  preflightSummaries: ReviewUpgradePreflightSummary[];
  migrationSummaries: ReviewUpgradeMigrationSummary[];
  migrationOperationCount: number;
  migrationOperationSummaries: ReviewUpgradeMigrationOperationSummary[];
  diagnostics?: ReviewUpgradeDiagnosticsSummary;
}

function readUpgradeDiagnosticsString(details: unknown, key: string): string | null {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return null;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function upgradeDiagnosticsAttributionParts(details: unknown): string[] {
  const migrationId = readUpgradeDiagnosticsString(details, 'migrationId');
  if (!migrationId) {
    return [];
  }

  const role = readUpgradeDiagnosticsString(details, 'role');
  const path = readUpgradeDiagnosticsString(details, 'path');
  const migrationKind = readUpgradeDiagnosticsString(details, 'migrationKind');
  const target = readUpgradeDiagnosticsString(details, 'target')
    ?? (role === 'target' ? path : null);
  const source = readUpgradeDiagnosticsString(details, 'source')
    ?? (role === 'source' ? path : null);
  const slotId = readUpgradeDiagnosticsString(details, 'slotId');
  const entry = readUpgradeDiagnosticsString(details, 'entry');
  const entryId = readUpgradeDiagnosticsString(details, 'entryId');
  const entryKind = readUpgradeDiagnosticsString(details, 'entryKind');
  const rollbackStatus = readUpgradeDiagnosticsString(details, 'rollbackStatus');

  return [
    `migration=${migrationId}`,
    migrationKind ? `kind=${migrationKind}` : '',
    entry ? `entry=${entry}` : '',
    entryId ? `entryId=${entryId}` : '',
    entryKind ? `entryKind=${entryKind}` : '',
    target ? `target=${target}` : '',
    source ? `source=${source}` : '',
    slotId ? `slot=${slotId}` : '',
    rollbackStatus ? `rollback=${rollbackStatus}` : ''
  ].filter((part) => part.length > 0);
}
