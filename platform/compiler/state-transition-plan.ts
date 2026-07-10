import { CompilerError } from '../shared/errors.ts';
import type { LoadedSemanticContract } from '../shared/semantic-contract-types.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../shared/semantic-generator-types.ts';

export function assertStateTransitionFunctions(
  tasks: readonly SemanticLoweringTask[],
  contracts: readonly LoadedSemanticContract[]
): void {
  for (const task of tasks) {
    const loaded = contracts.find((entry) =>
      entry.blockId === task.blockId && entry.contract.id === task.contractId
    );
    const state = loaded?.contract.states.find((entry) => entry.id === task.stateId);
    if (!state) {
      throw new CompilerError('GENERATOR-PLAN-002', `Semantic state "${task.stateId}" is unavailable`);
    }

    const counts = new Map<string, number>();
    for (const transition of state.transitions) {
      counts.set(transition.from, (counts.get(transition.from) ?? 0) + 1);
    }
    for (const value of state.values) {
      const count = counts.get(value) ?? 0;
      if (count !== 1) {
        throw new CompilerError(
          count === 0 ? 'GENERATOR-PLAN-004' : 'GENERATOR-PLAN-005',
          `State "${state.id}" requires exactly one outgoing transition from "${value}"`
        );
      }
    }
  }
}
