import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import { buildProvenance } from '../../src/adapters/artifacts/provenance.ts';
import { CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { writeText } from "../../src/adapters/filesystem/files.ts";
import { resolvePathInside } from "../../src/contracts/relative-path.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { withTempWorkspace } from '../testkit/workspace.ts';

test('provenance records projection outputs without recursively hashing them', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const stablePath = 'src/generated/stable-output.ts';
    const lock: LockFile = {
      formatVersion: '1',
      app: { id: 'projection-hash-test', name: 'projection-hash-test', stack: 'typescript-library', mode: 'single-tenant' },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      generatedPaths: [...CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS, stablePath],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        verify: 'succeeded',
        repair: 'pending',
        lock: 'succeeded',
        emit: 'running'
      }
    };

    await Promise.all(CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS.map((artifactPath) =>
      writeText(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath), `projection:${artifactPath}\n`)
    ));
    const stableOutputPath = resolvePathInside(workspaceRoot, stablePath);
    if (stableOutputPath === null) throw new Error('Stable provenance fixture path escaped workspace');
    await writeText(stableOutputPath, 'stable\n');

    const provenance = await buildProvenance(workspaceRoot, lock);
    for (const artifactPath of CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS) {
      const artifact = provenance.artifacts.find((entry) => entry.path === artifactPath);
      expect(artifact).toBeDefined();
      expect(artifact).not.toHaveProperty('hash');
    }
    expect(provenance.artifacts.find((entry) => entry.path === stablePath)?.hash).toMatch(/^[a-f0-9]{64}$/u);
  }, 'engineering-compiler-provenance-projection-hash-');
});
