import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectExplainGraphInspect } from '../../src/application/explain-graph-inspect.ts';
import { formatExplainGraphInspect } from '../../src/entry/cli/explain-graph-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('explain inspect routes artifact text through application projection and entry rendering without changing JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const graph = {
      semanticViews: {},
      nodes: [
        { id: 'service', type: 'service', label: 'Service' },
        { id: 'entity', type: 'entity', label: 'Entity' },
        { id: 'service-2', type: 'service', label: 'Service 2' }
      ],
      edges: [
        { from: 'service', to: 'entity', type: 'writes_to' },
        { from: 'service-2', to: 'entity', type: 'depends_on' },
        { from: 'service-2', to: 'service', type: 'writes_to' }
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
  });
});
