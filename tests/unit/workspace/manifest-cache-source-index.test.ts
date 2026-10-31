import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ManifestCache, type ManifestCacheKey, type ManifestObservedSourceKey } from '../../../src/adapters/workspace/sources/manifest-cache.ts';
import type { ManifestEntry } from '../../../src/compiler/contract.ts';

function fixture(id = 'block/a') {
  const workspaceRoot = '/workspace';
  const key: ManifestCacheKey = { workspaceRoot, registrySourceId: 'source', registryKind: 'private', registryLocation: 'workspace',
    registryPath: 'registry', blockId: id, sourceDigest: 'sha256:bytes' };
  const registryRoot = `${workspaceRoot}/registry`;
  const manifestRoot = `${registryRoot}/${id.replaceAll('/', '.')}`;
  const entry: ManifestEntry = { manifest: {
    id, version: '1.0.0', kind: 'capability', stackProfiles: ['typescript-library'],
    requires: [], provides: [], conflicts: [],
    installs: [{ kind: 'template', from: 'source.ts', to: 'source.ts' }],
    pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: []
  }, registrySourceId: key.registrySourceId,
    registryKind: key.registryKind, registryLocation: key.registryLocation, registryPath: key.registryPath,
    manifestPath: `${manifestRoot}/block.manifest.yaml`, manifestRoot, resourceRoots: [manifestRoot], registryRoot };
  const source: ManifestObservedSourceKey = { ...key, manifestPath: entry.manifestPath };
  return { key, entry, source };
}

test('logical and observed-source reuse each refresh the shared bounded LRU order', () => {
  for (const lookup of ['logical', 'source'] as const) {
    const cache = new ManifestCache(2), a = fixture(), b = fixture('block/b'), c = fixture('block/c'), d = fixture('block/d');
    cache.set(a.key, a.entry); cache.set(b.key, b.entry);
    assert.deepEqual(lookup === 'logical' ? cache.get(a.key) : cache.getByObservedSource(a.source), a.entry, lookup);
    cache.set(c.key, c.entry);
    assert.equal(cache.getByObservedSource(b.source), undefined, lookup); assert.equal(cache.get(b.key), undefined, lookup);
    assert.deepEqual(cache.get(a.key), a.entry, lookup); assert.deepEqual(cache.getByObservedSource(a.source), a.entry, lookup);
    assert.deepEqual(cache.get(c.key), c.entry, lookup); assert.deepEqual(cache.getByObservedSource(c.source), c.entry, lookup);
    assert.equal(cache.size, 2, lookup);
    cache.set(d.key, d.entry);
    assert.equal(cache.get(a.key), undefined, lookup);
    assert.equal(cache.getByObservedSource(a.source), undefined, lookup);
    assert.deepEqual(cache.getByObservedSource(c.source), c.entry, lookup);
    assert.deepEqual(cache.getByObservedSource(d.source), d.entry, lookup);
    assert.equal(cache.size, 2, lookup);
  }
});

test('workspace, registry selection, location and observed path remain separate causal identities', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  for (const patch of [{ workspaceRoot: '/other' }, { registrySourceId: 'other' }, { registryKind: 'official' },
    { registryLocation: 'compiler' }, { registryPath: 'other' }, { manifestPath: '/other/block.manifest.yaml' }]) {
    assert.equal(cache.getByObservedSource({ ...a.source, ...patch } as ManifestObservedSourceKey), undefined);
  }
  assert.deepEqual(cache.getByObservedSource(a.source), a.entry);
});
