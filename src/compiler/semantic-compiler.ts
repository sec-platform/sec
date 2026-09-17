import type { ValidatedEngineeringIRSnapshot } from '../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticGeneratorDeclaration, SemanticGeneratorPlan } from '../semantic/generation/contract/types.ts';
import type { SemanticViewSet } from '../semantic/projection/contract/types.ts';
import type { BuildEngineeringIRInput } from './ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from './ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from './projection/build-semantic-view-set.ts';
import { buildSemanticGeneratorPlan } from './semantic-plan.ts';

interface SemanticCompilationInput {
  readonly engineeringIRInput: BuildEngineeringIRInput;
  readonly generatorDeclarations: readonly SemanticGeneratorDeclaration[];
}

export interface SemanticCompilation {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly generatorPlan: SemanticGeneratorPlan;
  readonly semanticViews: SemanticViewSet;
}

/**
 * Compile captured values without loading or publishing a workspace.
 * Capturing a coherent read set remains the caller's responsibility; this
 * function does not turn independently captured values into an atomic snapshot.
 */
export function compileSemanticInput(input: SemanticCompilationInput): SemanticCompilation {
  const snapshot = buildValidatedEngineeringIR(input.engineeringIRInput);
  return Object.freeze({
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, input.generatorDeclarations),
    semanticViews: buildSemanticViewSet(snapshot)
  });
}
