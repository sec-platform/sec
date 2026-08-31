import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadAllManifests,
  loadManifestById,
  loadManifestForResolvedBlock
} from '../../src/compiler/parse/load-manifest.ts';
import { manifestCache } from '../../src/compiler/parse/manifest-cache.ts';
import { blockDirName, resolveRegistryRoot } from '../../src/workspace/runtime/paths.ts';

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
    'slots: []',
    'acceptance: []',
    'routes: []',
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

test('repeated manifest loads reuse one deeply immutable parsed authority snapshot when source bytes are unchanged', async () => {
  manifestCache.clear();
  const first = await loadManifestById(BLOCK_ID);
  const second = await loadManifestById(BLOCK_ID);

  expect(second).toBe(first);
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
  const first = await loadManifestForResolvedBlock(process.cwd(), block);
  const second = await loadManifestForResolvedBlock(process.cwd(), block);
  expect(second).toBe(first);
  expect(second.registrySourceId).toBe(block.registrySourceId);
  expect(second.registryKind).toBe(block.registryKind);
  expect(second.registryLocation).toBe(block.registryLocation);
  expect(second.registryPath).toBe(block.registryPath);
});

test('source byte changes invalidate a long-lived manifest cache entry', async () => {
  const { workspaceRoot, registryPath, registryRoot } = await createWorkspaceRegistry();
  const manifestPath = await writeManifest(
    registryRoot,
    blockDirName('cache/probe'),
    manifestSource('cache/probe', '1.0.0')
  );
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;
  const first = await loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] });

  await fs.writeFile(manifestPath, manifestSource('cache/probe', '1.0.1'), 'utf8');
  const second = await loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] });

  expect(first.manifest.version).toBe('1.0.0');
  expect(second.manifest.version).toBe('1.0.1');
  expect(second).not.toBe(first);
});

test('addressed manifest must declare the exact requested block identity', async () => {
  const { workspaceRoot, registryPath, registryRoot } = await createWorkspaceRegistry();
  await writeManifest(registryRoot, blockDirName('cache/probe'), manifestSource('cache/other', '1.0.0'));
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;

  expect(() => loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] }))
    .toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-011' }));
});

test('registry enumeration rejects manifests whose physical directory cannot be reconstructed from id', async () => {
  const { workspaceRoot, registryPath, registryRoot } = await createWorkspaceRegistry();
  await writeManifest(registryRoot, 'wrong-directory', manifestSource('cache/probe', '1.0.0'));
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;

  await expect(loadAllManifests({ workspaceRoot, registrySources: [...source] }))
    .rejects.toMatchObject({ code: 'MANIFEST-SCHEMA-012' });
});

test('ordered registry shadowing is consistent between addressed and enumerated loads', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-manifest-shadow-'));
  temporaryRoots.push(workspaceRoot);
  const firstPath = 'registry-first';
  const secondPath = 'registry-second';
  const firstRoot = resolveRegistryRoot(workspaceRoot, 'workspace', firstPath);
  const secondRoot = resolveRegistryRoot(workspaceRoot, 'workspace', secondPath);
  await writeManifest(firstRoot, blockDirName('cache/probe'), manifestSource('cache/probe', '1.0.0'));
  await writeManifest(secondRoot, blockDirName('cache/probe'), manifestSource('cache/probe', '2.0.0'));
  const sources = [
    { id: 'first', kind: 'private', location: 'workspace', path: firstPath },
    { id: 'second', kind: 'private', location: 'workspace', path: secondPath }
  ] as const;

  const addressed = await loadManifestById('cache/probe', { workspaceRoot, registrySources: [...sources] });
  const enumerated = await loadAllManifests({ workspaceRoot, registrySources: [...sources] });

  expect(addressed.manifest.version).toBe('1.0.0');
  expect(addressed.registrySourceId).toBe('first');
  expect(enumerated).toHaveLength(1);
  expect(enumerated[0]?.manifest.version).toBe('1.0.0');
  expect(enumerated[0]?.registrySourceId).toBe('first');
});

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
