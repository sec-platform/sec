import type { LockFile } from '../../compiler/contract.ts';
import { compileSemanticInput, type SemanticCompilation } from '../../compiler/semantic-compiler.ts';
import type { SemanticMutationLoadedSourceCandidate } from '../../semantics/mutation/types.ts';
import { loadWorkspaceEngineeringIRBuildInput } from './engineering-input.ts';

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
