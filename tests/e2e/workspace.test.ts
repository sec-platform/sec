import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';
import { expectCliSuccess, expectCliText } from '../testkit/cli.ts';
import { withTempWorkspace, withWorkspaceScenario } from '../testkit/workspace.ts';

type WorkspaceLockSnapshot = {
  resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
};

type WorkspacePathsSnapshot = ReturnType<typeof getWorkspacePaths>;

function developerSourceLayerDirectories(paths: WorkspacePathsSnapshot): string[] {
  return [
    paths.developerSourceRoot,
    paths.sourceSlotsRoot,
    paths.sourceOverridesRoot,
    paths.sourcePoliciesRoot,
    paths.sourceAcceptanceRoot,
    paths.sourceAssetsRoot,
    paths.privateRegistryRoot,
    paths.sourceEnvRoot
  ];
}

async function expectDirectoriesExist(directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    await expect(fs.stat(directory)).resolves.toBeTruthy();
  }
}

test('CLI accepts init commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init'], 'Initialized project workspace\n');
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
  });
}, 180000);
test('CLI init creates the developer source layer', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

    const paths = getWorkspacePaths(workspaceRoot);
    await expectDirectoriesExist(developerSourceLayerDirectories(paths));
  });
}, 180000);
test('CLI defaults verification to the fast lane', async () => {
  await withWorkspaceScenario('adapted-default', async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['verify'], ['Verification passed (fast)\n']);
  });
}, 180000);
test('CLI adds private registry blocks and preserves registry metadata on resolve', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    await installPrivateBannerBlock(workspaceRoot);
    const { lockPath, planPath } = getWorkspacePaths(workspaceRoot);

    await expectCliSuccess(
      workspaceRoot,
      ['add', 'private/banner-basic'],
      'Added block private/banner-basic@0.1.0 from private (private)\n'
    );
    await expect(fs.readFile(planPath, 'utf8')).resolves.toContain('private/banner-basic');

    await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 4 blocks\n');
    const lock = await readJson<WorkspaceLockSnapshot>(lockPath);
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
}, 180000);
