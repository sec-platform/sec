import path from 'node:path';

import { expect, test } from 'bun:test';

import { writeJson, writeText } from '../../platform/shared/fs.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { failPipelineTransaction, startPipelineTransaction } from '../../platform/shared/pipeline-journal.ts';
import { writeProjectBaseline } from '../../platform/shared/project-baseline.ts';
import { checkProjectWriteBoundary } from '../../platform/shared/project-write-boundary.ts';
import type { UpgradePlan } from '../../platform/shared/upgrade-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lockFor(paths: string[]): LockFile {
  return {
    formatVersion: '1',
    app: { id: 'upgrade-boundary-test', name: 'upgrade-boundary-test', stack: 'nextjs-ts-prisma-sqlite', mode: 'single-tenant' },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: paths,
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

function plannedUpgrade(impacts: string[]): UpgradePlan {
  return {
    formatVersion: '1',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    status: 'planned',
    preflightChecks: [],
    impacts,
    migrations: [],
    migrationKindCounts: {},
    migrationSummaries: [],
    migrationOperations: []
  };
}

test('active upgrade transaction authorizes only declared project impacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { projectRoot, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    const allowedPath = 'app/page.tsx';
    const deniedPath = 'app/other.tsx';
    const allowedAbsolute = path.join(projectRoot, allowedPath);
    const deniedAbsolute = path.join(projectRoot, deniedPath);

    await writeText(allowedAbsolute, 'export const allowed = 1;\n');
    await writeText(deniedAbsolute, 'export const denied = 1;\n');
    await writeProjectBaseline(workspaceRoot, lockFor([allowedPath, deniedPath]));
    await writeJson(upgradePlanPath, plannedUpgrade([allowedPath]));

    const transactionId = await startPipelineTransaction(workspaceRoot, 'upgrade', ['resolve', 'compose']);
    try {
      await writeText(allowedAbsolute, 'export const allowed = 2;\n');
      await checkProjectWriteBoundary(workspaceRoot);

      await writeText(deniedAbsolute, 'export const denied = 2;\n');
      await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
        code: 'ERROR-DRIFT-001',
        details: { path: deniedPath }
      });
    } finally {
      await failPipelineTransaction(workspaceRoot, transactionId, 'TEST-END', 'test transaction closed');
    }
  }, 'engineering-compiler-upgrade-write-boundary-');
});
