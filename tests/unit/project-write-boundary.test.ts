import { createHash } from 'node:crypto';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { ensureDir, writeJson, writeText } from '../../platform/shared/fs.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeProjectBaseline } from '../../platform/shared/project-baseline.ts';
import { checkProjectWriteBoundary } from '../../platform/shared/project-write-boundary.ts';
import type { ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function lockFor(artifactPath: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      name: 'write-boundary-test',
      stack: 'nextjs-ts-prisma-sqlite',
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
    const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
    const artifactPath = 'app/page.tsx';
    const absolutePath = path.join(projectRoot, artifactPath);
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
