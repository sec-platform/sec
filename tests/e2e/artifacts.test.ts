import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { CI_ARTIFACT_FILES, CI_ARTIFACT_PATHS } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { CI_ARTIFACT_MISSING_REASON } from '../../src/verification/ci-artifacts/contract/types.ts';
import type { CiArtifactManifest } from '../../src/verification/ci-artifacts/contract/types.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { expectCliJson } from '../testkit/cli.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('artifact inventory publishes only machine evidence and diagnoses missing governance', async () => {
  await withWorkspaceScenario('explained-all-default', async (workspaceRoot) => {
    const manifest = await expectCliJson<CiArtifactManifest>(workspaceRoot, ['artifacts', '--json']);

    expect(manifest.summary).toMatchObject({
      artifactStatus: 'passed',
      artifactCount: manifest.artifacts.length,
      governanceCount: expect.any(Number),
      testCount: expect.any(Number),
      contractCount: expect.any(Number),
      missingCount: 0
    });
    expect('viewCount' in manifest.summary).toBe(false);
    expect(manifest.artifacts.every((artifact) =>
      !/\b(?:html|workbench|playwright|browser)\b/iu.test(`${artifact.path} ${artifact.kind}`)
    )).toBe(true);
    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining(CI_ARTIFACT_PATHS.requiredGovernance)
    );
    expect(new Set(manifest.artifacts.map((artifact) => artifact.kind))).not.toContain('view');

    const paths = getWorkspacePaths(workspaceRoot);
    await fs.rm(paths.policyReportPath);
    const missing = await expectCliJson<CiArtifactManifest>(workspaceRoot, ['artifacts', '--json']);
    expect(missing.summary.artifactStatus).toBe('attention');
    expect(missing.missing).toContainEqual({
      path: CI_ARTIFACT_FILES.policyReport,
      reason: CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing,
      declaredBy: 'artifact-manifest'
    });
    expect(missing.summary.missingReasonCounts).toMatchObject({
      [CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing]: 1
    });
  });
}, 120000);
