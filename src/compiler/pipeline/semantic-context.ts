import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../semantics/generation/types.ts';
import type { SemanticViewSet } from '../../semantics/projection/types.ts';
import { CompilerError } from '../errors.ts';

export interface PipelineSemanticContext {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly generatorPlan: SemanticGeneratorPlan;
  readonly semanticViews: SemanticViewSet;
}

// Local linkage identity, not an IR validation or operation authorization grant.
const issuedSemanticLinks = new WeakMap<PipelineSemanticContext, ValidatedEngineeringIRSnapshot['ir']>();

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

export function assertIssuedPipelineSemanticContext(
  transactionId: string,
  semantic: unknown
): asserts semantic is PipelineSemanticContext {
  if (!semantic || typeof semantic !== 'object') {
    throw new CompilerError('PIPELINE-SEMANTIC-002', 'Pipeline transaction does not own a semantic linkage', { transactionId });
  }
  const typed = semantic as PipelineSemanticContext;
  const expectedIr = issuedSemanticLinks.get(typed);
  if (expectedIr === undefined || typed.transactionId !== transactionId) {
    throw new CompilerError('PIPELINE-SEMANTIC-002', 'Pipeline transaction does not own a semantic linkage', { transactionId });
  }
  const observed = revisions(typed.snapshot, typed.generatorPlan, typed.semanticViews);
  assertAligned(transactionId, observed);
  if (observed.ir !== expectedIr || observed.snapshotInputRevision !== typed.inputRevision ||
      observed.snapshotSemanticRevision !== typed.semanticRevision) {
    throw new CompilerError('PIPELINE-SEMANTIC-003', 'Pipeline semantic linkage became stale', { transactionId });
  }
}
