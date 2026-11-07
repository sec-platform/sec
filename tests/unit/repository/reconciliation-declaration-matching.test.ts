import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { pairSourceProgramDeclarations as pair } from '../../../src/adapters/repository/source-program-model/reconciliation-declarations.ts';

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

test('ambiguous repeated subject/relation does not use last-write-wins', () => {
  const a = declaration('a', 'src/a.ts', 'a'), b = declaration('b', 'src/b.ts', 'b'), c = declaration('c', 'src/c.ts', 'c');
  for (const old of [[a, b], [b, a]]) {
    assert.deepEqual(ids(pair(old, [c], old.map(d => relation('same', d)), [relation('same', c)])), []);
  }
});

test('equal digests preserve positional order and frozen inputs without reusing a target', () => {
  const frozen = (value: Declaration) => {
    Object.freeze(value.span);
    return Object.freeze(value);
  };
  const before = Object.freeze(Array.from({ length: 4 }, (_, i) => frozen(declaration(`a${i}`, 'src/a.ts', 'work', 'same', i))).reverse());
  const after = Object.freeze(Array.from({ length: 3 }, (_, i) => frozen(declaration(`b${i}`, 'src/a.ts', 'work', 'same', i))).reverse());
  assert.deepEqual(ids(pair(before, after, [], [])), [['a0', 'b0'], ['a1', 'b1'], ['a2', 'b2']]);
});

test('a move by stable name requires both the old and new unmatched side to be unique', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts'), c = declaration('c', 'src/c.ts');
  assert.deepEqual(ids(pair([a], [b], [], [])), [['a', 'b']]);
  for (const before of [[a, b], [b, a]]) assert.deepEqual(ids(pair(before, [c], [], [])), []);
  assert.deepEqual(ids(pair([a], [b, c], [], [])), []);
  assert.deepEqual(ids(pair([a], [{ ...b, exported: false }], [], [])), []);
});

test('module and declaration kind remain part of correspondence', () => {
  const a = declaration('a', 'src/a.ts'), b = declaration('b', 'src/b.ts');
  for (const changed of [{ ...b, moduleId: 'other' }, { ...b, kind: 'class' }]) {
    assert.deepEqual(ids(pair([a], [changed], [], [])), []);
  }
});
