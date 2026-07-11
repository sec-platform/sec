import { expect, test } from 'bun:test';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import { CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../platform/shared/ci-artifact-contract.ts';
import { writeText } from '../../platform/shared/fs.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { resolveWorkspaceArtifactPath } from '../../platform/shared/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('provenance records projection outputs without recursively hashing them', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const stablePath = 'generated/stable-output.ts';
    const lock: LockFile = {
      formatVersion: '1',
      app: { id: 'projection-hash-test', name: 'projection-hash-test', stack: 'nextjs-ts-prisma-sqlite', mode: 'single-tenant' },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [...CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS, stablePath],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'pending',
        lock: 'succeeded',
        emit: 'running'
      }
    };

    await Promise.all(CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS.map((artifactPath) =>
      writeText(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath), `projection:${artifactPath}\n`)
    ));
    await writeText(resolveWorkspaceArtifactPath(workspaceRoot, stablePath), 'stable\n');

    const provenance = await buildProvenance(workspaceRoot, lock);
    for (const artifactPath of CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS) {
      const artifact = provenance.artifacts.find((entry) => entry.path === artifactPath);
      expect(artifact).toBeDefined();
      expect(artifact).not.toHaveProperty('hash');
    }
    expect(provenance.artifacts.find((entry) => entry.path === stablePath)?.hash).toMatch(/^[a-f0-9]{64}$/u);
  }, 'engineering-compiler-provenance-projection-hash-');
});
