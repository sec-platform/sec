import fs from 'node:fs/promises';
import { buildTaskEnvelope } from '../synthesize/build-task-envelope.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { writeProvenance } from '../emit/write-provenance.ts';
import type { LockFile, PlanFile, RepairFailurePoint, RepairPlan, RepairTask, VerificationReport } from '../../shared/types.ts';

function summarizeFailure(report: VerificationReport): string {
  return `build=${report.build.status}; unit=${report.unit.status}; acceptance=${report.acceptance.status}; policy=${report.policy.status}; runtime=${report.runtime.status}`;
}

function buildFailurePoints(report: VerificationReport): RepairFailurePoint[] {
  const points: RepairFailurePoint[] = [];

  if (report.build.status === 'failed') {
    points.push({
      lane: 'fast',
      kind: 'build',
      issueType: 'unknown',
      repairable: false,
      artifactPath: 'generated/verification-report.json',
      message: report.fast.logs.stderr || 'Typecheck failed'
    });
  }
  if (report.unit.status === 'failed') {
    points.push({
      lane: 'fast',
      kind: 'unit',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'tests/unit',
      message: report.fast.logs.stderr || 'Unit verification failed'
    });
  }
  if (report.acceptance.status === 'failed') {
    points.push({
      lane: 'fast',
      kind: 'acceptance',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'tests/acceptance',
      message: report.fast.logs.stderr || 'Acceptance verification failed'
    });
  }
  if (report.policy.status === 'failed') {
    points.push({
      lane: 'fast',
      kind: 'policy',
      issueType: 'spec',
      repairable: false,
      artifactPath: 'generated/policy-report.json',
      message: report.policy.violations.map((violation) => violation.message).join('; ') || 'Policy verification failed'
    });
  }
  if (report.runtime.build.status === 'failed') {
    points.push({
      lane: 'runtime',
      kind: 'runtime-build',
      issueType: 'kernel',
      repairable: false,
      artifactPath: 'generated/runtime-report.json',
      message: report.runtime.logs.stderr || 'Runtime build failed'
    });
  }
  if (report.runtime.unit.status === 'failed') {
    points.push({
      lane: 'runtime',
      kind: 'runtime-unit',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'generated/runtime-report.json',
      message: report.runtime.logs.stderr || 'Runtime unit verification failed'
    });
  }
  if (report.runtime.acceptance.status === 'failed') {
    points.push({
      lane: 'runtime',
      kind: 'runtime-acceptance',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'generated/runtime-report.json',
      message: report.runtime.logs.stderr || 'Runtime acceptance verification failed'
    });
  }

  return points.length > 0
    ? points
    : [
        {
          lane: 'all',
          kind: 'summary',
          issueType: 'unknown',
          repairable: false,
          artifactPath: 'generated/verification-report.json',
          message: 'Verification failed without lane-specific failure details'
        }
      ];
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

  const failurePoints = buildFailurePoints(report);
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
        failureSummary: summarizeFailure(report),
        failurePoints
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
