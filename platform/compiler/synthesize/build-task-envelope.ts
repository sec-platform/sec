import type { LockFile, PlanFile, SlotTask, TaskEnvelope } from '../../shared/types.ts';

export function buildTaskEnvelope(plan: PlanFile, lock: LockFile, task: SlotTask): TaskEnvelope {
  const slot = plan.slots.find((candidate) => candidate.id === task.id);
  if (!slot) {
    throw new Error(`Missing slot configuration for ${task.id}`);
  }
  return {
    taskId: `fill_slot_${task.id}`,
    taskKind: `${slot.kind}-slot`,
    phase: 'adapt',
    targetBlock: task.block,
    targetFile: task.target,
    allowedPaths: [task.target],
    requiredSymbols: [task.symbol],
    forbiddenOperations: [
      'modify_other_files',
      'add_dependencies',
      'access_database',
      'change_exports'
    ],
    inputContracts: {
      description: slot.description
    },
    testsToPass: [
      'tests/unit/customer-normalizer.test.ts',
      'tests/acceptance/customer-flow.test.ts'
    ],
    budget: {
      maxAttempts: 2,
      timeoutSeconds: 90,
      maxTokens: 16000
    },
    expectedOutput: {
      type: 'source-file',
      language: 'typescript'
    },
    lockSummary: {
      blocks: lock.resolvedBlocks.map((block) => block.id)
    }
  };
}
