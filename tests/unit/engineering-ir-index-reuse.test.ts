import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { indexEngineeringIR, indexValidatedEngineeringIR } from '../../src/compiler/ir/index-engineering-ir.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import type { SemanticEntity } from '../../src/semantic/engineering-ir/contract/entity-types.ts';
import { addFact, emptyIR, entity, projectionSnapshot, viewIR } from '../fixtures/semantic-view-data.ts';

test('immutable IR generations share one read index across snapshot wrappers', () => {
  const snapshot = projectionSnapshot(viewIR());
  const first = indexValidatedEngineeringIR(snapshot);
  assert.equal(indexValidatedEngineeringIR(snapshot).entityById, first.entityById);
  assert.equal(indexValidatedEngineeringIR({ ...snapshot }).entityById, first.entityById);
  assert.equal(first.entityById.get(snapshot.ir.appId), snapshot.ir.entities[0]);
});

test('revision strings cannot alias different immutable input generations', () => {
  const first = projectionSnapshot(viewIR()); const second = projectionSnapshot(viewIR(2));
  assert.equal(first.ir.semanticRevision, second.ir.semanticRevision);
  const a = indexValidatedEngineeringIR(first); const b = indexValidatedEngineeringIR(second);
  assert.notEqual(a, b); assert.equal(a.entityById.has('state:1'), false); assert.equal(b.entityById.has('state:1'), true);
});

test('raw IR indexing remains fresh and does not freeze the caller data', () => {
  const ir = emptyIR(); const first = indexEngineeringIR(ir);
  ir.entities.push(entity('state:new', 'state'));
  const second = indexEngineeringIR(ir);
  assert.notEqual(first, second); assert.equal(first.entityById.has('state:new'), false);
  assert.equal(second.entityById.has('state:new'), true); assert.equal(Object.isFrozen(ir), false);
});

test('mutable snapshot data is rebuilt instead of becoming a stale cache', () => {
  const snapshot = projectionSnapshot(emptyIR(), false); const first = indexValidatedEngineeringIR(snapshot);
  snapshot.ir.entities.push(entity('state:new', 'state'));
  const second = indexValidatedEngineeringIR(snapshot);
  assert.notEqual(first, second); assert.equal(second.entityById.has('state:new'), true);
});

test('a frozen root with mutable entity membership remains uncached', () => {
  const ir = Object.freeze(emptyIR()); const snapshot = projectionSnapshot(ir, false);
  const first = indexValidatedEngineeringIR(snapshot); ir.entities.push(entity('state:new', 'state'));
  assert.notEqual(indexValidatedEngineeringIR(snapshot), first);
  assert.equal(indexValidatedEngineeringIR(snapshot).entityById.has('state:new'), true);
});

test('mutable entity keys cannot poison a frozen collection index', () => {
  const ir = emptyIR(); const e = ir.entities[0]!;
  Object.freeze(ir.entities); Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false); indexValidatedEngineeringIR(snapshot);
  e.id = 'app:renamed'; e.kind = 'block';
  const index = indexValidatedEngineeringIR(snapshot);
  assert.equal(index.entityById.has('app:fixture'), false);
  assert.equal(index.entitiesByKind.get('block')?.[0], e);
});

test('mutable fact target objects remain uncached even under frozen facts', () => {
  const ir = viewIR(); const fact = ir.facts.find((entry) => entry.predicate === 'READS')!;
  const object = fact.object;
  ir.entities.forEach(Object.freeze); ir.facts.forEach(Object.freeze);
  Object.freeze(ir.entities); Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false); const first = indexValidatedEngineeringIR(snapshot);
  assert.equal(object.kind, 'entity'); if (object.kind !== 'entity') assert.fail();
  object.entityId = 'state:changed';
  const second = indexValidatedEngineeringIR(snapshot);
  assert.notEqual(first, second);
  assert.equal(second.incomingFactsByEntityObject.get('state:changed')?.[0], fact);
});

test('frozen entity accessors are not mistaken for stable index keys', () => {
  const ir = emptyIR(); let id = ir.appId; let reads = 0;
  Object.defineProperty(ir.entities[0], 'id', { get() { reads += 1; return id; }, enumerable: true });
  Object.freeze(ir.entities[0]); Object.freeze(ir.entities); Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false);
  indexValidatedEngineeringIR(snapshot); id = 'app:changed';
  assert.equal(indexValidatedEngineeringIR(snapshot).entityById.has(id), true);
  assert.equal(reads, 2);
});

test('frozen collection accessors are not mistaken for fixed membership', () => {
  const ir = emptyIR(); let chosen = Object.freeze(entity('app:first', 'app')); let reads = 0;
  Object.defineProperty(ir.entities, 0, { get() { reads += 1; return chosen; }, enumerable: true });
  Object.freeze(ir.entities); Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false); const first = indexValidatedEngineeringIR(snapshot);
  chosen = Object.freeze(entity('app:second', 'app'));
  const second = indexValidatedEngineeringIR(snapshot);
  assert.notEqual(first, second); assert.equal(second.entityById.get(chosen.id), chosen); assert.equal(reads, 2);
});

