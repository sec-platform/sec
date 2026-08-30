import type { ValidatedEngineeringIRSnapshot } from '../../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../semantic/generation/contract/types.ts';
import type { SemanticViewSet } from '../../semantic/projection/contract/types.ts';
import { CompilerError } from '../errors.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from './types.ts';

export function bindPipelineSemanticContext(
  context: PipelineExecutionContext,
  snapshot: ValidatedEngineeringIRSnapshot,
  generatorPlan: SemanticGeneratorPlan,
  semanticViews: SemanticViewSet
): PipelineSemanticContext {
  if (context.semantic) {
    throw new CompilerError(
      'PIPELINE-SEMANTIC-001',
      `Pipeline transaction "${context.transactionId}" already owns a semantic snapshot`,
      {
        transactionId: context.transactionId,
        existingInputRevision: context.semantic.inputRevision,
        incomingInputRevision: snapshot.ir.inputRevision
      }
    );
  }

  const semantic = createPipelineSemanticContext(
    context.transactionId,
    snapshot,
    generatorPlan,
    semanticViews
  );
  context.semantic = semantic;
  return semantic;
}

export function createPipelineSemanticContext(
  transactionId: string,
  snapshot: ValidatedEngineeringIRSnapshot,
  generatorPlan: SemanticGeneratorPlan,
  semanticViews: SemanticViewSet
): PipelineSemanticContext {
  if (
    generatorPlan.inputRevision !== snapshot.ir.inputRevision ||
    generatorPlan.semanticRevision !== snapshot.ir.semanticRevision ||
    semanticViews.inputRevision !== snapshot.ir.inputRevision ||
    semanticViews.semanticRevision !== snapshot.ir.semanticRevision
  ) {
    throw new CompilerError(
      'PIPELINE-SEMANTIC-003',
      `Pipeline transaction "${transactionId}" received semantic derivatives for a different IR snapshot`,
      {
        snapshotInputRevision: snapshot.ir.inputRevision,
        planInputRevision: generatorPlan.inputRevision,
        snapshotSemanticRevision: snapshot.ir.semanticRevision,
        planSemanticRevision: generatorPlan.semanticRevision,
        viewInputRevision: semanticViews.inputRevision,
        viewSemanticRevision: semanticViews.semanticRevision
      }
    );
  }

  const semantic = Object.freeze({
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot,
    generatorPlan,
    semanticViews
  });
  return semantic;
}

export function requirePipelineSemanticContext(
  context: PipelineExecutionContext
): PipelineSemanticContext {
  if (!context.semantic || context.semantic.transactionId !== context.transactionId) {
    throw new CompilerError(
      'PIPELINE-SEMANTIC-002',
      `Pipeline transaction "${context.transactionId}" does not own a validated semantic snapshot`,
      {
        transactionId: context.transactionId,
        semanticTransactionId: context.semantic?.transactionId ?? null
      }
    );
  }
  return context.semantic;
}
