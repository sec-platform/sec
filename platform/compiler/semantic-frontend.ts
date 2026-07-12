import type { ValidatedEngineeringIRSnapshot } from '../shared/engineering-ir-types.ts';
import type { SemanticGeneratorPlan } from '../shared/semantic-generator-types.ts';
import type { SemanticViewSet } from '../shared/semantic-view-types.ts';
import { loadWorkspaceEngineeringIRBuildInput } from './ir/load-workspace-engineering-ir-input.ts';
import { buildValidatedEngineeringIR } from './ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from './projection/build-semantic-view-set.ts';
import { buildSemanticGeneratorPlan } from './semantic-plan.ts';

export interface WorkspaceSemanticBundle {
  snapshot: ValidatedEngineeringIRSnapshot;
  generatorPlan: SemanticGeneratorPlan;
  semanticViews: SemanticViewSet;
}

export async function buildWorkspaceSemanticBundle(
  workspaceRoot: string
): Promise<WorkspaceSemanticBundle> {
  const { engineeringIRInput, generatorDeclarations } = await loadWorkspaceEngineeringIRBuildInput(
    workspaceRoot
  );
  const snapshot = buildValidatedEngineeringIR(engineeringIRInput);
  return {
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, generatorDeclarations),
    semanticViews: buildSemanticViewSet(snapshot)
  };
}
