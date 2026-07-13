import type { LockFile, PlanFile, UpgradePlan } from '../shared/types.ts';
import {
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { runUpgradeWorkspaceWithLease } from '../upgrade/upgrade-workspace.ts';

export async function upgradeWorkspace(
  workspaceRoot = process.cwd(),
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: boolean },
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: UpgradePlan }> {
  return withWorkspaceWriteLease(
    workspaceRoot,
    workspaceWriteLease,
    (lease) => runUpgradeWorkspaceWithLease(workspaceRoot, blockId, targetVersion, lease, options)
  );
}
