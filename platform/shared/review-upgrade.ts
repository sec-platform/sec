import { countMatching, uniqueSorted } from './collections.ts';
import type {
  UpgradeDiagnostics,
  UpgradeDiagnosticsPhase,
  UpgradeMigrationOperation,
  UpgradePlan,
  UpgradePreflightCheck
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

function upgradePreflightSummaryGroup(checkId: string): string {
  return checkId.startsWith('migration-') ? 'migration' : checkId.split('-')[0];
}

function buildReviewUpgradeDiagnosticsSummary(diagnostics: UpgradeDiagnostics): ReviewUpgradeDiagnosticsSummary {
  return {
    status: diagnostics.status,
    phase: diagnostics.phase ?? 'planning',
    failedCheck: diagnostics.failedCheck,
    errorCode: diagnostics.errorCode,
    message: diagnostics.message,
    ...(diagnostics.details === undefined ? {} : { details: diagnostics.details })
  };
}

function buildReviewUpgradeMigrationKindCounts(plan: UpgradePlan): Record<string, number> {
  return Object.keys(plan.migrationKindCounts).length > 0
    ? plan.migrationKindCounts
    : plan.migrationSummaries.reduce<Record<string, number>>((counts, migration) => {
        counts[migration.kind] = (counts[migration.kind] ?? 0) + 1;
        return counts;
      }, {});
}

function buildReviewUpgradeMigrationSummaries(plan: UpgradePlan): ReviewUpgradeMigrationSummary[] {
  return plan.migrationSummaries
    .map((migration) => ({
      id: migration.id,
      kind: migration.kind,
      target: migration.target,
      reason: migration.reason,
      requiresVerification: migration.requiresVerification,
      ...(migration.source ? { source: migration.source } : {}),
      ...(migration.slotId ? { slotId: migration.slotId } : {})
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildReviewUpgradeMigrationOperationSummaries(plan: UpgradePlan): ReviewUpgradeMigrationOperationSummary[] {
  return plan.migrationOperations
    .map((operation) => ({
      ...operation,
      ...(operation.writableZones ? { writableZones: [...operation.writableZones] } : {}),
      ...(operation.path ? { path: [...operation.path] } : {})
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildReviewUpgradePreflightSummaries(
  preflightChecks: readonly UpgradePreflightCheck[]
): ReviewUpgradePreflightSummary[] {
  const groups = preflightChecks.reduce<Map<string, { checkCount: number; evidenceCount: number }>>(
    (summaries, check) => {
      const group = upgradePreflightSummaryGroup(check.id);
      const current = summaries.get(group) ?? { checkCount: 0, evidenceCount: 0 };
      current.checkCount += 1;
      current.evidenceCount += check.evidence.length;
      summaries.set(group, current);
      return summaries;
    },
    new Map()
  );

  return [...groups.entries()]
    .map(([group, summary]) => ({ group, ...summary }))
    .sort((left, right) => left.group.localeCompare(right.group));
}

export function buildReviewUpgradeSummary(
  upgradePlan: UpgradePlan | null,
  diagnostics: UpgradeDiagnostics | null
): ReviewUpgradeSummary | undefined {
  if (!upgradePlan) {
    if (!diagnostics) {
      return undefined;
    }

    return {
      status: 'blocked',
      blockId: diagnostics.blockId,
      toVersion: diagnostics.targetVersion,
      preflightCheckCount: 0,
      preflightEvidenceCount: 0,
      migrationCount: 0,
      migrationKindCounts: {},
      requiresVerification: false,
      requiresVerificationCount: 0,
      impactCount: 0,
      impacts: [],
      sourceMigrationCount: 0,
      slotMigrationCount: 0,
      verificationSummaries: [
        { id: 'required', count: 0 },
        { id: 'skipped', count: 0 }
      ],
      preflightSummaries: [],
      migrationSummaries: [],
      migrationOperationCount: 0,
      migrationOperationSummaries: [],
      diagnostics: buildReviewUpgradeDiagnosticsSummary(diagnostics)
    };
  }

  const plan = upgradePlan;
  const requiresVerificationCount = countMatching(
    plan.migrationSummaries,
    (migration) => migration.requiresVerification
  );
  const skippedVerificationCount = plan.migrationSummaries.length - requiresVerificationCount;
  const migrationSummaries = buildReviewUpgradeMigrationSummaries(plan);
  const migrationOperationSummaries = buildReviewUpgradeMigrationOperationSummaries(plan);

  return {
    status: diagnostics ? 'blocked' : plan.status,
    blockId: plan.blockId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    preflightCheckCount: plan.preflightChecks.length,
    preflightEvidenceCount: plan.preflightChecks.reduce(
      (total, check) => total + check.evidence.length,
      0
    ),
    migrationCount: plan.migrationSummaries.length,
    migrationKindCounts: buildReviewUpgradeMigrationKindCounts(plan),
    requiresVerification: requiresVerificationCount > 0 || plan.status === 'applied',
    requiresVerificationCount,
    impactCount: plan.impacts.length,
    impacts: uniqueSorted(plan.impacts),
    sourceMigrationCount: countMatching(migrationSummaries, (migration) => migration.source !== undefined),
    slotMigrationCount: countMatching(migrationSummaries, (migration) => migration.slotId !== undefined),
    verificationSummaries: [
      { id: 'required', count: requiresVerificationCount },
      { id: 'skipped', count: skippedVerificationCount }
    ],
    preflightSummaries: buildReviewUpgradePreflightSummaries(plan.preflightChecks),
    migrationSummaries,
    migrationOperationCount: migrationOperationSummaries.length,
    migrationOperationSummaries,
    ...(diagnostics ? { diagnostics: buildReviewUpgradeDiagnosticsSummary(diagnostics) } : {})
  };
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
