import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { projectCiArtifactManifest } from '../../../src/application/ci-artifact-manifest-inspect.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('artifact manifest inspection routes retained manifest through application and entry while preserving JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manifest: CiArtifactManifest = {
      formatVersion: '2',
      root: 'workspace',
      summary: {
        artifactStatus: 'passed',
        artifactCount: 0,
        governanceCount: 0,
        testCount: 0,
        contractCount: 0,
        contractPaths: [],
        uploadGroupCount: 0,
        missingCount: 0,
        missingReasonTypeCount: 0,
        missingReasonCounts: {
          'declared-generated-missing': 0,
          'fixed-governance-missing': 0,
          'stale-semantic-projection': 0
        }
      },
      artifacts: [],
      uploadGroups: [],
      missing: []
    };

    const manifestPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.artifactManifest);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const { stdout } = await expectCliSuccess(workspaceRoot, ['artifacts', 'manifest']);
    expect(stdout).toMatch(/Artifact manifest\s+passed(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bartifacts=0(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bmissing=0(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bupload groups=0(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/^Missing reasons:\s*none\s*$/mu);
    // A successful empty manifest cannot detect a reader that accidentally
    // drops all nonempty groups or missing diagnostics. Use independently
    // authored counts and files, not the projection under test as the oracle.
    const nonempty: CiArtifactManifest = {
      ...manifest,
      summary: {
        ...manifest.summary,
        artifactStatus: 'attention',
        artifactCount: 4, governanceCount: 1, testCount: 2, contractCount: 1,
        uploadGroupCount: 3, missingCount: 2, missingReasonTypeCount: 2,
        missingReasonCounts: {
          'fixed-governance-missing': Number.MAX_SAFE_INTEGER,
          'declared-generated-missing': 2 ** 40,
          'stale-semantic-projection': 0
        }
      },
      artifacts: [
        { path: CI_ARTIFACT_FILES.reviewSummary, kind: 'governance', uploadName: 'review', exists: true },
        { path: '.sec/artifacts/test-results/unit.xml', kind: 'test', uploadName: 'unit', exists: true },
        { path: '.sec/artifacts/test-results/acceptance.xml', kind: 'test', uploadName: 'acceptance', exists: true },
        { path: '.sec/artifacts/generated/runtime-contract.json', kind: 'contract', uploadName: 'runtime', exists: true }
      ],
      uploadGroups: [
        { kind: 'governance', count: 1, paths: [CI_ARTIFACT_FILES.reviewSummary] },
        { kind: 'test', count: 2, paths: ['.sec/artifacts/test-results/unit.xml', '.sec/artifacts/test-results/acceptance.xml'] },
        { kind: 'contract', count: 1, paths: ['.sec/artifacts/generated/runtime-contract.json'] }
      ],
      missing: [{
        path: CI_ARTIFACT_FILES.graphLock,
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      }, {
        path: '.sec/artifacts/generated/missing-contract.json',
        reason: 'declared-generated-missing',
        declaredBy: 'artifact-manifest'
      }]
    };
    await fs.writeFile(manifestPath, JSON.stringify(nonempty) + '\n', 'utf8');
    const populated = await expectCliSuccess(workspaceRoot, ['artifacts', 'manifest']);
    const output = populated.stdout;
    for (const field of [
      /Artifact manifest\s+attention(?=$|[\s;,()])/u,
      /\bartifacts=4(?=$|[\s;,()])/u,
      /\bmissing=2(?=$|[\s;,()])/u,
      /\bupload groups=3(?=$|[\s;,()])/u
    ]) expect(output).toMatch(field);
    expect(output).toMatch(/^Kinds:\s*governance=1,\s*test=2,\s*contract=1\s*$/mu);
    expect(output).toMatch(/^Missing reasons:\s*declared-generated-missing=1099511627776,\s*fixed-governance-missing=9007199254740991\s*$/mu);
    expect(output).not.toContain('stale-semantic-projection');
    expect(output).toMatch(/^Upload groups:\s*governance=1,\s*test=2,\s*contract=1\s*$/mu);
    expect(await expectCliJson(workspaceRoot, ['artifacts', 'manifest', '--json'])).toEqual(nonempty);
  });
});

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

test('invalid aggregate counts fail explicitly', () => {
  for (const count of [-1, 0.5, Infinity, NaN]) {
    expect(() => projectCiArtifactManifest(source({ invalid: count }))).toThrow(RangeError);
  }
});
