import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { loadManifestById } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { readManifestResourceFileUtf8 } from '../../src/adapters/workspace/sources/read-manifest-resource.ts';
import { writeBlockUpgradeFixture } from '../helpers/block-upgrade-fixtures.ts';
import { buildPrivatePlanRegistrySource } from '../helpers/plan-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('versioned manifest resources use the changed version file and fall back to the root file', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeBlockUpgradeFixture(workspaceRoot);
    const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
    const blockRoot = path.join(privateRegistryRoot, 'private.block-upgrade');
    const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
    const changedResource = 'files/changed.txt';
    const inheritedResource = 'files/inherited.txt';
    await fs.mkdir(path.join(blockRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(versionRoot, 'files'), { recursive: true });
    await fs.writeFile(path.join(blockRoot, changedResource), 'root changed\n', 'utf8');
    await fs.writeFile(path.join(versionRoot, changedResource), 'version changed\n', 'utf8');
    await fs.writeFile(path.join(blockRoot, inheritedResource), 'root inherited\n', 'utf8');

    const registrySources = [buildPrivatePlanRegistrySource()];
    const rootEntry = loadManifestById('private/block-upgrade', { workspaceRoot, registrySources });
    const versionEntry = loadManifestById('private/block-upgrade', {
      workspaceRoot,
      registrySources,
      version: '0.2.0'
    });

    expect(versionEntry.resourceRoots).toEqual([versionEntry.manifestRoot, rootEntry.manifestRoot]);
    expect(readManifestResourceFileUtf8(versionEntry, changedResource)).toMatchObject({
      root: versionEntry.manifestRoot,
      raw: 'version changed\n'
    });
    expect(readManifestResourceFileUtf8(versionEntry, inheritedResource)).toMatchObject({
      root: rootEntry.manifestRoot,
      raw: 'root inherited\n'
    });
  });
});
