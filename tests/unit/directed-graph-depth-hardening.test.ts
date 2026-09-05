import assert from 'node:assert/strict';
import { test } from 'bun:test';

import { compileClosedDirectedGraphStrongComponents as scc, type DirectedGraphEdge } from '../../src/system-architecture/foundation/runtime/directed-graph.ts';

function chain(size: number): { nodes: string[]; edges: DirectedGraphEdge[] } {
  const nodes = Array.from({ length: size }, (_, index) => String(index).padStart(6, '0'));
  const edges = nodes.slice(1).map((to, index) => ({ from: nodes[index]!, to }));
  return { nodes, edges };
}

test('empty directed graph returns a frozen empty partition', () => {
  const result = scc([], []);
  assert.deepEqual(result, []);
  assert.ok(Object.isFrozen(result));
});

test('isolated, self-loop and duplicate nodes preserve set semantics', () => {
  assert.deepEqual(scc(['b', 'a', 'a'], [{ from: 'b', to: 'b' }]), [['a'], ['b']]);
});

test('SCC keeps duplicate edges idempotent and output deeply frozen', () => {
  const result = scc(['b', 'a'], [
    { from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }
  ]);
  assert.deepEqual(result, [['a', 'b']]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0]));
});

test('SCC rejects either endpoint outside the closed node set', () => {
  assert.throws(() => scc(['known'], [{ from: 'known', to: 'unknown' }]), /directed-graph-unknown-endpoint/);
  assert.throws(() => scc(['known'], [{ from: 'unknown', to: 'known' }]), /directed-graph-unknown-endpoint/);
});

test('SCC preserves input and canonical partition across reversed traversal', () => {
  const nodes = Object.freeze(['d', 'c', 'b', 'a']);
  const edges = Object.freeze([
    Object.freeze({ from: 'a', to: 'b' }), Object.freeze({ from: 'b', to: 'a' }),
    Object.freeze({ from: 'c', to: 'd' }), Object.freeze({ from: 'd', to: 'c' }),
    Object.freeze({ from: 'b', to: 'c' })
  ]);
  assert.deepEqual(scc(nodes, edges), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(scc([...nodes].reverse(), [...edges].reverse()), scc(nodes, edges));
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

test('SCC orders Unicode and special strings by code units without prototype aliases', () => {
  const nodes = ['中', '__proto__', '', 'Z', 'a', '😀'];
  assert.deepEqual(scc(nodes, []), [...nodes].sort().map((id) => [id]));
});

test('SCC captures each edge endpoint once before validating and using it', () => {
  let fromReads = 0;
  let toReads = 0;
  const edge = {
    get from() { fromReads += 1; return fromReads === 1 ? 'a' : 'missing'; },
    get to() { toReads += 1; return toReads === 1 ? 'b' : 'missing'; }
  };
  assert.deepEqual(scc(['a', 'b'], [edge, { from: 'b', to: 'a' }]), [['a', 'b']]);
  assert.equal(fromReads, 1);
  assert.equal(toReads, 1);
});

test('SCC processes a 30000-node chain without native call-stack dependence', () => {
  const { nodes, edges } = chain(30_000);
  const components = scc(nodes, edges);
  assert.equal(components.length, nodes.length);
  for (let index = 0; index < nodes.length; index += 1) {
    assert.deepEqual(components[index], [nodes[index]]);
  }
});

test('SCC processes a 30000-node cycle without native call-stack dependence', () => {
  const { nodes, edges } = chain(30_000);
  edges.push({ from: nodes[nodes.length - 1]!, to: nodes[0]! });
  const components = scc(nodes, edges);
  assert.equal(components.length, 1);
  assert.deepEqual(components[0], nodes);
});
