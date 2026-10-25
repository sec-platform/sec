import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { normalizeSemanticContract } from '../../../src/semantics/definitions/normalize.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';

function baseInput(): BuildEngineeringIRInput {
  return {
    app: { id: 'semantic-app', name: 'semantic-app' },
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
    acceptanceIds: ['item_can_transition'],
    policyDeclarations: []
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
        bindings: [{
          target: { kind: 'operation', id: 'closeItem' },
          declaration: { path: 'src/item/close-item.ts', exportName: 'closeItem' }
        }],
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

function expectCodedFailure(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    expect((error as CodedFailure).code).toBe(code);
    return;
  }
  throw new Error(`Expected CodedFailure ${code}`);
}

test('literal #step in legal namespace, scenario and step components survives build and cached validation', () => {
  for (const [namespace, scenarioId, stepId] of [
    ['a#step', 'b', 'c'],
    ['a#step', 'b#step', 'c#step'],
    ['#step', '#step', '#step'],
    ['a', 'b', 'c']
  ]) {
    const loaded = contract();
    loaded.contract.namespace = namespace!;
    loaded.contract.scenarios[0]!.id = scenarioId!;
    loaded.contract.scenarios[0]!.steps[0]!.id = stepId!;
    const source = { ...baseInput(), semanticContracts: [loaded] };
    const ir = buildEngineeringIR(source);
    const expectedId = `scenario:${namespace}:${scenarioId}#step:${stepId}`;
    expect(ir.entities.find((entity) => entity.kind === 'scenario-step')!.id).toBe(expectedId);
    expect(validateEngineeringIR(ir, source).ir.entities.some((entity) => entity.id === expectedId)).toBe(true);
  }
});

test('a second edit changes only the named event and does not merge independently named declarations', () => {
  const loaded = contract();
  loaded.contract.events.push({ id: 'OtherEvent', label: 'same label', payloadType: 'Item' });
  const before = buildEngineeringIR({ ...baseInput(), semanticContracts: [loaded] });
  loaded.contract.events[0]!.payloadType = 'ChangedPayload';
  const after = buildEngineeringIR({ ...baseInput(), semanticContracts: [loaded] });
  expect(before.entities.find((entity) => entity.id === 'event:item:OtherEvent')?.attributes)
    .toContainEqual({ key: 'payloadType', value: 'Item' });
  expect(after.entities.find((entity) => entity.id === 'event:item:OtherEvent')).toEqual(before.entities.find((entity) => entity.id === 'event:item:OtherEvent'));
  expect(after.entities.find((entity) => entity.id === 'event:item:ItemClosed')).not.toEqual(before.entities.find((entity) => entity.id === 'event:item:ItemClosed'));
  expect(after.semanticRevision).not.toBe(before.semanticRevision);
  expect(before.entities.filter((entity) => entity.kind === 'event')).toHaveLength(2);
  loaded.contract.namespace = 'item:OtherEvent';
  expect(() => buildEngineeringIR({ ...baseInput(), semanticContracts: [loaded] })).toThrow();
});

test('distinct NUL-bearing state transitions survive compilation and a second transition edit', () => {
  const loaded = contract();
  loaded.contract.states[0]!.values = ['a', 'a\u0000b', 'b\u0000c', 'c', 'edited'];
  loaded.contract.states[0]!.transitions = [
    { from: 'a\u0000b', to: 'c', by: 'closeItem' },
    { from: 'a', to: 'b\u0000c', by: 'closeItem' }
  ];
  const before = buildEngineeringIR({ ...baseInput(), semanticContracts: [loaded] });
  const transitions = before.facts.filter((fact) => fact.predicate === 'TRANSITIONS_TO');
  expect(transitions).toHaveLength(2);
  loaded.contract.states[0]!.transitions[1]!.to = 'edited';
  const after = buildEngineeringIR({ ...baseInput(), semanticContracts: [loaded] });
  expect(after.inputRevision).not.toBe(before.inputRevision);
  expect(after.facts.filter((fact) => fact.predicate === 'TRANSITIONS_TO')).toHaveLength(2);
  const unchanged = transitions.find((fact) => fact.object.kind === 'value' && typeof fact.object.value === 'object' && fact.object.value !== null && !Array.isArray(fact.object.value) && fact.object.value.from === 'a\u0000b')!;
  expect(after.facts.some((fact) => fact.id === unchanged.id)).toBe(true);
});

test('semantic contract becomes authoritative entities, facts, transitions, and scenario steps', () => {
  const semanticContract = contract();
  const input = { ...baseInput(), semanticContracts: [semanticContract] };
  const ir = buildEngineeringIR(input);

  expect(ir.entities.find((entity) => entity.id === 'responsibility:item:ItemStateMachine')?.kind).toBe('responsibility');
  expect(ir.entities.find((entity) => entity.id === 'responsibility:item:ItemStateMachine')?.attributes)
    .not.toContainEqual(expect.objectContaining({ key: 'role' }));
  const binding = ir.entities.find((entity) => entity.kind === 'responsibility-binding');
  expect(binding?.attributes).toEqual(expect.arrayContaining([
    { key: 'targetKind', value: 'operation' },
    { key: 'targetId', value: 'operation:item:closeItem' },
    { key: 'declarationPath', value: 'src/item/close-item.ts' },
    { key: 'declarationExportName', value: 'closeItem' }
  ]));
  expect(ir.facts).toContainEqual(expect.objectContaining({
    subject: 'responsibility:item:ItemStateMachine',
    predicate: 'CONTAINS',
    object: { kind: 'entity', entityId: binding?.id },
    assertions: [expect.objectContaining({ authority: 'authoritative' })]
  }));
  expect(ir.entities.find((entity) => entity.id === 'state:item:item-status')?.attributes).toContainEqual({
    key: 'values',
    value: ['closed', 'open']
  });

  const transition = ir.facts.find((fact) =>
    fact.subject === 'state:item:item-status' && fact.predicate === 'TRANSITIONS_TO'
  );
  expect(transition?.assertions[0]?.authority).toBe('authoritative');
  expect(transition?.object).toEqual({
    kind: 'value',
    value: {
      by: 'operation:item:closeItem',
      from: 'open',
      to: 'closed'
    }
  });
  expect(transition?.assertions[0]?.provenance).toEqual([{
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
      id: 'scenario:item:close-item#step:close',
      operationEntityId: 'operation:item:closeItem',
      afterStepIds: [],
      awaits: false
    }]
  });
  expect(buildEngineeringIR({
    ...input,
    semanticContracts: [semanticContract, semanticContract]
  })).toEqual(ir);
});

