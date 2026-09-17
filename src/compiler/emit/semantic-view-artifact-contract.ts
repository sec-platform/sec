import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import type { SemanticViewSet } from '../../semantics/projection/types.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { requireSemanticViewSetSchema } from '../lock.ts';

function invalidSemanticViews(message: string, details: Record<string, unknown> = {}): never {
  throw new CompilerError('EXPLAIN-BLOCKED-005', message, details);
}

function requireCanonicalSemanticViewSet(
  value: unknown,
  source: string
): SemanticViewSet {
  try {
    return requireSemanticViewSetSchema(value, source);
  } catch (error) {
    invalidSemanticViews(
      `SemanticViewSet from ${source} does not match the canonical runtime schema`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export function requireLockSemanticViews(lock: LockFile): SemanticViewSet {
  if (lock.semanticViews === undefined) {
    invalidSemanticViews('graph.lock.json is missing canonical semanticViews');
  }
  const semanticViews = requireCanonicalSemanticViewSet(
    lock.semanticViews,
    'graph.lock.json'
  );

  const staleTask = (lock.semanticLoweringTasks ?? []).find((task) =>
    task.inputRevision !== semanticViews.inputRevision ||
    task.semanticRevision !== semanticViews.semanticRevision
  );
  if (staleTask) {
    invalidSemanticViews('Semantic lowering task revision does not match SemanticViewSet', {
      taskId: staleTask.id,
      taskInputRevision: staleTask.inputRevision,
      taskSemanticRevision: staleTask.semanticRevision,
      viewInputRevision: semanticViews.inputRevision,
      viewSemanticRevision: semanticViews.semanticRevision
    });
  }
  return semanticViews;
}

export function semanticViewArtifactsAreCurrent(lock: LockFile, graph: ExplainGraph): boolean {
  try {
    const lockViews = requireLockSemanticViews(lock);
    const graphViews = requireCanonicalSemanticViewSet(
      graph.semanticViews,
      'ExplainGraph'
    );
    return graphViews.inputRevision === lockViews.inputRevision &&
      graphViews.semanticRevision === lockViews.semanticRevision;
  } catch (error) {
    if (error instanceof CompilerError && error.code === 'EXPLAIN-BLOCKED-005') return false;
    throw error;
  }
}

export function assertSemanticViewArtifactsAreCurrent(lock: LockFile, graph: ExplainGraph): void {
  if (semanticViewArtifactsAreCurrent(lock, graph)) return;
  throw new CompilerError(
    'EXPLAIN-BLOCKED-006',
    'ExplainGraph semantic projection does not match the current graph lock revision',
    {
      lockInputRevision: lock.semanticViews?.inputRevision,
      lockSemanticRevision: lock.semanticViews?.semanticRevision,
      graphInputRevision: graph.semanticViews?.inputRevision,
      graphSemanticRevision: graph.semanticViews?.semanticRevision
    }
  );
}
