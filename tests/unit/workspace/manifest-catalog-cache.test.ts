import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML, { type Document } from 'yaml';
import { loadAllManifests, loadManifestById } from '../../../src/adapters/workspace/sources/load-manifest.ts';
import { manifestCache } from '../../../src/adapters/workspace/sources/manifest-cache.ts';
import type { PlanRegistrySource } from '../../../src/compiler/contract.ts';

// Native runs use the actual YAML parser, semantic validator and retained reads.
// The counter wraps the existing Document value-decoding boundary. Both the
// strict parser and previous YAML.parse use this library operation; cache hits
// must not decode again. It is not a wall-time performance gate.
async function using(run: (f: ReturnType<typeof fixture>, parses: () => number) => Promise<void>) {
  const f = fixture(); const original = YAML.Document.prototype.toJS; let parsed = 0;
  YAML.Document.prototype.toJS = function (this: Document, ...args: Parameters<typeof original>) {
    parsed++; return Reflect.apply(original, this, args);
  };
  manifestCache.clear();
  try { await run(f, () => parsed); }
  finally { YAML.Document.prototype.toJS = original; manifestCache.clear(); rmSync(f.root, { recursive: true, force: true }); }
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

function sourceOptions(f: ReturnType<typeof fixture>, names: readonly string[]) {
  return { ...f.options, registrySources: names.map(name => ({ ...f.source, id: name, path: name })) };
}

test('effective version overlays participate in collision checks after merging root defaults', () => using(async f => {
  const first = f.write(), second = f.write('block/a', 'second');
  for (const entry of [first, second]) {
    const versionRoot = path.join(entry.folder, 'versions', '0.5.0'); mkdirSync(versionRoot, { recursive: true });
    writeFileSync(path.join(versionRoot, 'block.manifest.yaml'), JSON.stringify({ version: '0.5.0' }));
  }
  const options = { ...sourceOptions(f, ['registry', 'second']), version: '0.5.0' };
  assert.equal(loadManifestById('block/a', options).manifest.version, '0.5.0');
  writeFileSync(second.file, JSON.stringify({ ...second.manifest, provides: ['different/service'] }));
  assert.throws(() => loadManifestById('block/a', options), /Conflicting manifest definitions/);
}));

test('cold catalog and logical reads share parsed validation without sharing mutable catalog results', () => using(async (f, parses) => {
  const written = f.write();
  const first = await loadAllManifests(f.options);
  const catalogParseCount = parses();
  assert.ok(catalogParseCount > 0);
  const logical = loadManifestById('block/a', f.options);
  const next = await loadAllManifests(f.options);
  assert.equal(parses(), catalogParseCount);
  assert.deepEqual(first, [logical]); assert.deepEqual(next, first);
  assert.equal(logical.manifest.id, 'block/a'); assert.equal(logical.manifest.version, '1.0.0');
  first[0]!.manifest.provides.push('caller-only'); first[0]!.resourceRoots.push('/caller');
  assert.deepEqual(logical.manifest.provides, ['block/a']);
  assert.deepEqual(next[0]!.manifest.provides, ['block/a']);
  assert.deepEqual(next[0]!.resourceRoots, [written.folder]);
  assert.deepEqual((await loadAllManifests(f.options))[0], next[0]);
  assert.equal(parses(), catalogParseCount);

  // Reset both cache indexes, not the retained source. The opposite priming
  // direction must begin cold rather than inherit the catalog-created record.
  manifestCache.clear();
  assert.equal(manifestCache.size, 0);
  const addressed = loadManifestById('block/a', f.options);
  const logicalParseCount = parses();
  assert.ok(logicalParseCount > catalogParseCount);
  const catalog = await loadAllManifests(f.options);
  assert.equal(parses(), logicalParseCount); assert.deepEqual(catalog, [addressed]);
  assert.equal(addressed.manifest.id, 'block/a'); assert.equal(addressed.manifest.version, '1.0.0');
  catalog[0]!.manifest.provides.push('caller-only');
  assert.deepEqual(addressed.manifest.provides, ['block/a']);
  assert.equal(manifestCache.size, 1);
}));

test('changed current bytes invalidate addressed and catalog caches before returning a new version', () => using(async (f, parses) => {
  const a = f.write();
  const first = loadManifestById('block/a', f.options);
  a.manifest.version = '1.0.1'; writeFileSync(a.file, JSON.stringify(a.manifest));
  const changed = loadManifestById('block/a', f.options);
  assert.equal(first.manifest.version, '1.0.0');
  assert.equal(changed.manifest.version, '1.0.1');

  assert.equal((await loadAllManifests(f.options))[0]!.manifest.version, '1.0.1');
  const before = parses();
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

test('version overlays never prime or replace the root manifest observation', () => using(async (f, parses) => {
  const a = f.write(); const versionRoot = path.join(a.folder, 'versions', '0.5.0'); mkdirSync(versionRoot, { recursive: true });
  writeFileSync(path.join(versionRoot, 'block.manifest.yaml'), JSON.stringify({ ...a.manifest, version: '0.5.0', provides: ['old'] }));
  const old = loadManifestById('block/a', { ...f.options, version: '0.5.0' }); assert.equal(old.manifest.version, '0.5.0');
  const before = parses(), catalog = await loadAllManifests(f.options);
  assert.equal(parses(), before + 1); assert.equal(catalog[0]!.manifest.version, '1.0.0');
  assert.deepEqual(catalog[0]!.manifest.provides, ['block/a']);
}));

test('path binding never infers a block identity from an invalid directory spelling', () => using(async f => {
  f.write(); await loadAllManifests(f.options);
  const wrong = path.join(f.root, 'registry', 'legacy.wrong'); mkdirSync(wrong);
  writeFileSync(path.join(wrong, 'block.manifest.yaml'), JSON.stringify({ ...f.write('block/z').manifest, id: 'block/z' }));
  await assert.rejects(loadAllManifests(f.options), e => (e as { code?: string }).code === 'MANIFEST-SCHEMA-012');
}));

test('equal definition mirrors isolate source metadata and preserve configured priority across formats', () => using(async f => {
  f.write(); const mirror = f.write('block/a', 'second');
  const left = await loadAllManifests(f.options);
  const right = await loadAllManifests({ ...f.options, registrySources: [{ ...f.source, id: 'other', path: 'second' }] });
  assert.equal(left[0]!.registrySourceId, 'private'); assert.equal(right[0]!.registrySourceId, 'other');
  assert.notEqual(left[0]!.registryRoot, right[0]!.registryRoot);
  writeFileSync(mirror.file, YAML.stringify(mirror.manifest));
  const options = sourceOptions(f, ['registry', 'second']);
  assert.equal(loadManifestById('block/a', options).registrySourceId, 'registry');
  assert.equal((await loadAllManifests(options))[0]!.registrySourceId, 'registry');
  assert.equal(loadManifestById('block/a', sourceOptions(f, ['second', 'registry'])).registrySourceId, 'second');
}));
