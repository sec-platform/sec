import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectCiArtifactManifest } from '../../src/application/ci-artifact-manifest-inspect.ts';
import { formatCiArtifactManifest } from '../../src/entry/cli/ci-artifact-manifest-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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

    await expectCliSuccess(
      workspaceRoot,
      ['artifacts', 'manifest'],
      `${formatCiArtifactManifest(projectCiArtifactManifest(manifest))}\n`
    );
    const json = await expectCliJson(workspaceRoot, ['artifacts', 'manifest', '--json']);
    expect(json).toEqual(manifest);
  });
});
