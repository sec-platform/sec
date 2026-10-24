import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

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
    const json = await expectCliJson(workspaceRoot, ['artifacts', 'manifest', '--json']);
    expect(json).toEqual(manifest);

    // A successful empty manifest cannot detect a reader that accidentally
    // drops all nonempty groups or missing diagnostics. Use independently
    // authored counts and files, not the projection under test as the oracle.
    const nonempty: CiArtifactManifest = {
      ...manifest,
      summary: {
        ...manifest.summary,
        artifactStatus: 'attention',
        artifactCount: 2, governanceCount: 1, testCount: 1,
        uploadGroupCount: 2, missingCount: 1, missingReasonTypeCount: 1,
        missingReasonCounts: {
          ...manifest.summary.missingReasonCounts, 'fixed-governance-missing': 1
        }
      },
      artifacts: [
        { path: CI_ARTIFACT_FILES.reviewSummary, kind: 'governance', uploadName: 'review', exists: true },
        { path: '.sec/artifacts/test-results/unit.xml', kind: 'test', uploadName: 'unit', exists: true }
      ],
      uploadGroups: [
        { kind: 'governance', count: 1, paths: [CI_ARTIFACT_FILES.reviewSummary] },
        { kind: 'test', count: 1, paths: ['.sec/artifacts/test-results/unit.xml'] }
      ],
      missing: [{
        path: CI_ARTIFACT_FILES.graphLock,
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      }]
    };
    await fs.writeFile(manifestPath, JSON.stringify(nonempty) + '\n', 'utf8');
    const populated = await expectCliSuccess(workspaceRoot, ['artifacts', 'manifest']);
    const output = populated.stdout;
    for (const field of [
      /Artifact manifest\s+attention(?=$|[\s;,()])/u,
      /\bartifacts=2(?=$|[\s;,()])/u,
      /\bmissing=1(?=$|[\s;,()])/u,
      /\bupload groups=2(?=$|[\s;,()])/u,
      /\bgovernance=1(?=$|[\s;,()])/u,
      /\btest=1(?=$|[\s;,()])/u,
      /\bfixed-governance-missing=1(?=$|[\s;,()])/u
    ]) expect(output).toMatch(field);
    expect(await expectCliJson(workspaceRoot, ['artifacts', 'manifest', '--json'])).toEqual(nonempty);
  });
});
