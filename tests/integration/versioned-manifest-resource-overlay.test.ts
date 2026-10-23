import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { loadManifestById } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { readManifestResourceFileUtf8 } from '../../src/adapters/workspace/sources/read-manifest-resource.ts';
import { buildPrivatePlanRegistrySource } from '../helpers/plan-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('versioned manifest resources use the changed version file and fall back to the root file', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
    const blockRoot = path.join(privateRegistryRoot, 'private.block-upgrade');
    const versionRoot = path.join(blockRoot, 'versions', '0.2.0');
    const changedResource = 'files/changed.txt';
    const inheritedResource = 'files/inherited.txt';
    await fs.mkdir(path.join(blockRoot, 'files'), { recursive: true });
    await fs.mkdir(path.join(versionRoot, 'files'), { recursive: true });
    await fs.writeFile(path.join(blockRoot, 'block.manifest.yaml'), JSON.stringify({
      id: 'private/block-upgrade', version: '0.1.0', kind: 'capability',
      stackProfiles: ['typescript-library'], requires: [], provides: [], conflicts: [],
      installs: [{ kind: 'copy', from: changedResource, to: 'src/changed.txt' }],
      pins: { inputs: [], outputs: [] }, acceptance: []
    }), 'utf8');
    await fs.writeFile(path.join(versionRoot, 'block.manifest.yaml'), JSON.stringify({ version: '0.2.0' }), 'utf8');
    await fs.writeFile(path.join(blockRoot, changedResource), 'root changed\n', 'utf8');
    await fs.writeFile(path.join(versionRoot, changedResource), 'version changed\n', 'utf8');
    await fs.writeFile(path.join(blockRoot, inheritedResource), 'root inherited\n', 'utf8');

    const registrySources = [buildPrivatePlanRegistrySource()];
    const versionEntry = loadManifestById('private/block-upgrade', {
      workspaceRoot,
      registrySources,
      version: '0.2.0'
    });

    expect(versionEntry.resourceRoots).toEqual([versionRoot, blockRoot]);
    expect(readManifestResourceFileUtf8(versionEntry, changedResource)).toMatchObject({
      root: versionRoot,
      raw: 'version changed\n'
    });
    expect(readManifestResourceFileUtf8(versionEntry, inheritedResource)).toMatchObject({
      root: blockRoot,
      raw: 'root inherited\n'
    });
  });
});
