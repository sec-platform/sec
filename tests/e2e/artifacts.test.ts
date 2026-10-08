import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES, CI_ARTIFACT_PATHS } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MISSING_REASON,
  type CiArtifactManifest
} from '../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { expectCliJson, expectCliSuccess, expectCliVariants } from '../testkit/cli.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('provenance is readable before explain and artifact inventory diagnoses missing governance', async () => {
  await withWorkspaceScenario('locked-all-default', async (workspaceRoot) => {
    const { json: provenance } = await expectCliVariants<{
      formatVersion: string;
      artifacts: Array<{
        path: string;
        originType: string;
        registrySourceId?: string;
        verifiedBy: string[];
        overrideStatus: string;
      }>;
    }>(workspaceRoot, ['provenance', 'registry'], {
      text: [
        'Provenance registry; artifacts=',
        'Origins: block=',
        'Registry sources: official='
      ],
      compactJson: {
        formatVersion: '1',
        artifacts: expect.any(Array)
      }
    });
    expect(provenance.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          registrySourceId: 'official'
        })
      ])
    );
    await expectCliSuccess(workspaceRoot, ['explain']);
    const manifest = await expectCliJson<CiArtifactManifest>(workspaceRoot, ['artifacts', '--json']);

    expect(manifest.summary).toMatchObject({
      artifactStatus: 'passed',
      artifactCount: manifest.artifacts.length,
      governanceCount: expect.any(Number),
      testCount: expect.any(Number),
      contractCount: expect.any(Number),
      missingCount: 0
    });
    expect(manifest.artifacts.every((artifact) =>
      CI_ARTIFACT_KINDS.includes(artifact.kind)
    )).toBe(true);
    expect(manifest.artifacts.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining(CI_ARTIFACT_PATHS.requiredGovernance)
    );
    await fs.rm(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport));
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
