import fs from 'node:fs/promises';
import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, toProjectRuntimePath } from '../../shared/paths.ts';
import type { PlanFile } from '../../shared/plan-manifest-types.ts';
import type {
  RepairBlocker,
  RepairFailurePoint,
  RepairPlan,
  RepairTask,
  RepairTaskPreview
} from '../../shared/repair-types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { writeProvenance } from '../emit/write-provenance.ts';
import { buildTaskEnvelope } from '../synthesize/build-task-envelope.ts';
import { synthesizeSlotSource } from '../synthesize/mock-slot-synthesizer.ts';

function summarizeFailure(report: VerificationReport): string {
  return `build=${report.build.status}; unit=${report.unit.status}; acceptance=${report.acceptance.status}; policy=${report.policy.status}; runtime=${report.runtime.status}`;
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.endsWith('\n') ? value.split('\n').length - 1 : value.split('\n').length;
}

function addFailedRepairPoint(
  points: RepairFailurePoint[],
  status: 'passed' | 'failed' | 'skipped',
  point: RepairFailurePoint
): void {
  if (status === 'failed') points.push(point);
}

function projectRelativeImport(fromFile: string, toFile: string): string {
  const relativePath = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function rebaseRelativeImports(source: string, fromFile: string, toFile: string): string {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => {
    const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return `${prefix}${projectRelativeImport(toFile, resolvedTarget)}${suffix}`;
  });
}

function slotWritePath(task: { sourcePath?: string; target: string }): string {
  return task.sourcePath ?? task.target;
}

function resolveRepairTargetPath(workspaceRoot: string, root: string, targetFile: string): string {
  let targetPath: string;
  try {
    targetPath = resolveWorkspaceArtifactPath(workspaceRoot, targetFile);
  } catch {
    throw new CompilerError('REPAIR-SCOPE-004', `Repair target "${targetFile}" escapes workspace root`);
  }
  const rootWithSeparator = `${root}${path.sep}`;
  if (targetPath !== root && !targetPath.startsWith(rootWithSeparator)) {
    throw new CompilerError('REPAIR-SCOPE-004', `Repair target "${targetFile}" escapes workspace root`);
  }
  return targetPath;
}

function countChangedLines(before: string, after: string): Pick<RepairTaskPreview, 'addedLines' | 'removedLines'> {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let addedLines = 0;
  let removedLines = 0;
  const length = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] === afterLines[index]) {
      continue;
    }
    if (afterLines[index] !== undefined) {
      addedLines += 1;
    }
    if (beforeLines[index] !== undefined) {
      removedLines += 1;
    }
  }

  return { addedLines, removedLines };
}

type PreparedRepairWriteTask = {
  repairTask: RepairTask;
  targetPath: string;
  slotTask: LockFile['slotTasks'][number];
  source: string;
};

function prepareRepairWriteTasks(
  workspaceRoot: string,
  plan: PlanFile,
  lock: LockFile,
  repairPlan: RepairPlan
): PreparedRepairWriteTask[] {
  const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
  return repairPlan.tasks
    .filter((task) => task.failurePoints.some((point) => point.repairable))
    .map((repairTask) => {
      if (!repairTask.allowedPaths.includes(repairTask.targetFile)) {
        throw new CompilerError('REPAIR-SCOPE-001', `Repair target "${repairTask.targetFile}" is not allowed`);
      }
      const targetPath = resolveRepairTargetPath(workspaceRoot, root, repairTask.targetFile);
      const slotTask = lock.slotTasks.find((task) => task.id === repairTask.sourceSlotId && slotWritePath(task) === repairTask.targetFile);
      if (!slotTask) {
        throw new CompilerError('REPAIR-SCOPE-002', `Repair slot "${repairTask.sourceSlotId}" is missing from graph.lock.json`);
      }
      const envelope = buildTaskEnvelope(plan, lock, slotTask);
      if (!envelope.allowedPaths.includes(repairTask.targetFile)) {
        throw new CompilerError('REPAIR-SCOPE-003', `Repair envelope does not allow "${repairTask.targetFile}"`);
      }
      return { repairTask, targetPath, slotTask, source: synthesizeSlotSource(envelope) };
    });
}

