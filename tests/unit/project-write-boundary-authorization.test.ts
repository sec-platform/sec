import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import {
  failPipelineTransaction,
  startPipelineTransaction
} from '../../src/compiler/pipeline/journal.ts';
import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { writeText } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { checkProjectWriteBoundary, writeProjectBaseline } from '../../src/workspace/project.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lockFor(path: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'upgrade-authorization-test',
      name: 'upgrade-authorization-test',
      stack: 'typescript-library',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [path],
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

async function prepareBaseline(workspaceRoot: string): Promise<void> {
  const artifactPath = 'app/page.tsx';
  const absolutePath = path.join(getWorkspacePaths(workspaceRoot).projectRoot, artifactPath);
  await writeText(absolutePath, 'export const value = 1;\n');
  await writeProjectBaseline(workspaceRoot, lockFor(artifactPath));
}

async function withActiveUpgrade(
  workspaceRoot: string,
  execute: () => Promise<void>
): Promise<void> {
  const transactionId = await startPipelineTransaction(
    workspaceRoot,
    'upgrade',
    ['resolve', 'compose'],
    async () => undefined
  );
  try {
    await execute();
  } finally {
    await failPipelineTransaction(
      workspaceRoot,
      transactionId,
      'TEST-END',
      'test transaction closed',
      async () => undefined
    );
  }
}

test('active UpgradePlan cannot authorize traversal or duplicate impact paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareBaseline(workspaceRoot);
    const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    await fs.mkdir(path.dirname(upgradePlanPath), { recursive: true });

    await withActiveUpgrade(workspaceRoot, async () => {
      for (const impacts of [
        ['../outside.ts'],
        ['app/page.tsx', 'app/page.tsx']
      ]) {
        await fs.writeFile(upgradePlanPath, `${JSON.stringify({
          formatVersion: '1',
          status: 'planned',
          impacts
        })}\n`, 'utf8');
        await expect(checkProjectWriteBoundary(workspaceRoot))
          .rejects.toThrow('UpgradePlan authorization');
      }
    });
  });
});

test('active UpgradePlan authorization rejects a linked workflow ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareBaseline(workspaceRoot);
    const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    const workflowRoot = path.dirname(upgradePlanPath);
    const externalWorkflow = path.join(workspaceRoot, 'external-workflow');
    await fs.rm(workflowRoot, { recursive: true, force: true });
    await fs.mkdir(path.dirname(workflowRoot), { recursive: true });
    await fs.mkdir(externalWorkflow, { recursive: true });
    await fs.writeFile(
      path.join(externalWorkflow, path.basename(upgradePlanPath)),
      `${JSON.stringify({ formatVersion: '1', status: 'planned', impacts: ['app/page.tsx'] })}\n`,
      'utf8'
    );
    await fs.symlink(
      externalWorkflow,
      workflowRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await withActiveUpgrade(workspaceRoot, async () => {
      await expect(checkProjectWriteBoundary(workspaceRoot))
        .rejects.toBeInstanceOf(PhysicalNoFollowError);
    });
  });
});
