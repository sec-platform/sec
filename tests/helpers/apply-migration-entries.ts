import type { UpgradeMigrationEntry } from '../../platform/shared/plan-manifest-types.ts';
import { applyMigrationEntries as applyMigrationEntriesWithFence } from '../../platform/upgrade/upgrade-workspace.ts';

const testCommitFence = async (): Promise<void> => undefined;

export function applyMigrationEntries(
  projectRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entries: UpgradeMigrationEntry[]
): Promise<void> {
  return applyMigrationEntriesWithFence(
    projectRoot,
    targetManifestRoot,
    impacts,
    entries,
    testCommitFence
  );
}