test('semantic operation input sequence survives normalization and Engineering IR attributes', () => {
  const semanticContract = contract();
  semanticContract.contract.operations[0]!.inputs = ['number', 'string', 'number'];
  semanticContract.contract = normalizeSemanticContract(semanticContract.contract);
  expect(semanticContract.contract.operations[0]!.inputs).toEqual(['number', 'string', 'number']);

  const ir = buildEngineeringIR({ ...baseInput(), semanticContracts: [semanticContract] });
  const operation = ir.entities.find((entity) => entity.id === 'operation:item:closeItem');

  expect(operation?.attributes).toContainEqual({
    key: 'inputs',
    value: ['number', 'string', 'number']
  });
});

test('distinct semantic contracts cannot implicitly merge through a shared namespace', () => {
  const first = contract();
  const second = contract();
  second.contractPath = 'registry/item.basic/contracts/item-extension.yaml';
  second.contract = {
    ...second.contract,
    id: 'item-extension',
    entities: [],
    states: [],
    responsibilities: [],
    operations: [],
    events: [],
    policies: [],
    permissions: [],
    effects: [],
    scenarios: []
  };

  expectCodedFailure(
    () => buildEngineeringIR({ ...baseInput(), semanticContracts: [first, second] }),
    'SEMANTIC-LINK-001'
  );
});

test('semantic contract scenario cannot reference undeclared acceptance', () => {
  const input = baseInput();
  const semanticContract = contract();
  semanticContract.contract.scenarios[0]!.acceptance = ['missing_acceptance'];

  expectCodedFailure(
    () => buildEngineeringIR({ ...input, semanticContracts: [semanticContract] }),
    'IR-FACT-003'
  );
});
