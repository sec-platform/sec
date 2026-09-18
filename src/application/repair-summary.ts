import { uniqueSorted } from '../contracts/canonical.ts';
import type { RepairPlan } from '../semantics/repair/types.ts';

type RepairFailureView = Readonly<{
  lane: string;
  kind: string;
  issueType: string;
  repairable: boolean;
  message: string;
}>;

type RepairTaskReviewView = Readonly<{
  writeBounds: readonly string[];
  requiredSymbols: readonly string[];
  forbiddenOperations: readonly string[];
  testsToPass: readonly string[];
  failureTargets: readonly string[];
}>;

type RepairTaskView = Readonly<{
  taskId: string;
  targetBlock: string;
  targetFile: string;
  review: RepairTaskReviewView;
  preview?: Readonly<{
    beforeLines: number;
    afterLines: number;
    addedLines: number;
    removedLines: number;
    changed: boolean;
  }>;
  failurePoints: readonly RepairFailureView[];
}>;

type RepairBlockerView = Readonly<{
  blockerId: string;
  boundary: string;
  reason: string;
  failurePoints: readonly RepairFailureView[];
}>;

export type RepairSummaryView = Readonly<{
  status: RepairPlan['status'];
  presentation: 'ordinary' | 'dry-run' | 'verify-pending';
  taskCount: number;
  blockerCount: number;
  sourceVerificationStatus: RepairPlan['sourceVerificationStatus'];
  requiresVerification: boolean;
  tasks: readonly RepairTaskView[];
  blockers: readonly RepairBlockerView[];
}>;

function projectFailure(failure: RepairPlan['tasks'][number]['failurePoints'][number]): RepairFailureView {
  return {
    lane: failure.lane,
    kind: failure.kind,
    issueType: failure.issueType,
    repairable: failure.repairable,
    message: failure.message
  };
}

function projectTaskReview(task: RepairPlan['tasks'][number]): RepairTaskReviewView {
  const review = task.review;
  if (review) {
    return {
      writeBounds: [...review.writeBounds],
      requiredSymbols: [...review.requiredSymbols],
      forbiddenOperations: [...review.forbiddenOperations],
      testsToPass: [...review.testsToPass],
      failureTargets: [...review.failureTargets]
    };
  }

  return {
    writeBounds: [...task.allowedPaths],
    requiredSymbols: [...task.requiredSymbols],
    forbiddenOperations: [...task.forbiddenOperations],
    testsToPass: [...task.testsToPass],
    failureTargets: uniqueSorted(task.failurePoints.flatMap((point) => point.targetIds ?? []))
  };
}

export function projectRepairSummary(repairPlan: RepairPlan, dryRun: boolean): RepairSummaryView {
  return {
    status: repairPlan.status,
    presentation: repairPlan.status === 'applied' ? 'verify-pending' : dryRun ? 'dry-run' : 'ordinary',
    taskCount: repairPlan.tasks.length,
    blockerCount: repairPlan.blockers?.length ?? 0,
    sourceVerificationStatus: repairPlan.sourceVerificationStatus,
    requiresVerification: repairPlan.requiresVerification,
    tasks: repairPlan.tasks.slice(0, 3).map((task) => ({
      taskId: task.taskId,
      targetBlock: task.targetBlock,
      targetFile: task.targetFile,
      review: projectTaskReview(task),
      ...(task.preview ? {
        preview: {
          beforeLines: task.preview.beforeLines,
          afterLines: task.preview.afterLines,
          addedLines: task.preview.addedLines,
          removedLines: task.preview.removedLines,
          changed: task.preview.changed
        }
      } : {}),
      failurePoints: task.failurePoints.slice(0, 2).map(projectFailure)
    })),
    blockers: (repairPlan.blockers ?? []).slice(0, 3).map((blocker) => ({
      blockerId: blocker.blockerId,
      boundary: blocker.boundary,
      reason: blocker.reason,
      failurePoints: blocker.failurePoints.slice(0, 2).map(projectFailure)
    }))
  };
}
