import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { artifactEntityId, normalizedArtifactTarget } from '../../../src/compiler/ir/ir-identity.ts';
import { digest } from '../../../src/compiler/ir/ir-revision.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE } from '../../../src/semantics/policies/rules.ts';

function semanticContract(): LoadedSemanticContract {
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
          { id: 'status', type: 'string', required: true, mutable: true },
          { id: 'id', type: 'number', required: true, mutable: false }
        ]
      }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemWorker',
        values: ['open', 'closed'],
        transitions: [{ from: 'open', to: 'closed', by: 'processItem' }]
      }],
      responsibilities: [{
        id: 'ItemWorker',
        role: 'Process item',
        owns: ['Item.status', 'Item.id'],
        implements: ['processItem'],
        dependsOn: []
      }],
      operations: [{
        id: 'processItem',
        responsibility: 'ItemWorker',
        inputs: ['number', 'string'],
        output: 'Item',
        reads: ['Item.status', 'Item.id'],
        writes: ['Item.status'],
        mutates: ['Item.status'],
        requiresPolicies: ['item-policy'],
        requiresPermissions: ['item-write'],
        performsEffects: ['item-write-effect'],
        emits: ['ItemProcessed'],
        invokes: [],
        awaits: []
      }],
      events: [{ id: 'ItemProcessed', payloadType: 'Item' }],
      policies: [{ id: 'item-policy', rule: 'item_allowed' }],
      permissions: [{ id: 'item-write', scope: 'tenant' }],
      effects: [{ id: 'item-write-effect', kind: 'database-write', target: 'Item' }],
      scenarios: []
    }
  };
}

function fixture(): BuildEngineeringIRInput {
  return {
    app: { id: 'stable-ticket-app', name: 'Ticket App' },
    resolvedBlocks: [
      {
        id: 'item/basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'registry/item.basic/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'registry'
      },
      {
        id: 'auth/basic-session',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'registry/auth.basic-session/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'registry'
      }
    ],
    manifests: [
      {
        blockId: 'item/basic',
        manifestPath: 'registry/item.basic/block.manifest.yaml',
        manifest: {
          requires: ['auth/session', 'tenant/scope'],
          provides: ['item/read', 'item/write'],
          pins: {
            inputs: [
              { id: 'tenant', type: 'Tenant', required: true },
              { id: 'actor', type: 'Session', required: true }
            ],
            outputs: [
              { id: 'updated', type: 'Item', required: true },
              { id: 'created', type: 'Item', required: false }
            ]
          }
        }
      },
      {
        blockId: 'auth/basic-session',
        manifest: {
          requires: [],
          provides: ['auth/session'],
          pins: { inputs: [], outputs: [] }
        }
      }
    ],
    acceptanceIds: ['item_can_update', 'item_can_create'],
    policyDeclarations: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['item/basic'],
        rule: TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE
      },
      {
        id: 'item-write-required',
        severity: 'warn',
        appliesTo: ['item/basic'],
        rule: TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE
      }
    ],
    semanticContracts: [semanticContract()]
  };
}

test('canonical primitive known-answer vectors remain byte-identical', () => {
  const generatorTarget = 'src\\installed/item/./generated/../item-semantic-contract.ts';
  const input = fixture();
  input.manifests[0]!.manifest.generators = [{
    id: 'item-status-runtime-contract',
    kind: 'generate-state-transition-map',
    contract: 'item-core',
    state: 'item-status',
    target: generatorTarget,
    consumes: ['transition', 'state'],
    produces: 'typescript-runtime-contract',
    typeBinding: { name: 'ItemStatus', importFrom: '../../runtime/database.ts' },
    verification: ['typecheck', 'item_can_update']
  }];
  const ir = buildEngineeringIR(input);

  expect(digest('SEC canonical primitives\n工程')).toBe(
    '5f977604c630d50f70017523d83a380745f74dfceabbb89acfaa2a6b7342593d'
  );
  expect(normalizedArtifactTarget(generatorTarget)).toBe(
    'src/installed/item/item-semantic-contract.ts'
  );
  expect(artifactEntityId(generatorTarget)).toBe(
    'artifact:src/installed/item/item-semantic-contract.ts'
  );
  expect(ir.inputRevision).toBe(
    'sha256:673d12da3ef98d98b184f041f461d81f0d3d719b6c9943c01e390eec181c04dc'
  );
  expect(ir.semanticRevision).toBe(
    'sha256:7bad43b2cc410603d6cf0d862af356f1967b573ab5cd10b6572b42273ea19ada'
  );
});