function buildFailurePoints(report: VerificationReport): RepairFailurePoint[] {
  const points: RepairFailurePoint[] = [];

  addFailedRepairPoint(points, report.build.status, {
    lane: 'fast',
    kind: 'build',
    issueType: 'unknown',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.verificationReport,
    message: report.fast.logs.stderr || 'Typecheck failed'
  });
  addFailedRepairPoint(points, report.unit.status, {
    lane: 'fast',
    kind: 'unit',
    issueType: 'slot',
    repairable: true,
    artifactPath: 'tests/unit',
    message: report.fast.logs.stderr || 'Unit verification failed'
  });
  addFailedRepairPoint(points, report.acceptance.status, {
    lane: 'fast',
    kind: 'acceptance',
    issueType: 'slot',
    repairable: true,
    artifactPath: 'tests/acceptance',
    message: report.fast.logs.stderr || 'Acceptance verification failed',
    targetIds: uniqueSorted(report.acceptance.failed)
  });
  addFailedRepairPoint(points, report.policy.status, {
    lane: 'fast',
    kind: 'policy',
    issueType: 'spec',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.policyReport,
    message: uniqueSorted(report.policy.violations.map((violation) => violation.message)).join('; ') || 'Policy verification failed',
    targetIds: uniqueSorted(report.policy.violations.flatMap((violation) => [violation.id, ...violation.files]))
  });
  addFailedRepairPoint(points, report.runtime.build.status, {
    lane: 'runtime',
    kind: 'runtime-build',
    issueType: 'kernel',
    repairable: false,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime build failed'
  });
  addFailedRepairPoint(points, report.runtime.unit.status, {
    lane: 'runtime',
    kind: 'runtime-unit',
    issueType: 'slot',
    repairable: true,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime unit verification failed',
    targetIds: uniqueSorted(report.runtime.unit.failed)
  });
  addFailedRepairPoint(points, report.runtime.acceptance.status, {
    lane: 'runtime',
    kind: 'runtime-acceptance',
    issueType: 'slot',
    repairable: true,
    artifactPath: CI_ARTIFACT_FILES.runtimeReport,
    message: report.runtime.logs.stderr || 'Runtime acceptance verification failed',
    targetIds: uniqueSorted(report.runtime.acceptance.failed)
  });

  return points.length > 0
    ? points
    : [
        {
          lane: 'all',
          kind: 'summary',
          issueType: 'unknown',
          repairable: false,
          artifactPath: CI_ARTIFACT_FILES.verificationReport,
          message: 'Verification failed without lane-specific failure details'
        }
      ];
}

function repairBoundaryFor(point: RepairFailurePoint): RepairBlocker['boundary'] {
  if (point.issueType === 'spec' || point.issueType === 'kernel' || point.issueType === 'slot') {
    return point.issueType;
  }
  return 'unknown';
}

function repairDecisionFor(boundary: RepairBlocker['boundary']): string {
  if (boundary === 'spec') {
    return 'Decide whether to change policy/spec, installed source, or project plan before repair can proceed.';
  }
  if (boundary === 'kernel') {
    return 'Inspect runtime/build ownership and decide whether compiler or generated runtime code must change.';
  }
  if (boundary === 'slot') {
    return 'Regenerate or add a slot task that owns the failing target before repair can proceed.';
  }
  if (boundary === 'scope') {
    return 'Choose an allowed project-scoped target before repair can proceed.';
  }
  return 'Classify the failure owner before repair can proceed.';
}

function buildRepairBlockers(failurePoints: RepairFailurePoint[]): RepairBlocker[] {
  return failurePoints
    .filter((point) => !point.repairable)
    .map((point, index) => {
      const boundary = repairBoundaryFor(point);
      return {
        blockerId: `repair_blocker_${index + 1}_${point.lane}_${point.kind}`,
        reason: `${point.kind} failure is outside automatic slot repair: ${point.message}`,
        boundary,
        decisionRequired: repairDecisionFor(boundary),
        failurePoints: [point]
      };
    });
}

function buildNoSlotBlocker(failurePoints: RepairFailurePoint[]): RepairBlocker {
  return {
    blockerId: 'repair_blocker_no_slot_tasks',
    reason: 'No eligible slot tasks are present in graph.lock.json for the current verification failure',
    boundary: 'slot',
    decisionRequired: repairDecisionFor('slot'),
    failurePoints
  };
}

