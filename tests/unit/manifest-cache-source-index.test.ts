import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ManifestCache, type ManifestCacheKey, type ManifestObservedSourceKey } from '../../src/adapters/workspace/sources/manifest-cache.ts';
import type { ManifestEntry } from '../../src/compiler/contract.ts';

function fixture(id = 'block/a', workspaceRoot = '/workspace') {
  const key: ManifestCacheKey = { workspaceRoot, registrySourceId: 'source', registryKind: 'private', registryLocation: 'workspace',
    registryPath: 'registry', blockId: id, sourceDigest: 'sha256:bytes' };
  const entry = { manifest: { id, version: '1.0.0' }, registrySourceId: key.registrySourceId,
    registryKind: key.registryKind, registryLocation: key.registryLocation, registryPath: key.registryPath,
    manifestPath: `${workspaceRoot}/registry/${id}/block.manifest.yaml` } as ManifestEntry;
  const source: ManifestObservedSourceKey = { ...key, manifestPath: entry.manifestPath };
  return { key, entry, source };
}

test('logical and observed-source reads return the same single cached record', () => {
  const cache = new ManifestCache(2), a = fixture(); cache.set(a.key, a.entry);
  assert.equal(cache.getByObservedSource(a.source), cache.get(a.key)); assert.equal(cache.size, 1);
  assert.ok(Object.isFrozen(a.entry.manifest));
});

test('source reuse participates in the same LRU order as logical reuse', () => {
  const cache = new ManifestCache(2), a = fixture(), b = fixture('block/b'), c = fixture('block/c');
  cache.set(a.key, a.entry); cache.set(b.key, b.entry); cache.getByObservedSource(a.source); cache.set(c.key, c.entry);
  assert.equal(cache.getByObservedSource(b.source), undefined); assert.equal(cache.get(b.key), undefined);
  assert.equal(cache.getByObservedSource(a.source), a.entry); assert.equal(cache.size, 2);
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
  assert.equal(cache.getByObservedSource(a.source), a.entry);
});

test('version-qualified and overlay records cannot impersonate a root-source observation', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set({ ...a.key, version: '1.0.0' }, a.entry);
  assert.equal(cache.getByObservedSource(a.source), undefined);
  assert.equal(cache.get({ ...a.key, version: '1.0.0' }), a.entry);
});

test('replacing a logical record retires its former path binding', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  const next = { ...a.entry, manifestPath: '/new/block.manifest.yaml' };
  cache.set(a.key, next);
  assert.equal(cache.getByObservedSource(a.source), undefined);
  assert.equal(cache.getByObservedSource({ ...a.source, manifestPath: next.manifestPath }), next); assert.equal(cache.size, 1);
});

test('one source cannot keep two independently mutable logical mappings', () => {
  const cache = new ManifestCache(), a = fixture(), b = fixture('block/b'); cache.set(a.key, a.entry);
  b.entry.manifestPath = a.entry.manifestPath;
  const observed = { ...b.source, manifestPath: a.entry.manifestPath };
  cache.set(b.key, b.entry);
  assert.equal(cache.get(a.key), undefined); assert.equal(cache.getByObservedSource(observed), b.entry); assert.equal(cache.size, 1);
});

test('workspace clearing removes both projections without clearing another workspace', () => {
  const cache = new ManifestCache(), a = fixture(), b = fixture('block/a', '/other');
  cache.set(a.key, a.entry); cache.set(b.key, b.entry); cache.clearWorkspace('/workspace');
  assert.equal(cache.getByObservedSource(a.source), undefined); assert.equal(cache.getByObservedSource(b.source), b.entry);
  cache.clear(); assert.equal(cache.getByObservedSource(b.source), undefined); assert.equal(cache.size, 0);
});

test('disabled cache retains no logical or source record and keeps input ownership unchanged', () => {
  const cache = new ManifestCache(0), a = fixture(); cache.set(a.key, a.entry);
  assert.equal(cache.getByObservedSource(a.source), undefined); assert.equal(cache.get(a.key), undefined);
  assert.equal(Object.isFrozen(a.entry), false);
});

test('invalid replacement does not evict a previously valid source', () => {
  const cache = new ManifestCache(1), a = fixture(), b = fixture('block/b'); cache.set(a.key, a.entry);
  assert.throws(() => cache.set(a.key, b.entry)); assert.equal(cache.getByObservedSource(a.source), a.entry);
});

test('input view and accessors are consumed once and cannot change later lookup state', () => {
  const cache = new ManifestCache(), a = fixture(); cache.set(a.key, a.entry);
  let reads = 0; const lookup = { ...a.source, get manifestPath() { reads++; return a.source.manifestPath; } };
  assert.equal(cache.getByObservedSource(lookup), a.entry); assert.equal(reads, 1);
});

test('churn across both query forms remains bounded by the original record limit', () => {
  const cache = new ManifestCache(8), entries = Array.from({ length: 300 }, (_, i) => fixture(`block/${i}`));
  for (const entry of entries) { cache.set(entry.key, entry.entry); assert.ok(cache.size <= 8); }
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i]!; assert.equal(cache.getByObservedSource(item.source), i < 292 ? undefined : item.entry);
  }
});
