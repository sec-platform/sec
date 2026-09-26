import { link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { semanticMutationByteDigest } from '../../../src/compiler/semantic-mutation/canonical.ts';

import { planSemanticMutationSourceEdit, renderSemanticMutationSourceEdit } from '../../../src/adapters/mutation/plan-source-edit.ts';
import {
  renderSemanticContractYamlEdit,
} from '../../../src/adapters/mutation/semantic-contract-yaml-adapter.ts';
import { readSemanticMutationSource } from '../../../src/adapters/mutation/source-path-boundary.ts';
import { loadAuthoringSemanticContractSources } from "../../../src/adapters/workspace/sources/load-authoring-semantic-contracts.ts";
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { normalizeSemanticMutationRequest, semanticMutationAuthorizationRevision } from '../../../src/compiler/semantic-mutation/normalize-request.ts';
import { preflightSemanticMutation } from '../../../src/compiler/semantic-mutation/preflight.ts';
import { resolveSemanticMutationSource } from '../../../src/compiler/semantic-mutation/source-adapter-registry.ts';
import { buildTrustedLocalSemanticMutationAuthorization, type TrustedLocalSemanticMutationPolicyDraft } from '../../../src/compiler/semantic-mutation/trusted-authorization-ingress.ts';
import { normalizeSemanticContract } from '../../../src/semantics/definitions/normalize.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, type SemanticMutationAuthorizationContext, type SemanticMutationLoadedSourceCandidate, type SemanticMutationRequest } from '../../../src/semantics/mutation/types.ts';
import { buildSemanticContractSourceCandidate } from "../../../src/semantics/provenance/source-candidate.ts";
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH } from "../../../src/workspace/contract/authoring-index.ts";
import { modelRelativePath } from '../../../src/workspace/contract/types.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

function loadedContract(contractPath = `${modelRelativePath}/item.yaml`): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath,
    contract: normalizeSemanticContract({
      formatVersion: '1',
      id: 'item-core',
      namespace: 'item',
      imports: [],
      entities: [{
        id: 'Item',
        fields: [{ id: 'status', type: 'ItemStatus', required: false, mutable: true }]
      }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemStateMachine',
        values: ['closed', 'open'],
        transitions: []
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
        reads: ['Item.status'],
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
    })
  };
}

function sourceYaml(options: {
  readonly bom?: boolean;
  readonly eol?: '\n' | '\r\n';
  readonly finalNewline?: boolean;
  readonly stateValues?: string;
} = {}): Uint8Array {
  const eol = options.eol ?? '\n';
  let text = [
    '# authoring contract comment',
    'formatVersion: "1"',
    'id: item-core',
    'namespace: item',
    'entities:',
    '  - id: Item',
    '    fields:',
    '      - id: status',
    '        type: ItemStatus',
    '        required: false',
    '        mutable: true',
    'states:',
    '  - id: item-status',
    '    entity: Item',
    '    field: status',
    '    owner: ItemStateMachine',
    `    values: [${options.stateValues ?? 'closed, open'}]`,
    '    transitions: [] # keep transition comment',
    'responsibilities:',
    '  - id: ItemStateMachine',
    '    role: Own item status',
    '    owns: [Item.status]',
    '    implements: [closeItem]',
    '    dependsOn: []',
    'operations:',
    '  - id: closeItem',
    '    responsibility: ItemStateMachine',
    '    inputs: [Item]',
    '    output: Item',
    '    reads: [Item.status]',
    '    writes: []',
    '    mutates: [Item.status]',
    '    requiresPolicies: []',
    '    requiresPermissions: []',
    '    performsEffects: []',
    '    emits: []',
    '    invokes: []',
    '    awaits: []',
    'events: []',
    'policies: []',
    'permissions: []',
    'effects: []',
    'scenarios: []'
  ].join(eol);
  if (options.finalNewline ?? true) text += eol;
  const body = new TextEncoder().encode(text);
  if (!options.bom) return body;
  const bytes = new Uint8Array(body.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(body, 3);
  return bytes;
}

function buildInput(contract: LoadedSemanticContract): BuildEngineeringIRInput {
  return {
    app: { id: 'mutation-app', name: 'Mutation App' },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'model/block.manifest.yaml',
      registrySourceId: 'workspace',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'source/model'
    }],
    manifests: [],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contract]
  };
}

