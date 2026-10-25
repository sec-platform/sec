import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { YamlInputLimitError, YamlSyntaxError } from '../../../src/adapters/formats/yaml.ts';
import { semanticMutationByteDigest } from '../../../src/compiler/semantic-mutation/canonical.ts';

import { planSemanticMutationSourceEdit, renderSemanticMutationSourceEdit } from '../../../src/adapters/mutation/plan-source-edit.ts';
import {
  renderSemanticContractYamlEdit,
} from '../../../src/adapters/mutation/semantic-contract-yaml-adapter.ts';
import { readSemanticMutationSource } from '../../../src/adapters/mutation/source-path-boundary.ts';
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES, loadAuthoringSemanticContractSources } from "../../../src/adapters/workspace/sources/load-authoring-semantic-contracts.ts";
import type { BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { semanticMutationAuthorizationRevision } from '../../../src/compiler/semantic-mutation/normalize-request.ts';
import { preflightSemanticMutation } from '../../../src/compiler/semantic-mutation/preflight-semantic-mutation.ts';
import { resolveSemanticMutationSource } from '../../../src/compiler/semantic-mutation/source-adapter-registry.ts';
import { normalizeSemanticContract } from '../../../src/semantics/definitions/normalize.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, type SemanticMutationAuthorizationContext, type SemanticMutationLoadedSourceCandidate, type SemanticMutationRequest } from '../../../src/semantics/mutation/types.ts';
import { buildSemanticContractSourceCandidate } from "../../../src/semantics/provenance/source-candidate.ts";
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH, AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION } from "../../../src/workspace/contract/authoring-index.ts";
import { modelRelativePath } from '../../../src/workspace/contract/types.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';
import { semanticMutationEngineeringInput } from '../../helpers/semantic-mutation-recovery-fixture.ts';

function loadedContract(): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath: `${modelRelativePath}/item.yaml`,
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
    ...semanticMutationEngineeringInput(false, { sourceRoot: 'model' }),
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
  contract: LoadedSemanticContract,
  sourceKind: 'workspace-authoring' | 'workspace-registry' | 'compiler-registry' = 'workspace-authoring'
): SemanticMutationLoadedSourceCandidate {
  return buildSemanticContractSourceCandidate(sourceKind, contract);
}

