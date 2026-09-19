import path from 'node:path';
import {
  prepareRepairWorkspaceRequest,
  repairWorkspaceResult,
  type RepairWorkspaceOperations
} from '../../application/repair-workspace.ts';
import { readOptionalRetainedJson } from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { resolveWorkspaceArtifactPath } from '../../adapters/workspace-context.ts';
import { readLockFile, saveLock } from '../../adapters/workspace/lock.ts';
import {
  buildRepairPlan,
  writeRepairPlan
} from '../../adapters/verification/repair/build-repair-plan.ts';

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
) {
  workspaceRoot = path.resolve(workspaceRoot);
  const request = prepareRepairWorkspaceRequest(options);
  const verificationReportPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.verificationReport
  );
  const baseOperations = {
    readLock: () => readLockFile(workspaceRoot),
    readVerification: () => readOptionalRetainedJson<VerificationReport>(
      verificationReportPath,
      'Repair Verification report'
    ),
    buildPlan: buildRepairPlan
  };
  if (request.mode === 'preview') {
    return repairWorkspaceResult(request, baseOperations);
  }
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, token => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const operations: RepairWorkspaceOperations = {
      ...baseOperations,
      publish: (repairPlan, lock) => writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence),
      recordFailure: lock => saveLock(workspaceRoot, lock, commitFence)
    };
    return repairWorkspaceResult(request, operations);
  });
}
