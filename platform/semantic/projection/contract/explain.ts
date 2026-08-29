import {
  SEMANTIC_ENTITY_KINDS,
  type SemanticEntityKind,
  type SemanticPredicate
} from '../../engineering-ir/index.ts';
import type { ProvenanceArtifact } from '../../provenance/index.ts';
import type { SemanticViewSet, ViewReference } from './types.ts';

export const EXPLAIN_NODE_TYPES = [
  ...SEMANTIC_ENTITY_KINDS,
  'semantic-value',
  'pin',
  'file',
  'override',
  'repair',
  'upgrade'
] as const;

export type ExplainNodeType = SemanticEntityKind | 'semantic-value' | 'pin' | 'file' | 'override' | 'repair' | 'upgrade';

export type ExplainEdgeType =
  | Lowercase<SemanticPredicate>
  | 'depends_on'
  | 'provides'
  | 'connects_to'
  | 'writes_to'
  | 'verified_by'
  | 'originates_from'
  | 'violates';

export interface ExplainGraphNode {
  id: string;
  type: ExplainNodeType;
  label: string;
  references?: ViewReference[];
}

export interface ExplainGraphEdge {
  from: string;
  to: string;
  type: ExplainEdgeType;
  references?: ViewReference[];
}

export interface CoverageOverlay {
  blocks: Array<{
    id: string;
    coveredBy: string[];
  }>;
  slots: Array<{
    id: string;
    coveredBy: string[];
  }>;
}

export interface ExplainGraph {
  semanticViews: SemanticViewSet;
  nodes: ExplainGraphNode[];
  edges: ExplainGraphEdge[];
  overlays: {
    provenance: ProvenanceArtifact[];
    coverage: CoverageOverlay;
  };
}