test('canonical revisions preserve unordered and audit equivalence while distinguishing semantic edits', () => {
  const input = fixture();
  const before = buildEngineeringIR(input);
  const renamed = buildEngineeringIR({
    ...input,
    app: { ...input.app, name: 'Renamed Ticket Application' }
  });

  expect(renamed.appId).toBe(before.appId);
  expect(renamed.graphId).toBe(before.graphId);
  expect(renamed.facts.map((fact) => fact.id)).toEqual(before.facts.map((fact) => fact.id));

  const contract = input.semanticContracts![0]!;
  const reversedContract: LoadedSemanticContract = {
    ...contract,
    contract: {
      ...contract.contract,
      entities: [...contract.contract.entities].reverse().map((entity) => ({
        ...entity,
        fields: [...entity.fields].reverse()
      })),
      states: [...contract.contract.states].reverse().map((state) => ({
        ...state,
        values: [...state.values].reverse(),
        transitions: [...state.transitions].reverse()
      })),
      responsibilities: [...contract.contract.responsibilities].reverse().map((responsibility) => ({
        ...responsibility,
        owns: [...responsibility.owns].reverse(),
        implements: [...responsibility.implements].reverse(),
        dependsOn: [...responsibility.dependsOn].reverse()
      })),
      operations: [...contract.contract.operations].reverse().map((operation) => ({
        ...operation,
        reads: [...operation.reads].reverse(),
        writes: [...operation.writes].reverse(),
        mutates: [...operation.mutates].reverse(),
        requiresPolicies: [...operation.requiresPolicies].reverse(),
        requiresPermissions: [...operation.requiresPermissions].reverse(),
        performsEffects: [...operation.performsEffects].reverse(),
        emits: [...operation.emits].reverse(),
        invokes: [...operation.invokes].reverse(),
        awaits: [...operation.awaits].reverse()
      })),
      events: [...contract.contract.events].reverse(),
      policies: [...contract.contract.policies].reverse(),
      permissions: [...contract.contract.permissions].reverse(),
      effects: [...contract.contract.effects].reverse()
    }
  };
  const reordered: BuildEngineeringIRInput = {
    ...input,
    resolvedBlocks: [...input.resolvedBlocks].reverse(),
    manifests: [...input.manifests].reverse().map((entry) => ({
      ...entry,
      manifest: {
        ...entry.manifest,
        requires: [...entry.manifest.requires].reverse(),
        provides: [...entry.manifest.provides].reverse(),
        pins: {
          inputs: [...entry.manifest.pins.inputs].reverse(),
          outputs: [...entry.manifest.pins.outputs].reverse()
        }
      }
    })),
    acceptanceIds: [...input.acceptanceIds].reverse(),
    policyDeclarations: [...input.policyDeclarations].reverse(),
    semanticContracts: [reversedContract]
  };

  const reorderedIR = buildEngineeringIR(reordered);
  expect(reorderedIR.inputRevision).toBe(before.inputRevision);
  expect(reorderedIR.semanticRevision).toBe(before.semanticRevision);

  const duplicateSource = semanticContract();
  const duplicatedContract: LoadedSemanticContract = {
    ...duplicateSource,
    contract: {
      ...duplicateSource.contract,
      states: duplicateSource.contract.states.map((state) => ({
        ...state,
        transitions: [...state.transitions, ...state.transitions]
      }))
    }
  };
  const itemManifest = input.manifests[0]!;
  const duplicatedManifest = {
    ...itemManifest,
    manifest: {
      ...itemManifest.manifest,
      requires: [...itemManifest.manifest.requires, ...itemManifest.manifest.requires],
      provides: [...itemManifest.manifest.provides, ...itemManifest.manifest.provides],
      pins: {
        inputs: [...itemManifest.manifest.pins.inputs, ...itemManifest.manifest.pins.inputs],
        outputs: [...itemManifest.manifest.pins.outputs, ...itemManifest.manifest.pins.outputs]
      }
    }
  };
  const duplicated: BuildEngineeringIRInput = {
    ...input,
    resolvedBlocks: [...input.resolvedBlocks, input.resolvedBlocks[0]!],
    manifests: [...input.manifests, duplicatedManifest],
    acceptanceIds: [...input.acceptanceIds, input.acceptanceIds[0]!],
    policyDeclarations: [...input.policyDeclarations, input.policyDeclarations[0]!],
    semanticContracts: [duplicatedContract, duplicatedContract]
  };

  const duplicatedIR = buildEngineeringIR(duplicated);
  expect(duplicatedIR.inputRevision).toBe(before.inputRevision);
  expect(duplicatedIR.semanticRevision).toBe(before.semanticRevision);

  const changedContract = semanticContract();
  changedContract.contract.operations[0]!.inputs = ['string', 'number'];

  const sequenceIR = buildEngineeringIR({ ...input, semanticContracts: [changedContract] });

  expect(sequenceIR.inputRevision).not.toBe(before.inputRevision);
  expect(sequenceIR.semanticRevision).not.toBe(before.semanticRevision);

  const changedPolicy = {
    ...input.policyDeclarations[0]!,
    severity: 'blocker' as const,
    appliesTo: ['auth/basic-session', 'item/basic']
  };

  const policyIR = buildEngineeringIR({
    ...input,
    policyDeclarations: [changedPolicy, ...input.policyDeclarations.slice(1)]
  });

  expect(policyIR.inputRevision).not.toBe(before.inputRevision);
  expect(policyIR.semanticRevision).toBe(before.semanticRevision);
  expect(policyIR.entities.filter((entity) => entity.kind === 'policy')).toEqual(
    before.entities.filter((entity) => entity.kind === 'policy')
  );
});

