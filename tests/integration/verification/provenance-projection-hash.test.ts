import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { buildProvenance } from '../../../src/adapters/artifacts/provenance.ts';
import { writeText } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES, CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import { resolvePathInside } from "../../../src/contracts/relative-path.ts";
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('provenance records projection outputs without recursively hashing them', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const stablePath = 'src/generated/stable-output.ts';
    // Provenance must remain a recursion breaker even if it is accidentally
    // removed from the production exclusion collection.
    const projectionPaths = [...new Set([
      CI_ARTIFACT_FILES.provenance,
      ...CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS
    ])];
    const stableContent = 'stable\n';
    const changedContent = 'changed stable output\n';
    const expectedHash = createHash('sha256').update(stableContent).digest('hex');
    const lock: LockFile = {
      formatVersion: '1',
      app: { id: 'projection-hash-test', name: 'projection-hash-test', stack: 'typescript-library', mode: 'single-tenant' },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      generatedPaths: [...projectionPaths, stablePath],
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

    // No parallel writer may escape into cleanup after a sibling rejects.
    for (const artifactPath of projectionPaths) {
      await writeText(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath), `projection:${artifactPath}\n`);
    }
    const stableOutputPath = resolvePathInside(workspaceRoot, stablePath);
    if (stableOutputPath === null) throw new Error('Stable provenance fixture path escaped workspace');
    await writeText(stableOutputPath, stableContent);

    const provenance = await buildProvenance(workspaceRoot, lock);
    for (const artifactPath of projectionPaths) {
      const artifact = provenance.artifacts.find((entry) => entry.path === artifactPath);
      expect(artifact).toBeDefined();
      expect(artifact).not.toHaveProperty('hash');
    }
    expect(provenance.artifacts.find((entry) => entry.path === stablePath)?.hash).toBe(expectedHash);

    await writeText(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
      'changed recursive projection\n');
    const afterProjectionChange = await buildProvenance(workspaceRoot, lock);
    expect(afterProjectionChange).toEqual(provenance);

    await writeText(stableOutputPath, changedContent);
    const afterStableChange = await buildProvenance(workspaceRoot, lock);
    expect(afterStableChange.artifacts.find((entry) => entry.path === stablePath)?.hash)
      .toBe(createHash('sha256').update(changedContent).digest('hex'));
    expect(afterStableChange.artifacts.find((entry) => entry.path === CI_ARTIFACT_FILES.provenance))
      .toEqual(provenance.artifacts.find((entry) => entry.path === CI_ARTIFACT_FILES.provenance));
  }, 'engineering-compiler-provenance-projection-hash-');
});
