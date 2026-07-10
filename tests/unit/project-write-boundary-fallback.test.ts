import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { ensureDir, writeJson, writeText } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { checkProjectWriteBoundary } from '../../platform/shared/project-write-boundary.ts';
import type { ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

test('project write boundary falls back to provenance when no local baseline exists', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
    const artifactPath = 'app/page.tsx';
    const absolutePath = path.join(projectRoot, artifactPath);
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
