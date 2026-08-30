import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { RepairPlan } from '../../semantic/repair/contract/types.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../workspace/lease.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import type {
  LockFile,
  PlanFile
} from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { assertPassStatus, readLockFile, saveLock } from '../lock.ts';
import { loadWorkspacePlan } from '../parse/load-plan.ts';
import {
  applyRepairPlan,
  buildRepairPlan,
  previewRepairPlan,
  writeRepairPlan
} from '../repair/build-repair-plan.ts';

type RepairInputs = Readonly<{
  plan: PlanFile;
  lock: LockFile;
  repairPlan: RepairPlan;
}>;

function loadRepairInputs(workspaceRoot: string): RepairInputs {
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const plan = loadWorkspacePlan(workspaceRoot);
  const lock = readLockFile(workspaceRoot);

  assertPassStatus(
    lock,
    'verify',
    'pending',
    new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair'),
    'differs'
  );

  const report = readOptionalRetainedJson<VerificationReport>(
    verificationReportPath,
    'Repair Verification report'
  );
  if (report === null) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verification-report.json is missing');
  }

  return Object.freeze({
    plan,
    lock,
    repairPlan: buildRepairPlan(plan, lock, report)
  });
}

async function previewRepairWorkspace(workspaceRoot: string): Promise<RepairInputs> {
  const inputs = loadRepairInputs(workspaceRoot);
  if (inputs.repairPlan.status === 'pending') {
    await previewRepairPlan(workspaceRoot, inputs.plan, inputs.lock, inputs.repairPlan);
  }
  // Preview is an observation only. A blocked/skipped plan is useful preview
  // output and must not mutate Lock status or persist a control artifact.
  return inputs;
}

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  if (options.dryRun) {
    const { lock, repairPlan } = await previewRepairWorkspace(workspaceRoot);
    return { lock, repairPlan };
  }

  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { plan, lock, repairPlan } = loadRepairInputs(workspaceRoot);

    try {
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
