import type { LockFile, PlanFile, UpgradePlan } from '../shared/types.ts';
import { upgradeWorkspace as runUpgradeWorkspace } from '../upgrade/upgrade-workspace.ts';

export async function upgradeWorkspace(
  workspaceRoot = process.cwd(),
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: boolean }
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: UpgradePlan }> {
  return runUpgradeWorkspace(workspaceRoot, blockId, targetVersion, options);
}
