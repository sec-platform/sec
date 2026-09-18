import type { CountSummary } from '../../contracts/collections.ts';
import type { UpgradePlanningView } from '../../application/upgrade-planning.ts';
import { formatFields, formatList, optionalFields } from './format-utils.ts';

function formatCountSummaries(entries: readonly CountSummary<string>[]): string {
  return formatList(entries.map((entry) => `${entry.id}=${entry.count}`));
}

function formatMigration(migration: UpgradePlanningView['migrations'][number]): string {
  return formatFields([
    `Migration ${migration.id}: ${migration.kind}`,
    `target=${migration.target}`,
    ...optionalFields([
      [migration.source, `source=${migration.source}`],
      [migration.role, `role=${migration.role}`],
      [migration.path, `path=${migration.path?.join('.')}`],
      [migration.updateCount, `updates=${migration.updateCount}`],
      [migration.itemCount, `items=${migration.itemCount}`],
      [migration.valueKeyCount, `valueKeys=${migration.valueKeyCount}`],
      [migration.contentLength, `contentLength=${migration.contentLength}`],
      [migration.searchLength, `searchLength=${migration.searchLength}`],
      [migration.replacementLength, `replacementLength=${migration.replacementLength}`],
      [migration.pattern, `pattern=${migration.pattern}`],
      [migration.flags, `flags=${migration.flags}`]
    ]),
    `requiresVerification=${migration.requiresVerification}`
  ]);
}

export function formatUpgradePlanning(view: UpgradePlanningView): string {
  const suffix = view.presentation === 'preview' ? ' (dry-run)' : '';
  return [
    `Upgrade ${view.blockId} ${view.fromVersion} -> ${view.toVersion}${suffix}`,
    formatFields([
      `Status: ${view.presentation}`,
      `migrations: ${view.migrationCount}`,
      `preflight checks: ${view.preflightCheckCount}`
    ]),
    `Migration kinds: ${formatCountSummaries(view.migrationKindCounts)}`,
    `Operation roles: ${formatCountSummaries(view.operationRoleCounts)}`,
    `Impacts: ${formatList([...view.impacts])}`,
    `Preflight evidence: ${view.preflightEvidenceCount}`,
    `Requires verification: ${view.requiresVerificationCount > 0} (${view.requiresVerificationCount} migrations)`,
    ...view.migrations.map(formatMigration),
    ...view.preflightChecks.map((check) =>
      formatFields([`Preflight ${check.id}: ${check.status}`, `evidence=${check.evidenceCount}`])
    )
  ].join('\n');
}
