import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildSemanticViewSet } from '../../src/compiler/projection/build-semantic-view-set.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import { projectScenarioView } from '../../src/compiler/projection/project-scenario-view.ts';
import { projectStateView } from '../../src/compiler/projection/project-state-view.ts';
import { buildSemanticInspector } from '../../src/compiler/projection/semantic-view-utils.ts';
import { semanticViewFactIds } from '../../src/semantic/projection/contract/types.ts';
import { addFact, entity, projectionSnapshot, viewIR } from '../fixtures/semantic-view-data.ts';

const code = (value: string) => (error: unknown): boolean =>
  error !== null && typeof error === 'object' && Reflect.get(error, 'code') === value;

test('architecture includes both ends of eligible facts but not scenario or literal relations', () => {
  const ir = viewIR();
  const self = addFact(ir, 'operation:0', 'AWAITS', 'operation:0');
  const view = projectArchitectureView(projectionSnapshot(ir));
  const included = new Set(view.nodes.map((node) => node.entityId));
  assert.equal(included.has('scenario:0'), false); assert.equal(included.has('scenario:0#step:a'), false);
  for (const edge of view.edges) { assert.ok(included.has(edge.source)); assert.ok(included.has(edge.target!)); }
  const operation = view.nodes.find((node) => node.entityId === 'operation:0')!;
  assert.equal(operation.references.filter((ref) => ref.kind === 'fact' && ref.ref === self.id).length, 1);
  assert.ok(operation.badges.includes('async'));
});

test('architecture node facts agree with an independent incident-edge selection', () => {
  const snapshot = projectionSnapshot(viewIR(4)); const view = projectArchitectureView(snapshot);
  for (const node of view.nodes) {
    const expected = view.edges.filter((edge) => edge.source === node.entityId || edge.target === node.entityId)
      .flatMap((edge) => edge.references.filter((ref) => ref.kind === 'fact').map((ref) => ref.ref));
    assert.deepEqual(node.references.filter((ref) => ref.kind === 'fact').map((ref) => ref.ref).sort(), [...new Set(expected)].sort());
  }
});

test('scenario projection does not gain relations from unrelated incoming step edges', () => {
  const ir = viewIR(2); const foreign = addFact(ir, 'scenario:1#step:b', 'PRECEDES', 'scenario:0#step:a');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:0');
  assert.ok(view.nodes.find((node) => node.id === 'scenario:0#step:a')!.badges.includes('entry'));
  assert.equal(semanticViewFactIds(view).includes(foreign.id), false);
});

test('scenario keeps retry values, referenced operations, async badges and step provenance', () => {
  const view = projectScenarioView(projectionSnapshot(viewIR()), 'scenario:0');
  assert.ok(view.nodes.find((node) => node.id === 'scenario:0#step:a')!.badges.includes('async'));
  assert.ok(view.nodes.find((node) => node.id === 'scenario:0#step:b')!.badges.includes('retry'));
  const retry = view.edges.find((edge) => edge.relation === 'RETRIES')!;
  assert.deepEqual(retry.value, { maxAttempts: 3 }); assert.equal(retry.label, 'retries up to 3');
  assert.ok(retry.references.some((ref) => ref.kind === 'scenario-step' && ref.ref === 'scenario:0#step:b'));
});

test('an operation shared with other domains retains its global operation facts in a scenario node', () => {
  const ir = viewIR(2); const global = addFact(ir, 'operation:0', 'READS', 'state:1');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:0');
  const operation = view.nodes.find((node) => node.id === 'operation:0')!;
  assert.ok(operation.references.some((ref) => ref.kind === 'fact' && ref.ref === global.id));
});

test('duplicate step membership never duplicates its outgoing scenario edges', () => {
  const ir = viewIR(); addFact(ir, 'scenario:0', 'CONTAINS', 'scenario:0#step:a');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:0');
  assert.equal(view.edges.filter((edge) => edge.source === 'scenario:0#step:a' && edge.relation === 'INVOKES').length, 1);
  assert.equal(view.nodes.filter((node) => node.id === 'scenario:0#step:a').length, 1);
});

test('scenario self-edges remain visible once and suppress an entry badge when they precede the step', () => {
  const ir = viewIR(); const fact = addFact(ir, 'scenario:0#step:a', 'PRECEDES', 'scenario:0#step:a');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:0');
  const step = view.nodes.find((node) => node.id === 'scenario:0#step:a')!;
  assert.equal(step.badges.includes('entry'), false);
  assert.equal(step.references.filter((ref) => ref.kind === 'fact' && ref.ref === fact.id).length, 1);
});

