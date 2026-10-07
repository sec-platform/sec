import path from 'node:path';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { readOptionalVerificationArtifactSet } from '../../adapters/verification/platform/artifact/runtime/authority.ts';
import { writeRepairPlan } from '../../adapters/verification/repair/write-repair-plan.ts';
import { readLockFile, saveLock } from '../../adapters/workspace/lock.ts';
import { buildRepairPlan } from '../../application/repair-plan.ts';
import {
  executeRepairWorkspaceAdmission,
  prepareRepairWorkspaceRequest,
  repairWorkspaceResult,
  type RepairWorkspaceOperations
} from '../../application/repair-workspace.ts';

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
) {
  workspaceRoot = path.resolve(workspaceRoot);
  const request = prepareRepairWorkspaceRequest(options);
  const baseOperations = {
    readLock: () => readLockFile(workspaceRoot),
    readVerification: () => readOptionalVerificationArtifactSet(
      workspaceRoot,
      'Repair Verification artifact set'
    ),
    buildPlan: buildRepairPlan
  };
  return executeRepairWorkspaceAdmission(request, {
    preview: () => repairWorkspaceResult(request, baseOperations),
    publish: () => withWorkspaceWriteLease(
      workspaceRoot,
      workspaceWriteLease,
      token => {
        const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
        const operations: RepairWorkspaceOperations = {
          ...baseOperations,
          publish: (repairPlan, lock, artifacts) =>
            writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence, artifacts),
          recordFailure: lock => saveLock(workspaceRoot, lock, commitFence)
        };
        return repairWorkspaceResult(request, operations);
      }
    )
  });
}
