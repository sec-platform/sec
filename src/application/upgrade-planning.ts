import { compareCodeUnits } from '../contracts/canonical.ts';
import { summarizeCounts, type CountSummary } from '../contracts/collections.ts';
import type {
  UpgradeExecutionTerminal,
  UpgradePlan,
  UpgradePreview
} from '../semantics/upgrade/upgrade-artifact.ts';

type UpgradePlanningMaterial = UpgradePlan | UpgradePreview;

type UpgradeMigrationView = Readonly<{
  id: string;
  kind: string;
  target: string;
  source?: string;
  role?: string;
  path?: readonly string[];
  updateCount?: number;
  itemCount?: number;
  valueKeyCount?: number;
  contentLength?: number;
  searchLength?: number;
  replacementLength?: number;
  pattern?: string;
  flags?: string;
  requiresVerification: boolean;
}>;

type UpgradePreflightView = Readonly<{
  id: string;
  status: string;
  evidenceCount: number;
}>;

export type UpgradePlanningView = Readonly<{
  blockId: string;
  fromVersion: string;
  toVersion: string;
  presentation: 'preview' | 'planned' | 'applied';
  migrationCount: number;
  preflightCheckCount: number;
  migrationKindCounts: readonly CountSummary<string>[];
  operationRoleCounts: readonly CountSummary<string>[];
  impacts: readonly string[];
  preflightEvidenceCount: number;
  requiresVerificationCount: number;
  migrations: readonly UpgradeMigrationView[];
  preflightChecks: readonly UpgradePreflightView[];
}>;

function projectCountRecord(record: Readonly<Record<string, number>>): readonly CountSummary<string>[] {
  return Object.entries(record)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([id, count]) => ({ id, count }));
}

function projectUpgradePlanning(
  plan: UpgradePlanningMaterial,
  presentation: UpgradePlanningView['presentation']
): UpgradePlanningView {
  const operationsById = new Map(plan.migrationOperations.map((operation) => [operation.id, operation]));
  const migrations = plan.migrationSummaries.slice(0, 3).map((migration) => {
    const operation = operationsById.get(migration.id);
    return {
      id: migration.id,
      kind: migration.kind,
      target: migration.target,
      ...(migration.source ? { source: migration.source } : {}),
      ...(operation?.role === undefined ? {} : { role: operation.role }),
      ...(operation?.path === undefined ? {} : { path: [...operation.path] }),
      ...(operation?.updateCount === undefined ? {} : { updateCount: operation.updateCount }),
      ...(operation?.itemCount === undefined ? {} : { itemCount: operation.itemCount }),
      ...(operation?.valueKeyCount === undefined ? {} : { valueKeyCount: operation.valueKeyCount }),
      ...(operation?.contentLength === undefined ? {} : { contentLength: operation.contentLength }),
      ...(operation?.searchLength === undefined ? {} : { searchLength: operation.searchLength }),
      ...(operation?.replacementLength === undefined ? {} : { replacementLength: operation.replacementLength }),
      ...(operation?.pattern === undefined ? {} : { pattern: operation.pattern }),
      ...(operation?.flags === undefined ? {} : { flags: operation.flags }),
      requiresVerification: migration.requiresVerification
    };
  });

  return {
    blockId: plan.blockId,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    presentation,
    migrationCount: plan.migrations.length,
    preflightCheckCount: plan.preflightChecks.length,
    migrationKindCounts: projectCountRecord(plan.migrationKindCounts),
    operationRoleCounts: summarizeCounts(plan.migrationOperations.map((operation) => operation.role)),
    impacts: [...plan.impacts],
    preflightEvidenceCount: plan.preflightChecks.reduce((count, check) => count + check.evidence.length, 0),
    requiresVerificationCount: plan.migrationSummaries.filter((migration) => migration.requiresVerification).length,
    migrations,
    preflightChecks: plan.preflightChecks.slice(0, 3).map((check) => ({
      id: check.id,
      status: check.status,
      evidenceCount: check.evidence.length
    }))
  };
}

export function projectUpgradePreview(preview: UpgradePreview): UpgradePlanningView {
  return projectUpgradePlanning(preview, 'preview');
}

export function projectUpgradePlan(
  plan: UpgradePlan,
  executionTerminal: UpgradeExecutionTerminal | null
): UpgradePlanningView {
  return projectUpgradePlanning(
    plan,
    executionTerminal?.settlement === 'applied' ? 'applied' : 'planned'
  );
}
