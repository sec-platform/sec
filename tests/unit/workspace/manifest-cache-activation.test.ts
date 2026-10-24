import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { blockDirName, resolveRegistryRoot } from "../../../src/adapters/workspace-context.ts";
import {
  loadAllManifests,
  loadManifestById,
  loadManifestForResolvedBlock
} from '../../../src/adapters/workspace/sources/load-manifest.ts';
import { manifestCache } from '../../../src/adapters/workspace/sources/manifest-cache.ts';

const BLOCK_ID = 'ticket/basic';
const temporaryRoots: string[] = [];

afterEach(async () => {
  manifestCache.clear();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function manifestSource(id: string, version: string): string {
  return [
    `id: ${id}`,
    `version: ${version}`,
    'kind: capability',
    'stackProfiles: [typescript-library]',
    'requires: []',
    'provides: []',
    'conflicts: []',
    'installs:',
    '  - kind: template',
    '    from: source.ts',
    '    to: source.ts',
    'pins: { inputs: [], outputs: [] }',
    'acceptance: []',
    'contracts: []',
    'generators: []',
    ''
  ].join('\n');
}

async function createWorkspaceRegistry(): Promise<{ workspaceRoot: string; registryPath: string; registryRoot: string }> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-manifest-cache-'));
  temporaryRoots.push(workspaceRoot);
  const registryPath = 'registry-cache-fixture';
  const registryRoot = resolveRegistryRoot(workspaceRoot, 'workspace', registryPath);
  await fs.mkdir(registryRoot, { recursive: true });
  return { workspaceRoot, registryPath, registryRoot };
}

async function writeManifest(registryRoot: string, directoryName: string, source: string): Promise<string> {
  const manifestDirectory = path.join(registryRoot, directoryName);
  const manifestPath = path.join(manifestDirectory, 'block.manifest.yaml');
  await fs.mkdir(manifestDirectory, { recursive: true });
  await fs.writeFile(manifestPath, source, 'utf8');
  return manifestPath;
}

test('repeated manifest loads preserve deeply immutable source content', async () => {
  manifestCache.clear();
  const first = await loadManifestById(BLOCK_ID);
  const second = await loadManifestById(BLOCK_ID);

  expect(second).toEqual(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.manifest)).toBe(true);
  expect(Object.isFrozen(first.manifest.provides)).toBe(true);
  expect(Object.isFrozen(first.manifest.installs)).toBe(true);
  expect(Object.isFrozen(first.manifest.installs[0])).toBe(true);
  expect(() => first.manifest.provides.push('forged/capability')).toThrow();
  expect(second.manifest.provides).not.toContain('forged/capability');
});

test('resolved block loads preserve exact registry source identity', async () => {
  const discovered = await loadManifestById(BLOCK_ID);
  const block = {
    id: discovered.manifest.id,
    version: discovered.manifest.version,
    registrySourceId: discovered.registrySourceId,
    registryKind: discovered.registryKind,
    registryLocation: discovered.registryLocation,
    registryPath: discovered.registryPath
  };

  manifestCache.clear();
  const loaded = await loadManifestForResolvedBlock(process.cwd(), block);
  expect(loaded.manifest.id).toBe(block.id);
  expect(loaded.manifest.version).toBe(block.version);
  expect(loaded.registrySourceId).toBe(block.registrySourceId);
  expect(loaded.registryKind).toBe(block.registryKind);
  expect(loaded.registryLocation).toBe(block.registryLocation);
  expect(loaded.registryPath).toBe(block.registryPath);
});

test.each(['routes: []', 'uiPortals: []', 'uiHooks: []'])(
  'retired UI manifest grammar is rejected instead of becoming a compatibility surface',
  async (retiredField) => {
    const { workspaceRoot, registryPath, registryRoot } = await createWorkspaceRegistry();
    await writeManifest(
      registryRoot,
      blockDirName('cache/probe'),
      `${manifestSource('cache/probe', '1.0.0')}${retiredField}\n`
    );
    const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;

    expect(() => loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] }))
      .toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-001' }));
  }
);

test('addressed manifest reads reject a linked block directory', async () => {
  const { workspaceRoot, registryPath, registryRoot } = await createWorkspaceRegistry();
  const externalBlockRoot = path.join(workspaceRoot, 'external-block');
  await writeManifest(workspaceRoot, 'external-block', manifestSource('cache/probe', '1.0.0'));
  await fs.symlink(
    externalBlockRoot,
    path.join(registryRoot, blockDirName('cache/probe')),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;

  expect(() => loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] }))
    .toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
});

test('registry enumeration rejects a linked registry root instead of traversing it', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-manifest-linked-root-'));
  temporaryRoots.push(workspaceRoot);
  const externalRegistryRoot = path.join(workspaceRoot, 'external-registry');
  await writeManifest(externalRegistryRoot, blockDirName('cache/probe'), manifestSource('cache/probe', '1.0.0'));
  await fs.symlink(
    externalRegistryRoot,
    path.join(workspaceRoot, 'registry-link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: 'registry-link' }] as const;

  await expect(loadAllManifests({ workspaceRoot, registrySources: [...source] }))
    .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
});
