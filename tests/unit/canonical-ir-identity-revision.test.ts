import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../platform/compiler/index.ts';
import { normalizePlan, validatePlan } from '../../platform/compiler/parse/load-plan.ts';
import { runPolicyGate } from '../../platform/compiler/verify/run-policy-gate.ts';
import { buildWorkspaceEngineeringIR } from '../../platform/orchestrator.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import { pathExists, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { PlanFile } from '../../platform/shared/plan-manifest-types.ts';
import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { prepareResolvedWorkspace } from '../testkit/workspace.ts';

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
    slotTasks: [{
      id: 'item_adapter',
      block: 'item/basic',
      target: 'custom/item_adapter.ts',
      sourcePath: 'source/code/slots/item_adapter.ts',
      symbol: 'adaptItem',
      kind: 'adapter',
      inputType: 'ItemInput',
      outputType: 'Item',
      status: 'filled',
      writableZones: ['custom/'],
      provenanceHints: { generator: null, verifiedBy: [] }
    }],
    acceptanceIds: ['item_can_update', 'item_can_create'],
    policyDeclarations: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['item/basic'],
        rule: 'tenant_context_must_flow_to_query'
      },
      {
        id: 'item-write-required',
        severity: 'warn',
        appliesTo: ['item/basic'],
        rule: 'item_write_must_be_authorized'
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
    slotTasks: [...input.slotTasks].reverse(),
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
    slotTasks: [...input.slotTasks, input.slotTasks[0]!],
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
    appliesTo: ['auth/basic-session', 'item/basic'],
    rule: 'tenant_context_must_be_explicit'
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
      stack: 'nextjs-ts-prisma-sqlite',
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: [] },
    blocks: [],
    slots: [],
    acceptance: []
  } as unknown as PlanFile);

  expectCompilerError(() => validatePlan(normalized), 'PLAN-VALIDATION-014');
});

test.serial('provenance and ExplainGraph artifact changes cannot feed canonical revisions', async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-canonical-revision-domain-'
  });
  const before = await buildWorkspaceEngineeringIR(workspaceRoot);
  const { provenancePath, explainGraphPath } = getWorkspacePaths(workspaceRoot);

  await fs.mkdir(path.dirname(provenancePath), { recursive: true });
  await fs.writeFile(provenancePath, JSON.stringify({ artifacts: [{ path: 'changed.ts', generatedAt: Date.now() }] }), 'utf8');
  const afterProvenance = await buildWorkspaceEngineeringIR(workspaceRoot);

  expect(afterProvenance.inputRevision).toBe(before.inputRevision);
  expect(afterProvenance.semanticRevision).toBe(before.semanticRevision);

  await fs.mkdir(path.dirname(explainGraphPath), { recursive: true });
  await fs.writeFile(explainGraphPath, JSON.stringify({ nodes: ['changed'], generatedAt: Date.now() }), 'utf8');
  const afterExplainGraph = await buildWorkspaceEngineeringIR(workspaceRoot);

  expect(afterExplainGraph.inputRevision).toBe(before.inputRevision);
  expect(afterExplainGraph.semanticRevision).toBe(before.semanticRevision);
}, 15_000);

test.serial('policy report materialization cannot feed canonical policy identity or revisions', async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-policy-revision-domain-'
  });
  const { sourcePoliciesRoot, policyReportPath } = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(sourcePoliciesRoot, { recursive: true });
  await writeYaml(path.join(sourcePoliciesRoot, 'canonical-policy.yaml'), {
    policies: [{
      id: 'canonical-source-policy',
      severity: 'warn',
      appliesTo: ['ticket/basic'],
      rule: 'declaration_only_for_revision_stability'
    }]
  });

  expect(await pathExists(policyReportPath)).toBe(false);
  const before = await buildWorkspaceEngineeringIR(workspaceRoot);
  const beforePolicyEntities = before.entities.filter((entity) => entity.kind === 'policy');
  const beforePolicyEntityIds = new Set(beforePolicyEntities.map((entity) => entity.id));
  const beforePolicyFacts = before.facts.filter((fact) =>
    beforePolicyEntityIds.has(fact.subject) ||
    (fact.object.kind === 'entity' && beforePolicyEntityIds.has(fact.object.entityId))
  );
  expect(beforePolicyEntities.map((entity) => entity.id)).toContain('policy:canonical-source-policy');

  const report = await runPolicyGate(workspaceRoot);
  await writeJson(policyReportPath, report);
  expect(await pathExists(policyReportPath)).toBe(true);
  const after = await buildWorkspaceEngineeringIR(workspaceRoot);
  const afterPolicyEntities = after.entities.filter((entity) => entity.kind === 'policy');
  const afterPolicyEntityIds = new Set(afterPolicyEntities.map((entity) => entity.id));
  const afterPolicyFacts = after.facts.filter((fact) =>
    afterPolicyEntityIds.has(fact.subject) ||
    (fact.object.kind === 'entity' && afterPolicyEntityIds.has(fact.object.entityId))
  );

  expect(after.inputRevision).toBe(before.inputRevision);
  expect(after.semanticRevision).toBe(before.semanticRevision);
  expect(afterPolicyEntities).toEqual(beforePolicyEntities);
  expect(afterPolicyFacts).toEqual(beforePolicyFacts);
}, 15_000);
