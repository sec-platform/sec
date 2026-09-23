import { describe, expect, test } from 'bun:test';

import { projectCiArtifactManifest } from '../../src/application/ci-artifact-manifest-inspect.ts';
import { formatCiArtifactManifest } from '../../src/entry/cli/ci-artifact-manifest-inspect.ts';

function source(counts: Readonly<Record<string, number>>) {
  return {
    summary: {
      artifactStatus: 'attention',
      artifactCount: 4,
      missingCount: 2,
      uploadGroupCount: 2,
      governanceCount: 1,
      testCount: 2,
      contractCount: 1,
      missingReasonCounts: counts
    },
    uploadGroups: [
      { kind: 'governance', count: 1 },
      { kind: 'test', count: 2 }
    ]
  };
}

describe('CI artifact manifest presentation boundary', () => {
  test('application owns finite projection and canonical aggregate counts while entry only renders', () => {
    const view = projectCiArtifactManifest(source({
      'fixed-governance-missing': 2,
      'declared-generated-missing': 1,
      'zero-reason': 0
    }));

    expect(view.missingReasons).toEqual([
      { id: 'declared-generated-missing', count: 1 },
      { id: 'fixed-governance-missing', count: 2 }
    ]);
    expect(formatCiArtifactManifest(view)).toBe([
      'Artifact manifest attention',
      'artifacts=4; missing=2; upload groups=2',
      'Kinds: governance=1, test=2, contract=1',
      'Missing reasons: declared-generated-missing=1, fixed-governance-missing=2',
      'Upload groups: governance=1, test=2'
    ].join('\n'));
  });

  test('large aggregate counts remain aggregates and invalid counts fail explicitly', () => {
    const large = projectCiArtifactManifest(source({
      'fixed-governance-missing': Number.MAX_SAFE_INTEGER,
      'declared-generated-missing': 2 ** 40
    }));
    expect(formatCiArtifactManifest(large)).toContain(
      `Missing reasons: declared-generated-missing=${2 ** 40}, fixed-governance-missing=${Number.MAX_SAFE_INTEGER}`
    );

    for (const count of [-1, 0.5, Infinity, NaN]) {
      expect(() => projectCiArtifactManifest(source({ invalid: count }))).toThrow(RangeError);
    }
  });
});
