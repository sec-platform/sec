import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildSemanticViewSet } from '../../../src/compiler/projection/build-semantic-view-set.ts';
import { projectArchitectureView } from '../../../src/compiler/projection/project-architecture-view.ts';
import { projectScenarioView } from '../../../src/compiler/projection/project-scenario-view.ts';
import { projectStateView } from '../../../src/compiler/projection/project-state-view.ts';
import { semanticViewFactIds } from '../../../src/semantics/projection/types.ts';
import { addFact, projectionSnapshot, viewIR } from '../../fixtures/semantic-view-data.ts';

test('architecture projection preserves exact incident membership and self-relation direction', () => {
  const ir = viewIR(4);
  const self = addFact(ir, 'operation:fixture:0', 'AWAITS', 'operation:fixture:0');
  const snapshot = projectionSnapshot(ir);
  const view = projectArchitectureView(snapshot);
  const included = new Set(view.nodes.map((node) => node.entityId));
  assert.equal(included.has('scenario:fixture:0'), false); assert.equal(included.has('scenario:fixture:0#step:a'), false);
  for (const edge of view.edges) { assert.ok(included.has(edge.source)); assert.ok(included.has(edge.target!)); }
  const operation = view.nodes.find((node) => node.entityId === 'operation:fixture:0')!;
  assert.equal(operation.references.filter((ref) => ref.kind === 'fact' && ref.ref === self.id).length, 1);
  assert.ok(operation.badges.includes('async'));

  const eligibleIds = new Set(snapshot.ir.entities
    .filter(entity => entity.kind !== 'scenario' && entity.kind !== 'scenario-step')
    .map(entity => entity.id));
  assert.deepEqual(view.nodes.map(node => node.entityId).sort(), [...eligibleIds].sort());
  for (const node of view.nodes) {
    const expected = snapshot.ir.facts.filter(fact => fact.object.kind === 'entity'
      && eligibleIds.has(fact.subject) && eligibleIds.has(fact.object.entityId)
      && (fact.subject === node.entityId || fact.object.entityId === node.entityId))
      .map(fact => fact.id);
    assert.deepEqual(node.references.filter((ref) => ref.kind === 'fact').map((ref) => ref.ref).sort(), [...new Set(expected)].sort());
  }
});

test('scenario projection keeps local control flow and global operation evidence', () => {
  const ir = viewIR(2);
  const global = addFact(ir, 'operation:fixture:0', 'READS', 'field:fixture:1.value');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:fixture:0');
  assert.ok(view.nodes.find((node) => node.id === 'scenario:fixture:0#step:a')!.badges.includes('entry'));

  assert.ok(view.nodes.find((node) => node.id === 'scenario:fixture:0#step:a')!.badges.includes('async'));
  assert.ok(view.nodes.find((node) => node.id === 'scenario:fixture:0#step:b')!.badges.includes('retry'));
  const retry = view.edges.find((edge) => edge.relation === 'RETRIES')!;
  assert.deepEqual(retry.value, { maxAttempts: 3 }); assert.equal(retry.label, 'retries up to 3');
  assert.ok(retry.references.some((ref) => ref.kind === 'scenario-step' && ref.ref === 'scenario:fixture:0#step:b'));

  const operation = view.nodes.find((node) => node.id === 'operation:fixture:0')!;
  assert.ok(operation.references.some((ref) => ref.kind === 'fact' && ref.ref === global.id));
});

test('scenario self-edges remain visible once and suppress an entry badge when they precede the step', () => {
  const ir = viewIR(); const fact = addFact(ir, 'scenario:fixture:0#step:a', 'PRECEDES', 'scenario:fixture:0#step:a');
  const view = projectScenarioView(projectionSnapshot(ir), 'scenario:fixture:0');
  const step = view.nodes.find((node) => node.id === 'scenario:fixture:0#step:a')!;
  assert.equal(step.badges.includes('entry'), false);
  assert.equal(step.references.filter((ref) => ref.kind === 'fact' && ref.ref === fact.id).length, 1);
});

test('state projection follows incoming accesses to state and backing fields, not unrelated targets', () => {
  const ir = viewIR(2); const foreign = addFact(ir, 'operation:fixture:1', 'MUTATES', 'field:fixture:0.value');
  const view = projectStateView(projectionSnapshot(ir), 'state:fixture:0');
  assert.ok(view.edges.some((edge) => edge.source === 'operation:fixture:1' && edge.target === 'field:fixture:0.value'));
  assert.ok(semanticViewFactIds(view).includes(foreign.id));
  assert.equal(view.nodes.some((node) => node.id === 'state:fixture:1'), false);
});

test('view-set selects every scenario and state with immutable output', () => {
  const snapshot = projectionSnapshot(viewIR(3));
  const result = buildSemanticViewSet(snapshot);
  assert.deepEqual(result.views.map(view => view.viewKind === 'architecture' ? [view.viewKind] : [view.viewKind, view.subject]), [
    ['architecture'],
    ['scenario', 'scenario:fixture:0'], ['scenario', 'scenario:fixture:1'], ['scenario', 'scenario:fixture:2'],
    ['state', 'state:fixture:0'], ['state', 'state:fixture:1'], ['state', 'state:fixture:2']
  ]);
  assert.deepEqual(result.views[0]!.nodes.filter(node => node.entityKind === 'app').map(node => node.entityId), ['app:fixture']);
  assert.equal(result.formatVersion, '1');
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.views));
  assert.ok(Object.isFrozen(result.views[0]?.nodes));
});

test('additional disjoint domains cannot change an already selected scenario or state view', () => {
  const first = projectionSnapshot(viewIR()); const expanded = projectionSnapshot(viewIR(20));
  // Evidence validity tracks the whole graph revision; all local content must remain unchanged.
  const localContent = (view: unknown) => JSON.stringify(view, (key, value) => key === 'validFromRevision' ? undefined : value);
  assert.equal(localContent(projectScenarioView(first, 'scenario:fixture:0')), localContent(projectScenarioView(expanded, 'scenario:fixture:0')));
  assert.equal(localContent(projectStateView(first, 'state:fixture:0')), localContent(projectStateView(expanded, 'state:fixture:0')));
});
