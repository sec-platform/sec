import type { UpgradeMigrationEntry } from '../../src/semantics/upgrade/manifest-types.ts';
import { applyMigrationEntries as applyMigrationEntriesWithFence } from '../../src/bootstrap/upgrade/upgrade-workspace.ts';

const testCommitFence = async (): Promise<void> => undefined;

export function applyMigrationEntries(
  workspaceRoot: string,
  targetManifestRoot: string,
  impacts: string[],
  entries: UpgradeMigrationEntry[]
): Promise<void> {
  return applyMigrationEntriesWithFence(
    workspaceRoot,
    targetManifestRoot,
    impacts,
    entries,
    testCommitFence
  );
}
