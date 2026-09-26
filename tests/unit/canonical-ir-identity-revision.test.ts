import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import type { PlanFile } from '../../src/compiler/contract.ts';
import { normalizePlan, validatePlan } from '../../src/compiler/contract/plan-validation.ts';
import { CompilerError } from '../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { artifactEntityId, normalizedArtifactTarget } from '../../src/compiler/ir/ir-identity.ts';
import { rawSha256Hex } from '../../src/compiler/ir/ir-revision.ts';
import type { LoadedSemanticContract } from '../../src/semantics/definitions/types.ts';
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE } from '../../src/semantics/policies/rules.ts';
const PLAN_NORMALIZATION_DEFAULTS = Object.freeze({
  officialPath: 'catalog/registry/official',
  privatePath: 'model/blocks/private'
});

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

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
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

  expect(rawSha256Hex('SEC canonical primitives\n工程')).toBe(
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
  expect(createHash('sha256').update(JSON.stringify(ir)).digest('hex')).toBe(
    '9eb9118eb2a3891c0130b23a9dc2e72a5ed8dcd6de649824bb45e6d795bc7c18'
  );
});

test('app label changes do not change app identity, graph identity, or Fact IDs', () => {
  const input = fixture();
  const before = buildEngineeringIR(input);
  const after = buildEngineeringIR({
    ...input,
    app: { ...input.app, name: 'Renamed Ticket Application' }
  });

  expect(after.appId).toBe(before.appId);
  expect(after.graphId).toBe(before.graphId);
  expect(after.facts.map((fact) => fact.id)).toEqual(before.facts.map((fact) => fact.id));
});

test('unordered semantic input collections do not change either revision', () => {
  const input = fixture();
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

  const before = buildEngineeringIR(input);
  const after = buildEngineeringIR(reordered);
  expect(after.inputRevision).toBe(before.inputRevision);
  expect(after.semanticRevision).toBe(before.semanticRevision);
});

test('exact duplicate unordered semantic declarations do not change revisions', () => {
  const input = fixture();
  const contract = semanticContract();
  const duplicatedContract: LoadedSemanticContract = {
    ...contract,
    contract: {
      ...contract.contract,
      states: contract.contract.states.map((state) => ({
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

  const before = buildEngineeringIR(input);
  const after = buildEngineeringIR(duplicated);
  expect(after.inputRevision).toBe(before.inputRevision);
  expect(after.semanticRevision).toBe(before.semanticRevision);
});

test('operation input sequence changes canonical semantic revision', () => {
  const input = fixture();
  const changedContract = semanticContract();
  changedContract.contract.operations[0]!.inputs = ['string', 'number'];

  const before = buildEngineeringIR(input);
  const after = buildEngineeringIR({ ...input, semanticContracts: [changedContract] });

  expect(after.inputRevision).not.toBe(before.inputRevision);
  expect(after.semanticRevision).not.toBe(before.semanticRevision);
});

test('policy declaration content changes input revision without changing semantic graph identity', () => {
  const input = fixture();
  const changedPolicy = {
    ...input.policyDeclarations[0]!,
    severity: 'blocker' as const,
    appliesTo: ['auth/basic-session', 'item/basic']
  };

  const before = buildEngineeringIR(input);
  const after = buildEngineeringIR({
    ...input,
    policyDeclarations: [changedPolicy, ...input.policyDeclarations.slice(1)]
  });

  expect(after.inputRevision).not.toBe(before.inputRevision);
  expect(after.semanticRevision).toBe(before.semanticRevision);
  expect(after.entities.filter((entity) => entity.kind === 'policy')).toEqual(
    before.entities.filter((entity) => entity.kind === 'policy')
  );
});

test('plan validation hard fails when app.id is absent', () => {
  const normalized = normalizePlan({
    app: {
      name: 'legacy-name-only',
      stack: 'typescript-library',
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: [] },
    blocks: [],
    acceptance: []
  } as unknown as PlanFile, PLAN_NORMALIZATION_DEFAULTS);

  expectCompilerError(() => validatePlan(normalized), 'PLAN-VALIDATION-014');
});
