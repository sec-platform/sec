import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  loadManifestById,
  loadManifestForResolvedBlock
} from '../../platform/compiler/parse/load-manifest.ts';
import { manifestCache } from '../../platform/compiler/parse/manifest-cache.ts';

const BLOCK_ID = 'ticket/basic';
const temporaryRoots: string[] = [];

afterEach(async () => {
  manifestCache.clear();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('repeated manifest loads reuse the exact parsed entry when source bytes are unchanged', async () => {
  manifestCache.clear();
  const first = await loadManifestById(BLOCK_ID);
  const second = await loadManifestById(BLOCK_ID);
  expect(second).toBe(first);
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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-manifest-cache-'));
  temporaryRoots.push(workspaceRoot);
  const registryPath = 'registry-cache-fixture';
  const manifestDirectory = path.join(workspaceRoot, registryPath, 'cache__probe');
  const manifestPath = path.join(manifestDirectory, 'block.manifest.yaml');
  await fs.mkdir(manifestDirectory, { recursive: true });

  const manifest = (version: string) => [
    'id: cache/probe',
    `version: ${version}`,
    'kind: capability',
    'stackProfiles: [next-bun]',
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

  await fs.writeFile(manifestPath, manifest('1.0.0'), 'utf8');
  const source = [{ id: 'fixture', kind: 'private', location: 'workspace', path: registryPath }] as const;
  const first = await loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] });

  await fs.writeFile(manifestPath, manifest('1.0.1'), 'utf8');
  const second = await loadManifestById('cache/probe', { workspaceRoot, registrySources: [...source] });

  expect(first.manifest.version).toBe('1.0.0');
  expect(second.manifest.version).toBe('1.0.1');
  expect(second).not.toBe(first);
});