function buildRepairTaskReview(
  task: Omit<RepairTask, 'review'>,
  envelope: ReturnType<typeof buildTaskEnvelope>
): RepairTask['review'] {
  const failureTargets = uniqueSorted(task.failurePoints.flatMap((point) => point.targetIds ?? []));
  return {
    allowedPathCount: task.allowedPaths.length,
    requiredSymbolCount: task.requiredSymbols.length,
    forbiddenOperationCount: task.forbiddenOperations.length,
    testCount: task.testsToPass.length,
    failureTargetCount: failureTargets.length,
    sourceSlotStatus: envelope.sourceSlot.status,
    sourceWritableZones: [...envelope.sourceSlot.writableZones],
    sourceProvenanceHints: {
      generator: envelope.sourceSlot.provenanceHints.generator,
      verifiedBy: [...envelope.sourceSlot.provenanceHints.verifiedBy]
    },
    writeBounds: [...task.allowedPaths],
    requiredSymbols: [...task.requiredSymbols],
    forbiddenOperations: [...task.forbiddenOperations],
    testsToPass: [...task.testsToPass],
    failureTargets
  };
}

function blockedRepairPlan(blockers: RepairBlocker[]): RepairPlan {
  return {
    formatVersion: '1',
    status: 'blocked',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [],
    blockers
  };
}

export function buildRepairPlan(plan: PlanFile, lock: LockFile, report: VerificationReport): RepairPlan {
  if (report.summary.status === 'passed') {
    return {
      formatVersion: '1',
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      requiresVerification: false,
      tasks: []
    };
  }

  const failurePoints = buildFailurePoints(report);
  const blockers = buildRepairBlockers(failurePoints);
  const tasks: RepairTask[] = lock.slotTasks
    .filter((task) => task.status === 'filled' || task.status === 'verified' || task.status === 'failed')
    .map((task) => {
      const envelope = buildTaskEnvelope(plan, lock, task);
      const repairTask: Omit<RepairTask, 'review'> = {
        taskId: `repair_slot_${task.id}`,
        taskKind: 'repair-slot',
        category: 'slot-rewrite',
        phase: 'repair',
        sourceSlotId: task.id,
        targetBlock: task.block,
        targetFile: envelope.targetFile,
        allowedPaths: envelope.allowedPaths,
        requiredSymbols: envelope.requiredSymbols,
        forbiddenOperations: envelope.forbiddenOperations,
        testsToPass: envelope.testsToPass,
        failureSummary: summarizeFailure(report),
        failurePoints
      };
      return {
        ...repairTask,
        review: buildRepairTaskReview(repairTask, envelope)
      };
    });

  if (tasks.length === 0) {
    return blockedRepairPlan([buildNoSlotBlocker(failurePoints), ...blockers]);
  }

  return {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks,
    ...(blockers.length > 0 ? { blockers } : {})
  };
}

export async function previewRepairPlan(workspaceRoot: string, plan: PlanFile, lock: LockFile, repairPlan: RepairPlan): Promise<void> {
  for (const { repairTask, targetPath, source } of prepareRepairWriteTasks(workspaceRoot, plan, lock, repairPlan)) {
    const before = await fs.readFile(targetPath, 'utf8').catch(() => '');
    const { addedLines, removedLines } = countChangedLines(before, source);
    repairTask.preview = {
      beforeLines: countLines(before),
      afterLines: countLines(source),
      addedLines,
      removedLines,
      changed: before !== source
    };
  }
}

export async function applyRepairPlan(workspaceRoot: string, plan: PlanFile, lock: LockFile, repairPlan: RepairPlan): Promise<void> {
  const writeTasks = prepareRepairWriteTasks(workspaceRoot, plan, lock, repairPlan);

  if (repairPlan.status === 'pending' && writeTasks.length === 0) {
    throw new CompilerError('REPAIR-BLOCKED-003', 'No repairable failure points found for current repair plan');
  }

  for (const { targetPath, slotTask, source } of writeTasks) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, source, 'utf8');
    if (slotTask.sourcePath) {
      const runtimeTargetPath = resolveWorkspaceArtifactPath(workspaceRoot, slotTask.target);
      await fs.mkdir(path.dirname(runtimeTargetPath), { recursive: true });
      await fs.writeFile(runtimeTargetPath, rebaseRelativeImports(source, slotTask.sourcePath, toProjectRuntimePath(slotTask.target)), 'utf8');
    }
    slotTask.status = 'filled';
  }
}

export async function writeRepairPlan(workspaceRoot: string, plan: RepairPlan, lock: LockFile): Promise<void> {
  const { repairPlanPath, lockPath } = getWorkspacePaths(workspaceRoot);
  await writeJson(repairPlanPath, plan);
  await writeLockWithGeneratedPaths(lockPath, lock, [CI_ARTIFACT_FILES.repairPlan]);
  await writeProvenance(workspaceRoot, lock);
}
