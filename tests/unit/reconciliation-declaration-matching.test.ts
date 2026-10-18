import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { pairSourceProgramDeclarations as pair } from '../../src/adapters/repository/source-program-model/reconciliation-declarations.ts';

type Declaration = Parameters<typeof pair>[0][number];
function declaration(id: string, path: string, name = 'work', digest = id, start = 0): Declaration {
  return { observationId: id, declarationDigest: digest, path, name, moduleId: 'module', kind: 'function', exported: true,
    span: { start, end: start + 1, startLine: 1, endLine: 1, startColumn: 1, endColumn: 2 } };
}
const relation = (subject: string, d: Declaration, kind = 'declares') => ({ subject, relation: kind, declaration: d });
const ids = (result: ReturnType<typeof pair>) => [...result.values()].map(value => [value.before.observationId, value.after.observationId]).sort();

test('unambiguous causal identity survives beside ambiguous renamed and moved declarations', () => {
  const a = declaration('a', 'src/old-a.ts', 'oldA'), b = declaration('b', 'src/old-b.ts', 'oldB');
  const c = declaration('c', 'src/old-c.ts', 'oldC'), d = declaration('d', 'src/old-d.ts', 'oldD');
  const x = declaration('x', 'src/new-x.ts', 'newX'), y = declaration('y', 'src/new-y.ts', 'newY');
  const z = declaration('z', 'src/new-z.ts', 'newZ'), w = declaration('w', 'src/new-w.ts', 'newW');
  const beforeHints = [relation('split-x', a), relation('split-y', a), relation('merge-y', b), relation('unique-c', c), relation('unique-d', d)];
  const afterHints = [relation('split-x', x), relation('split-y', y), relation('merge-y', y), relation('unique-c', z), relation('unique-d', w)];
  assert.deepEqual(ids(pair([a, b, c, d], [x, y, z, w], beforeHints, afterHints)), [['c', 'z'], ['d', 'w']]);
});

test('many old declarations cannot disappear into one causal target', () => {
  const a = declaration('a', 'src/a.ts', 'a'), b = declaration('b', 'src/b.ts', 'b'), c = declaration('c', 'src/c.ts', 'c');
  assert.deepEqual(ids(pair([a, b], [c], [relation('one', a), relation('two', b)], [relation('one', c), relation('two', c)])), []);
});

test('one old declaration cannot be arbitrarily renamed to one of several causal targets', () => {
  const a = declaration('a', 'src/a.ts', 'a'), b = declaration('b', 'src/b.ts', 'b'), c = declaration('c', 'src/c.ts', 'c');
  assert.deepEqual(ids(pair([a], [b, c], [relation('one', a), relation('two', a)], [relation('one', b), relation('two', c)])), []);
});

test('ambiguous repeated subject/relation does not use last-write-wins', () => {
  const a = declaration('a', 'src/a.ts', 'a'), b = declaration('b', 'src/b.ts', 'b'), c = declaration('c', 'src/c.ts', 'c');
  for (const old of [[a, b], [b, a]]) {
    assert.deepEqual(ids(pair(old, [c], old.map(d => relation('same', d)), [relation('same', c)])), []);
  }
});

test('an exact survivor of an ambiguous merge is retained, leaving the other declaration removed', () => {
  const a = declaration('a', 'src/a.ts', 'work'), b = declaration('b', 'src/b.ts', 'other');
  const current = declaration('c', 'src/a.ts', 'work');
  const matches = pair([a, b], [current], [relation('one', a), relation('two', b)],
    [relation('one', current), relation('two', current)]);
  assert.deepEqual(ids(matches), [['a', 'c']]); assert.equal(matches.has('b'), false);
});

test('repeated identical relations and multiple agreeing role hints do not invent ambiguity', () => {
  const a = declaration('a', 'src/a.ts', 'a'), b = declaration('b', 'src/b.ts', 'b');
  assert.deepEqual(ids(pair([a], [b], [relation('one', a), relation('one', a), relation('one', a, 'writes')],
    [relation('one', b), relation('one', b, 'writes')])), [['a', 'b']]);
});