test('distinct transition tuples remain separate facts in either source order', () => {
  const input = fixture();
  const state = input.semanticContracts![0]!.contract.states[0]!;
  state.values = ['a\0b', 'c', 'a', 'b\0c'];
  const first = { from: 'a\0b', to: 'c', by: 'processItem' };
  const second = { from: 'a', to: 'b\0c', by: 'processItem' };
  const singletonRevisions = [first, second].map(transition => {
    state.transitions = [transition];
    return buildEngineeringIR(input).inputRevision;
  });
  const pairRevisions: string[] = [];
  for (const transitions of [[first, second], [second, first]]) {
    state.transitions = transitions;
    const ir = buildEngineeringIR(input);
    pairRevisions.push(ir.inputRevision);
    for (const singletonRevision of singletonRevisions) expect(ir.inputRevision).not.toBe(singletonRevision);
    const transitionsInIR = ir.facts.filter(fact => fact.predicate === 'TRANSITIONS_TO');
    expect(transitionsInIR).toHaveLength(2);
    expect(new Set(transitionsInIR.map(fact => fact.id)).size).toBe(2);
    expect(transitionsInIR.map(fact => fact.object)).toEqual(expect.arrayContaining([
      { kind: 'value', value: { from: 'a\0b', to: 'c', by: 'operation:item:processItem' } },
      { kind: 'value', value: { from: 'a', to: 'b\0c', by: 'operation:item:processItem' } }
    ]));
  }
  expect(pairRevisions[0]).toBe(pairRevisions[1]);
});
