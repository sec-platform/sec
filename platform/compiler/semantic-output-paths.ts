import { CompilerError } from '../shared/errors.ts';
import { portableLogicalPathCollisionKeyV1 } from '../shared/logical-path-identity.ts';
import type { SemanticGeneratorPlanTask } from '../shared/semantic-generator-types.ts';

export function assertUniqueSemanticOutputPaths(tasks: readonly SemanticGeneratorPlanTask[]): void {
  const pathToTask = new Map<string, string>();

  for (const task of tasks) {
    const identity = portableLogicalPathCollisionKeyV1(task.target, 'Semantic output path');
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
