import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ManifestCache, type ManifestCacheKey } from '../../src/compiler/parse/manifest-cache.ts';
import type { ManifestEntry } from '../../src/compiler/contract.ts';
function fixture(id: string, workspaceRoot = '/one') {
  const key = { workspaceRoot, registrySourceId: 'registry', registryKind: 'local', registryLocation: 'workspace',
    registryPath: 'registry', blockId: id, sourceDigest: 'sha256:one' } as ManifestCacheKey;
  const entry = { manifest: { id, version: '1' }, registrySourceId: key.registrySourceId,
    registryKind: key.registryKind, registryLocation: key.registryLocation, registryPath: key.registryPath } as ManifestEntry;
  return { key, entry };
}

test('LRU capacity bounds live locators without changing digest-qualified reuse', () => {
  const cache = new ManifestCache(2), a = fixture('a'), b = fixture('b'), c = fixture('c');
  cache.set(a.key, a.entry); cache.set(b.key, b.entry); assert.equal(cache.get(a.key), a.entry);
  cache.set(c.key, c.entry); assert.equal(cache.size, 2); assert.equal(cache.get(b.key), undefined);
  assert.equal(cache.get(a.key), a.entry); assert.equal(cache.get(c.key), c.entry);
});

test('a digest miss retires the stale locator immediately', () => {
  const cache = new ManifestCache(2), a = fixture('a'); cache.set(a.key, a.entry);
  assert.equal(cache.get({ ...a.key, sourceDigest: 'sha256:new' }), undefined); assert.equal(cache.size, 0);
});

test('disabled caching retains no records and does not freeze caller-owned inputs', () => {
  const cache = new ManifestCache(0), a = fixture('a'); cache.set(a.key, a.entry);
  assert.equal(cache.get(a.key), undefined); assert.equal(cache.size, 0); assert.equal(Object.isFrozen(a.entry), false);
});

test('workspace clearing cannot remove another workspace cache', () => {
  const cache = new ManifestCache(3), a = fixture('a'), b = fixture('a', '/two');
  cache.set(a.key, a.entry); cache.set(b.key, b.entry); cache.clearWorkspace('/one');
  assert.equal(cache.get(a.key), undefined); assert.equal(cache.get(b.key), b.entry);
});

test('invalid entries do not evict a valid cache record', () => {
  const cache = new ManifestCache(1), a = fixture('a'), b = fixture('b'); cache.set(a.key, a.entry);
  assert.throws(() => cache.set(a.key, b.entry)); assert.equal(cache.get(a.key), a.entry);
});
