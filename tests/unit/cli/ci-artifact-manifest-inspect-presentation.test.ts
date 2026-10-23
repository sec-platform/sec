import { describe, expect, test } from 'bun:test';

import { projectCiArtifactManifest } from '../../../src/application/ci-artifact-manifest-inspect.ts';
import { formatCiArtifactManifest } from '../../../src/entry/cli/ci-artifact-manifest-inspect.ts';

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
      'fixed-governance-missing': Number.MAX_SAFE_INTEGER,
      'declared-generated-missing': 2 ** 40,
      'zero-reason': 0
    }));

    expect(view.missingReasons).toEqual([
      { id: 'declared-generated-missing', count: 1099511627776 },
      { id: 'fixed-governance-missing', count: 9007199254740991 }
    ]);
    const text = formatCiArtifactManifest(view);
    expect(text).toMatch(/Artifact manifest\s+attention(?=$|[\s;,()])/u);
    for (const count of [/\bartifacts=4(?=$|[\s;,()])/u, /\bmissing=2(?=$|[\s;,()])/u, /\bupload groups=2(?=$|[\s;,()])/u]) {
      expect(text).toMatch(count);
    }
    const kinds = text.split('\n').find((line) => /^Kinds\b/u.test(line));
    expect(kinds).toMatch(/\bgovernance=1(?=$|[\s;,()])/u);
    expect(kinds).toMatch(/\btest=2(?=$|[\s;,()])/u);
    expect(kinds).toMatch(/\bcontract=1(?=$|[\s;,()])/u);
    const reasons = text.split('\n').find((line) => /^Missing reasons\b/u.test(line));
    expect(reasons).toMatch(/\bdeclared-generated-missing=1099511627776(?=$|[\s;,()])/u);
    expect(reasons).toMatch(/\bfixed-governance-missing=9007199254740991(?=$|[\s;,()])/u);
    expect(reasons).not.toContain('zero-reason');
    const emptyReasons = formatCiArtifactManifest(projectCiArtifactManifest(source({ 'zero-reason': 0 })));
    expect(emptyReasons).toMatch(/Missing reasons\W+none(?=$|[\s;,()])/u);
    const groups = text.split('\n').find((line) => /^Upload groups\b/u.test(line));
    expect(groups).toMatch(/\bgovernance=1(?=$|[\s;,()])/u);
    expect(groups).toMatch(/\btest=2(?=$|[\s;,()])/u);
  });

  test('invalid aggregate counts fail explicitly', () => {
    for (const count of [-1, 0.5, Infinity, NaN]) {
      expect(() => projectCiArtifactManifest(source({ invalid: count }))).toThrow(RangeError);
    }
  });
});
