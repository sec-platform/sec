import type {
  EngineeringIR,
  SemanticEntity,
  SemanticEntityKind,
  SemanticFact,
  SemanticPredicate
} from '../../shared/engineering-ir-types.ts';

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
  const entityById = new Map(ir.entities.map((entity) => [entity.id, entity]));
  const entitiesByKind = new Map<SemanticEntityKind, SemanticEntity[]>();
  const factById = new Map(ir.facts.map((fact) => [fact.id, fact]));
  const factsByPredicate = new Map<SemanticPredicate, SemanticFact[]>();
  const outgoingFactsBySubject = new Map<string, SemanticFact[]>();
  const incomingFactsByEntityObject = new Map<string, SemanticFact[]>();

  for (const entity of ir.entities) {
    pushMapValue(entitiesByKind, entity.kind, entity);
  }

  for (const fact of ir.facts) {
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
