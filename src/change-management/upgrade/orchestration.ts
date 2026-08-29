import type { LockFile, PlanFile } from '../../compiler/contract.ts';
import { withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../workspace/lease.ts';
import type { UpgradePlan } from './contract/types.ts';
import { planUpgradeWorkspace, runUpgradeWorkspaceWithLease } from './upgrade-workspace.ts';

export async function upgradeWorkspace(
  workspaceRoot = process.cwd(),
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: boolean },
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: UpgradePlan }> {
  if (options?.dryRun) {
    return planUpgradeWorkspace(workspaceRoot, blockId, targetVersion);
  }

  return withWorkspaceWriteLease(
    workspaceRoot,
    workspaceWriteLease,
    (lease) => runUpgradeWorkspaceWithLease(workspaceRoot, blockId, targetVersion, lease)
  );
}
