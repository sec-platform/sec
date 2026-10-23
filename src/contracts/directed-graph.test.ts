import { expect, test } from 'bun:test';

import { compileClosedDirectedGraphStrongComponents } from './directed-graph.ts';

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