test('SM-2 plans one deterministic YAML edit and preserves comments, BOM, CRLF, and final-newline policy', async () => {
  await withTempWorkspace(async (root) => {
    const before = sourceYaml({ bom: true, eol: '\r\n', finalNewline: false });
    const transactionDirectory = await writePlanningWorkspace(root, before);
    const { contract, base, request, auth, preflight } = fixture();
    const source = candidate(contract);
    expect(source.loadedContract).toEqual(contract);
    const input = {
      request,
      base,
      authorization: auth,
      preflight,
      sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
      sourceCandidates: [source],
      workspaceRoot: root,
      transactionDirectory
    };
    const first = await planSemanticMutationSourceEdit(input);
    const second = await planSemanticMutationSourceEdit(input);
    expect(first.status).toBe('planned');
    expect(second).toEqual(first);
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

test('semantic YAML edits preserve canonical nodes and style while reporting typed syntax failures', () => {
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
  expect(text).toContain('from: closed');
  expect(text).toContain('to: pending');
  expect(text.indexOf('from: closed')).toBeLessThan(text.indexOf('from: open'));
  expect(text.match(/from:/gu)).toHaveLength(2);
  expect(text.endsWith('\n')).toBe(false);
  expect(text.replaceAll('\r\n', '')).not.toContain('\n');

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

test('owner resolution rejects registry sources, ambiguous ownership, and unauthorized authoring owners', () => {
  const { contract, base, request, auth } = fixture();
  const normalized = {
    ...request,
    requestRevision: 'sha256:'.padEnd(71, '0')
  };
  const authoring = candidate(contract);
  for (const sources of [
    [candidate(contract, 'workspace-registry')],
    [candidate(contract, 'compiler-registry')]
  ]) {
    expect(resolveSemanticMutationSource(normalized, base, auth, sources).status).toBe('rejected');
  }
  expect(resolveSemanticMutationSource(normalized, base, auth, [
    authoring, candidate(contract, 'workspace-registry')
  ])).toMatchObject({
    status: 'rejected',
    diagnostics: [{
      code: 'SEMANTIC-MUTATION-004',
      message: 'Loaded contract provenance does not resolve to exactly one source owner',
      details: { candidateCounts: [2] }
    }]
  });

  const unauthorized = authorization('semantic-contract-owner:item:other');
  const unauthorizedFixture = fixture(contract, unauthorized);
  expect(resolveSemanticMutationSource(
    { ...unauthorizedFixture.request, requestRevision: 'sha256:'.padEnd(71, '0') },
    unauthorizedFixture.base,
    unauthorized,
    [authoring]
  ).status).toBe('rejected');
});

test('path boundary rejects lexical escape, aliases, device names, case mismatch, and junction parents', async () => {
  await withTempWorkspace(async (root) => {
    const transaction = path.join(root, '.sec', 'transactions', 'tx-path');
    await mkdir(transaction, { recursive: true });
    await mkdir(path.join(root, 'source', 'model'), { recursive: true });
    await writeFile(path.join(root, 'source', 'model', 'Item.yaml'), sourceYaml());
    const original = await readSemanticMutationSource(root, transaction, 'source/model/Item.yaml');
    expect(original.bytes).toEqual(sourceYaml());
    expect(original.pathEvidence.relativePath).toBe('source/model/Item.yaml');

    for (const relativePath of [
      'model/../outside.yaml',
      'model/item.yaml:stream',
      'model/CON.yaml',
      'source/model/item.yaml'
    ]) {
      await expect(readSemanticMutationSource(root, transaction, relativePath)).rejects.toMatchObject({
        diagnostic: { code: 'SEMANTIC-MUTATION-005', stage: 'path' }
      });
    }

    const realDirectory = path.join(root, 'real-model');
    await mkdir(realDirectory, { recursive: true });
    await writeFile(path.join(realDirectory, 'item.yaml'), sourceYaml());
    await symlink(realDirectory, path.join(root, 'source', 'model', 'linked'), 'junction');
    await expect(readSemanticMutationSource(
      root,
      transaction,
      'source/model/linked/item.yaml'
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

test('fixed authoring index admits only declared bounded sources and returns canonical provenance order', async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(path.join(root, modelRelativePath), { recursive: true });
    const sourcePath = `${modelRelativePath}/item.yaml`;
    const sourceBytes = sourceYaml();
    await writeFile(path.join(root, sourcePath), sourceBytes);
    const resolved = new Set(['item/basic']);
    const load = () => loadAuthoringSemanticContractSources(root, resolved);
    expect(await load()).toEqual([]);

    const indexPath = path.join(root, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
    const writeIndex = (contracts: unknown[]) => writeFile(indexPath, JSON.stringify({
      formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts
    }));
    await writeIndex([]);
    expect(await load()).toEqual([]);
    for (const raw of [null, {}, { formatRevision: 'other', contracts: [] },
      { formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts: null },
      { formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts: [], callerOwner: 'forged' }]) {
      await writeFile(indexPath, JSON.stringify(raw));
      await expect(load()).rejects.toMatchObject({ code: 'CONTRACT-SEMANTIC-019' });
    }
    for (const entry of [null, { blockId: 7, path: 'a' }, { blockId: 'item/basic', path: 7 },
      { blockId: 'item/basic', path: 'a', extra: true }]) {
      await writeIndex([entry]);
      await expect(load()).rejects.toMatchObject({ code: 'CONTRACT-SEMANTIC-020' });
    }
    await writeIndex([{ blockId: 'block/unresolved', path: sourcePath }]);
    await expect(load()).rejects.toMatchObject({ code: 'CONTRACT-SEMANTIC-020' });
    for (const entryPath of ['../escape.yaml', 'src/a.yaml', `${modelRelativePath}/a.json`, AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH]) {
      await writeIndex([{ blockId: 'item/basic', path: entryPath }]);
      await expect(load()).rejects.toMatchObject({ code: 'CONTRACT-SEMANTIC-021' });
    }
    await writeIndex([{ blockId: 'item/basic', path: sourcePath }, { blockId: 'item/basic', path: sourcePath }]);
    await expect(load()).rejects.toMatchObject({ code: 'CONTRACT-SEMANTIC-022' });

    await writeFile(indexPath, 'contracts: []\ncontracts: []\n');
    await expect(load()).rejects.toBeInstanceOf(YamlSyntaxError);
    await writeFile(indexPath, ' '.repeat(AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES + 1));
    await expect(load()).rejects.toBeInstanceOf(YamlInputLimitError);
    await writeFile(indexPath, Uint8Array.of(0xff));
    await expect(load()).rejects.toThrow();

    await writeIndex([{ blockId: 'item/basic', path: sourcePath }]);
    await writeFile(path.join(root, sourcePath), Buffer.from(sourceBytes).toString('utf8').replace('id: item-core', 'id: !unknown item-core'));
    await expect(load()).rejects.toBeInstanceOf(YamlSyntaxError);
    await writeFile(path.join(root, sourcePath), sourceBytes);
    const secondPath = `${modelRelativePath}/z-other.yaml`;
    await writeFile(path.join(root, secondPath), JSON.stringify({ formatVersion: '1', id: 'other-core', namespace: 'other' }));
    await writeIndex([{ blockId: 'item/basic', path: secondPath }, { blockId: 'item/basic', path: sourcePath }]);
    const sources = await load();
    expect(sources.map(source => source.loadedContract.contractPath)).toEqual([sourcePath, secondPath]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      sourceKind: 'workspace-authoring',
      loadedContract: {
        blockId: 'item/basic',
        contractPath: sourcePath,
        contract: { id: 'item-core', namespace: 'item' }
      }
    });
    expect(sources[1]!.loadedContract.contract).toMatchObject({ id: 'other-core', namespace: 'other' });
    expect(sources[0]!.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(sources[0])).toBe(true);
    expect(Object.isFrozen(sources[0]!.loadedContract.contract)).toBe(true);
  });
});
