import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceProvenancePath } from '../../src/adapters/workspace-context.ts';
import { projectProvenanceRegistryInspect } from '../../src/application/provenance-registry-inspect.ts';
import { formatProvenanceRegistry } from '../../src/entry/cli/provenance-registry-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('provenance inspection routes text through application and entry while preserving raw JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const provenance = {
      formatVersion: '1',
      artifacts: [
        {
          path: 'src/block.ts',
          originType: 'block',
          originId: 'block:a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated.ts',
          originType: 'generated',
          originId: 'generated:a',
          generatedByPass: 'emit',
          verifiedBy: [],
          overrideStatus: 'none'
        }
      ]
    };
    const provenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

    const view = projectProvenanceRegistryInspect(provenance);
    await expectCliSuccess(
      workspaceRoot,
      ['provenance'],
      `${formatProvenanceRegistry(view)}\n`
    );

    const rawJson = await expectCliJson<typeof provenance>(workspaceRoot, ['provenance', '--json']);
    expect(rawJson).toEqual(provenance);
  });
});
