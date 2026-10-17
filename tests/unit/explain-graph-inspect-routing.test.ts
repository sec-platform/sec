import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectExplainGraphInspect } from '../../src/application/explain-graph-inspect.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatExplainGraphInspect } from '../../src/entry/cli/explain-graph-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('explain inspect preserves historical pin graph JSON through reading, counting and rendering', async () => {
  // Preserve independent projection/text fixture from tests/unit/explain-graph-inspect-presentation.test.ts.
  {
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
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const graph = {
      semanticViews: {},
      nodes: [
        { id: 'service', type: 'service', label: 'Service' },
        { id: 'entity', type: 'entity', label: 'Entity' },
        { id: 'service-2', type: 'service', label: 'Service 2' },
        { id: 'pin:fixture/basic:input:context', type: 'pin', label: 'Context' }
      ],
      edges: [
        { from: 'service', to: 'entity', type: 'writes_to' },
        { from: 'service-2', to: 'entity', type: 'depends_on' },
        { from: 'service-2', to: 'service', type: 'writes_to' },
        { from: 'service', to: 'pin:fixture/basic:input:context', type: 'depends_on' }
      ],
      overlays: {
        coverage: { blocks: [{ id: 'alpha', coveredBy: ['acceptance:a'] }] },
        provenance: [{ path: 'src/service.ts' }]
      }
    } as const;
    const graphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    await fs.mkdir(path.dirname(graphPath), { recursive: true });
    await fs.writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    await expectCliSuccess(
      workspaceRoot,
      ['explain', 'graph'],
      `${formatExplainGraphInspect(projectExplainGraphInspect(graph))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['explain', 'graph', '--json']);
    expect(json).toEqual(graph);
    expect(projectExplainGraphInspect(json as typeof graph)).toMatchObject({
      nodeCount: 4, edgeCount: 4,
      nodeTypeCounts: [{ id: 'entity', count: 1 }, { id: 'pin', count: 1 }, { id: 'service', count: 2 }],
      edgeTypeCounts: [{ id: 'depends_on', count: 2 }, { id: 'writes_to', count: 2 }]
    });
  });
});
