import path from 'node:path';

import {
  executeUpgradeWorkspace,
  prepareUpgradeWorkspaceRequest
} from '../../application/upgrade-workspace.ts';
import {
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../../adapters/filesystem/write-lease.ts';
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
  const request = prepareUpgradeWorkspaceRequest(options);
  return executeUpgradeWorkspace(request, {
    preview: () => planUpgradeWorkspace(workspaceRoot, blockId, targetVersion),
    apply: () => withWorkspaceWriteLease(
      workspaceRoot,
      workspaceWriteLease,
      lease => runUpgradeWorkspaceWithLease(workspaceRoot, blockId, targetVersion, lease)
    )
  });
}
