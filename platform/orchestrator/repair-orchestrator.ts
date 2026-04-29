import fs from 'node:fs/promises';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { applyRepairPlan, buildRepairPlan, previewRepairPlan, writeRepairPlan } from '../compiler/repair/build-repair-plan.ts';
import { CompilerError } from '../shared/errors.ts';
import { readJson } from '../shared/fs.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath, resolveWorkspacePlanPath } from '../shared/paths.ts';
import type { RepairPlan } from '../shared/repair-types.ts';
import type { LockFile } from '../shared/types.ts';
import type { VerificationReport } from '../shared/verification-types.ts';

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {}
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));

  if (lock.passStatus.verify === 'pending') {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair');
  }

  const report = await readJson<VerificationReport>(verificationReportPath);

  try {
    const repairPlan = buildRepairPlan(plan, lock, report);
    if (repairPlan.status === 'blocked') {
      lock.passStatus.repair = 'failed';
      await writeRepairPlan(workspaceRoot, repairPlan, lock);
      throw new CompilerError(
        'REPAIR-BLOCKED-001',
        repairPlan.blockers?.[0]?.reason ?? 'Repair is blocked for current verification failure',
        { blockers: repairPlan.blockers ?? [] }
      );
    }
    if (repairPlan.status === 'pending') {
      if (options.dryRun) {
        await previewRepairPlan(workspaceRoot, plan, lock, repairPlan);
        await writeRepairPlan(workspaceRoot, repairPlan, lock);
        return { lock, repairPlan };
      }
      await applyRepairPlan(workspaceRoot, plan, lock, repairPlan);
      repairPlan.status = 'applied';
      repairPlan.requiresVerification = true;
      lock.passStatus.verify = 'pending';
      lock.passStatus.repair = 'succeeded';
    } else {
      lock.passStatus.repair = 'skipped';
    }
    await writeRepairPlan(workspaceRoot, repairPlan, lock);
    return { lock, repairPlan };
  } catch (error) {
    lock.passStatus.repair = 'failed';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    throw error;
  }
}
