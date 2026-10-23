import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ManifestCache, type ManifestCacheKey, type ManifestObservedSourceKey } from '../../../src/adapters/workspace/sources/manifest-cache.ts';
import type { ManifestEntry } from '../../../src/compiler/contract.ts';

function fixture(id = 'block/a', workspaceRoot = '/workspace') {
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
  const cache = new ManifestCache(8);
  const entries = Array.from({ length: 9 }, (_, index) => fixture(`block/${index}`));
  for (const item of entries) cache.set(item.key, item.entry);
  assert.equal(cache.size, 8);
  for (const [index, item] of entries.entries()) {
    const expected = index === 0 ? undefined : item.entry;
    assert.deepEqual(cache.get(item.key), expected);
    assert.deepEqual(cache.getByObservedSource(item.source), expected);
  }
});

test('a logical digest miss retires the corresponding source lookup', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  assert.equal(cache.get({ ...a.key, sourceDigest: 'sha256:other' }), undefined);
  assert.equal(cache.getByObservedSource(a.source), undefined); assert.equal(cache.size, 0);
});

test('a source digest miss retires its logical cache record', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  assert.equal(cache.getByObservedSource({ ...a.source, sourceDigest: 'sha256:other' }), undefined);
  assert.equal(cache.get(a.key), undefined); assert.equal(cache.size, 0);
});

test('workspace, registry selection, location and observed path remain separate causal identities', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  for (const patch of [{ workspaceRoot: '/other' }, { registrySourceId: 'other' }, { registryKind: 'official' },
    { registryLocation: 'compiler' }, { registryPath: 'other' }, { manifestPath: '/other/block.manifest.yaml' }]) {
    assert.equal(cache.getByObservedSource({ ...a.source, ...patch } as ManifestObservedSourceKey), undefined);
  }
  assert.deepEqual(cache.getByObservedSource(a.source), a.entry);
});

test('version-qualified records stay outside the root-source index and retire on a digest miss', () => {
  const cache = new ManifestCache(), a = fixture(), b = fixture('block/b');
  const key = { ...a.key, version: '1.0.0' };
  const otherKey = { ...b.key, version: '1.0.0' };
  cache.set(key, a.entry);
  cache.set(otherKey, b.entry);
  assert.equal(cache.getByObservedSource(a.source), undefined);
  assert.deepEqual(cache.get(key), a.entry);
  assert.equal(cache.get({ ...key, sourceDigest: 'sha256:other' }), undefined);
  assert.equal(cache.get(key), undefined);
  assert.equal(cache.size, 1);
  assert.deepEqual(cache.get(otherKey), b.entry);
});

test('workspace clearing removes both projections without clearing another workspace', () => {
  const cache = new ManifestCache(), a = fixture(), b = fixture('block/a', '/other');
  cache.set(a.key, a.entry); cache.set(b.key, b.entry); cache.clearWorkspace('/workspace');
  assert.equal(cache.getByObservedSource(a.source), undefined); assert.deepEqual(cache.getByObservedSource(b.source), b.entry);
  assert.equal(cache.get(a.key), undefined); assert.deepEqual(cache.get(b.key), b.entry);
  cache.clear(); assert.equal(cache.getByObservedSource(b.source), undefined); assert.equal(cache.size, 0);
  assert.equal(cache.get(b.key), undefined);
});

test('disabled cache retains no logical or source record', () => {
  const cache = new ManifestCache(0), a = fixture(); cache.set(a.key, a.entry);
  assert.equal(cache.getByObservedSource(a.source), undefined); assert.equal(cache.get(a.key), undefined);
  assert.equal(cache.size, 0);
});

test('invalid replacement does not evict a previously valid source', () => {
  const cache = new ManifestCache(1), a = fixture(), b = fixture('block/b'); cache.set(a.key, a.entry);
  assert.throws(() => cache.set(a.key, b.entry)); assert.deepEqual(cache.getByObservedSource(a.source), a.entry);
  assert.deepEqual(cache.get(a.key), a.entry);
});
