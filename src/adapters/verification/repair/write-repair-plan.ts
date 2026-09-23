import { CI_ARTIFACT_FILES } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { LockFile } from '../../../compiler/contract.ts';
import { type CommitFence } from '../../../contracts/commit-fence.ts';
import { validateRepairPlan, type RepairPlan } from '../../../semantics/repair/types.ts';
import { writeProvenance } from '../../artifacts/provenance.ts';
import { writeJson } from '../../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../workspace-context.ts';
import { writeLockWithGeneratedPaths } from '../../workspace/lock.ts';

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
  await writeJson(repairPlanPath, validateRepairPlan(plan), commitFence);
  await writeLockWithGeneratedPaths(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.repairPlan],
    commitFence
  );
  await writeProvenance(workspaceRoot, lock, commitFence);
}
