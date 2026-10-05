import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { type CommitFence } from '../../../contracts/commit-fence.ts';
import { validateRepairPlan, type RepairPlan } from '../../../semantics/repair/types.ts';
import { writeProvenance } from '../../artifacts/provenance.ts';
import { writeJson } from '../../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace-context.ts';
import { writeLockWithGeneratedPaths } from '../../workspace/lock.ts';
import { readOptionalVerificationArtifactSet } from '../platform/artifact/runtime/authority.ts';

export async function writeRepairPlan(
  workspaceRoot: string,
  plan: RepairPlan,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<void> {
  const repairPlanPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.repairPlan
  );
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );
  const validatedPlan = validateRepairPlan(plan);
  // Reject malformed/partial publication input before the first plan or Lock
  // effect. Absence remains valid for this low-level provenance writer; the
  // repair application separately requires a current, subject-bound result.
  readOptionalVerificationArtifactSet(workspaceRoot, 'Repair publication Verification artifact set');
  await writeJson(repairPlanPath, validatedPlan, commitFence);
  await writeLockWithGeneratedPaths(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.repairPlan],
    commitFence
  );
  await writeProvenance(workspaceRoot, lock, commitFence);
}
