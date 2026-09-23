import { portableLogicalPathCollisionKey } from '../contracts/logical-path.ts';
import type { SemanticGeneratorPlanTask } from '../semantics/generation/types.ts';
import { CompilerError } from './errors.ts';

/** Every output task owns one identity and one ordinary-file target. Repeated
 * IDs are not an idempotence receipt; parent/child file targets cannot coexist. */
export function assertUniqueSemanticOutputPaths(tasks: readonly SemanticGeneratorPlanTask[]): void {
  const pathToTask = new Map<string, string>();
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== 'string' || task.id.length === 0 || taskIds.has(task.id)) {
      throw new CompilerError('GENERATOR-PLAN-003', 'Semantic output tasks must have distinct non-empty identities');
    }
    taskIds.add(task.id);
    const identity = portableLogicalPathCollisionKey(task.target, 'Semantic output path');
    if (pathToTask.has(identity)) {
      throw new CompilerError('GENERATOR-PLAN-003', `Semantic output path "${task.target}" is declared by multiple tasks`);
    }
    pathToTask.set(identity, task.id);
  }
  // Evaluate the complete set, so rejection is independent of input order.
  for (const identity of pathToTask.keys()) {
    for (let separator = identity.indexOf('/'); separator !== -1; separator = identity.indexOf('/', separator + 1)) {
      if (pathToTask.has(identity.slice(0, separator))) {
        throw new CompilerError('GENERATOR-PLAN-003', `Semantic output path "${identity}" descends from another file target`);
      }
    }
  }
}
