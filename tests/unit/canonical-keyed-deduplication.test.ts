import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { factAssertionId } from '../../src/compiler/ir/ir-fact-store.ts';
import { normalizeEvidence, normalizeProvenance } from '../../src/compiler/ir/ir-normalization.ts';
import { CanonicalKeyConflictError, uniqueSortedByKey } from '../../src/contracts/canonical.ts';
import type { EvidenceReference, FactProvenance } from '../../src/semantics/engineering-ir/fact-types.ts';

const conflict = (error: unknown): boolean => error instanceof CanonicalKeyConflictError
  && error.code === 'CANONICAL-KEY-CONFLICT';

// Small ordinary-data observations only: no process, repository or compiler fixture.
test('keyed deduplication folds canonical-equal duplicates and sorts unique keys', () => {
  const first = { id: 'b', payload: { z: 2, a: 1 } };
  const equal = { payload: { a: 1, z: 2 }, id: 'b' };
  const other = { id: 'a', payload: { a: 3, z: 4 } };
  for (const values of [[first, equal, other], [equal, other, first], [other, first, equal]]) {
    let calls = 0;
    const actual = uniqueSortedByKey(values, value => { calls++; return value.id; });
    assert.deepEqual(actual, [other, first]);
    assert.equal(calls, values.length);
    assert.equal(values.length, 3);
  }
});

test('conflicting duplicate keys reject every ordering without leaking values', () => {
  const first = { id: 'private-key', value: 'private-first' };
  const second = { id: 'private-key', value: 'private-second' };
  for (const values of [[first, second], [second, first], [first, first, second], [second, first, first]]) {
    assert.throws(() => uniqueSortedByKey(values, value => value.id), error => {
      assert.ok(conflict(error));
      assert.equal((error as Error).message, 'Canonical duplicate key has conflicting values');
      return true;
    });
  }
});

test('IR metadata preserves unique legacy bytes and rejects ambiguous duplicate wire order', () => {
  const first: FactProvenance = { kind: 'contract', sourceId: 'owner', sourcePath: 'owner.yaml', revision: 'r1' };
  const reordered: FactProvenance = { revision: 'r1', sourcePath: 'owner.yaml', sourceId: 'owner', kind: 'contract' };
  const legacyForms = [
    [first, '[{"kind":"contract","sourceId":"owner","sourcePath":"owner.yaml","revision":"r1"}]'],
    [reordered, '[{"revision":"r1","sourcePath":"owner.yaml","sourceId":"owner","kind":"contract"}]']
  ] as const;
  for (const [value, bytes] of legacyForms) {
    const expectedId = `assertion:${createHash('sha256').update(`fact:example\0authoritative\0${bytes}`).digest('hex').slice(0, 24)}`;
    for (const inputs of [[value], [value, { ...value }]]) {
      const normalized = normalizeProvenance(inputs);
      assert.equal(normalized[0], value);
      assert.equal(JSON.stringify(normalized), bytes);
      assert.equal(factAssertionId('fact:example', 'authoritative', normalized), expectedId);
    }
  }
  for (const inputs of [[first, reordered], [reordered, first]]) {
    assert.throws(() => normalizeProvenance(inputs), conflict);
  }
  const evidence: EvidenceReference = { kind: 'test', ref: 'case', digest: 'd1' };
  const reorderedEvidence: EvidenceReference = { digest: 'd1', ref: 'case', kind: 'test' };
  for (const [value, bytes] of [
    [evidence, '[{"kind":"test","ref":"case","digest":"d1"}]'],
    [reorderedEvidence, '[{"digest":"d1","ref":"case","kind":"test"}]']
  ] as const) {
    const normalized = normalizeEvidence([value, { ...value }]);
    assert.equal(normalized[0], value);
    assert.equal(JSON.stringify(normalized), bytes);
  }
  for (const inputs of [[evidence, reorderedEvidence], [reorderedEvidence, evidence]]) {
    assert.throws(() => normalizeEvidence(inputs), conflict);
  }
});

test('IR metadata rejects delimiter collisions and distinguishes empty optional values', () => {
  const provenancePairs: FactProvenance[][] = [
    [{ kind: 'compiler', sourceId: 'a\0b', sourcePath: 'c' }, { kind: 'compiler', sourceId: 'a', sourcePath: 'b\0c' }],
    [{ kind: 'compiler', sourceId: 'a' }, { kind: 'compiler', sourceId: 'a', sourcePath: '' }]
  ];
  for (const pair of provenancePairs) {
    assert.throws(() => normalizeProvenance(pair), conflict);
    assert.throws(() => normalizeProvenance([...pair].reverse()), conflict);
  }
  const evidencePairs: EvidenceReference[][] = [
    [{ kind: 'test', ref: 'a\0b', digest: 'c' }, { kind: 'test', ref: 'a', digest: 'b\0c' }],
    [{ kind: 'test', ref: 'a' }, { kind: 'test', ref: 'a', digest: '' }]
  ];
  for (const pair of evidencePairs) {
    assert.throws(() => normalizeEvidence(pair), conflict);
    assert.throws(() => normalizeEvidence([...pair].reverse()), conflict);
  }
  assert.equal(normalizeProvenance([{ kind: 'compiler', sourceId: 'a', sourcePath: '' }])[0]!.sourcePath, '');
  assert.equal(normalizeEvidence([{ kind: 'test', ref: 'a', digest: '' }])[0]!.digest, '');
});

test('IR metadata preserves unique competing fields and refuses conflicting duplicate data', () => {
  const first = { kind: 'test', ref: 'case', competing: 'first' };
  const second = { kind: 'test', ref: 'case', competing: 'second' };
  const normalized = normalizeEvidence([first]);
  assert.equal(normalized[0], first);
  assert.equal(JSON.stringify(normalized), '[{"kind":"test","ref":"case","competing":"first"}]');
  assert.throws(() => normalizeEvidence([first, second]), conflict);
  assert.throws(() => normalizeEvidence([second, first]), conflict);
  const optional: FactProvenance = { revision: undefined, sourceId: 'owner', kind: 'compiler' };
  assert.equal(normalizeProvenance([optional])[0], optional);
  assert.equal(JSON.stringify(normalizeProvenance([optional])), '[{"sourceId":"owner","kind":"compiler"}]');
  assert.throws(() => normalizeProvenance([optional, optional]), /own string data/u);
  let reads = 0;
  const accessor = { kind: 'test', ref: 'case' };
  Object.defineProperty(accessor, 'competing', { enumerable: true, get() { reads++; return 'hidden'; } });
  const toJSON = { kind: 'test', ref: 'case', toJSON() { reads++; return {}; } };
  const hidden = { kind: 'test', ref: 'case' };
  Object.defineProperty(hidden, 'competing', { value: 'hidden' });
  const symbol = { kind: 'test', ref: 'case', [Symbol('competing')]: 'hidden' };
  for (const value of [accessor, toJSON, hidden, symbol]) {
    assert.equal(normalizeEvidence([value])[0], value);
    assert.throws(() => normalizeEvidence([value, value]), /own string data/u);
  }
  assert.equal(reads, 0);
});
