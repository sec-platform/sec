import { summarizeCounts } from '../contracts/collections.ts';

export type ExplainGraphInspectProjectionSource = Readonly<{
  nodes: readonly Readonly<{ type: string }>[];
  edges: readonly Readonly<{ type: string }>[];
  overlays: Readonly<{
    coverage: Readonly<{ blocks: readonly unknown[] }>;
    provenance: readonly unknown[];
  }>;
}>;

export type ExplainGraphInspectCountEntry = Readonly<{
  id: string;
  count: number;
}>;

export type ExplainGraphInspectView = Readonly<{
  nodeCount: number;
  edgeCount: number;
  nodeTypeCounts: readonly ExplainGraphInspectCountEntry[];
  edgeTypeCounts: readonly ExplainGraphInspectCountEntry[];
  coverageBlockCount: number;
  provenanceArtifactCount: number;
}>;

export function projectExplainGraphInspect(source: ExplainGraphInspectProjectionSource): ExplainGraphInspectView {
  return {
    nodeCount: source.nodes.length,
    edgeCount: source.edges.length,
    nodeTypeCounts: summarizeCounts(source.nodes.map((node) => node.type)),
    edgeTypeCounts: summarizeCounts(source.edges.map((edge) => edge.type)),
    coverageBlockCount: source.overlays.coverage.blocks.length,
    provenanceArtifactCount: source.overlays.provenance.length
  };
}
