import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import YAML from 'yaml';
import { loadAllManifests, loadManifestById } from '../../src/compiler/parse/load-manifest.ts';
import { manifestCache } from '../../src/compiler/parse/manifest-cache.ts';
import type { PlanRegistrySource } from '../../src/compiler/contract.ts';

// Native runs use the actual YAML parser, semantic validator and retained reads.
// Local replay declares JSON-subset/physical/semantic boundary adapters. The
// counter wraps the selected parser; it is not a wall-time performance gate.
async function using(run: (f: ReturnType<typeof fixture>, parses: () => number) => Promise<void>) {
  const f = fixture(); const original = YAML.parse; let parsed = 0;
  YAML.parse = ((...args: Parameters<typeof YAML.parse>) => { parsed++; return original(...args); }) as typeof YAML.parse;
  manifestCache.clear();
  try { await run(f, () => parsed); }
  finally { YAML.parse = original; manifestCache.clear(); rmSync(f.root, { recursive: true, force: true }); }
}
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-manifest-catalog-'));
  const source: PlanRegistrySource = { id: 'private', kind: 'private', location: 'workspace', path: 'registry' };
  const options = { workspaceRoot: root, registrySources: [source] };
  function write(id = 'block/a', registry = 'registry') {
    const folder = path.join(root, registry, id.replaceAll('/', '.')); mkdirSync(folder, { recursive: true });
    const manifest = { id, version: '1.0.0', kind: 'capability', stackProfiles: ['test'], requires: [], provides: [id], conflicts: [],
      installs: [{ kind: 'copy', from: 'source.ts', to: `src/${id.replaceAll('/', '-')}.ts` }],
      pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] };
    const file = path.join(folder, 'block.manifest.yaml'); writeFileSync(file, JSON.stringify(manifest));
    return { folder, file, manifest };
  }
  return { root, source, options, write };
}

test('a repeated catalog read reuses parsed validation but keeps independent mutable results', () => using(async (f, parses) => {
  f.write(); const first = await loadAllManifests(f.options); const before = parses();
  const next = await loadAllManifests(f.options);
  assert.equal(parses(), before); assert.deepEqual(next, first); assert.notEqual(next[0], first[0]);
  first[0]!.manifest.provides.push('caller-only'); first[0]!.resourceRoots.push('/caller');
  assert.ok(!next[0]!.manifest.provides.includes('caller-only'));
  assert.deepEqual((await loadAllManifests(f.options))[0], next[0]);
}));

test('explicit unversioned lookup and catalog lookup share one parse record', () => using(async (f, parses) => {
  f.write(); const first = loadManifestById('block/a', f.options); const before = parses();
  const catalog = await loadAllManifests(f.options);
  assert.equal(parses(), before); assert.deepEqual(catalog[0], first); assert.notEqual(catalog[0], first);
  assert.equal(manifestCache.size, 1);
}));

test('catalog parsing also primes later logical lookup without exposing its mutable view', () => using(async (f, parses) => {
  f.write(); const catalog = await loadAllManifests(f.options); const before = parses();
  const logical = loadManifestById('block/a', f.options);
  assert.equal(parses(), before); assert.deepEqual(catalog[0], logical); assert.notEqual(catalog[0], logical);
  assert.ok(Object.isFrozen(logical.manifest)); assert.equal(Object.isFrozen(catalog[0]!.manifest), false);
}));

test('changed current bytes invalidate cached parsing before returning a new version', () => using(async (f, parses) => {
  const a = f.write(); await loadAllManifests(f.options); const before = parses();
  a.manifest.version = '2.0.0'; writeFileSync(a.file, JSON.stringify(a.manifest));
  assert.equal((await loadAllManifests(f.options))[0]!.manifest.version, '2.0.0'); assert.equal(parses(), before + 1);
  assert.equal(loadManifestById('block/a', f.options).manifest.version, '2.0.0');
}));

test('deleted or invalid current sources cannot reuse a previous valid result', () => using(async f => {
  const a = f.write(); await loadAllManifests(f.options);
  unlinkSync(a.file); await assert.rejects(loadAllManifests(f.options), e => (e as { code?: string }).code === 'MANIFEST-SCHEMA-013');
  writeFileSync(a.file, JSON.stringify({ ...a.manifest, id: 'block/other' }));
  await assert.rejects(loadAllManifests(f.options), e => (e as { code?: string }).code === 'MANIFEST-SCHEMA-012');
}));

test('a lower precedence source is still validated even after the selected source was cached', () => using(async f => {
  f.write(); const shadow = f.write('block/a', 'shadow');
  const options = { ...f.options, registrySources: [f.source, { ...f.source, id: 'shadow', path: 'shadow' }] };
  const result = await loadAllManifests(options); assert.equal(result.length, 1); assert.equal(result[0]!.registrySourceId, 'private');
  writeFileSync(shadow.file, JSON.stringify({ ...shadow.manifest, unknownField: true }));
  await assert.rejects(loadAllManifests(options), e => (e as { code?: string }).code === 'MANIFEST-SCHEMA-001');
}));

test('version overlays never prime or replace the root manifest observation', () => using(async (f, parses) => {
  const a = f.write(); const versionRoot = path.join(a.folder, 'versions', '0.5.0'); mkdirSync(versionRoot, { recursive: true });
  writeFileSync(path.join(versionRoot, 'block.manifest.yaml'), JSON.stringify({ ...a.manifest, version: '0.5.0', provides: ['old'] }));
  const old = loadManifestById('block/a', { ...f.options, version: '0.5.0' }); assert.equal(old.manifest.version, '0.5.0');
  const before = parses(), catalog = await loadAllManifests(f.options);
  assert.equal(parses(), before + 1); assert.equal(catalog[0]!.manifest.version, '1.0.0');
  assert.deepEqual(catalog[0]!.manifest.provides, ['block/a']);
}));

test('clearing a workspace forces source and logical lookups to reobserve the cache', () => using(async (f, parses) => {
  f.write(); await loadAllManifests(f.options); const before = parses();
  manifestCache.clearWorkspace(f.root); await loadAllManifests(f.options); assert.equal(parses(), before + 1);
}));

test('path binding never infers a block identity from an invalid directory spelling', () => using(async f => {
  f.write(); await loadAllManifests(f.options);
  const wrong = path.join(f.root, 'registry', 'legacy.wrong'); mkdirSync(wrong);
  writeFileSync(path.join(wrong, 'block.manifest.yaml'), JSON.stringify({ ...f.write('block/z').manifest, id: 'block/z' }));
  await assert.rejects(loadAllManifests(f.options), e => (e as { code?: string }).code === 'MANIFEST-SCHEMA-012');
}));

test('two source selections with equal bytes keep their own registry metadata and mutable projections', () => using(async f => {
  f.write(); f.write('block/a', 'second');
  const left = await loadAllManifests(f.options);
  const right = await loadAllManifests({ ...f.options, registrySources: [{ ...f.source, id: 'other', path: 'second' }] });
  assert.equal(left[0]!.registrySourceId, 'private'); assert.equal(right[0]!.registrySourceId, 'other');
  assert.notEqual(left[0]!.registryRoot, right[0]!.registryRoot);
}));
