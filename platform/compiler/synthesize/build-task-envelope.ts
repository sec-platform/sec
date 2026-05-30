import type { LockFile, SlotTask } from '../../shared/lock-types.ts';
import type { PlanFile } from '../../shared/plan-manifest-types.ts';
import type { TaskEnvelope } from '../../shared/task-envelope-types.ts';

export function buildTaskEnvelope(plan: PlanFile, lock: LockFile, task: SlotTask): TaskEnvelope {
  const slot = plan.slots.find((candidate) => candidate.id === task.id);
  if (!slot) {
    throw new Error(`Missing slot configuration for ${task.id}`);
  }
  const writablePath = task.sourcePath ?? task.target;
  return {
    taskId: `fill_slot_${task.id}`,
    taskKind: `${slot.kind}-slot`,
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
      description: slot.description,
      inputType: 'CustomerInput',
      outputType: 'NormalizedCustomerInput'
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
    },
    ...(task.mockTemplate ? { mockTemplate: task.mockTemplate } : {})
  };
}
