import { CompilerError } from '../shared/errors.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../shared/semantic-generator-types.ts';

export function assertUniqueSemanticOutputPaths(tasks: readonly SemanticLoweringTask[]): void {
  const pathToTask = new Map<string, string>();

  for (const task of tasks) {
    const existingTaskId = pathToTask.get(task.target);
    if (existingTaskId && existingTaskId !== task.id) {
      throw new CompilerError(
        'GENERATOR-PLAN-003',
        `Semantic output path "${task.target}" is declared by multiple tasks`
      );
    }
    pathToTask.set(task.target, task.id);
  }
}
