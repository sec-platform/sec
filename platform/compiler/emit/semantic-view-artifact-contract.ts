import { CompilerError } from '../../shared/errors.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import {
  SEMANTIC_VIEW_FORMAT_VERSION,
  SEMANTIC_VIEW_SET_FORMAT_VERSION,
  type SemanticViewSet
} from '../../shared/semantic-view-types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReferenceArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((reference) =>
    isRecord(reference) && typeof reference.kind === 'string' && typeof reference.ref === 'string'
  );
}

function invalidSemanticViews(message: string, details: Record<string, unknown> = {}): never {
  throw new CompilerError('EXPLAIN-BLOCKED-005', message, details);
}

function assertSemanticViewSetShape(value: SemanticViewSet | undefined): asserts value is SemanticViewSet {
  if (!isRecord(value)) {
    invalidSemanticViews('SemanticViewSet is missing or malformed');
  }
  const semanticViews = value as unknown as Partial<SemanticViewSet>;
  if (semanticViews.formatVersion !== SEMANTIC_VIEW_SET_FORMAT_VERSION) {
    invalidSemanticViews('SemanticViewSet formatVersion is not supported', {
      expected: SEMANTIC_VIEW_SET_FORMAT_VERSION,
      actual: semanticViews.formatVersion
    });
  }
  if (
    typeof semanticViews.inputRevision !== 'string' ||
    !semanticViews.inputRevision.trim() ||
    typeof semanticViews.semanticRevision !== 'string' ||
    !semanticViews.semanticRevision.trim()
  ) {
    invalidSemanticViews('SemanticViewSet revisions must be non-empty', {
      inputRevision: semanticViews.inputRevision,
      semanticRevision: semanticViews.semanticRevision
    });
  }
  if (!Array.isArray(semanticViews.views)) {
    invalidSemanticViews('SemanticViewSet views must be an array');
  }
  for (const [viewIndex, rawView] of semanticViews.views.entries()) {
    if (!isRecord(rawView)) {
      invalidSemanticViews('SemanticViewSet contains a malformed semantic view', { viewIndex });
    }
    const view = rawView as Record<string, unknown>;
    if (
      view.formatVersion !== SEMANTIC_VIEW_FORMAT_VERSION ||
      !['architecture', 'scenario', 'state'].includes(String(view.viewKind))
    ) {
      invalidSemanticViews('Semantic view identity or formatVersion is not supported', {
        viewIndex,
        formatVersion: view.formatVersion,
        viewKind: view.viewKind
      });
    }
    for (const collection of ['nodes', 'edges', 'inspector', 'overlays'] as const) {
      if (!Array.isArray(view[collection])) {
        invalidSemanticViews(`Semantic view ${collection} must be an array`, {
          viewIndex,
          viewKind: view.viewKind
        });
      }
    }
    for (const [nodeIndex, rawNode] of (view.nodes as unknown[]).entries()) {
      if (
        !isRecord(rawNode) ||
        typeof rawNode.id !== 'string' ||
        typeof rawNode.entityKind !== 'string' ||
        typeof rawNode.label !== 'string' ||
        !isReferenceArray(rawNode.references)
      ) {
        invalidSemanticViews('Semantic view contains a malformed node', { viewIndex, nodeIndex });
      }
    }
    for (const [edgeIndex, rawEdge] of (view.edges as unknown[]).entries()) {
      const hasTarget = isRecord(rawEdge) && typeof rawEdge.target === 'string';
      const hasValue = isRecord(rawEdge) && rawEdge.value !== undefined;
      if (
        !isRecord(rawEdge) ||
        typeof rawEdge.id !== 'string' ||
        typeof rawEdge.source !== 'string' ||
        typeof rawEdge.relation !== 'string' ||
        typeof rawEdge.label !== 'string' ||
        !isReferenceArray(rawEdge.references) ||
        hasTarget === hasValue
      ) {
        invalidSemanticViews('Semantic view contains a malformed edge', { viewIndex, edgeIndex });
      }
    }
    for (const [sectionIndex, rawSection] of (view.inspector as unknown[]).entries()) {
      if (!isRecord(rawSection) || !Array.isArray(rawSection.items)) {
        invalidSemanticViews('Semantic view contains a malformed inspector section', { viewIndex, sectionIndex });
      }
      const items = rawSection.items as unknown[];
      if (items.some((item) => !isRecord(item) || !isReferenceArray(item.references))) {
        invalidSemanticViews('Semantic view contains a malformed inspector item', { viewIndex, sectionIndex });
      }
    }
    for (const [overlayIndex, rawOverlay] of (view.overlays as unknown[]).entries()) {
      if (!isRecord(rawOverlay) || !Array.isArray(rawOverlay.entries)) {
        invalidSemanticViews('Semantic view contains a malformed overlay', { viewIndex, overlayIndex });
      }
      const entries = rawOverlay.entries as unknown[];
      if (entries.some((entry) =>
        !isRecord(entry) ||
        !Array.isArray(entry.factIds) ||
        entry.factIds.some((factId) => typeof factId !== 'string')
      )) {
        invalidSemanticViews('Semantic view contains a malformed overlay entry', { viewIndex, overlayIndex });
      }
    }
  }
  const architectureViews = semanticViews.views.filter((view) => view.viewKind === 'architecture');
  if (architectureViews.length !== 1) {
    invalidSemanticViews('SemanticViewSet must contain exactly one architecture view', {
      architectureViewCount: architectureViews.length
    });
  }
}

export function requireLockSemanticViews(lock: LockFile): SemanticViewSet {
  const semanticViews = lock.semanticViews;
  if (!semanticViews) {
    invalidSemanticViews('graph.lock.json is missing canonical semanticViews');
  }
  assertSemanticViewSetShape(semanticViews);

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
    assertSemanticViewSetShape(graph.semanticViews);
    return graph.semanticViews.inputRevision === lockViews.inputRevision &&
      graph.semanticViews.semanticRevision === lockViews.semanticRevision;
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
