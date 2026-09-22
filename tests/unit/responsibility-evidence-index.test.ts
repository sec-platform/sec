import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { indexResponsibilityEvidenceInputs as index } from '../../src/adapters/repository/source-program-model/responsibility-evidence-index.ts';

const row = (id = 'b', path: string | null = 'src/a.ts', name: string | null = 'f') => ({
  binding: { id }, declarationPath: path, exportName: name
});
const declaration = (path = 'src/a.ts', name = 'f', exported = true) => ({
  path, name, exported, observationId: `${path}:${name}`, detail: 'retained'
});
const fact = (id = 'b', subject = 'owner', revision = 'current') => ({
  predicate: 'CONTAINS', subject, object: { kind: 'entity', entityId: id },
  assertions: [{ authority: 'authoritative', validFromRevision: revision, provenance: [{ kind: 'contract' }] }]
});

test('unique input joins preserve the declaration object and row order', () => {
  const entry = declaration();
  const result = index([row()], [fact()], [entry], 'current');
  assert.deepEqual(result[0]!.containment, { status: 'unique', value: 'owner' });
  assert.deepEqual(result[0]!.declaration, { status: 'unique', value: entry });
  assert.equal(result[0]!.conflictingDeclarationClaim, false);
  if (result[0]!.declaration.status === 'unique') assert.equal(result[0]!.declaration.value, entry);
});

test('duplicate identical containment facts are ambiguous rather than deduplicated', () => {
  const input = fact();
  assert.equal(index([row()], [input, input], [declaration()], 'current')[0]!.containment.status, 'ambiguous');
});

test('two qualifying assertions on one fact do not create two claims', () => {
  const input = fact(); input.assertions.push(input.assertions[0]!);
  assert.equal(index([row()], [input], [], 'current')[0]!.containment.status, 'unique');
});

test('absence and ambiguity remain distinct declaration outcomes', () => {
  const entry = declaration();
  assert.equal(index([row()], [fact()], [], 'current')[0]!.declaration.status, 'absent');
  assert.equal(index([row()], [fact()], [entry, entry], 'current')[0]!.declaration.status, 'ambiguous');
});

for (const [label, change] of [
  ['wrong predicate', { predicate: 'USES' }],
  ['non-entity target', { object: { kind: 'literal', entityId: 'b' } }],
  ['unrelated binding', { object: { kind: 'entity', entityId: 'other' } }],
  ['no assertion', { assertions: [] }],
  ['stale revision', { assertions: fact('b', 'owner', 'previous').assertions }],
  ['derived assertion', { assertions: [{ authority: 'derived', validFromRevision: 'current', provenance: [{ kind: 'contract' }] }] }],
  ['no contract provenance', { assertions: [{ authority: 'authoritative', validFromRevision: 'current', provenance: [{ kind: 'runtime' }] }] }]
] as const) {
  test(`irrelevant containment: ${label}`, () => {
    assert.equal(index([row()], [{ ...fact(), ...change }], [], 'current')[0]!.containment.status, 'absent');
  });
}

test('one qualifying assertion among irrelevant assertions is sufficient', () => {
  const input = fact();
  input.assertions.unshift({ authority: 'derived', validFromRevision: 'old', provenance: [] });
  assert.equal(index([row()], [input], [], 'current')[0]!.containment.status, 'unique');
});

test('non-exported and mismatched declarations are not a successful declaration join', () => {
  const result = index([row()], [fact()], [declaration('src/a.ts', 'f', false), declaration('src/b.ts'), declaration('src/a.ts', 'g')], 'current');
  assert.equal(result[0]!.declaration.status, 'absent');
});

test('claim collisions remain visible even when a claimant has no containment fact', () => {
  const rows = [row('first'), row('second')];
  const result = index(rows, [fact('first')], [declaration()], 'current');
  assert.deepEqual(result.map((value) => value.conflictingDeclarationClaim), [true, true]);
  assert.equal(result[1]!.containment.status, 'absent');
});

test('null path/name does not participate in declaration claim counts; empty text remains a value', () => {
  const result = index([row('a', null), row('b', 'src/a.ts', null), row('c', '', '')], [], [declaration('', '')], 'current');
  assert.deepEqual(result.map((value) => value.declaration.status), ['absent', 'absent', 'unique']);
  assert.deepEqual(result.map((value) => value.conflictingDeclarationClaim), [false, false, false]);
});

test('structured declaration comparison preserves both fields even with delimiter characters', () => {
  const rows = [row('a', 'x\0y', 'z'), row('b', 'x', 'y\0z')];
  const entries = [declaration('x\0y', 'z'), declaration('x', 'y\0z')];
  const result = index(rows, [], entries, 'current');
  for (let i = 0; i < 2; i += 1) {
    const selection = result[i]!.declaration;
    assert.equal(selection.status, 'unique');
    if (selection.status === 'unique') assert.equal(selection.value, entries[i]);
  }
  // Preserve the existing caller's claim-key policy; this index does not
  // silently fix a different contract in the middle of a performance change.
  assert.ok(result.every((value) => value.conflictingDeclarationClaim));
});

test('snapshots are independent across calls and do not freeze caller objects', () => {
  const entry = declaration();
  const rows = [row()];
  const first = index(rows, [fact()], [entry], 'current');
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first[0]));
  assert.equal(Object.isFrozen(rows[0]!.binding), false);
  assert.equal(Object.isFrozen(entry), false);
  assert.equal(index(rows, [], [entry], 'current')[0]!.containment.status, 'absent');
  assert.equal(first[0]!.containment.status, 'unique');
});

test('empty requests do not read fact or declaration elements', () => {
  const bad = new Proxy(fact(), { get() { throw new Error('must not inspect'); } });
  const badDeclaration = new Proxy(declaration(), { get() { throw new Error('must not inspect'); } });
  assert.deepEqual(index([], [bad], [badDeclaration], 'current'), []);
});

test('many bindings scan each fact and each declaration once, not once per binding', () => {
  let factReads = 0; let declarationReads = 0;
  const size = 200;
  const facts = Array.from({ length: size }, (_, i) => ({ ...fact(`b${i}`), get predicate() { factReads += 1; return 'CONTAINS'; } }));
  const entries = Array.from({ length: size }, (_, i) => ({ ...declaration('src/a.ts', `f${i}`), get exported() { declarationReads += 1; return true; } }));
  const result = index(Array.from({ length: size }, (_, i) => row(`b${i}`, 'src/a.ts', `f${i}`)), facts, entries, 'current');
  assert.ok(result.every((value) => value.declaration.status === 'unique' && value.containment.status === 'unique'));
  assert.equal(factReads, size); assert.equal(declarationReads, size);
});

test('small multiset joins agree with independent filtering and cardinality', () => {
  const pool = [fact(), fact('b', 'other'), fact('outside'), fact('b', 'owner', 'stale')];
  for (let code = 0; code < 256; code += 1) {
    const facts = Array.from({ length: 4 }, (_, i) => pool[(code >> (i * 2)) & 3]!);
    const selected = facts.filter((entry) => entry.object.entityId === 'b' && entry.assertions.some((assertion) => assertion.validFromRevision === 'current'));
    const actual = index([row()], facts, [], 'current')[0]!.containment;
    assert.equal(actual.status, selected.length === 0 ? 'absent' : selected.length === 1 ? 'unique' : 'ambiguous');
    if (actual.status === 'unique') assert.equal(actual.value, selected[0]!.subject);
  }
});
