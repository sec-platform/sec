import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { checkProjectWriteBoundary } from '../../src/adapters/workspace/project-write-boundary.ts';
import { writeText } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { writeProjectBaseline } from '../../src/adapters/workspace/project-baseline.ts';
import { buildUpgradePlanArtifact } from '../helpers/upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function baselinePathInput(path: string) {
  return {
    artifactPaths: [path]
  };
}

async function prepareBaseline(workspaceRoot: string): Promise<void> {
  const artifactPath = 'src/ui/page.ts';
  const absolutePath = path.join(getWorkspacePaths(workspaceRoot).workspaceRoot, artifactPath);
  await writeText(absolutePath, 'export const value = 1;\n');
  await writeProjectBaseline(workspaceRoot, baselinePathInput(artifactPath));
}

test('a caller-written UpgradePlan cannot mint project write authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareBaseline(workspaceRoot);
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await fs.mkdir(path.dirname(upgradePlanPath), { recursive: true });

    await fs.writeFile(
      upgradePlanPath,
      `${JSON.stringify(buildUpgradePlanArtifact({ impacts: ['src/ui/page.ts'] }))}\n`,
      'utf8'
    );
    await writeText(
      path.join(getWorkspacePaths(workspaceRoot).workspaceRoot, 'src/ui/page.ts'),
      'export const value = 2;\n'
    );
    await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001',
      details: { path: 'src/ui/page.ts' }
    });
  });
});

test('a linked persisted UpgradePlan cannot become an authority side channel', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareBaseline(workspaceRoot);
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    const workflowRoot = path.dirname(upgradePlanPath);
    const externalWorkflow = path.join(workspaceRoot, 'external-workflow');
    await fs.rm(workflowRoot, { recursive: true, force: true });
    await fs.mkdir(path.dirname(workflowRoot), { recursive: true });
    await fs.mkdir(externalWorkflow, { recursive: true });
    await fs.writeFile(
      path.join(externalWorkflow, path.basename(upgradePlanPath)),
      `${JSON.stringify(buildUpgradePlanArtifact({ impacts: ['src/ui/page.ts'] }))}\n`,
      'utf8'
    );
    await fs.symlink(
      externalWorkflow,
      workflowRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await writeText(
      path.join(getWorkspacePaths(workspaceRoot).workspaceRoot, 'src/ui/page.ts'),
      'export const value = 2;\n'
    );
    await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
      code: 'ERROR-DRIFT-001',
      details: { path: 'src/ui/page.ts' }
    });
  });
});
