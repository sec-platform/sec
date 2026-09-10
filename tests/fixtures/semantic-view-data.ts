import type { SemanticEntity, SemanticEntityKind } from '../../src/semantic/engineering-ir/contract/entity-types.ts';
import type { FactAssertion, SemanticFact, SemanticPredicate, SemanticValue } from '../../src/semantic/engineering-ir/contract/fact-types.ts';
import type { EngineeringIR } from '../../src/semantic/engineering-ir/contract/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../src/semantic/engineering-ir/contract/validated-types.ts';
import { deepFreeze } from '../../src/system-architecture/foundation/runtime/canonical.ts';

export function entity(id: string, kind: SemanticEntityKind, label = id): SemanticEntity {
  return { id, kind, label, attributes: [] };
}

function assertion(id = 'assertion:0', confidence = 0.75): FactAssertion {
  return {
    id, authority: 'authoritative', confidence,
    provenance: [{ kind: 'contract', sourceId: 'fixture' }],
    evidence: [{ kind: 'source', ref: 'fixture' }], validFromRevision: 'semantic:fixture'
  };
}

export function emptyIR(): EngineeringIR {
  return {
    formatVersion: '2', graphId: 'graph:fixture', inputRevision: 'input:fixture',
    semanticRevision: 'semantic:fixture', appId: 'app:fixture',
    entities: [entity('app:fixture', 'app')], facts: [], scenarios: []
  };
}

export function addFact(
  ir: EngineeringIR, subject: string, predicate: SemanticPredicate,
  target: string | { value: SemanticValue }
): SemanticFact {
  const id = `fact:${String(ir.facts.length).padStart(8, '0')}`;
  const claim = assertion(`assertion:${id}`);
  if (ir.facts.length % 3 === 0) { claim.authority = 'inferred'; claim.confidence = 0.5; }
  const fact: SemanticFact = {
    id, subject, predicate, assertions: [claim],
    object: typeof target === 'string' ? { kind: 'entity', entityId: target } : { kind: 'value', value: target.value }
  };
  ir.facts.push(fact);
  return fact;
}

export function viewIR(groups = 1): EngineeringIR {
  const ir = emptyIR();
  for (let i = 0; i < groups; i += 1) {
    const owner = `responsibility:${i}`; const state = `state:${i}`;
    const field = `field:${i}.value`; const operation = `operation:${i}`;
    const scenario = `scenario:${i}`; const first = `${scenario}#step:a`; const second = `${scenario}#step:b`;
    const effect = `effect:${i}`; const permission = `permission:${i}`;
    ir.entities.push(entity(owner, 'responsibility'), entity(state, 'state'), entity(field, 'field'),
      entity(operation, 'operation'), entity(scenario, 'scenario'), entity(first, 'scenario-step'),
      entity(second, 'scenario-step'), entity(effect, 'effect'), entity(permission, 'permission'));
    ir.entities[ir.entities.length - 6]!.attributes.push({ key: 'role', value: `role:${i}` });
    addFact(ir, ir.appId, 'CONTAINS', owner);
    addFact(ir, owner, 'OWNS', state); addFact(ir, state, 'DECLARES', field);
    addFact(ir, operation, 'READS', state); addFact(ir, operation, 'WRITES', field);
    addFact(ir, operation, 'PERFORMS_EFFECT', effect); addFact(ir, operation, 'REQUIRES_PERMISSION', permission);
    addFact(ir, state, 'TRANSITIONS_TO', { value: { from: 'open', to: 'closed', by: operation } });
    addFact(ir, scenario, 'CONTAINS', first); addFact(ir, scenario, 'CONTAINS', second);
    addFact(ir, scenario, 'INVOKES', operation); addFact(ir, first, 'INVOKES', operation);
    addFact(ir, first, 'PRECEDES', second); addFact(ir, first, 'AWAITS', operation);
    addFact(ir, second, 'RETRIES', { value: { maxAttempts: 3 } }); addFact(ir, second, 'HANDLES', first);
  }
  return ir;
}

/** Synthetic data for pure read projections, not a validator-issued authority. */
export function projectionSnapshot(ir: EngineeringIR, frozen = true): ValidatedEngineeringIRSnapshot {
  return (frozen ? Object.freeze({ ir: deepFreeze(ir) }) : { ir }) as ValidatedEngineeringIRSnapshot;
}