function authorization(ownerId = 'semantic-contract-owner:item:item-core'): SemanticMutationAuthorizationContext {
  const draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
    taskId: 'task:mutation-source',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: [ownerId],
    allowedPathPrefixes: ['model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  return { ...draft, authorizationRevision: semanticMutationAuthorizationRevision(draft) };
}

function trustedLocalPolicy(): TrustedLocalSemanticMutationPolicyDraft {
  return {
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
}

function fixture(contract = loadedContract(), auth = authorization()) {
  const snapshot = buildValidatedEngineeringIR(buildInput(contract));
  const base: FactDeltaEndpointContext = {
    transactionId: 'tx:base',
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
  const request: SemanticMutationRequest = {
    contractVersion: '2',
    requestId: 'request:add-transition-source',
    graphId: snapshot.ir.graphId,
    appId: snapshot.ir.appId,
    base: {
      transactionId: base.transactionId,
      inputRevision: base.inputRevision,
      semanticRevision: base.semanticRevision
    },
    preconditions: [],
    operations: [{
      operationId: 'operation:add-transition',
      kind: 'add-state-transition',
      contract: { namespace: 'item', contractId: 'item-core' },
      stateId: 'item-status',
      from: 'open',
      to: 'closed',
      by: 'closeItem'
    }],
    expectation: {
      revision: 'semantic-mutation-expectation-v1',
      matchMode: 'exact',
      addedFacts: [],
      removedFacts: [],
      assertionChanges: [],
      entityChanges: 'none'
    },
    postconditions: [],
    additionalVerification: []
  };
  const preflight = preflightSemanticMutation({ request, base, authorization: auth });
  if (preflight.status !== 'ready') throw new Error(`Expected ready preflight: ${JSON.stringify(preflight)}`);
  return { contract, base, request, auth, preflight };
}

async function writePlanningWorkspace(root: string, bytes: Uint8Array): Promise<string> {
  await mkdir(path.join(root, modelRelativePath), { recursive: true });
  await mkdir(path.join(root, '.sec', 'transactions', 'tx-plan'), { recursive: true });
  await writeFile(path.join(root, modelRelativePath, 'item.yaml'), bytes);
  return path.join(root, '.sec', 'transactions', 'tx-plan');
}

function candidate(
  contract = loadedContract(),
  sourceKind: 'workspace-authoring' | 'workspace-registry' | 'compiler-registry' = 'workspace-authoring'
): SemanticMutationLoadedSourceCandidate {
  return buildSemanticContractSourceCandidate(sourceKind, contract);
}

test('trusted local authorization ingress derives owner/path authority from the shared source registry', () => {
  const { contract, base, request, auth } = fixture();
  const normalized = normalizeSemanticMutationRequest(request);
  const result = buildTrustedLocalSemanticMutationAuthorization({
    request: normalized,
    base,
    sourceCandidates: [candidate(contract)],
    policy: trustedLocalPolicy()
  });
  expect(result.status).toBe('authorized');
  if (result.status !== 'authorized') return;

  expect(result.authorization).toMatchObject({
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: ['semantic-contract-owner:item:item-core'],
    allowedPathPrefixes: ['model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  });
  expect('taskId' in result.authorization).toBe(false);
  expect('envelopeRevision' in result.authorization).toBe(false);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.authorization)).toBe(true);
  expect(Object.isFrozen(result.authorization.allowedSourceOwnerIds)).toBe(true);
  const { authorizationRevision, ...authorizationDraft } = result.authorization;
  expect(authorizationRevision).toBe(semanticMutationAuthorizationRevision(authorizationDraft));

  const manuallyAuthorized = resolveSemanticMutationSource(normalized, base, auth, [candidate(contract)]);
  const ingressAuthorized = resolveSemanticMutationSource(
    normalized,
    base,
    result.authorization,
    [candidate(contract)]
  );
  expect(ingressAuthorized.status).toBe('resolved');
  expect(JSON.stringify(ingressAuthorized)).toBe(JSON.stringify(manuallyAuthorized));
});

test('trusted local authorization ingress rejects caller authority fields and unresolved source ownership', () => {
  const { contract, base, request } = fixture();
  const normalized = normalizeSemanticMutationRequest(request);
  const input = {
    request: normalized,
    base,
    sourceCandidates: [candidate(contract)],
    policy: trustedLocalPolicy()
  };

  for (const [field, value] of [
    ['authorizationRevision', 'sha256:forged'],
    ['taskId', 'task:caller'],
    ['envelopeRevision', 'envelope:caller'],
    ['allowedSourceOwnerIds', ['semantic-contract-owner:item:item-core']],
    ['allowedPathPrefixes', ['model/']]
  ] as const) {
    expect(() => buildTrustedLocalSemanticMutationAuthorization({
      ...input,
      policy: { ...input.policy, [field]: value } as never
    })).toThrow('forbidden authority fields');
  }

  expect(() => buildTrustedLocalSemanticMutationAuthorization({
    ...input,
    policy: {
      ...input.policy,
      allowedTargetEntityIds: ['state:item:z', 'state:item:a']
    }
  })).toThrow('canonical order');

  const forged = candidate(contract);
  const sourceSets = [
    [] as SemanticMutationLoadedSourceCandidate[],
    [candidate(contract, 'workspace-registry')],
    [candidate(contract, 'compiler-registry')],
    [candidate(contract), candidate(contract)],
    [{ ...forged, sourceRevision: 'sha256:'.padEnd(71, '1') }]
  ];
  for (const sourceCandidates of sourceSets) {
    expect(buildTrustedLocalSemanticMutationAuthorization({
      ...input,
      sourceCandidates
    }).status).toBe('rejected');
  }

  expect(buildTrustedLocalSemanticMutationAuthorization({
    ...input,
    policy: {
      ...input.policy,
      allowedTargetEntityIds: ['state:item:other']
    }
  }).status).toBe('rejected');
});

test('SM-2 plans one deterministic YAML edit and preserves comments, BOM, CRLF, and final-newline policy', async () => {
  await withTempWorkspace(async (root) => {
    const before = sourceYaml({ bom: true, eol: '\r\n', finalNewline: false });
    const transactionDirectory = await writePlanningWorkspace(root, before);
    const { contract, base, request, auth, preflight } = fixture();
    const input = {
      request,
      base,
      authorization: auth,
      preflight,
      sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
      sourceCandidates: [candidate(contract)],
      workspaceRoot: root,
      transactionDirectory
    };
    const first = await planSemanticMutationSourceEdit(input);
    const second = await planSemanticMutationSourceEdit(input);
    expect(first.status).toBe('planned');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    if (first.status !== 'planned') return;
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(first.plan.ownerId).toBe('semantic-contract-owner:item:item-core');
    expect(first.plan.relativePath).toBe('model/item.yaml');
    expect(first.rollbackManifest).toMatchObject({
      encoding: 'utf-8',
      utf8Bom: true,
      lineEnding: 'crlf',
      finalNewline: false,
      beforeByteLength: before.byteLength
    });
    expect(Array.from(await readFile(path.join(root, modelRelativePath, 'item.yaml')))).toEqual(Array.from(before));

    const staged = renderSemanticMutationSourceEdit(first.plan, before);
    expect(semanticMutationByteDigest(staged)).toBe(first.plan.stagedByteDigest);
    expect(staged.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const text = new TextDecoder().decode(staged.slice(3));
    expect(text).toContain('# authoring contract comment');
    expect(text).toContain('# keep transition comment');
    expect(text).toContain('from: open');
    expect(text).toContain('to: closed');
    expect(text).toContain('by: closeItem');
    expect(text.endsWith('\n')).toBe(false);
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

test('SM-2 adds consecutive transitions to one state as canonical YAML nodes without style loss', () => {
  const before = sourceYaml({
    bom: true,
    eol: '\r\n',
    finalNewline: false,
    stateValues: 'closed, open, pending'
  });
  const secondOperation = {
    operationId: 'operation:second-transition',
    kind: 'add-state-transition' as const,
    contract: { namespace: 'item', contractId: 'item-core' },
    stateId: 'item-status',
    from: 'closed',
    to: 'pending',
    by: 'closeItem'
  };

  const commentedBody = new TextEncoder().encode(
    new TextDecoder().decode(before.slice(3)).replace(
      '    transitions: [] # keep transition comment',
      [
        '    transitions: # keep transition comment',
        '      - from: open',
        '        to: closed',
        '        by: closeItem # retain existing transition node comment'
      ].join('\r\n')
    )
  );
  const commentedAfterFirst = new Uint8Array(commentedBody.byteLength + 3);
  commentedAfterFirst.set([0xef, 0xbb, 0xbf]);
  commentedAfterFirst.set(commentedBody, 3);
  const afterSecond = renderSemanticContractYamlEdit(commentedAfterFirst, [secondOperation]).stagedBytes;
  expect(renderSemanticContractYamlEdit(commentedAfterFirst, [secondOperation]).stagedBytes)
    .toEqual(afterSecond);
  expect(afterSecond.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));

  const text = new TextDecoder().decode(afterSecond.slice(3));
  expect(text).toContain('# authoring contract comment');
  expect(text).toContain('# keep transition comment');
  expect(text).toContain('# retain existing transition node comment');
  expect(text.indexOf('from: closed')).toBeLessThan(text.indexOf('from: open'));
  expect(text.match(/from:/gu)).toHaveLength(2);
  expect(text.endsWith('\n')).toBe(false);
  expect(text.replaceAll('\r\n', '')).not.toContain('\n');
});

test('semantic YAML syntax failure remains one typed mutation diagnostic', () => {
  const render = () => renderSemanticContractYamlEdit(
    new TextEncoder().encode('states: [unterminated\n'),
    []
  );

  expect(render).toThrow(expect.objectContaining({
    code: 'SEMANTIC-MUTATION-006',
    diagnostic: expect.objectContaining({
      code: 'SEMANTIC-MUTATION-006',
      details: {
        yamlFailureCode: 'YAML-SYNTAX-001',
        yamlFailureKind: 'invalid-yaml'
      }
    })
  }));
});

test('owner resolution fails closed for none, read-only, ambiguous, forged, mismatched, or unauthorized provenance', () => {
  const { contract, base, request, auth } = fixture();
  const normalized = {
    ...request,
    requestRevision: 'sha256:'.padEnd(71, '0')
  };
  const authoring = candidate(contract);
  for (const sources of [
    [],
    [candidate(contract, 'workspace-registry')],
    [candidate(contract, 'compiler-registry')],
    [authoring, authoring]
  ]) {
    expect(resolveSemanticMutationSource(normalized, base, auth, sources).status).toBe('rejected');
  }
  expect(resolveSemanticMutationSource(normalized, base, auth, [{
    ...authoring,
    sourceRevision: 'sha256:'.padEnd(71, '1')
  }]).status).toBe('rejected');
  expect(resolveSemanticMutationSource(
    normalized,
    base,
    auth,
    [candidate(loadedContract('model/other.yaml'))]
  ).status).toBe('rejected');

  const unauthorized = authorization('semantic-contract-owner:item:other');
  const unauthorizedFixture = fixture(contract, unauthorized);
  expect(resolveSemanticMutationSource(
    { ...unauthorizedFixture.request, requestRevision: 'sha256:'.padEnd(71, '0') },
    unauthorizedFixture.base,
    unauthorized,
    [authoring]
  ).status).toBe('rejected');
});

test('adapter registry mismatch is rejected before path IO and stale current bytes fail before-byte CAS', async () => {
  await withTempWorkspace(async (root) => {
    const before = sourceYaml();
    const transactionDirectory = await writePlanningWorkspace(root, before);
    const { contract, base, request, auth, preflight } = fixture();
    const common = {
      request,
      base,
      authorization: auth,
      preflight,
      sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
      sourceCandidates: [candidate(contract)],
      workspaceRoot: root,
      transactionDirectory
    };
    expect((await planSemanticMutationSourceEdit({
      ...common,
      adapterRevision: 'semantic-contract-yaml-v0'
    })).status).toBe('rejected');
    const result = await planSemanticMutationSourceEdit(common);
    if (result.status !== 'planned') throw new Error(JSON.stringify(result));
    expect(() => renderSemanticMutationSourceEdit(
      result.plan,
      new TextEncoder().encode('# concurrent write\n')
    )).toThrow('before-byte CAS');
  });
});

test('path boundary rejects lexical escape, aliases, device names, case mismatch, and junction parents', async () => {
  await withTempWorkspace(async (root) => {
    const transaction = path.join(root, '.sec', 'transactions', 'tx-path');
    await mkdir(transaction, { recursive: true });
    await mkdir(path.join(root, 'source', 'model'), { recursive: true });
    await writeFile(path.join(root, 'source', 'model', 'Item.yaml'), sourceYaml());

    for (const relativePath of [
      'model/../outside.yaml',
      'model/item.yaml:stream',
      'model/CON.yaml',
      'model/item.yaml'
    ]) {
      await expect(readSemanticMutationSource(root, transaction, relativePath)).rejects.toMatchObject({
        diagnostic: { code: 'SEMANTIC-MUTATION-005', stage: 'path' }
      });
    }

    await link(
      path.join(root, 'source', 'model', 'Item.yaml'),
      path.join(root, 'source', 'model', 'hardlink.yaml')
    );
    await expect(readSemanticMutationSource(
      root,
      transaction,
      'model/hardlink.yaml'
    )).rejects.toMatchObject({ diagnostic: { code: 'SEMANTIC-MUTATION-005', stage: 'path' } });

    const realDirectory = path.join(root, 'real-model');
    await mkdir(realDirectory, { recursive: true });
    await writeFile(path.join(realDirectory, 'item.yaml'), sourceYaml());
    await symlink(realDirectory, path.join(root, 'source', 'model', 'linked'), 'junction');
    await expect(readSemanticMutationSource(
      root,
      transaction,
      'model/linked/item.yaml'
    )).rejects.toMatchObject({ diagnostic: { code: 'SEMANTIC-MUTATION-005' } });
  });
});

test('source bytes that drift from loaded provenance reject transform without mutating the workspace', async () => {
  await withTempWorkspace(async (root) => {
    const before = sourceYaml();
    const drifted = new TextEncoder().encode(new TextDecoder().decode(before).replace(
      'values: [closed, open]',
      'values: [closed, open, archived]'
    ));
    const transactionDirectory = await writePlanningWorkspace(root, drifted);
    const { contract, base, request, auth, preflight } = fixture();
    const result = await planSemanticMutationSourceEdit({
      request,
      base,
      authorization: auth,
      preflight,
      sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
      sourceCandidates: [candidate(contract)],
      workspaceRoot: root,
      transactionDirectory
    });
    expect(result).toMatchObject({
      status: 'rejected',
      rejectedAt: 'transform',
      diagnostics: [{ code: 'SEMANTIC-MUTATION-006' }]
    });
    expect(new Uint8Array(await readFile(path.join(root, modelRelativePath, 'item.yaml')))).toEqual(drifted);
  });
});

test('authoring source candidate does not change canonical IR identity outside its loaded contract content', () => {
  const contract = loadedContract();
  const before = buildEngineeringIR(buildInput(contract));
  const source = candidate(contract);
  expect(source.loadedContract).toEqual(contract);
  expect(buildEngineeringIR(buildInput(source.loadedContract))).toEqual(before);
});

test('fixed authoring index is a real loader provenance seam and does not infer unlisted source/model mirrors', async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(path.join(root, modelRelativePath), { recursive: true });
    await writeFile(path.join(root, modelRelativePath, 'item.yaml'), sourceYaml());
    expect(await loadAuthoringSemanticContractSources(root, new Set(['item/basic']))).toEqual([]);

    const indexPath = path.join(root, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
    await writeFile(indexPath, [
      'formatRevision: authoring-semantic-contract-index-v1',
      'contracts: []',
      'callerOwner: forged',
      ''
    ].join('\n'));
    await expect(loadAuthoringSemanticContractSources(root, new Set(['item/basic']))).rejects.toMatchObject({
      code: 'CONTRACT-SEMANTIC-019'
    });

    await writeFile(indexPath, [
      'formatRevision: authoring-semantic-contract-index-v1',
      'contracts:',
      '  - blockId: item/basic',
      '    path: model/item.yaml',
      ''
    ].join('\n'));
    const sources = await loadAuthoringSemanticContractSources(root, new Set(['item/basic']));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sourceKind: 'workspace-authoring',
      loadedContract: {
        blockId: 'item/basic',
        contractPath: `${modelRelativePath}/item.yaml`,
        contract: { id: 'item-core', namespace: 'item' }
      }
    });
    expect(sources[0]!.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(sources[0])).toBe(true);
  });
});
