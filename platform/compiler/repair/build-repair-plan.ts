import fs from 'node:fs/promises';
import { buildTaskEnvelope } from '../synthesize/build-task-envelope.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { writeProvenance } from '../emit/write-provenance.ts';
import type { LockFile, PlanFile, RepairPlan, RepairTask, VerificationReport } from '../../shared/types.ts';

function summarizeFailure(report: VerificationReport): string {
  return `build=${report.build.status}; unit=${report.unit.status}; acceptance=${report.acceptance.status}`;
}

export function buildRepairPlan(plan: PlanFile, lock: LockFile, report: VerificationReport): RepairPlan {
  if (report.summary.status === 'passed') {
    return {
      formatVersion: '1',
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      tasks: []
    };
  }

  const tasks: RepairTask[] = lock.slotTasks
    .filter((task) => task.status === 'filled' || task.status === 'verified' || task.status === 'failed')
    .map((task) => {
      const envelope = buildTaskEnvelope(plan, lock, task);
      return {
        taskId: `repair_slot_${task.id}`,
        taskKind: 'repair-slot',
        phase: 'repair',
        sourceSlotId: task.id,
        targetBlock: task.block,
        targetFile: task.target,
        allowedPaths: envelope.allowedPaths,
        requiredSymbols: envelope.requiredSymbols,
        forbiddenOperations: envelope.forbiddenOperations,
        testsToPass: envelope.testsToPass,
        failureSummary: summarizeFailure(report)
      };
    });

  if (tasks.length === 0) {
    throw new CompilerError('REPAIR-BLOCKED-001', 'No repairable slot tasks found for current verification failure');
  }

  return {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    tasks
  };
}

export async function writeRepairPlan(workspaceRoot: string, plan: RepairPlan, lock: LockFile): Promise<void> {
  const { repairPlanPath, lockPath } = getWorkspacePaths(workspaceRoot);
  await fs.writeFile(repairPlanPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  if (!lock.generatedPaths.includes('generated/repair-plan.json')) {
    lock.generatedPaths.push('generated/repair-plan.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
}
