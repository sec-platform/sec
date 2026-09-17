import { expect, test } from 'bun:test';

import { compileClosedDirectedGraphStrongComponents } from './directed-graph.ts';

test('closed directed graph SCC compilation is input-order invariant without mutating input', () => {
  const nodes = ['c', 'b', 'a'] as const;
  const edges = [
    { from: 'c', to: 'a' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'b' }
  ] as const;

  expect(compileClosedDirectedGraphStrongComponents(nodes, edges)).toEqual([['a', 'b', 'c']]);
  expect(compileClosedDirectedGraphStrongComponents([...nodes].reverse(), [...edges].reverse()))
    .toEqual([['a', 'b', 'c']]);
  expect(nodes).toEqual(['c', 'b', 'a']);
  expect(edges).toEqual([
    { from: 'c', to: 'a' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'b' }
  ]);
});

test('closed directed graph SCC compilation retains isolated singleton and self-loop components', () => {
  expect(compileClosedDirectedGraphStrongComponents(['only'], [])).toEqual([['only']]);
  expect(compileClosedDirectedGraphStrongComponents(
    ['self'],
    [{ from: 'self', to: 'self' }]
  )).toEqual([['self']]);
});

test('closed directed graph SCC compilation separates disconnected components', () => {
  expect(compileClosedDirectedGraphStrongComponents(
    ['d', 'c', 'b', 'a'],
    [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'c', to: 'd' }
    ]
  )).toEqual([['a', 'b'], ['c'], ['d']]);
});

test('closed directed graph SCC compilation treats duplicate edges as idempotent', () => {
  expect(compileClosedDirectedGraphStrongComponents(
    ['a', 'b'],
    [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' }
    ]
  )).toEqual([['a', 'b']]);
});

test('closed directed graph SCC compilation rejects unknown endpoints', () => {
  expect(() => compileClosedDirectedGraphStrongComponents(
    ['known'],
    [{ from: 'known', to: 'unknown' }]
  )).toThrow('[directed-graph-unknown-endpoint]');
});
