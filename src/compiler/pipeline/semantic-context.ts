import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../semantics/generation/types.ts';
import type { SemanticViewSet } from '../../semantics/projection/types.ts';
import { CompilerError } from '../errors.ts';
import type { PipelineExecutionContext, PipelineSemanticContext } from './types.ts';

// Local linkage identity, not an IR validation or operation authorization grant.
// The IR validator, generator and view owners retain their existing contracts.
const issuedSemanticLinks = new WeakMap<PipelineSemanticContext, ValidatedEngineeringIRSnapshot['ir']>();

/** Revision linkage reads data slots, not user code. This is deliberately not
 * a parser or validator for the IR/plan/view payloads themselves. */
function semanticDataField<T extends object, K extends keyof T>(value: T, field: K): T[K] {
  const descriptor = value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, field) : undefined;
  if (!descriptor || !('value' in descriptor)) {
    throw new CompilerError('PIPELINE-SEMANTIC-003', 'Pipeline semantic linkage requires own data fields', { field });
  }
  return descriptor.value;
}

function revisions(snapshot: ValidatedEngineeringIRSnapshot, plan: SemanticGeneratorPlan, views: SemanticViewSet) {
  const ir = semanticDataField(snapshot, 'ir');
  return {
    ir,
    snapshotInputRevision: semanticDataField(ir, 'inputRevision'),
    snapshotSemanticRevision: semanticDataField(ir, 'semanticRevision'),
    planInputRevision: semanticDataField(plan, 'inputRevision'),
    planSemanticRevision: semanticDataField(plan, 'semanticRevision'),
    viewInputRevision: semanticDataField(views, 'inputRevision'),
    viewSemanticRevision: semanticDataField(views, 'semanticRevision')
  };
}

function assertAligned(transactionId: string, observed: ReturnType<typeof revisions>): void {
  const { ir: _ir, ...data } = observed;
  if (typeof transactionId !== 'string' || transactionId.length === 0 ||
      typeof data.snapshotInputRevision !== 'string' || data.snapshotInputRevision.length === 0 ||
      typeof data.snapshotSemanticRevision !== 'string' || data.snapshotSemanticRevision.length === 0 ||
      data.planInputRevision !== data.snapshotInputRevision ||
      data.planSemanticRevision !== data.snapshotSemanticRevision ||
      data.viewInputRevision !== data.snapshotInputRevision ||
      data.viewSemanticRevision !== data.snapshotSemanticRevision) {
    throw new CompilerError('PIPELINE-SEMANTIC-003', 'Pipeline semantic derivatives do not bind one IR revision', data);
  }
}

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
  // Descriptor traps may synchronously re-enter the producer. Never overwrite
  // a link installed during observation or attach to a retargeted transaction.
  if (context.transactionId !== transactionId ||
      (after !== undefined && (!('value' in after) || after.value !== undefined))) {
    throw new CompilerError('PIPELINE-SEMANTIC-001', 'Pipeline semantic binding changed during creation', { transactionId });
  }
  Object.defineProperty(context, 'semantic', { value: semantic, enumerable: true, writable: false, configurable: false });
  return semantic;
}

export function createPipelineSemanticContext(
  transactionId: string,
  snapshot: ValidatedEngineeringIRSnapshot,
  generatorPlan: SemanticGeneratorPlan,
  semanticViews: SemanticViewSet
): PipelineSemanticContext {
  const observed = revisions(snapshot, generatorPlan, semanticViews);
  assertAligned(transactionId, observed);
  const semantic = Object.freeze({
    transactionId,
    inputRevision: observed.snapshotInputRevision,
    semanticRevision: observed.snapshotSemanticRevision,
    snapshot,
    generatorPlan,
    semanticViews
  });
  issuedSemanticLinks.set(semantic, observed.ir);
  return semantic;
}

export function requirePipelineSemanticContext(context: PipelineExecutionContext): PipelineSemanticContext {
  const transactionId = context.transactionId;
  const descriptor = Object.getOwnPropertyDescriptor(context, 'semantic');
  const semantic: PipelineSemanticContext | undefined = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  const expectedIr = semantic === undefined ? undefined : issuedSemanticLinks.get(semantic);
  if (expectedIr === undefined || semantic === undefined || semantic.transactionId !== transactionId) {
    throw new CompilerError('PIPELINE-SEMANTIC-002', 'Pipeline transaction does not own a semantic linkage', { transactionId });
  }
  const observed = revisions(semantic.snapshot, semantic.generatorPlan, semantic.semanticViews);
  assertAligned(transactionId, observed);
  if (observed.ir !== expectedIr || observed.snapshotInputRevision !== semantic.inputRevision ||
      observed.snapshotSemanticRevision !== semantic.semanticRevision) {
    throw new CompilerError('PIPELINE-SEMANTIC-003', 'Pipeline semantic linkage became stale', { transactionId });
  }
  // A getter may have rebound an externally constructed execution context.
  const current = Object.getOwnPropertyDescriptor(context, 'semantic');
  if (context.transactionId !== transactionId || !current || !('value' in current) || current.value !== semantic) {
    throw new CompilerError('PIPELINE-SEMANTIC-002', 'Pipeline semantic linkage changed during readback', { transactionId });
  }
  return semantic;
}
