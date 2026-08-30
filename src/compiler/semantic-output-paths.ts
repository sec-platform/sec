import type { SemanticGeneratorPlanTask } from '../semantic/generation/contract/types.ts';
import { portableLogicalPathCollisionKey } from '../system-architecture/foundation/contract/logical-path.ts';
import { CompilerError } from './errors.ts';

export function assertUniqueSemanticOutputPaths(tasks: readonly SemanticGeneratorPlanTask[]): void {
  const pathToTask = new Map<string, string>();

  for (const task of tasks) {
    const identity = portableLogicalPathCollisionKey(task.target, 'Semantic output path');
    const existingTaskId = pathToTask.get(identity);
    if (existingTaskId && existingTaskId !== task.id) {
      throw new CompilerError(
        'GENERATOR-PLAN-003',
        `Semantic output path "${task.target}" is declared by multiple tasks`
      );
    }
    pathToTask.set(identity, task.id);
  }
}
