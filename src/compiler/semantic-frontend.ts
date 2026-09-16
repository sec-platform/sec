import type { ValidatedEngineeringIRSnapshot } from '../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticGeneratorPlan } from '../semantic/generation/contract/types.ts';
import type { SemanticMutationLoadedSourceCandidate } from '../semantic/mutation/contract/types.ts';
import type { SemanticViewSet } from '../semantic/projection/contract/types.ts';
import type { LockFile } from './contract.ts';
import { loadWorkspaceEngineeringIRBuildInput } from './ir/load-workspace-engineering-ir-input.ts';
import { buildValidatedEngineeringIR } from './ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from './projection/build-semantic-view-set.ts';
import { buildSemanticGeneratorPlan } from './semantic-plan.ts';

export interface WorkspaceSemanticBundle {
  snapshot: ValidatedEngineeringIRSnapshot;
  generatorPlan: SemanticGeneratorPlan;
  semanticViews: SemanticViewSet;
  semanticContractSources: readonly SemanticMutationLoadedSourceCandidate[];
  /** Exact Lock object used by the authoritative semantic-input loader. */
  sourceLock: LockFile;
}

export async function buildWorkspaceSemanticBundle(
  workspaceRoot: string
): Promise<WorkspaceSemanticBundle> {
  const {
    engineeringIRInput,
    generatorDeclarations,
    semanticContractSources,
    sourceLock
  } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  const snapshot = buildValidatedEngineeringIR(engineeringIRInput);
  return {
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, generatorDeclarations),
    semanticViews: buildSemanticViewSet(snapshot),
    semanticContractSources,
    sourceLock
  };
}
