import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { addFact } from '../../src/compiler/ir/ir-fact-store.ts';
import { rawSha256Hex, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectStateView } from '../../src/compiler/projection/project-state-view.ts';
import type { LoadedSemanticContract, SemanticContractOperation } from '../../src/semantics/definitions/types.ts';
import type { SemanticFact } from '../../src/semantics/engineering-ir/fact-types.ts';
import type { EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';

function input(): BuildEngineeringIRInput {
  return {
    app: { id: 'state-projection', name: 'state-projection' },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry'
    }],
    manifests: [{
      blockId: 'item/basic',
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
    }],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contract()]
  };
}

function operation(id: string): SemanticContractOperation {
  return {
    id,
    responsibility: 'ItemStateMachine',
    inputs: ['Item'],
    output: 'Item',
    reads: ['Item'],
    writes: [],
    mutates: ['Item.status'],
    requiresPolicies: [],
    requiresPermissions: [],
    performsEffects: [],
    emits: [],
    invokes: [],
    awaits: []
  };
}

function contract(): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath: 'registry/item.basic/contracts/item.yaml',
    contract: {
      formatVersion: '1',
      id: 'item-core',
      namespace: 'item',
      entities: [{
        id: 'Item',
        fields: [{ id: 'status', type: 'ItemStatus', required: true, mutable: true }]
      }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemStateMachine',
        values: ['open', 'closed'],
        transitions: [
          { from: 'open', to: 'closed', by: 'closeItem' },
          { from: 'open', to: 'closed', by: 'forceCloseItem' }
        ]
      }],
      responsibilities: [{
        id: 'ItemStateMachine',
        role: 'Own item status',
        owns: ['Item.status'],
        implements: ['closeItem', 'forceCloseItem'],
        dependsOn: []
      }],
      operations: [operation('closeItem'), operation('forceCloseItem')],
      events: [],
      policies: [],
      permissions: [],
      effects: [],
      scenarios: []
    }
  };
}

function withRevision(fact: SemanticFact, revision: string): SemanticFact {
  return {
    ...fact,
    assertions: fact.assertions.map((assertion) => ({ ...assertion, validFromRevision: revision }))
  };
}

test('State View preserves same-endpoint transition Fact identity and inferred badges', () => {
  const buildInput = input();
  const base = buildEngineeringIR(buildInput);
  const facts = new Map(base.facts.map((fact) => [fact.id, fact]));
  const inferredTransition = base.facts.find((fact) =>
    fact.subject === 'state:item:item-status' &&
    fact.predicate === 'TRANSITIONS_TO' &&
    fact.object.kind === 'value' &&
    JSON.stringify(fact.object.value).includes('forceCloseItem')
  )!;
  addFact(facts, {
    subject: inferredTransition.subject,
    predicate: inferredTransition.predicate,
    object: inferredTransition.object,
    authority: 'inferred',
    confidence: 0.75,
    provenance: [{ kind: 'ai', sourceId: 'state-transition-inference' }]
  });

  const pendingFacts = [...facts.values()].sort((left, right) => left.id.localeCompare(right.id));
  const semanticRevision = `sha256:${rawSha256Hex(semanticRevisionPayload(
    base.graphId,
    base.appId,
    base.entities,
    pendingFacts,
    base.scenarios
  ))}`;
  const ir: EngineeringIR = {
    ...base,
    semanticRevision,
    facts: pendingFacts.map((fact) => withRevision(fact, semanticRevision))
  };
  const snapshot = validateEngineeringIR(ir, buildInput);
  const view = projectStateView(snapshot, 'state:item:item-status');
  const transitions = view.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO');

  expect(transitions).toHaveLength(2);
  expect(new Set(transitions.map((edge) => edge.id)).size).toBe(2);
  expect(transitions.every((edge) => edge.id.startsWith('edge:fact:fact:'))).toBe(true);
  expect(transitions.map((edge) => edge.label).sort()).toEqual([
    'open → closed by closeItem',
    'open → closed by forceCloseItem'
  ]);
  expect(transitions.map((edge) => edge.value)).toEqual(expect.arrayContaining([
    { by: 'operation:item:closeItem', from: 'open', to: 'closed' },
    { by: 'operation:item:forceCloseItem', from: 'open', to: 'closed' }
  ]));
  expect(transitions.every((edge) =>
    edge.references.filter((reference) => reference.kind === 'fact').length === 1
  )).toBe(true);
  expect(view.nodes.find((node) => node.entityId === 'state:item:item-status')?.badges).toContain('inferred');
});
