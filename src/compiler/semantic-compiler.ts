import type { ValidatedEngineeringIRSnapshot } from '../semantics/engineering-ir/validated-types.ts';
import type { SemanticGeneratorDeclaration, SemanticGeneratorPlan } from '../semantics/generation/types.ts';
import type { SemanticViewSet } from '../semantics/projection/types.ts';
import { CompilerError } from './errors.ts';
import { captureSemanticRoots, selectSemanticGeneratorRoots } from './semantic-roots.ts';
import type { BuildEngineeringIRInput } from './ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from './ir/validate-engineering-ir.ts';
import { buildSemanticViewSet } from './projection/build-semantic-view-set.ts';
import { buildSemanticGeneratorPlan } from './semantic-plan.ts';

export interface SemanticCompilationInput {
  readonly engineeringIRInput: BuildEngineeringIRInput;
  readonly generatorDeclarations?: readonly SemanticGeneratorDeclaration[];
}

export interface SemanticCompilation {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly generatorPlan: SemanticGeneratorPlan;
  readonly semanticViews: SemanticViewSet;
}

/** Derive declarations from the same captured manifest and selected block
 * values. Authors need not maintain a second copy of generator declarations. */
export function deriveSemanticGeneratorDeclarations(input: BuildEngineeringIRInput): SemanticGeneratorDeclaration[] {
  const blocks = new Map(input.resolvedBlocks.map(block => [block.id, block]));
  return input.manifests.flatMap(entry => (entry.manifest.generators ?? []).map(declaration => {
    const block = blocks.get(entry.blockId);
    const manifestPath = entry.manifestPath ?? block?.manifestPath;
    if (block === undefined || typeof manifestPath !== 'string' || manifestPath.length === 0) {
      throw new CompilerError('GENERATOR-DECLARATION-001', `Generator source for "${entry.blockId}" lacks its selected block or manifest path`);
    }
    return {
      blockId: entry.blockId, manifestPath, declaration: structuredClone(declaration),
      registrySourceId: block.registrySourceId, registryKind: block.registryKind,
      registryLocation: block.registryLocation, registryPath: block.registryPath
    };
  }));
}

/**
 * Compile captured values without loading or publishing a workspace.
 * Capturing a coherent read set remains the caller's responsibility; this
 * function does not turn independently captured values into an atomic snapshot.
 */
export function compileSemanticInput(input: SemanticCompilationInput, roots?: readonly string[]): SemanticCompilation {
  const selectedRoots = captureSemanticRoots(roots);
  const snapshot = buildValidatedEngineeringIR(input.engineeringIRInput);
  return Object.freeze({
    snapshot,
    generatorPlan: buildSemanticGeneratorPlan(snapshot, selectSemanticGeneratorRoots(
      input.generatorDeclarations ?? deriveSemanticGeneratorDeclarations(input.engineeringIRInput), selectedRoots
    )),
    semanticViews: buildSemanticViewSet(snapshot)
  });
}
