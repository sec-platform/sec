import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTaskEnvelope } from '../synthesize/build-task-envelope.ts';
import { synthesizeSlotSource } from '../synthesize/mock-slot-synthesizer.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { writeProvenance } from '../emit/write-provenance.ts';
import type {
  LockFile,
  PlanFile,
  RepairBlocker,
  RepairFailurePoint,
  RepairPlan,
  RepairTask,
  RepairTaskPreview
} from '../../shared/types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';

function summarizeFailure(report: VerificationReport): string {
  return `build=${report.build.status}; unit=${report.unit.status}; acceptance=${report.acceptance.status}; policy=${report.policy.status}; runtime=${report.runtime.status}`;
}

function sortedUniqueMessages(messages: string[]): string[] {
  return [...new Set(messages)].sort((left, right) => left.localeCompare(right));
}

function sortedUniqueTargets(targets: string[]): string[] {
  return [...new Set(targets.filter((target) => target.length > 0))].sort((left, right) => left.localeCompare(right));
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  return value.endsWith('\n') ? value.split('\n').length - 1 : value.split('\n').length;
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
      message: report.fast.logs.stderr || 'Acceptance verification failed',
      targetIds: sortedUniqueTargets(report.acceptance.failed)
    });
  }
  if (report.policy.status === 'failed') {
    points.push({
      lane: 'fast',
      kind: 'policy',
      issueType: 'spec',
      repairable: false,
      artifactPath: 'generated/policy-report.json',
      message: sortedUniqueMessages(report.policy.violations.map((violation) => violation.message)).join('; ') || 'Policy verification failed',
      targetIds: sortedUniqueTargets(report.policy.violations.flatMap((violation) => [violation.id, ...violation.files]))
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
      message: report.runtime.logs.stderr || 'Runtime unit verification failed',
      targetIds: sortedUniqueTargets(report.runtime.unit.failed)
    });
  }
  if (report.runtime.acceptance.status === 'failed') {
    points.push({
      lane: 'runtime',
      kind: 'runtime-acceptance',
      issueType: 'slot',
      repairable: true,
      artifactPath: 'generated/runtime-report.json',
      message: report.runtime.logs.stderr || 'Runtime acceptance verification failed',
      targetIds: sortedUniqueTargets(report.runtime.acceptance.failed)
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
  const failureTargets = sortedUniqueTargets(task.failurePoints.flatMap((point) => point.targetIds ?? []));
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
        targetFile: task.target,
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
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const repairableTasks = repairPlan.tasks.filter((task) => task.failurePoints.some((point) => point.repairable));

  for (const repairTask of repairableTasks) {
    if (!repairTask.allowedPaths.includes(repairTask.targetFile)) {
      throw new CompilerError('REPAIR-SCOPE-001', `Repair target "${repairTask.targetFile}" is not allowed`);
    }
    const targetPath = path.resolve(projectRoot, repairTask.targetFile);
    const projectRootWithSeparator = `${projectRoot}${path.sep}`;
    if (targetPath !== projectRoot && !targetPath.startsWith(projectRootWithSeparator)) {
      throw new CompilerError('REPAIR-SCOPE-004', `Repair target "${repairTask.targetFile}" escapes project root`);
    }
    const slotTask = lock.slotTasks.find((task) => task.id === repairTask.sourceSlotId && task.target === repairTask.targetFile);
    if (!slotTask) {
      throw new CompilerError('REPAIR-SCOPE-002', `Repair slot "${repairTask.sourceSlotId}" is missing from graph.lock.json`);
    }
    const envelope = buildTaskEnvelope(plan, lock, slotTask);
    if (!envelope.allowedPaths.includes(repairTask.targetFile)) {
      throw new CompilerError('REPAIR-SCOPE-003', `Repair envelope does not allow "${repairTask.targetFile}"`);
    }
    const before = await fs.readFile(targetPath, 'utf8').catch(() => '');
    const after = synthesizeSlotSource(envelope);
    const { addedLines, removedLines } = countChangedLines(before, after);
    repairTask.preview = {
      beforeLines: countLines(before),
      afterLines: countLines(after),
      addedLines,
      removedLines,
      changed: before !== after
    };
  }
}

export async function applyRepairPlan(workspaceRoot: string, plan: PlanFile, lock: LockFile, repairPlan: RepairPlan): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const repairableTasks = repairPlan.tasks.filter((task) => task.failurePoints.some((point) => point.repairable));

  if (repairPlan.status === 'pending' && repairableTasks.length === 0) {
    throw new CompilerError('REPAIR-BLOCKED-003', 'No repairable failure points found for current repair plan');
  }

  const writeTasks = repairableTasks.map((repairTask) => {
    if (!repairTask.allowedPaths.includes(repairTask.targetFile)) {
      throw new CompilerError('REPAIR-SCOPE-001', `Repair target "${repairTask.targetFile}" is not allowed`);
    }
    const targetPath = path.resolve(projectRoot, repairTask.targetFile);
    const projectRootWithSeparator = `${projectRoot}${path.sep}`;
    if (targetPath !== projectRoot && !targetPath.startsWith(projectRootWithSeparator)) {
      throw new CompilerError('REPAIR-SCOPE-004', `Repair target "${repairTask.targetFile}" escapes project root`);
    }
    const slotTask = lock.slotTasks.find((task) => task.id === repairTask.sourceSlotId && task.target === repairTask.targetFile);
    if (!slotTask) {
      throw new CompilerError('REPAIR-SCOPE-002', `Repair slot "${repairTask.sourceSlotId}" is missing from graph.lock.json`);
    }
    const envelope = buildTaskEnvelope(plan, lock, slotTask);
    if (!envelope.allowedPaths.includes(repairTask.targetFile)) {
      throw new CompilerError('REPAIR-SCOPE-003', `Repair envelope does not allow "${repairTask.targetFile}"`);
    }
    return { targetPath, slotTask, source: synthesizeSlotSource(envelope) };
  });

  for (const { targetPath, slotTask, source } of writeTasks) {
    await fs.writeFile(targetPath, source, 'utf8');
    slotTask.status = 'filled';
  }
}

export async function writeRepairPlan(workspaceRoot: string, plan: RepairPlan, lock: LockFile): Promise<void> {
  const { repairPlanPath, lockPath } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(path.dirname(repairPlanPath), { recursive: true });
  await fs.writeFile(repairPlanPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  if (!lock.generatedPaths.includes('generated/repair-plan.json')) {
    lock.generatedPaths.push('generated/repair-plan.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
}
