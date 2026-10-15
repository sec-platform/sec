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
