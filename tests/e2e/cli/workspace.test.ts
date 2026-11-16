import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { readJson } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { installPrivateBannerBlock } from '../../helpers/private-registry-fixtures.ts';
import { expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

type WorkspaceLockSnapshot = {
  resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
};

type WorkspacePathsSnapshot = ReturnType<typeof getWorkspacePaths>;

function nativeWorkspaceDirectories(paths: WorkspacePathsSnapshot): string[] {
  return [
    paths.modelRoot,
    paths.modelBlocksRoot,
    paths.privateRegistryRoot,
    paths.policiesRoot,
    paths.overridesRoot,
    paths.srcRoot,
    paths.testsRoot,
    paths.prismaRoot,
    paths.secRoot,
    paths.artifactsRoot,
    paths.cacheRoot,
    paths.workspaceWriteLeaseRoot
  ];
}

async function expectDirectoriesExist(directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    const entry = await fs.stat(directory);
    expect(entry.isDirectory(), `Expected workspace directory: ${directory}`).toBe(true);
  }
}

test('CLI initializes native roots, adds private blocks, and preserves registry metadata on resolve', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliSuccess(workspaceRoot, ['init'], 'Initialized project workspace\n');
    await expectDirectoriesExist(nativeWorkspaceDirectories(getWorkspacePaths(workspaceRoot)));
    await installPrivateBannerBlock(workspaceRoot);
    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);

    await expectCliSuccess(
      workspaceRoot,
      ['add', 'private/banner-basic'],
      'Added block private/banner-basic@0.1.0 from private (private)\n'
    );
    await expect(fs.readFile(workspaceConfigPath, 'utf8')).resolves.toContain('private/banner-basic');

    await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 1 blocks\n');
    const lock = await readJson<WorkspaceLockSnapshot>(lockPath);
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
}, 180000);
