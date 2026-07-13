import { loadWorkspacePlan } from '../compiler/parse/load-plan.ts';
import {
  applyRepairPlan,
  buildRepairPlan,
  previewRepairPlan,
  writeRepairPlan
} from '../compiler/repair/build-repair-plan.ts';
import { CompilerError } from '../shared/errors.ts';
import { readJson } from '../shared/fs.ts';
import { assertPassStatus, readLockFile, saveLock } from '../shared/lock-utils.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import type { RepairPlan } from '../shared/repair-types.ts';
import type { LockFile } from '../shared/types.ts';
import type { VerificationReport } from '../shared/verification-types.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const plan = await loadWorkspacePlan(workspaceRoot);
    const lock = await readLockFile(workspaceRoot);

    assertPassStatus(lock, 'verify', 'pending', new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair'), 'differs');

    const report = await readJson<VerificationReport>(verificationReportPath);

    try {
      const repairPlan = buildRepairPlan(plan, lock, report);
      if (repairPlan.status === 'blocked') {
        lock.passStatus.repair = 'failed';
        await writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence);
        throw new CompilerError(
          'REPAIR-BLOCKED-001',
          repairPlan.blockers?.[0]?.reason ?? 'Repair is blocked for current verification failure',
          { blockers: repairPlan.blockers ?? [] }
        );
      }
      if (repairPlan.status === 'pending') {
        if (options.dryRun) {
          await previewRepairPlan(workspaceRoot, plan, lock, repairPlan);
          await writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence);
          return { lock, repairPlan };
        }
        await applyRepairPlan(workspaceRoot, plan, lock, repairPlan, commitFence);
        repairPlan.status = 'applied';
        repairPlan.requiresVerification = true;
        lock.passStatus.verify = 'pending';
        lock.passStatus.repair = 'succeeded';
      } else {
        lock.passStatus.repair = 'skipped';
      }
      await writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence);
      return { lock, repairPlan };
    } catch (error) {
      lock.passStatus.repair = 'failed';
      await saveLock(workspaceRoot, lock, commitFence);
      throw error;
    }
  });
}
