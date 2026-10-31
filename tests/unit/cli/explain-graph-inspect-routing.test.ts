import { expect, test } from 'bun:test';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
        coverage: { blocks: [
          { id: 'alpha', coveredBy: ['acceptance:a'] },
          { id: 'beta', coveredBy: ['acceptance:b'] }
        ] },
        provenance: [{ path: 'src/service.ts' }]
      }
    } as const;
    const graphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    await writeJson(graphPath, graph);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['explain', 'graph']);
    expect(stdout).toMatch(/\b4 nodes(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\b4 edges(?=$|[\s;,()])/u);
    const nodeTypes = stdout.split('\n').find((line) => /^Node types\b/u.test(line));
    expect(nodeTypes?.match(/\b[\w-]+=\d+(?=$|[\s;,()])/gu)?.sort())
      .toEqual(['entity=1', 'pin=1', 'service=2']);
    const edgeTypes = stdout.split('\n').find((line) => /^Edge types\b/u.test(line));
    expect(edgeTypes?.match(/\b[\w-]+=\d+(?=$|[\s;,()])/gu)?.sort())
      .toEqual(['depends_on=2', 'writes_to=2']);
    expect(stdout).toMatch(/Coverage overlay[^\n]*\b2 blocks(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/Provenance overlay[^\n]*\b1 artifacts(?=$|[\s;,()])/u);

    const json = await expectCliJson(workspaceRoot, ['explain', 'graph', '--json']);
    expect(json).toEqual(graph);
  });
});
