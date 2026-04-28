import type { ProvenanceArtifact } from './provenance-types.ts';

export type ExplainNodeType =
  | 'app'
  | 'block'
  | 'capability'
  | 'pin'
  | 'slot'
  | 'file'
  | 'acceptance'
  | 'policy'
  | 'override'
  | 'repair'
  | 'upgrade';

export type ExplainEdgeType =
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
}

export interface ExplainGraphEdge {
  from: string;
  to: string;
  type: ExplainEdgeType;
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
  nodes: ExplainGraphNode[];
  edges: ExplainGraphEdge[];
  overlays: {
    provenance: ProvenanceArtifact[];
    coverage: CoverageOverlay;
  };
}
