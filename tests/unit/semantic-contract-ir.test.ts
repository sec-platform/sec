import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../platform/compiler/index.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';

function baseInput(): BuildEngineeringIRInput {
  return {
    app: { name: 'semantic-app' },
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
      manifest: {
        requires: [],
        provides: ['item/write'],
        pins: { inputs: [], outputs: [] }
      }
    }],
    slotTasks: [],
    acceptanceIds: ['item_can_transition'],
    policyIds: [],
    provenanceArtifacts: []
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
        fields: [
          { id: 'id', type: 'number', required: true, mutable: false },
          { id: 'status', type: 'ItemStatus', required: true, mutable: true }
        ]
      }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemStateMachine',
        values: ['open', 'closed'],
        transitions: [{ from: 'open', to: 'closed', by: 'closeItem' }]
      }],
      responsibilities: [{
        id: 'ItemStateMachine',
        role: 'Own item status',
        owns: ['Item.status'],
        implements: ['closeItem'],
        dependsOn: []
      }],
      operations: [{
        id: 'closeItem',
        responsibility: 'ItemStateMachine',
        inputs: ['Item'],
        output: 'Item',
        reads: ['Item'],
        writes: [],
        mutates: ['Item.status'],
        requiresPolicies: ['item-policy'],
        requiresPermissions: ['item-write'],
        performsEffects: ['item-db-write'],
        emits: ['ItemClosed'],
        invokes: [],
        awaits: []
      }],
      events: [{ id: 'ItemClosed', payloadType: 'Item' }],
      policies: [{ id: 'item-policy', rule: 'item_transition_allowed' }],
      permissions: [{ id: 'item-write', scope: 'tenant' }],
      effects: [{ id: 'item-db-write', kind: 'database-write', target: 'Item storage' }],
      scenarios: [{
        id: 'close-item',
        entry: 'closeItem',
        steps: [{ id: 'close', operation: 'closeItem', after: [] }],
        acceptance: ['item_can_transition']
      }]
    }
  };
}

test('semantic contract becomes authoritative entities, facts, transitions, and scenario steps', () => {
  const ir = buildEngineeringIR({ ...baseInput(), semanticContracts: [contract()] });

  expect(ir.entities.find((entity) => entity.id === 'responsibility:item:ItemStateMachine')?.kind).toBe('responsibility');
  expect(ir.entities.find((entity) => entity.id === 'state:item:item-status')?.attributes).toContainEqual({
    key: 'values',
    value: ['closed', 'open']
  });

  const transition = ir.facts.find((fact) =>
    fact.subject === 'state:item:item-status' && fact.predicate === 'TRANSITIONS_TO'
  );
  expect(transition?.authority).toBe('authoritative');
  expect(transition?.object).toEqual({
    kind: 'value',
    value: {
      by: 'operation:item:closeItem',
      from: 'open',
      to: 'closed'
    }
  });
  expect(transition?.provenance).toEqual([{
    kind: 'contract',
    sourceId: 'semantic-contract:item-core',
    sourcePath: 'registry/item.basic/contracts/item.yaml'
  }]);

  const scenario = ir.scenarios[0];
  expect(scenario).toMatchObject({
    id: 'scenario:item:close-item',
    entryEntityId: 'operation:item:closeItem',
    acceptanceEntityIds: ['acceptance:item_can_transition'],
    steps: [{
      id: 'close',
      operationEntityId: 'operation:item:closeItem',
      afterStepIds: [],
      awaits: false
    }]
  });
});

test('semantic contract scenario cannot reference undeclared acceptance', () => {
  const input = baseInput();
  const semanticContract = contract();
  semanticContract.contract.scenarios[0]!.acceptance = ['missing_acceptance'];

  try {
    buildEngineeringIR({ ...input, semanticContracts: [semanticContract] });
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe('IR-FACT-003');
    return;
  }
  throw new Error('Expected missing acceptance to fail referential integrity');
});