test('digest matches take precedence over span position within a repeated exact address', () => {
  const a = declaration('a', 'src/a.ts', 'work', 'first', 0), b = declaration('b', 'src/a.ts', 'work', 'second', 10);
  const c = declaration('c', 'src/a.ts', 'work', 'second', 0), d = declaration('d', 'src/a.ts', 'work', 'first', 10);
  assert.deepEqual(ids(pair([a, b], [c, d], [], [])), [['a', 'd'], ['b', 'c']]);
});

test('equal digests retain stable positional occurrence order without reusing a target', () => {
  const before = Array.from({ length: 4 }, (_, i) => declaration(`a${i}`, 'src/a.ts', 'work', 'same', i));
  const after = Array.from({ length: 3 }, (_, i) => declaration(`b${i}`, 'src/a.ts', 'work', 'same', i));
  assert.deepEqual(ids(pair([...before].reverse(), [...after].reverse(), [], [])), [['a0', 'b0'], ['a1', 'b1'], ['a2', 'b2']]);
});

test('remaining declarations at the same exact address keep the established positional fallback', () => {
  const a = declaration('a', 'src/a.ts', 'work', 'old', 1), b = declaration('b', 'src/a.ts', 'work', 'new', 20);
  assert.deepEqual(ids(pair([a], [b], [], [])), [['a', 'b']]);
});

test('a move by stable name requires both the old and new unmatched side to be unique', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts'), c = declaration('c', 'src/c.ts');
  assert.deepEqual(ids(pair([a], [b], [], [])), [['a', 'b']]);
  for (const before of [[a, b], [b, a]]) assert.deepEqual(ids(pair(before, [c], [], [])), []);
  assert.deepEqual(ids(pair([a], [b, c], [], [])), []);
});

test('a unique declaration at one exact address retains identity across visibility changes', () => {
  const before = declaration('before', 'src/a.ts');
  const after = { ...declaration('after', 'src/a.ts'), exported: false };
  assert.deepEqual(ids(pair([before], [after], [], [])), [['before', 'after']]);
});

test('visibility matching does not absorb overload ambiguity or moves', () => {
  const before = declaration('before', 'src/a.ts');
  const moved = { ...declaration('moved', 'src/b.ts'), exported: false };
  const oldOverloads = [
    declaration('old-a', 'src/a.ts', 'work', 'a', 0),
    declaration('old-b', 'src/a.ts', 'work', 'b', 10)
  ];
  const newOverloads = oldOverloads.map((item, index) => ({
    ...declaration(`new-${index}`, 'src/a.ts', 'work', item.declarationDigest, item.span.start),
    exported: false
  }));
  assert.deepEqual(ids(pair([before], [moved], [], [])), []);
  assert.deepEqual(ids(pair(oldOverloads, newOverloads, [], [])), []);
});

test('module and declaration kind remain part of correspondence', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts');
  for (const changed of [{ ...b, moduleId: 'other' }, { ...b, kind: 'class' }]) {
    assert.deepEqual(ids(pair([a], [changed], [], [])), []);
  }
});

test('large repeated-name groups use indexed exact matches with unchanged identities', () => {
  const count = 12000;
  const before = Array.from({ length: count }, (_, i) => declaration(`a${i}`, 'src/a.ts', 'work', `digest${i}`, i));
  const after = Array.from({ length: count }, (_, i) => declaration(`b${i}`, 'src/a.ts', 'work', `digest${i}`, count - i));
  const matches = pair(before, after, [], []);
  assert.equal(matches.size, count);
  for (let i = 0; i < count; i++) assert.equal(matches.get(`a${i}`)?.after.observationId, `b${i}`);
});

test('caller arrays and declarations remain untouched and every mapping is injective', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts');
  const before = Object.freeze([Object.freeze(a)]), after = Object.freeze([Object.freeze(b)]);
  const matched = pair(before, after, [], []);
  assert.equal(new Set([...matched.values()].map(value => value.after.observationId)).size, matched.size);
  assert.equal(matched.get('a')!.before, a); assert.equal(matched.get('a')!.after, b);
});
