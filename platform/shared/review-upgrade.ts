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
