import path from 'node:path';
import { withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { planUpgradeWorkspace, runUpgradeWorkspaceWithLease } from './upgrade-workspace.ts';

export type UpgradeWorkspaceResult =
  | Awaited<ReturnType<typeof planUpgradeWorkspace>>
  | Awaited<ReturnType<typeof runUpgradeWorkspaceWithLease>>;

export function upgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  options: { dryRun: true },
  workspaceWriteLease?: never
): Promise<Awaited<ReturnType<typeof planUpgradeWorkspace>>>;
export function upgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: false },
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<Awaited<ReturnType<typeof runUpgradeWorkspaceWithLease>>>;
export function upgradeWorkspace(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  options: { dryRun: boolean },
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<UpgradeWorkspaceResult>;
export async function upgradeWorkspace(
  workspaceRoot = process.cwd(),
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: boolean },
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<UpgradeWorkspaceResult> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (options?.dryRun) {
    return planUpgradeWorkspace(workspaceRoot, blockId, targetVersion);
  }

  return withWorkspaceWriteLease(
    workspaceRoot,
    workspaceWriteLease,
    (lease) => runUpgradeWorkspaceWithLease(workspaceRoot, blockId, targetVersion, lease)
  );
}
