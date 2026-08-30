import type { TaskEnvelope } from '../../control/task/contract/envelope.ts';
import type { LockFile, PlanFile, SlotTask } from '../contract.ts';

export function buildTaskEnvelope(plan: PlanFile, lock: LockFile, task: SlotTask): TaskEnvelope {
  const slot = plan.slots.find((candidate) => candidate.id === task.id);
  const writablePath = task.sourcePath ?? task.target;
  return {
    taskId: `fill_slot_${task.id}`,
    taskKind: `${task.kind}-slot`,
    phase: 'adapt',
    targetBlock: task.block,
    targetFile: writablePath,
    sourceSlot: {
      id: task.id,
      status: task.status,
      runtimeTarget: task.target,
      ...(task.sourcePath ? { sourcePath: task.sourcePath } : {}),
      writableZones: [...task.writableZones],
      provenanceHints: {
        generator: task.provenanceHints.generator,
        verifiedBy: [...task.provenanceHints.verifiedBy]
      }
    },
    allowedPaths: [writablePath],
    requiredSymbols: [task.symbol],
    forbiddenOperations: [
      'modify_other_files',
      'add_dependencies',
      'access_database',
      'change_exports'
    ],
    inputContracts: {
      description: slot?.description ?? task.id,
      inputType: task.inputType,
      outputType: task.outputType
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
