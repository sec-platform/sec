import type { UpgradeMigrationEntry } from '../../src/change-management/upgrade/contract/manifest-types.ts';
import { applyMigrationEntries as applyMigrationEntriesWithFence } from '../../src/change-management/upgrade/upgrade-workspace.ts';

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
