import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { pairSourceProgramDeclarations as pair } from '../../src/brownfield/source-program-model/reconciliation-declarations.ts';

type Declaration = Parameters<typeof pair>[0][number];
function declaration(id: string, path: string, name = 'work', digest = id, start = 0): Declaration {
  return { observationId: id, declarationDigest: digest, path, name, moduleId: 'module', kind: 'function', exported: true,
    span: { start, end: start + 1, startLine: 1, endLine: 1, startColumn: 1, endColumn: 2 } };
}
const relation = (subject: string, d: Declaration, kind = 'declares') => ({ subject, relation: kind, declaration: d });
const ids = (result: ReturnType<typeof pair>) => [...result.values()].map(value => [value.before.observationId, value.after.observationId]).sort();

test('unique causal identity can establish one renamed and moved declaration', () => {
  const a = declaration('a', 'src/old.ts', 'old'), b = declaration('b', 'src/new.ts', 'new');
  assert.deepEqual(ids(pair([a], [b], [relation('owner.work', a)], [relation('owner.work', b)])), [['a', 'b']]);
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

test('module, declaration kind and export status remain part of correspondence', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts');
  for (const changed of [{ ...b, moduleId: 'other' }, { ...b, kind: 'class' }, { ...b, exported: false }]) {
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

test('all 512 three-by-three causal hint graphs keep only unambiguous one-to-one hints', () => {
  const before = [0, 1, 2].map(i => declaration(`a${i}`, `src/old-${i}.ts`, `old${i}`));
  const after = [0, 1, 2].map(i => declaration(`b${i}`, `src/new-${i}.ts`, `new${i}`));
  for (let mask = 0; mask < 512; mask++) {
    const oldHints = [], newHints = [], selected: Array<[number, number]> = [];
    for (let left = 0; left < 3; left++) for (let right = 0; right < 3; right++) {
      if ((mask & (1 << (3 * left + right))) === 0) continue;
      selected.push([left, right]);
      oldHints.push(relation(`edge${left}-${right}`, before[left]!));
      newHints.push(relation(`edge${left}-${right}`, after[right]!));
    }
    const expected = selected.filter(([left, right]) => selected.filter(([l]) => l === left).length === 1
      && selected.filter(([, r]) => r === right).length === 1).map(([l, r]) => [`a${l}`, `b${r}`]).sort();
    assert.deepEqual(ids(pair(before, after, oldHints, newHints)), expected, `hint graph ${mask}`);
  }
});
