import { SEMANTIC_ENTITY_KINDS, type SemanticEntityKind } from '../../engineering-ir/contract/entity-types.ts';
import { type SemanticPredicate } from '../../engineering-ir/contract/fact-types.ts';
import type { ProvenanceArtifact } from '../../provenance/contract/types.ts';
import type { SemanticViewSet, ViewReference } from './types.ts';


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
