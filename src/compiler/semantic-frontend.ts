import type { SemanticMutationLoadedSourceCandidate } from '../semantic/mutation/contract/types.ts';
import type { LockFile } from './contract.ts';
import { loadWorkspaceEngineeringIRBuildInput } from './ir/load-workspace-engineering-ir-input.ts';
import { compileSemanticInput, type SemanticCompilation } from './semantic-compiler.ts';

export interface WorkspaceSemanticBundle {
  snapshot: SemanticCompilation['snapshot'];
  generatorPlan: SemanticCompilation['generatorPlan'];
  semanticViews: SemanticCompilation['semanticViews'];
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
  return {
    ...compileSemanticInput({ engineeringIRInput, generatorDeclarations }),
    semanticContractSources,
    sourceLock
  };
}
