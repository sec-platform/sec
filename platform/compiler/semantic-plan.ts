import { uniqueSorted } from '../shared/collections.ts';
import { CompilerError } from '../shared/errors.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import type { LoadedSemanticContract } from '../shared/semantic-contract-types.ts';
import type { SemanticGeneratorTask as SemanticLoweringTask } from '../shared/semantic-generator-types.ts';
import { assertUniqueSemanticOutputPaths } from './semantic-output-paths.ts';
import { assertStateTransitionFunctions } from './state-transition-plan.ts';

export function resolveSemanticPlanTasks(
  manifestEntries: readonly ManifestEntry[],
  semanticContracts: readonly LoadedSemanticContract[]
): SemanticLoweringTask[] {
  const tasks: SemanticLoweringTask[] = [];

  for (const entry of [...manifestEntries].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))) {
    const blockContracts = semanticContracts.filter((loaded) => loaded.blockId === entry.manifest.id);

    for (const declaration of [...entry.manifest.generators].sort((left, right) => left.id.localeCompare(right.id))) {
      const loaded = blockContracts.find((candidate) => candidate.contract.id === declaration.contract);
      if (!loaded) {
        throw new CompilerError('GENERATOR-PLAN-001', `Unknown semantic contract "${declaration.contract}"`);
      }
      const state = loaded.contract.states.find((candidate) => candidate.id === declaration.state);
      if (!state) {
        throw new CompilerError('GENERATOR-PLAN-002', `Unknown semantic state "${declaration.state}"`);
      }

      tasks.push({
        id: `generator:${entry.manifest.id}:${declaration.id}`,
        blockId: entry.manifest.id,
        generatorId: declaration.id,
        kind: declaration.kind,
        contractId: loaded.contract.id,
        contractPath: loaded.contractPath,
        contractNamespace: loaded.contract.namespace,
        stateId: state.id,
        target: declaration.target,
        consumes: uniqueSorted(declaration.consumes),
        produces: declaration.produces,
        typeBinding: { ...declaration.typeBinding },
        verification: uniqueSorted(declaration.verification),
        registrySourceId: entry.registrySourceId,
        registryKind: entry.registryKind,
        registryLocation: entry.registryLocation,
        registryPath: entry.registryPath,
        status: 'pending'
      });
    }
  }

  return tasks.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildSemanticGeneratorPlan(
  manifestEntries: readonly ManifestEntry[],
  semanticContracts: readonly LoadedSemanticContract[]
): SemanticLoweringTask[] {
  const tasks = resolveSemanticPlanTasks(manifestEntries, semanticContracts);
  assertStateTransitionFunctions(tasks, semanticContracts);
  assertUniqueSemanticOutputPaths(tasks);
  return tasks;
}
