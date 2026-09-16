import type { SemanticGeneratorPlanTask } from '../semantic/generation/contract/types.ts';
import { CompilerError } from './errors.ts';

/** A total deterministic transition function has unique declared values,
 * exactly one outgoing edge per value, and no undeclared endpoints. */
export function assertStateTransitionFunctions(
  tasks: readonly SemanticGeneratorPlanTask[]
): void {
  for (const task of tasks) {
    const values = new Set<string>();
    for (const value of task.stateValues) {
      if (typeof value !== 'string' || values.has(value)) {
        throw new CompilerError('GENERATOR-PLAN-005', `State "${task.stateId}" values must be distinct strings`);
      }
      values.add(value);
    }
    const counts = new Map<string, number>();
    for (const transition of task.transitions) {
      if (!values.has(transition.from) || !values.has(transition.to)) {
        throw new CompilerError('GENERATOR-PLAN-004', `State "${task.stateId}" transition uses an undeclared endpoint`);
      }
      counts.set(transition.from, (counts.get(transition.from) ?? 0) + 1);
    }
    for (const value of values) {
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
