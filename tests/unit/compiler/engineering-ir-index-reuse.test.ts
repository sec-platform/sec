import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { indexEngineeringIR, indexValidatedEngineeringIR } from '../../../src/compiler/ir/index-engineering-ir.ts';
import type { SemanticEntity } from '../../../src/semantics/engineering-ir/entity-types.ts';
import { addFact, emptyIR, entity, projectionSnapshot, viewIR } from '../../fixtures/semantic-view-data.ts';

// Public EngineeringIRIndex surface, declared independently of Object.values(index).
const READ_INDEX_FIELDS = [
  'entityById', 'entitiesByKind', 'factById', 'factsByPredicate',
  'outgoingFactsBySubject', 'incomingFactsByEntityObject'
] as const;

test('revision strings cannot alias different immutable input generations', () => {
  const first = projectionSnapshot(viewIR()); const second = projectionSnapshot(viewIR(2));
  assert.equal(first.ir.semanticRevision, second.ir.semanticRevision);
  const a = indexValidatedEngineeringIR(first); const b = indexValidatedEngineeringIR(second);
  assert.equal(a.entityById.has('state:1'), false); assert.equal(b.entityById.has('state:1'), true);
});

test('cached maps and their membership buckets prevent caller mutation', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  for (const field of READ_INDEX_FIELDS) {
    const map = index[field];
    for (const key of ['set', 'delete', 'clear']) assert.equal(Reflect.get(map, key), undefined);
    assert.throws(() => Map.prototype.clear.call(map), TypeError);
    assert.equal(Object.isFrozen(map), true);
  }
  assert.equal(Reflect.set(Object.getPrototypeOf(index.entityById), 'get', () => null), false);
  for (const map of [
    index.entitiesByKind, index.factsByPredicate,
    index.outgoingFactsBySubject, index.incomingFactsByEntityObject
  ]) {
    for (const bucket of map.values()) {
      assert.ok(Object.isFrozen(bucket));
      assert.equal(Reflect.set(bucket, 0, null), false);
    }
  }
});

test('read index iterators support native Map copies with detached entry tuples', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  const copy = new Map(index.entityById); assert.equal(copy.size, index.entityById.size);
  const pair = index.entityById.entries().next().value!;
  const original = pair[0]; pair[0] = 'changed'; pair[1] = entity('changed', 'app');
  assert.equal(index.entityById.has(original), true); assert.equal(index.entityById.has('changed'), false);
  assert.deepEqual([...copy.values()], [...index.entityById.values()]);
});

test('an empty immutable graph still provides the complete readonly query contract', () => {
  const ir = emptyIR(); ir.entities = [];
  const index = indexValidatedEngineeringIR(projectionSnapshot(ir));
  for (const field of READ_INDEX_FIELDS) {
    const map = index[field];
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

test('caller-local result replacement and mutable indexing cannot corrupt cached readers', () => {
  const snapshot = projectionSnapshot(viewIR());
  const first = indexValidatedEngineeringIR(snapshot);
  const second = indexValidatedEngineeringIR(snapshot);
  const expected = snapshot.ir.entities.map(entity => [entity.id, entity.kind]);
  const expectMembers = (index: ReturnType<typeof indexValidatedEngineeringIR>) =>
    assert.deepEqual([...index.entityById].map(([id, entity]) => [id, entity.kind]), expected);

  // A disposable non-validated index exposes native mutable Maps, but this
  // mutation cannot flow into either existing or subsequent validated readers.
  const temporary = indexEngineeringIR(snapshot.ir);
  Map.prototype.clear.call(temporary.entityById);
  assert.equal(temporary.entityById.size, 0);
  expectMembers(first);
  expectMembers(second);

  // The returned record is caller-local. Public content survives reassigning
  // one record field; sharing an exact internal Map object is not a contract.
  first.entityById = new Map();
  assert.equal(first.entityById.size, 0);
  expectMembers(second);
  expectMembers(indexValidatedEngineeringIR(snapshot));
  expectMembers(indexValidatedEngineeringIR({ ...snapshot }));
});

test('empty read maps reject noncallable forEach callbacks like a native map', () => {
  const ir = emptyIR(); ir.entities = [];
  const index = indexValidatedEngineeringIR(projectionSnapshot(ir));
  assert.throws(() => index.entityById.forEach(null as never), TypeError);
});

test('forEach invokes the callback itself rather than its replaceable call property', () => {
  const index = indexValidatedEngineeringIR(projectionSnapshot(viewIR()));
  const receiver = {}; const seen: string[] = []; let hookCalled = false;
  const callback = function (this: object, value: SemanticEntity, key: string, map: ReadonlyMap<string, SemanticEntity>): void {
    seen.push(key); assert.equal(this, receiver); assert.equal(map, index.entityById);
    assert.equal(map.get(key), value); assert.equal(Reflect.get(map, 'set'), undefined);
  };
  Object.defineProperty(callback, 'call', { value: () => { hookCalled = true; } });
  index.entityById.forEach(callback, receiver);
  assert.deepEqual(seen, [...index.entityById.keys()]); assert.equal(hookCalled, false);
});
