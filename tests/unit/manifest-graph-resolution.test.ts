import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { ManifestEntry, ManifestKind } from '../../src/compiler/contract/plan-manifest.ts';
import { resolveManifestGraph } from '../../src/compiler/resolve/manifest-graph.ts';

function entry(id: string, requires: string[] = [], provides: string[] = [id], kind: ManifestKind = 'capability'): ManifestEntry {
  return { manifest: { id, version: '1.0.0', kind, requires, provides, conflicts: [], stackProfiles: ['test'],
    installs: [], pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] },
    manifestPath: `/registry/${id}/block.manifest.yaml`, manifestRoot: `/registry/${id}`, resourceRoots: [`/registry/${id}`],
    registryRoot: '/registry', registrySourceId: 'test', registryKind: 'private', registryLocation: 'workspace', registryPath: 'registry' };
}
const ids = (values: readonly ManifestEntry[]) => values.map(value => value.manifest.id);
const resolve = (selected: ManifestEntry[], all = selected) => resolveManifestGraph(selected, all);

test('empty input has no synthetic blocks or capabilities', () => {
  assert.deepEqual(resolve([]), { entries: [], capabilities: [] });
});

test('unique transitive providers are selected once and unrelated catalog entries stay out', () => {
  const a = entry('block/a', ['cap/b']), b = entry('block/b', ['cap/c'], ['cap/b']), c = entry('block/c', [], ['cap/c']);
  const result = resolve([a], [a, b, c, entry('block/unused')]);
  assert.deepEqual(ids(result.entries), ['block/c', 'block/b', 'block/a']);
  assert.deepEqual(result.capabilities, ['block/a', 'cap/b', 'cap/c']);
  assert.equal(result.entries[0], c);
});

test('an explicit provider still disambiguates an otherwise ambiguous capability catalog', () => {
  const a = entry('block/a', ['service']), b = entry('block/b', [], ['service']), c = entry('block/c', [], ['service']);
  assert.deepEqual(ids(resolve([a, b], [a, b, c]).entries), ['block/b', 'block/a']);
  assert.throws(() => resolve([a], [a, b, c]), /Ambiguous providers/);
});

test('a catalog version cannot satisfy a requirement absent from the explicitly selected version of the same ID', () => {
  const a = entry('block/app', ['new-api']), old = entry('block/runtime', [], ['old-api']);
  const newer = entry('block/runtime', [], ['old-api', 'new-api']); newer.manifest.version = '2.0.0';
  assert.throws(() => resolve([a, old], [a, newer]), /does not provide required capability/);
});

test('conflicting explicit versions and registry identities are not last-writer-wins', () => {
  const a = entry('block/a'), b = structuredClone(a); b.manifest.version = '2.0.0';
  assert.throws(() => resolve([a, b]), /Conflicting explicit/);
  b.manifest.version = a.manifest.version; b.registrySourceId = 'foreign';
  assert.throws(() => resolve([a, b]), /Conflicting explicit/);
});

test('repeated equal explicit entries coalesce but preserve the chosen object', () => {
  const a = entry('block/a');
  const result = resolve([a, structuredClone(a), a]);
  assert.deepEqual(ids(result.entries), ['block/a']); assert.equal(result.entries[0], a);
});

test('one provider repeating a declaration is not two ambiguous implementations', () => {
  const a = entry('block/a', ['service', 'service']), b = entry('block/b', [], ['service', 'service']);
  assert.deepEqual(ids(resolve([a], [a, b]).entries), ['block/b', 'block/a']);
});

test('missing capabilities remain typed resolver failures', () => {
  assert.throws(() => resolve([entry('block/a', ['missing'])]), e => (e as {code?: string}).code === 'RESOLVE-MISSING-001');
});