test('frozen IR collection properties implemented as getters stay fresh', () => {
  const ir = emptyIR(); let entities = Object.freeze([Object.freeze(entity('app:first', 'app'))]);
  Object.defineProperty(ir, 'entities', { get() { return entities; }, enumerable: true });
  Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false); const first = indexValidatedEngineeringIR(snapshot);
  entities = Object.freeze([Object.freeze(entity('app:second', 'app'))]);
  const second = indexValidatedEngineeringIR(snapshot);
  assert.notEqual(first, second); assert.equal(second.entityById.has('app:second'), true);
});

test('protected shared maps do not expose mutators or permit prototype replacement', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  for (const map of Object.values(index)) {
    for (const key of ['set', 'delete', 'clear']) assert.equal(Reflect.get(map, key), undefined);
    assert.throws(() => Map.prototype.clear.call(map), TypeError);
    assert.equal(Object.isFrozen(map), true);
  }
  assert.equal(Reflect.set(Object.getPrototypeOf(index.entityById), 'get', () => null), false);
});

test('cached membership buckets cannot be modified through any query route', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  for (const map of [index.entitiesByKind, index.factsByPredicate, index.outgoingFactsBySubject, index.incomingFactsByEntityObject]) {
    for (const bucket of map.values()) {
      assert.ok(Object.isFrozen(bucket)); assert.equal(Reflect.set(bucket, 0, null), false);
    }
  }
});

test('ReadonlyMap forEach preserves thisArg and never leaks its mutable backing Map', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR())); const context = {};
  const seen: string[] = [];
  index.entityById.forEach(function (this: object, value, key, map) {
    assert.equal(this, context); assert.equal(map, index.entityById);
    assert.equal(value, index.entityById.get(key)); assert.equal(Reflect.get(map, 'set'), undefined); seen.push(key);
  }, context);
  assert.deepEqual(seen, [...index.entityById.keys()]);
});

test('read index iterators support native Map copies with detached entry tuples', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  const copy = new Map(index.entityById); assert.equal(copy.size, index.entityById.size);
  const pair = index.entityById.entries().next().value!;
  const original = pair[0]; pair[0] = 'changed'; pair[1] = entity('changed', 'app');
  assert.equal(index.entityById.has(original), true); assert.equal(index.entityById.has('changed'), false);
  assert.deepEqual([...copy.values()], [...index.entityById.values()]);
});

test('indexed keys may be stable while nonindexed payload remains live', () => {
  const ir = viewIR(); ir.entities.forEach(Object.freeze);
  ir.facts.forEach((fact) => { Object.freeze(fact.object); Object.freeze(fact); });
  Object.freeze(ir.entities); Object.freeze(ir.facts); Object.freeze(ir);
  const snapshot = projectionSnapshot(ir, false); const index = indexValidatedEngineeringIR(snapshot);
  const op = ir.entities.find((e) => e.id === 'operation:0')!;
  op.attributes.splice(0, op.attributes.length, { key: 'role', value: 'updated' });
  assert.equal(indexValidatedEngineeringIR(snapshot).factById, index.factById);
  assert.equal(projectArchitectureView(snapshot).nodes.find((node) => node.id === op.id)?.role, 'updated');
});

test('an empty immutable graph still provides the complete readonly query contract', () => {
  const ir = emptyIR(); ir.entities = [];
  const index = indexValidatedEngineeringIR(projectionSnapshot(ir));
  for (const map of Object.values(index)) {
    assert.equal(map.size, 0); assert.deepEqual([...map], []); assert.equal(map.has('missing' as never), false);
  }
});

test('self edges and repeated input identities retain existing index occurrence semantics', () => {
  const ir = emptyIR(); const newer: SemanticEntity = { ...ir.entities[0]!, label: 'new' };
  ir.entities.push(newer); const a = addFact(ir, ir.appId, 'CONTAINS', ir.appId);
  const b = { ...a, assertions: [] }; ir.facts.push(b);
  const index = indexEngineeringIR(ir);
  assert.equal(index.entityById.get(ir.appId), newer); assert.equal(index.factById.get(a.id), b);
  assert.equal(index.entitiesByKind.get('app')?.length, 2);
  assert.deepEqual(index.outgoingFactsBySubject.get(ir.appId), [a, b]);
  assert.deepEqual(index.incomingFactsByEntityObject.get(ir.appId), [a, b]);
});

test('separate mutable read indexes cannot contaminate the immutable cache', () => {
  const snapshot = projectionSnapshot(viewIR()); const cached = indexValidatedEngineeringIR(snapshot);
  const temporary = indexEngineeringIR(snapshot.ir);
  Map.prototype.clear.call(temporary.entityById);
  assert.ok(cached.entityById.size > 0);
  assert.equal(indexValidatedEngineeringIR(snapshot).entityById, cached.entityById);
});


test('writable result fields remain caller-local while the underlying read indexes are shared', () => {
  const snapshot = projectionSnapshot(viewIR());
  const first = indexValidatedEngineeringIR(snapshot);
  const second = indexValidatedEngineeringIR(snapshot);
  assert.notEqual(first, second);
  assert.equal(first.entityById, second.entityById);
  first.entityById = new Map();
  assert.equal(first.entityById.size, 0);
  assert.ok(second.entityById.size > 0);
  assert.equal(indexValidatedEngineeringIR(snapshot).entityById, second.entityById);
});
