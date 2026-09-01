import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { buildSemanticGeneratorPlan } from '../../src/compiler/semantic-plan.ts';
import type { SemanticGeneratorDeclaration } from '../../src/semantic/generation/contract/types.ts';

function input(): BuildEngineeringIRInput {
  return {
    app: { id: 'item-app', name: 'item-app' },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry/item.basic'
    }],
    manifests: [{
      blockId: 'item/basic',
      manifestPath: 'registry/item.basic/block.manifest.yaml',
      manifest: {
        requires: [],
        provides: ['item/write'],
        pins: { inputs: [], outputs: [] },
        generators: [{
          id: 'item-status-runtime-contract',
          kind: 'generate-state-transition-map',
          contract: 'item-core',
          state: 'item-status',
          target: 'src\\installed/item/item-semantic-contract.ts',
          consumes: ['transition', 'state'],
          produces: 'typescript-runtime-contract',
          typeBinding: { name: 'ItemStatus', importFrom: '../../runtime/database.ts' },
          verification: ['typecheck', 'item_can_transition']
        }]
      }
    }],
    acceptanceIds: ['item_can_transition'],
    policyDeclarations: [],
    semanticContracts: [{
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
          values: ['closed', 'open'],
          transitions: [
            { from: 'closed', to: 'open', by: 'transitionItemStatus' },
            { from: 'open', to: 'closed', by: 'transitionItemStatus' }
          ]
        }],
        responsibilities: [{
          id: 'ItemStateMachine',
          role: 'Own item status',
          owns: ['Item.status'],
          implements: ['transitionItemStatus'],
          dependsOn: []
        }],
        operations: [{
          id: 'transitionItemStatus',
          responsibility: 'ItemStateMachine',
          inputs: ['ItemStatus'],
          output: 'ItemStatus',
          reads: ['Item'],
          writes: [],
          mutates: ['Item.status'],
          requiresPolicies: [],
          requiresPermissions: [],
          performsEffects: [],
          emits: [],
          invokes: [],
          awaits: []
        }],
        events: [],
        policies: [],
        permissions: [],
        effects: [],
        scenarios: []
      }
    }]
  };
}

function declarations(source = input()): SemanticGeneratorDeclaration[] {
  const declaration = source.manifests[0]!.manifest.generators![0]!;
  return [{
    blockId: 'item/basic',
    manifestPath: 'registry/item.basic/block.manifest.yaml',
    declaration: structuredClone(declaration),
    registrySourceId: 'official',
    registryKind: 'official',
    registryLocation: 'compiler',
    registryPath: 'registry/item.basic'
  }];
}

test('validated IR owns Generator/Artifact facts and the deterministic lowering plan', () => {
  const source = input();
  const snapshot = buildValidatedEngineeringIR(source);
  const plan = buildSemanticGeneratorPlan(snapshot, declarations(source));
  const generatorId = 'generator:item/basic:item-status-runtime-contract';
  const artifactId = 'artifact:src/installed/item/item-semantic-contract.ts';

  expect(snapshot.ir.entities.find((entity) => entity.id === generatorId)?.kind).toBe('generator');
  expect(snapshot.ir.entities.find((entity) => entity.id === artifactId)?.kind).toBe('artifact');
  expect(snapshot.ir.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ subject: generatorId, predicate: 'CONSUMES', object: { kind: 'entity', entityId: 'state:item:item-status' } }),
    expect.objectContaining({ subject: 'state:item:item-status', predicate: 'LOWERS_TO', object: { kind: 'entity', entityId: artifactId } }),
    expect.objectContaining({ subject: generatorId, predicate: 'GENERATES', object: { kind: 'entity', entityId: artifactId } }),
    expect.objectContaining({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'entity', entityId: 'acceptance:item_can_transition' } }),
    expect.objectContaining({ subject: artifactId, predicate: 'VERIFIED_BY', object: { kind: 'value', value: { selector: 'typecheck' } } })
  ]));
  expect(plan).toMatchObject({
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    tasks: [{
      id: generatorId,
      generatorEntityId: generatorId,
      artifactEntityId: artifactId,
      target: 'src/installed/item/item-semantic-contract.ts',
      stateValues: ['closed', 'open'],
      verifiedByEntityIds: ['acceptance:item_can_transition']
    }]
  });
  expect(plan.tasks[0]?.transitions).toEqual([
    { from: 'closed', to: 'open', by: 'transitionItemStatus', operationEntityId: 'operation:item:transitionItemStatus' },
    { from: 'open', to: 'closed', by: 'transitionItemStatus', operationEntityId: 'operation:item:transitionItemStatus' }
  ]);

  const raw = buildEngineeringIR(source);
  if (false) {
    // @ts-expect-error Generator plans require the branded validated snapshot boundary.
    buildSemanticGeneratorPlan(raw, declarations(source));
  }
});

test('Generator Plan rejects declarations that drift from their validated IR snapshot', () => {
  const source = input();
  const snapshot = buildValidatedEngineeringIR(source);
  const drifted = declarations(source);
  drifted[0]!.declaration.typeBinding.name = 'DriftedStatus';
  expect(() => buildSemanticGeneratorPlan(snapshot, drifted)).toThrow(
    'Generator declaration "item-status-runtime-contract" does not match validated IR'
  );
});
