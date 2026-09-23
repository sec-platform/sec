import type { SemanticEntity, SemanticEntityKind } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact, SemanticPredicate } from '../../semantics/engineering-ir/fact-types.ts';
import type { EngineeringIR } from '../../semantics/engineering-ir/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';

export interface EngineeringIRIndex {
  entityById: ReadonlyMap<string, SemanticEntity>;
  entitiesByKind: ReadonlyMap<SemanticEntityKind, readonly SemanticEntity[]>;
  factById: ReadonlyMap<string, SemanticFact>;
  factsByPredicate: ReadonlyMap<SemanticPredicate, readonly SemanticFact[]>;
  outgoingFactsBySubject: ReadonlyMap<string, readonly SemanticFact[]>;
  incomingFactsByEntityObject: ReadonlyMap<string, readonly SemanticFact[]>;
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function indexEngineeringIR(ir: EngineeringIR): EngineeringIRIndex {
  const { entities, facts } = ir;
  const entityById = new Map<string, SemanticEntity>();
  const entitiesByKind = new Map<SemanticEntityKind, SemanticEntity[]>();
  const factById = new Map<string, SemanticFact>();
  const factsByPredicate = new Map<SemanticPredicate, SemanticFact[]>();
  const outgoingFactsBySubject = new Map<string, SemanticFact[]>();
  const incomingFactsByEntityObject = new Map<string, SemanticFact[]>();

  for (let position = 0; position < entities.length; position += 1) {
    const entity = entities[position]!;
    entityById.set(entity.id, entity);
    pushMapValue(entitiesByKind, entity.kind, entity);
  }

  for (let position = 0; position < facts.length; position += 1) {
    const fact = facts[position]!;
    factById.set(fact.id, fact);
    pushMapValue(factsByPredicate, fact.predicate, fact);
    pushMapValue(outgoingFactsBySubject, fact.subject, fact);
    if (fact.object.kind === 'entity') {
      pushMapValue(incomingFactsByEntityObject, fact.object.entityId, fact);
    }
  }

  return {
    entityById,
    entitiesByKind,
    factById,
    factsByPredicate,
    outgoingFactsBySubject,
    incomingFactsByEntityObject
  };
}

/** The mutable Map never escapes through iteration or forEach's third argument. */
class IndexMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #source: ReadonlyMap<Key, Value>;

  constructor(source: ReadonlyMap<Key, Value>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number { return this.#source.size; }
  get(key: Key): Value | undefined { return this.#source.get(key); }
  has(key: Key): boolean { return this.#source.has(key); }
  entries() { return this.#source.entries(); }
  keys() { return this.#source.keys(); }
  values() { return this.#source.values(); }
  [Symbol.iterator]() { return this.#source[Symbol.iterator](); }
  forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    if (typeof callback !== 'function') throw new TypeError('IndexMap forEach callback must be callable');
    this.#source.forEach((value, key) => Reflect.apply(callback, thisArg, [value, key, this]));
  }
}
Object.freeze(IndexMap.prototype);

function immutableDataField(value: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value');
}

/**
 * Only index keys and collection membership must be immutable. Assertions and
 * attributes are read through their original records, never memoized here.
 * Frozen accessor properties are not evidence of a stable value.
 */
function hasImmutableIndexKeys(ir: EngineeringIR): boolean {
  if (!Object.isFrozen(ir) || !immutableDataField(ir, 'entities') || !immutableDataField(ir, 'facts')) return false;
  for (const collection of [ir.entities, ir.facts]) {
    if (!Array.isArray(collection) || !Object.isFrozen(collection)) return false;
    for (let position = 0; position < collection.length; position += 1) {
      if (!immutableDataField(collection, position)) return false;
    }
  }
  for (let position = 0; position < ir.entities.length; position += 1) {
    const entity = ir.entities[position]!;
    if (!Object.isFrozen(entity) || !immutableDataField(entity, 'id') || !immutableDataField(entity, 'kind')) return false;
  }
  for (let position = 0; position < ir.facts.length; position += 1) {
    const fact = ir.facts[position]!;
    if (!Object.isFrozen(fact) || !immutableDataField(fact, 'id') || !immutableDataField(fact, 'predicate')
        || !immutableDataField(fact, 'subject') || !immutableDataField(fact, 'object')) return false;
    const object = fact.object;
    if (!Object.isFrozen(object) || !immutableDataField(object, 'kind')
        || (object.kind === 'entity' && !immutableDataField(object, 'entityId'))) return false;
  }
  return true;
}

function protectIndex(index: EngineeringIRIndex): EngineeringIRIndex {
  for (const group of [index.entitiesByKind, index.factsByPredicate, index.outgoingFactsBySubject, index.incomingFactsByEntityObject]) {
    for (const values of group.values()) Object.freeze(values);
  }
  return Object.freeze({
    entityById: new IndexMap(index.entityById),
    entitiesByKind: new IndexMap(index.entitiesByKind),
    factById: new IndexMap(index.factById),
    factsByPredicate: new IndexMap(index.factsByPredicate),
    outgoingFactsBySubject: new IndexMap(index.outgoingFactsBySubject),
    incomingFactsByEntityObject: new IndexMap(index.incomingFactsByEntityObject)
  });
}

// Object identity, not a caller-supplied revision string, binds this disposable
// acceleration. Weak keys do not keep retired IR generations alive by themselves.
const immutableIndexes = new WeakMap<EngineeringIR, EngineeringIRIndex>();

export function indexValidatedEngineeringIR(
  snapshot: ValidatedEngineeringIRSnapshot
): EngineeringIRIndex {
  const ir = snapshot.ir;
  const existing = immutableIndexes.get(ir);
  if (existing !== undefined) return { ...existing };
  if (!hasImmutableIndexKeys(ir)) return indexEngineeringIR(ir);
  const index = protectIndex(indexEngineeringIR(ir));
  immutableIndexes.set(ir, index);
  // Keep the historically writable top-level result local to this caller.
  // Reassigning one of its fields must not replace another reader's index.
  return { ...index };
}
