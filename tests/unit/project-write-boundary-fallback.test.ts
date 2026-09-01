import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { checkProjectWriteBoundary } from '../../src/workspace/application/project-write-boundary.ts';
import { ensureDir, writeJson, writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

test('project write boundary falls back to provenance when no local baseline exists', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const artifactPath = 'src/ui/page.ts';
    const absolutePath = path.join(root, artifactPath);
    const expectedContent = 'export const revision = 1;';

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, expectedContent);
    await writeJson(provenancePath, {
      formatVersion: '1',
      artifacts: [{
        path: artifactPath,
        originType: 'generated',
        originId: artifactPath,
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none',
        hash: digest(expectedContent)
      }]
    } satisfies ProvenanceFile);

    await checkProjectWriteBoundary(workspaceRoot);

    await writeText(absolutePath, 'export const revision = 9;');
    await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-project-write-boundary-fallback-');
});