test('state projection follows incoming accesses to state and backing fields, not unrelated targets', () => {
  const ir = viewIR(2); const foreign = addFact(ir, 'operation:1', 'MUTATES', 'field:0.value');
  const view = projectStateView(projectionSnapshot(ir), 'state:0');
  assert.ok(view.edges.some((edge) => edge.source === 'operation:1' && edge.target === 'field:0.value'));
  assert.ok(semanticViewFactIds(view).includes(foreign.id));
  assert.equal(view.nodes.some((node) => node.id === 'state:1'), false);
});

test('responsibility state view retains all owned states and merged edge evidence', () => {
  const ir = viewIR(2); addFact(ir, 'responsibility:0', 'OWNS', 'state:1');
  const duplicate = addFact(ir, 'operation:0', 'READS', 'state:0');
  const view = projectStateView(projectionSnapshot(ir), 'responsibility:0');
  assert.ok(view.nodes.some((node) => node.id === 'state:0')); assert.ok(view.nodes.some((node) => node.id === 'state:1'));
  const read = view.edges.filter((edge) => edge.source === 'operation:0' && edge.target === 'state:0' && edge.relation === 'READS');
  assert.equal(read.length, 1); assert.ok(read[0]!.references.some((ref) => ref.ref === duplicate.id));
});

test('state transition labels retain value fallbacks and unknown operation labels', () => {
  const ir = viewIR();
  const transition = addFact(ir, 'state:0', 'TRANSITIONS_TO', { value: { by: 'operation:missing' } });
  const view = projectStateView(projectionSnapshot(ir), 'state:0');
  assert.equal(view.edges.find((edge) => edge.id === `edge:fact:${transition.id}`)?.label, '? → ? by operation:missing');
});

for (const frozen of [false, true]) {
  test(`view-set output matches separate public projections with ${frozen ? 'immutable' : 'mutable'} input`, () => {
    const snapshot = projectionSnapshot(viewIR(3), frozen);
    const before = JSON.stringify(snapshot.ir);
    const expected = [projectArchitectureView(snapshot),
      ...[0, 1, 2].map((i) => projectScenarioView(snapshot, `scenario:${i}`)),
      ...[0, 1, 2].map((i) => projectStateView(snapshot, `state:${i}`))];
    const result = buildSemanticViewSet(snapshot);
    assert.deepEqual(result.views, expected); assert.ok(Object.isFrozen(result.views));
    assert.equal(JSON.stringify(snapshot.ir), before);
  });
}

test('mutating one returned projection does not affect later projections sharing read indexes', () => {
  const snapshot = projectionSnapshot(viewIR());
  const first = projectScenarioView(snapshot, 'scenario:0'); const before = JSON.stringify(first);
  first.nodes[0]!.label = 'overwritten'; first.edges.length = 0;
  assert.equal(JSON.stringify(projectScenarioView(snapshot, 'scenario:0')), before);
});

test('additional disjoint domains cannot change an already selected scenario or state view', () => {
  const first = projectionSnapshot(viewIR()); const expanded = projectionSnapshot(viewIR(20));
  assert.deepEqual(projectScenarioView(first, 'scenario:0'), projectScenarioView(expanded, 'scenario:0'));
  assert.deepEqual(projectStateView(first, 'state:0'), projectStateView(expanded, 'state:0'));
});

test('inspector preserves the two directional observations of a self-relation', () => {
  const ir = viewIR(); const fact = addFact(ir, 'operation:0', 'AWAITS', 'operation:0');
  const sections = buildSemanticInspector(projectionSnapshot(ir), 'operation:0');
  assert.equal(sections.find((section) => section.id === 'EVIDENCE')!.items.filter((item) => item.key === fact.id).length, 2);
});

test('public projection subject errors retain their domain codes', () => {
  const snapshot = projectionSnapshot(viewIR());
  assert.throws(() => projectArchitectureView(snapshot, 'missing'), code('VIEW-INSPECTOR-001'));
  assert.throws(() => projectScenarioView(snapshot, 'state:0'), code('VIEW-SCENARIO-001'));
  assert.throws(() => projectStateView(snapshot, 'missing'), code('VIEW-STATE-001'));
  assert.throws(() => projectStateView(snapshot, 'operation:0'), code('VIEW-STATE-002'));
});

test('map-backed view construction treats prototype-shaped identifiers as data', () => {
  const ir = viewIR(); ir.entities.push(entity('__proto__', 'operation'), entity('constructor', 'state'));
  addFact(ir, '__proto__', 'READS', 'constructor');
  const snapshot = projectionSnapshot(ir);
  const view = projectStateView(snapshot, 'constructor');
  assert.ok(view.nodes.some((node) => node.id === '__proto__'));
  assert.equal(Object.hasOwn(Object.prototype, 'stateful'), false);
});
