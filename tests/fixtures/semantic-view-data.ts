import { buildEngineeringIR } from '../../src/compiler/ir/build-engineering-ir.ts';
import { addFact as storeFact } from '../../src/compiler/ir/ir-fact-store.ts';
import { digest, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { deriveScenarioDefinitions } from '../../src/compiler/ir/scenario-facts.ts';
import { validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import type { SemanticEntity, SemanticEntityKind } from '../../src/semantics/engineering-ir/entity-types.ts';
import type { SemanticFact, SemanticPredicate, SemanticValue } from '../../src/semantics/engineering-ir/fact-types.ts';
import type { EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../src/semantics/engineering-ir/validated-types.ts';

function entity(id: string, kind: SemanticEntityKind): SemanticEntity {
  return { id, kind, label: id, attributes: [] };
}

const input = { app: { id: 'fixture', name: 'fixture' }, resolvedBlocks: [], manifests: [],
  acceptanceIds: [], policyDeclarations: [] };

export function addFact(
  ir: EngineeringIR, subject: string, predicate: SemanticPredicate,
  target: string | { value: SemanticValue }
): SemanticFact {
  const facts = new Map(ir.facts.map(fact => [fact.id, fact]));
  const inferred = ir.facts.length % 3 === 0;
  const id = storeFact(facts, { subject, predicate,
    object: typeof target === 'string' ? { kind: 'entity', entityId: target } : { kind: 'value', value: target.value },
    authority: inferred ? 'inferred' : 'authoritative', confidence: inferred ? 0.5 : 0.75,
    provenance: [{ kind: 'contract', sourceId: 'fixture' }], evidence: [{ kind: 'source', ref: 'fixture' }] });
  ir.facts = [...facts.values()];
  return facts.get(id)!;
}

export function viewIR(groups = 1): EngineeringIR {
  const ir = buildEngineeringIR(input);
  for (let i = 0; i < groups; i += 1) {
    const owner = `responsibility:fixture:${i}`; const state = `state:fixture:${i}`;
    const field = `field:fixture:${i}.value`; const operation = `operation:fixture:${i}`;
    const scenario = `scenario:fixture:${i}`; const first = `${scenario}#step:a`; const second = `${scenario}#step:b`;
    const effect = `effect:fixture:${i}`; const permission = `permission:fixture:${i}`;
    ir.entities.push(entity(owner, 'responsibility'), entity(state, 'state'), entity(field, 'field'),
      entity(operation, 'operation'), entity(scenario, 'scenario'), entity(first, 'scenario-step'),
      entity(second, 'scenario-step'), entity(effect, 'effect'), entity(permission, 'permission'));
    addFact(ir, owner, 'OWNS', state); addFact(ir, state, 'DECLARES', field);
    addFact(ir, operation, 'MUTATES', state); addFact(ir, operation, 'WRITES', field);
    addFact(ir, operation, 'PERFORMS_EFFECT', effect); addFact(ir, operation, 'REQUIRES_PERMISSION', permission);
    addFact(ir, state, 'TRANSITIONS_TO', { value: { from: 'open', to: 'closed', by: operation } });
    addFact(ir, scenario, 'CONTAINS', first); addFact(ir, scenario, 'CONTAINS', second);
    addFact(ir, scenario, 'INVOKES', operation); addFact(ir, first, 'INVOKES', operation); addFact(ir, second, 'INVOKES', operation);
    addFact(ir, first, 'PRECEDES', second); addFact(ir, first, 'AWAITS', operation);
    addFact(ir, second, 'RETRIES', { value: { maxAttempts: 3 } }); addFact(ir, second, 'HANDLES', first);
  }
  return ir;
}

/** Issue every projection fixture through the real cached-IR admission boundary. */
export function projectionSnapshot(ir: EngineeringIR): ValidatedEngineeringIRSnapshot {
  ir.entities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ir.facts.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  ir.scenarios = deriveScenarioDefinitions(ir.entities, ir.facts);
  ir.semanticRevision = `sha256:${digest(semanticRevisionPayload(ir.graphId, ir.appId, ir.entities, ir.facts, ir.scenarios))}`;
  for (const fact of ir.facts) for (const assertion of fact.assertions) assertion.validFromRevision = ir.semanticRevision;
  return validateEngineeringIR(ir, input);
}
