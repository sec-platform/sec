import { CompilerError } from '../shared/errors.ts';
import type { SemanticGeneratorPlanTask } from '../shared/semantic-generator-types.ts';

export function assertStateTransitionFunctions(
  tasks: readonly SemanticGeneratorPlanTask[]
): void {
  for (const task of tasks) {
    const counts = new Map<string, number>();
    for (const transition of task.transitions) {
      counts.set(transition.from, (counts.get(transition.from) ?? 0) + 1);
    }
    for (const value of task.stateValues) {
      const count = counts.get(value) ?? 0;
      if (count !== 1) {
        throw new CompilerError(
          count === 0 ? 'GENERATOR-PLAN-004' : 'GENERATOR-PLAN-005',
          `State "${task.stateId}" requires exactly one outgoing transition from "${value}"`
        );
      }
    }
  }
}
