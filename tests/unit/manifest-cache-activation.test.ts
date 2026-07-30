import { expect, test } from 'bun:test';
import {
  loadManifestById,
  loadManifestForResolvedBlock
} from '../../platform/compiler/parse/load-manifest.ts';
import { manifestCache } from '../../platform/compiler/parse/manifest-cache.ts';

const BLOCK_ID = 'ticket/basic';

test('loadManifestById populates manifestCache after reading from disk', async () => {
  manifestCache.clear();

  const entry = await loadManifestById(BLOCK_ID);

  const cached = manifestCache.get({ blockId: BLOCK_ID });
  expect(cached).toBeDefined();
  expect(cached).toBe(entry);
});

test('loadManifestById checks manifestCache before disk', async () => {
  manifestCache.clear();

  // First call reads from disk and populates the cache
  const first = await loadManifestById(BLOCK_ID);
  expect(manifestCache.get({ blockId: BLOCK_ID })).toBe(first);

  // Second call must return the cached entry (same object reference).
  // If it re-read from disk, a new ManifestEntry object would be created.
  const second = await loadManifestById(BLOCK_ID);
  expect(second).toBe(first);
});

test('calling loadManifestById twice for the same block only reads disk once', async () => {
  manifestCache.clear();

  const first = await loadManifestById(BLOCK_ID);
  const second = await loadManifestById(BLOCK_ID);

  // Same reference proves the second call was served from cache, not re-read from disk
  expect(second).toBe(first);
});

test('loadManifestForResolvedBlock populates manifestCache after reading', async () => {
  manifestCache.clear();

  // Discover the real version + registry info from the root manifest
  const entry = await loadManifestById(BLOCK_ID);
  const block = {
    id: entry.manifest.id,
    version: entry.manifest.version,
    registrySourceId: entry.registrySourceId,
    registryKind: entry.registryKind,
    registryLocation: entry.registryLocation,
    registryPath: entry.registryPath
  };

  manifestCache.clear();

  const workspaceRoot = process.cwd();
  const loaded = await loadManifestForResolvedBlock(workspaceRoot, block);

  const cached = manifestCache.get({
    blockId: BLOCK_ID,
    version: entry.manifest.version,
    workspaceRoot
  });
  expect(cached).toBeDefined();
  expect(cached).toBe(loaded);
});
