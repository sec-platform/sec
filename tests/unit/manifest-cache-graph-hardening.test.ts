import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import type { ManifestEntry } from '../../src/compiler/contract/plan-manifest.ts';
import { manifestCache, type ManifestCacheKey } from '../../src/adapters/workspace/sources/manifest-cache.ts';

function key(sourceDigest: `sha256:${string}` = 'sha256:first'): ManifestCacheKey {
  return {
    workspaceRoot: '/fixture', registrySourceId: 'fixture', registryKind: 'private',
    registryLocation: 'workspace', registryPath: 'registry', blockId: 'probe/cache', sourceDigest
  };
}
function entry(): ManifestEntry {
  return {
    manifest: {
      id: 'probe/cache', version: '1.0.0', kind: 'capability', stackProfiles: ['typescript-library'],
      requires: [], provides: [], conflicts: [], installs: [{ kind: 'template', from: 'source.ts', to: 'source.ts' }],
      pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: []
    },
    manifestPath: '/fixture/registry/block.manifest.yaml', manifestRoot: '/fixture/registry',
    resourceRoots: ['/fixture/registry'], registryRoot: '/fixture/registry',
    registrySourceId: 'fixture', registryKind: 'private', registryLocation: 'workspace', registryPath: 'registry'
  };
}

afterEach(() => manifestCache.clear());

test('manifest cache freezes a deep graph without recursive stack exhaustion', () => {
  const value = entry();
  let chain: { next?: object } = {};
  const leaf = chain;
  for (let i = 0; i < 50_000; i++) chain = { next: chain };
  Object.defineProperty(value, 'extension', { value: chain, enumerable: false });
  manifestCache.set(key(), value);
  assert.strictEqual(manifestCache.get(key()), value);
  assert.equal(Object.isFrozen(chain), true);
  assert.equal(Object.isFrozen(leaf), true);
});

test('manifest cache never invokes unrelated accessor properties during freezing', () => {
  const value = entry();
  let reads = 0;
  Object.defineProperty(value, 'accessor', { enumerable: true, get() { reads++; throw new Error('getter'); } });
  manifestCache.set(key(), value);
  assert.equal(reads, 0);
  assert.equal(Object.isFrozen(value), true);
});

test('manifest cache freezes cyclic, symbol and shallow-frozen descendants', () => {
  const value = entry();
  const child = { data: { count: 1 } };
  Object.freeze(child);
  Object.defineProperty(value, Symbol('child'), { value: child });
  Object.defineProperty(value, 'self', { value });
  Object.freeze(value);
  manifestCache.set(key(), value);
  assert.equal(Object.isFrozen(child.data), true);
  assert.equal(Object.isFrozen(value.manifest), true);
});

test('manifest cache keeps causal digest isolation and replaces obsolete revisions', () => {
  const first = entry();
  const second = entry();
  manifestCache.set(key(), first);
  assert.equal(manifestCache.get(key('sha256:second')), undefined);
  // A miss already retires the locator, rather than retaining stale history.
  assert.equal(manifestCache.size, 0);
  manifestCache.set(key('sha256:second'), second);
  assert.strictEqual(manifestCache.get(key('sha256:second')), second);
  assert.equal(manifestCache.get(key()), undefined);
  assert.equal(manifestCache.size, 0);
  assert.equal(manifestCache.get(key('sha256:second')), undefined);
});

test('rejected manifest cache identity does not publish or replace a valid record', () => {
  const first = entry();
  manifestCache.set(key(), first);
  const forged = entry();
  forged.manifest.id = 'probe/other';
  assert.throws(() => manifestCache.set(key(), forged), /causal registry identity/u);
  assert.strictEqual(manifestCache.get(key()), first);
  assert.equal(Object.isFrozen(forged), false);
});
