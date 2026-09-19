import type { LockFile, PlanFile } from '../compiler/contract.ts';

export interface PlannedUpgradeApplyInput {
  readonly currentBlock: PlanFile['blocks'][number];
  readonly plan: PlanFile;
  readonly targetVersion: string;
}

export interface PlannedUpgradeApplyOperations {
  publishWorkspacePlan(plan: PlanFile): Promise<void>;
  applyMigrations(): Promise<void>;
  compileLock(): Promise<LockFile>;
}

/**
 * Apply one already-planned Upgrade. This use case owns ordering and the plan
 * state transition; physical publication/migration/compiler providers are
 * supplied by bootstrap.
 */
export async function executePlannedWorkspaceUpgrade(
  input: PlannedUpgradeApplyInput,
  operations: PlannedUpgradeApplyOperations
): Promise<LockFile> {
  input.currentBlock.version = input.targetVersion;
  await operations.publishWorkspacePlan(input.plan);
  await operations.applyMigrations();
  return operations.compileLock();
}
