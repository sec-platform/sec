import { describe, expect, test } from 'bun:test';

import { projectExplainGraphInspect } from '../../src/application/explain-graph-inspect.ts';
import { formatExplainGraphInspect } from '../../src/entry/cli/explain-graph-inspect.ts';

describe('explain graph inspection presentation boundary', () => {
  test('application owns finite counts and canonical type summaries while entry only renders them', () => {
    const source = {
      nodes: [{ type: 'service' }, { type: 'entity' }, { type: 'service' }],
      edges: [{ type: 'writes_to' }, { type: 'depends_on' }, { type: 'writes_to' }],
      overlays: {
        coverage: { blocks: [{ id: 'a' }, { id: 'b' }] },
        provenance: [{ path: 'one' }]
      }
    } as const;
    const nodeOrder = source.nodes.map((node) => node.type);
    const edgeOrder = source.edges.map((edge) => edge.type);

    const view = projectExplainGraphInspect(source);

    expect(view).toEqual({
      nodeCount: 3,
      edgeCount: 3,
      nodeTypeCounts: [{ id: 'entity', count: 1 }, { id: 'service', count: 2 }],
      edgeTypeCounts: [{ id: 'depends_on', count: 1 }, { id: 'writes_to', count: 2 }],
      coverageBlockCount: 2,
      provenanceArtifactCount: 1
    });
    expect(source.nodes.map((node) => node.type)).toEqual(nodeOrder);
    expect(source.edges.map((edge) => edge.type)).toEqual(edgeOrder);
    expect(formatExplainGraphInspect(view)).toBe([
      'Explain graph 3 nodes 3 edges',
      'Node types: entity=1, service=2',
      'Edge types: depends_on=1, writes_to=2',
      'Coverage overlay: 2 blocks',
      'Provenance overlay: 1 artifacts'
    ].join('\n'));
  });
});
