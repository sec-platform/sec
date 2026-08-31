import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, writeJson, writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { checkProjectWriteBoundary, writeProjectBaseline } from '../../src/workspace/project.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function lockFor(artifactPath: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'write-boundary-test',
      name: 'write-boundary-test',
      stack: 'typescript-library',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [artifactPath],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

test('project write boundary prefers current local baseline over stale provenance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
    const artifactPath = 'src/ui/page.ts';
    const absolutePath = path.join(root, artifactPath);
    const previousContent = 'export const revision = 1;';
    const currentContent = 'export const revision = 2;';

    await ensureDir(path.dirname(absolutePath));
    await writeText(absolutePath, previousContent);
    await writeJson(provenancePath, {
      formatVersion: '1',
      artifacts: [{
        path: artifactPath,
        originType: 'generated',
        originId: artifactPath,
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none',
        hash: digest(previousContent)
      }]
    } satisfies ProvenanceFile);

    await writeText(absolutePath, currentContent);
    await writeProjectBaseline(workspaceRoot, lockFor(artifactPath));

    await checkProjectWriteBoundary(workspaceRoot);

    await writeText(absolutePath, `${currentContent}\nexport const changed = true;`);
    await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001'
    });
  }, 'engineering-compiler-project-write-boundary-');
});