test('both ID and capability conflicts remain enforced', () => {
  const a = entry('block/a'), b = entry('block/b', [], ['service']);
  a.manifest.conflicts = ['block/b'];
  assert.throws(() => resolve([a, b]), e => (e as {code?: string}).code === 'RESOLVE-CONFLICT-002');
  a.manifest.conflicts = ['service'];
  assert.throws(() => resolve([a, b]), e => (e as {code?: string}).code === 'RESOLVE-CONFLICT-003');
});

test('self-provided requirements do not introduce a self-cycle', () => {
  const a = entry('block/a', ['self'], ['self']); assert.deepEqual(ids(resolve([a]).entries), ['block/a']);
});

test('every explicitly selected provider precedes a consumer as in the existing ordering contract', () => {
  const a = entry('block/a', ['service']), b = entry('block/b', [], ['service']), c = entry('block/c', [], ['service']);
  assert.deepEqual(ids(resolve([a, c, b]).entries), ['block/b', 'block/c', 'block/a']);
});

test('a newly-ready lower-priority-rank block preempts previously ready later entries', () => {
  const a = entry('block/a', ['base'], ['a'], 'infra'), b = entry('block/b', [], ['base'], 'capability'), c = entry('block/c', [], ['c'], 'strategy');
  assert.deepEqual(ids(resolve([c, a, b]).entries), ['block/b', 'block/a', 'block/c']);
});

test('cycle errors identify unscheduled blocks without calling their dependent tails a minimal cycle', () => {
  const a = entry('block/a', ['block/b']), b = entry('block/b', ['block/a']), c = entry('block/c', ['block/a']);
  assert.throws(() => resolve([c, b, a]), error => {
    const e = error as { code?: string; details?: { blockedBlockIds?: string[] } };
    assert.equal(e.code, 'RESOLVE-CYCLE-003'); assert.deepEqual(e.details?.blockedBlockIds, ['block/a', 'block/b', 'block/c']); return true;
  });
});

test('result arrays cannot be used to rewrite the completed selection and source manifests remain untouched', () => {
  const a = entry('block/a'), before = structuredClone(a), result = resolve([a]);
  assert.ok(Object.isFrozen(result.entries)); assert.ok(Object.isFrozen(result.capabilities));
  assert.deepEqual(a, before); assert.equal(Object.isFrozen(a), false);
});

test('wide and deep graphs use bounded stack, preserve ranks and include every selected vertex', () => {
  const wide = Array.from({ length: 20_000 }, (_, i) => entry(`block/${String(i).padStart(6, '0')}`));
  assert.deepEqual(ids(resolve([...wide].reverse()).entries), ids(wide));
  const deep = Array.from({ length: 20_000 }, (_, i) => entry(`block/${i}`, i ? [`block/${i - 1}`] : []));
  assert.deepEqual(ids(resolve([...deep].reverse()).entries), ids(deep));
});

test('priority-queue order agrees with an independent exhaustive ready-set model on generated DAGs', () => {
  let seed = 7291;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const kinds: ManifestKind[] = ['infra', 'governance', 'capability', 'strategy'];
  for (let scenario = 0; scenario < 500; scenario++) {
    const n = 1 + next() % 40;
    const values = Array.from({ length: n }, (_, i) => entry(`b/${String(i).padStart(3, '0')}`, [], undefined, kinds[next() % 4]!));
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) if (next() % 7 === 0) values[i]!.manifest.requires.push(values[j]!.manifest.id);
    const pending = new Set(values), done = new Set<string>(), expected: string[] = [];
    while (pending.size) {
      const ready = [...pending].filter(v => v.manifest.requires.every(id => done.has(id)));
      ready.sort((a, b) => kinds.indexOf(a.manifest.kind) - kinds.indexOf(b.manifest.kind) ||
        (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
      const first = ready[0]!; pending.delete(first); done.add(first.manifest.id); expected.push(first.manifest.id);
    }
    assert.deepEqual(ids(resolve([...values].reverse(), values).entries), expected, `scenario ${scenario}`);
  }
});
