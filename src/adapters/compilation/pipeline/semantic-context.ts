import { CompilerError } from '../../../compiler/errors.ts';
import {
  assertIssuedPipelineSemanticContext,
  createPipelineSemanticContext,
  type PipelineSemanticContext
} from '../../../compiler/pipeline/semantic-context.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../semantics/engineering-ir/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../../semantics/generation/types.ts';
import type { SemanticViewSet } from '../../../semantics/projection/types.ts';
import type { PipelineExecutionContext } from '../../compilation-protocol/types.ts';

export function bindPipelineSemanticContext(
  context: PipelineExecutionContext,
  snapshot: ValidatedEngineeringIRSnapshot,
  generatorPlan: SemanticGeneratorPlan,
  semanticViews: SemanticViewSet
): PipelineSemanticContext {
  const transactionId = context.transactionId;
  const before = Object.getOwnPropertyDescriptor(context, 'semantic');
  if (before !== undefined && (!('value' in before) || before.value !== undefined)) {
    throw new CompilerError('PIPELINE-SEMANTIC-001', 'Pipeline transaction already owns a semantic snapshot', { transactionId });
  }
  const semantic = createPipelineSemanticContext(transactionId, snapshot, generatorPlan, semanticViews);
  const after = Object.getOwnPropertyDescriptor(context, 'semantic');
  if (context.transactionId !== transactionId ||
      (after !== undefined && (!('value' in after) || after.value !== undefined))) {
    throw new CompilerError('PIPELINE-SEMANTIC-001', 'Pipeline semantic binding changed during creation', { transactionId });
  }
  Object.defineProperty(context, 'semantic', { value: semantic, enumerable: true, writable: false, configurable: false });
  return semantic;
}

export function requirePipelineSemanticContext(context: PipelineExecutionContext): PipelineSemanticContext {
  const transactionId = context.transactionId;
  const descriptor = Object.getOwnPropertyDescriptor(context, 'semantic');
  const semantic = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  assertIssuedPipelineSemanticContext(transactionId, semantic);
  const current = Object.getOwnPropertyDescriptor(context, 'semantic');
  if (context.transactionId !== transactionId || !current || !('value' in current) || current.value !== semantic) {
    throw new CompilerError('PIPELINE-SEMANTIC-002', 'Pipeline semantic linkage changed during readback', { transactionId });
  }
  return semantic;
}
