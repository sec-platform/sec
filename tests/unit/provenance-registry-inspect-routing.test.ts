import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceProvenancePath } from '../../src/adapters/workspace-context.ts';
import { projectProvenanceRegistryInspect } from '../../src/application/provenance-registry-inspect.ts';
import { formatProvenanceRegistry } from '../../src/entry/cli/provenance-registry-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('provenance inspection routes text through application and entry while preserving raw JSON', async () => {
  // Retain independent provenance projection and fixed text oracle before CLI readback.
  {
    const source = {
      artifacts: [
        {
          path: 'src/block-a.ts',
          originType: 'block',
          originId: 'block-a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/block-b.ts',
          originType: 'block',
          originId: 'block-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/override.ts',
          originType: 'override',
          originId: 'override-a',
          verifiedBy: ['verify:o'],
          overrideStatus: 'project'
        },
        {
          path: 'src/generated-a.ts',
          originType: 'generated',
          originId: 'generated-a',
          generatedByPass: 'emit',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          generatedByPass: 'compose',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        }
      ]
    };
    const view = projectProvenanceRegistryInspect(source);
    source.artifacts[0]!.verifiedBy.push('later');

    expect(view).toEqual({
      artifactCount: 5,
      registryArtifactCount: 1,
      overrideArtifactCount: 1,
      unverifiedArtifactCount: 3,
      originTypeCounts: [
        { id: 'block', count: 2 },
        { id: 'generated', count: 2 },
        { id: 'override', count: 1 }
      ],
      registrySourceCounts: [{ id: 'official', count: 1 }],
      generatedPasses: ['compose', 'emit'],
      samples: [
        {
          path: 'src/block-a.ts',
          originType: 'block',
          originId: 'block-a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/block-b.ts',
          originType: 'block',
          originId: 'block-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/override.ts',
          originType: 'override',
          originId: 'override-a',
          verifiedBy: ['verify:o'],
          overrideStatus: 'project'
        },
        {
          path: 'src/generated-a.ts',
          originType: 'generated',
          originId: 'generated-a',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        }
      ]
    });

    expect(formatProvenanceRegistry(view)).toBe([
      'Provenance registry; artifacts=5; registry=1; overrides=1; unverified=3',
      'Origins: block=2, generated=2, override=1',
      'Registry sources: official=1',
      'Generated passes: compose, emit',
      'Artifact src/block-a.ts; origin=block:block-a; registry=official; verifiedBy=verify:a; override=none',
      'Artifact src/block-b.ts; origin=block:block-b; registry=none; verifiedBy=none; override=none',
      'Artifact src/override.ts; origin=override:override-a; registry=none; verifiedBy=verify:o; override=project',
      'Artifact src/generated-a.ts; origin=generated:generated-a; registry=none; verifiedBy=none; override=none',
      'Artifact src/generated-b.ts; origin=generated:generated-b; registry=none; verifiedBy=none; override=none'
    ].join('\n'));
  });
  }
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
