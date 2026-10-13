import path from 'node:path';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { readOptionalCurrentVerificationPublication } from '../../adapters/verification/platform/artifact/runtime/authority.ts';
import { writeRepairPlan } from '../../adapters/verification/repair/write-repair-plan.ts';
import { readLockFile, saveLock } from '../../adapters/workspace/lock.ts';
import { buildRepairPlan } from '../../application/repair-plan.ts';
import {
  executeRepairWorkspaceAdmission,
  prepareRepairWorkspaceRequest,
  repairWorkspaceResult,
  type RepairWorkspaceOperations
} from '../../application/repair-workspace.ts';
import type { VerificationArtifactPublicationArtifacts } from '../../assurance/verification/artifact/publication.ts';
import type { LockFile } from '../../compiler/contract.ts';

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
) {
  workspaceRoot = path.resolve(workspaceRoot);
  const request = prepareRepairWorkspaceRequest(options);
  let verification: VerificationArtifactPublicationArtifacts | null = null;
  const baseOperations = {
    readLock: () => readLockFile(workspaceRoot),
    readVerification: (lock: LockFile) => {
      verification = readOptionalCurrentVerificationPublication(
        workspaceRoot, lock, 'Repair Verification artifact set'
      );
      return verification?.verificationReport ?? null;
    },
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
          publish: (repairPlan, lock) =>
            writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence, verification ?? undefined),
          recordFailure: lock => saveLock(workspaceRoot, lock, commitFence)
        };
        return repairWorkspaceResult(request, operations);
      }
    )
  });
}
