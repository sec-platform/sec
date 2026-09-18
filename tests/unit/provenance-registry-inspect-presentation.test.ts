import { describe, expect, test } from 'bun:test';

import { projectProvenanceRegistryInspect } from '../../src/application/provenance-registry-inspect.ts';
import { formatProvenanceRegistry } from '../../src/entry/cli/provenance-registry-inspect.ts';

describe('provenance registry inspection presentation boundary', () => {
  test('application owns counts, generated-pass identity and sample selection while entry only renders', () => {
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
          verifiedBy: [],
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
          verifiedBy: [],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          generatedByPass: 'compose',
          verifiedBy: [],
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
          verifiedBy: [],
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
          verifiedBy: [],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          verifiedBy: [],
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
});
