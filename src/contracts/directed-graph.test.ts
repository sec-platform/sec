import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { compileClosedDirectedGraphStrongComponents as scc, type DirectedGraphEdge } from './directed-graph.ts';

type DeepGraphInput = Readonly<{ nodes: readonly string[]; edges: readonly DirectedGraphEdge[] }>;
let deepGraphInput: DeepGraphInput | undefined;

function deepChain(): DeepGraphInput {
  if (deepGraphInput === undefined) {
    const nodes = Object.freeze(Array.from({ length: 30_000 }, (_, index) => String(index).padStart(6, '0')));
    const edges = Object.freeze(nodes.slice(1).map((to, index) => Object.freeze({ from: nodes[index]!, to })));
    deepGraphInput = Object.freeze({ nodes, edges });
  }
  return deepGraphInput;
}

test('empty directed graph returns an empty partition', () => {
  const result = scc([], []);
  assert.deepEqual(result, []);
});

test('SCC rejects either endpoint outside the closed node set', () => {
  assert.throws(() => scc(['known'], [{ from: 'known', to: 'unknown' }]), /directed-graph-unknown-endpoint/);
  assert.throws(() => scc(['known'], [{ from: 'unknown', to: 'known' }]), /directed-graph-unknown-endpoint/);
});

test('SCC preserves input and canonical partition across duplicate edges and reversed traversal', () => {
  const nodes = Object.freeze(['d', 'c', 'b', 'a']);
  const edges = Object.freeze([
    Object.freeze({ from: 'a', to: 'b' }), Object.freeze({ from: 'a', to: 'b' }),
    Object.freeze({ from: 'b', to: 'a' }),
    Object.freeze({ from: 'c', to: 'd' }), Object.freeze({ from: 'd', to: 'c' }),
    Object.freeze({ from: 'b', to: 'c' })
  ]);
  const components = scc(nodes, edges);
  for (const component of components) assert.equal(Reflect.set(component, '0', 'forged'), false);
  assert.deepEqual(components, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(scc([...nodes].reverse(), [...edges].reverse()), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(nodes, ['d', 'c', 'b', 'a']);
});

test('SCC never merges an edge into a previously completed component', () => {
  assert.deepEqual(scc(['a', 'b', 'c'], [
    { from: 'b', to: 'a' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }
  ]), [['a'], ['b', 'c']]);
});

test('SCC separates a diamond DAG from an actual back-edge cycle', () => {
  const nodes = ['a', 'b', 'c', 'd'];
  const edges = [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' }
  ];
  assert.deepEqual(scc(nodes, edges), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(scc(nodes, [...edges, { from: 'd', to: 'a' }]), [nodes]);
});

test('SCC processes a 30000-node chain without native call-stack dependence', () => {
  const { nodes, edges } = deepChain();
  const components = scc(nodes, edges);
  assert.equal(components.length, nodes.length);
  for (let index = 0; index < nodes.length; index += 1) {
    assert.deepEqual(components[index], [nodes[index]]);
  }
});

test('SCC processes a 30000-node cycle without native call-stack dependence', () => {
  const { nodes, edges } = deepChain();
  const components = scc(nodes, [...edges, { from: nodes[nodes.length - 1]!, to: nodes[0]! }]);
  assert.equal(components.length, 1);
  assert.deepEqual(components[0], nodes);
});
