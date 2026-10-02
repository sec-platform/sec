import { expect, test } from 'bun:test';
import { semanticMutationStagedRebuildDiagnostic } from '../../src/adapters/mutation/derive-staged-mutation.ts';
import {
  deriveSemanticMutation,
  type SemanticMutationDerivationOperations,
  type SemanticMutationPlanningCapability
} from '../../src/application/semantic-mutation-derivation.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { semanticMutationByteDigest } from '../../src/compiler/semantic-mutation/canonical.ts';
import type { FactDeltaEndpointContext } from '../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan } from '../../src/semantics/mutation/types.ts';
import { readyTransactionFixture } from '../helpers/semantic-mutation-recovery-fixture.ts';

const fixture = readyTransactionFixture('request:derivation');
const input = { request: fixture.request, base: fixture.base, authorization: fixture.auth };
const originalBytes = new TextEncoder().encode('before');
const stagedBytes = new TextEncoder().encode('after');
const digest = `sha256:${'a'.repeat(64)}`;
const scope = Object.freeze({ transactionRoot: '/owned/transaction', stagingWorkspaceRoot: '/owned/staging' });
const editPlan: SemanticMutationSourceEditPlan = {
  ownerId: 'owner:item-core', adapterId: 'semantic-contract-yaml', adapterRevision: 'semantic-contract-yaml-v1',
  relativePath: 'source/model/item.yaml', beforeByteDigest: semanticMutationByteDigest(originalBytes),
  stagedByteDigest: semanticMutationByteDigest(stagedBytes), editPlanRevision: digest,
  formatRevision: 'semantic-mutation-source-edit-plan-v1', requestRevision: digest,
  authorizationRevision: fixture.auth.authorizationRevision, preflightRevision: digest,
  operationRegistryRevision: 'semantic-mutation-operations-v1',
  sourceAdapterRegistryRevision: 'semantic-mutation-source-adapters-v1',
  sourceResolutionRevision: digest, sourceRevision: digest, sourceKind: 'workspace-authoring',
  namespace: 'item', contractId: 'item-core', operations: fixture.request.operations,
  rollbackManifestDigest: digest,
  pathEvidence: { formatRevision: 'semantic-mutation-source-path-evidence-v1',
    relativePath: 'source/model/item.yaml', workspaceIdentityDigest: digest,
    transactionDirectoryIdentityDigest: digest, parentIdentityDigest: digest,
    targetIdentityDigest: digest, pathEvidenceRevision: digest }
};
// These provider outputs establish only orchestration inputs. This test does
// not issue or validate physical path/rollback proofs or perform source I/O.
const rollbackManifest: SemanticMutationRollbackManifest = {
  formatRevision: 'semantic-mutation-rollback-manifest-v2', ownerId: 'owner:item-core',
  adapterId: 'semantic-contract-yaml', adapterRevision: 'semantic-contract-yaml-v1',
  relativePath: editPlan.relativePath, beforeByteDigest: editPlan.beforeByteDigest,
  stagedByteDigest: editPlan.stagedByteDigest, beforeByteLength: originalBytes.length,
  stagedByteLength: stagedBytes.length, fileMode: 0o600, windowsFileAttributes: null,
  encoding: 'utf-8', utf8Bom: false, lineEnding: 'none', finalNewline: false,
  pathEvidenceRevision: digest, rollbackManifestDigest: digest
};

// Independent staged source input, compiled only to establish the endpoint
// precondition. Expected call order and stop boundaries below are literal.
const stagedSnapshot = buildValidatedEngineeringIR({
  app: { id: 'mutation-app', name: 'Mutation App' },
  resolvedBlocks: [{ id: 'item/basic', version: '0.1.0', kind: 'capability', installOrder: 1,
    manifestPath: 'source/model/block.manifest.yaml', registrySourceId: 'workspace',
    registryKind: 'private', registryLocation: 'workspace', registryPath: 'source/model' }],
  manifests: [], acceptanceIds: [], policyDeclarations: [],
  semanticContracts: [{ blockId: 'item/basic', contractPath: 'source/model/item.yaml', contract: {
    formatVersion: '1', id: 'item-core', namespace: 'item',
    entities: [{ id: 'Item', fields: [{ id: 'status', type: 'ItemStatus', mutable: true }] }],
    states: [{ id: 'item-status', entity: 'Item', field: 'status', owner: 'ItemStateMachine',
      values: ['closed', 'open'], transitions: [{ from: 'open', to: 'closed', by: 'closeItem' }] }],
    responsibilities: [{ id: 'ItemStateMachine', role: 'Own item status', owns: ['Item.status'],
      implements: ['closeItem'], dependsOn: [] }],
    operations: [{ id: 'closeItem', responsibility: 'ItemStateMachine', inputs: ['Item'], output: 'Item',
      reads: ['Item.status'], writes: [], mutates: ['Item.status'], requiresPolicies: [], requiresPermissions: [],
      performsEffects: [], emits: [], invokes: [], awaits: [] }],
    events: [], policies: [], permissions: [], effects: [], scenarios: []
  } }]
});

function setup() {
  const events: string[] = [];
  const sources = Object.freeze([]);
  let capabilityEndpoint: FactDeltaEndpointContext | undefined;
  const operations: SemanticMutationDerivationOperations<typeof scope> = {
    readCurrentBundle() { expect(this).toBe(operations); events.push('read-current');
      return { snapshot: fixture.base.snapshot, semanticContractSources: sources }; },
    prepareScope(identity) { expect(this).toBe(operations); expect(identity).toMatch(/^sha256:/);
      events.push('prepare-scope'); return scope; },
    assertScope(actual) { expect(actual).toBe(scope); events.push('fence'); },
    planSourceEdit(actual, selected) {
      expect(this).toBe(operations); expect(actual).toBe(scope); events.push('source-plan');
      expect(selected.base.snapshot).toBe(fixture.base.snapshot);
      expect(selected.base.transactionId).toBe(input.base.transactionId);
      expect(selected.sourceCandidates).toBe(sources);
      return { status: 'planned', plan: editPlan, rollbackManifest };
    },
    readOriginalBytes(actual, relativePath) { expect(actual).toBe(scope);
      expect(relativePath).toBe('source/model/item.yaml'); events.push('read-source'); return originalBytes; },
    renderSourceEdit(plan, bytes) { expect(plan).toBe(editPlan); expect(bytes).toEqual(originalBytes);
      expect(bytes).not.toBe(originalBytes); events.push('render'); return stagedBytes; },
    prepareWorkspace(actual, selected) { expect(actual).toBe(scope); events.push('prepare-workspace');
      expect(selected).toEqual({ plan: editPlan, manifest: rollbackManifest, originalBytes, stagedBytes }); },
    readStagedBundle(actual) { expect(actual).toBe(scope); events.push('read-staged');
      return { snapshot: stagedSnapshot, semanticContractSources: [] }; },
    stagedRebuildDiagnostic(error) { events.push('diagnostic'); return semanticMutationStagedRebuildDiagnostic(error); }
  };
  const adapter: SemanticMutationPlanningCapability = {
    adapterId: 'semantic-mutation-local-verification', adapterRevision: 'semantic-mutation-local-verification-v2',
    async capabilityPlan(staged, requirements, root) {
      expect(this).toBe(adapter); events.push('capabilities'); capabilityEndpoint = staged;
      expect(root).toBe(scope.stagingWorkspaceRoot); expect(staged.snapshot).toBe(stagedSnapshot);
      return { formatRevision: 'semantic-mutation-verification-capability-plan-v1',
        adapterId: 'semantic-mutation-local-verification', adapterRevision: 'semantic-mutation-local-verification-v2',
        snapshotInputRevision: staged.inputRevision, snapshotSemanticRevision: staged.semanticRevision,
        status: 'runnable', capabilities: requirements.map(requirement => ({ requirement, status: 'runnable', isolated: true })),
        blockedRequirementKeys: [], capabilityPlanRevision: digest };
    }
  };
  return { operations, adapter, events, endpoint: () => capabilityEndpoint };
}

const successOrder = ['read-current', 'prepare-scope', 'source-plan', 'fence', 'read-source',
  'render', 'fence', 'prepare-workspace', 'fence', 'read-staged', 'fence', 'capabilities'];

test('staged derivation keeps the exact source/CAS/fence/rebuild/capability order and retained artifacts', async () => {
  const run = setup();
  const result = await deriveSemanticMutation(input, run.adapter, run.operations);
  expect(result.plan.status).toBe('ready');
  expect(run.events).toEqual(successOrder);
  expect(result.staged).toBe(run.endpoint());
  expect(result.editPlan).toBe(editPlan); expect(result.rollbackManifest).toBe(rollbackManifest);
  expect(result.originalBytes).toEqual(originalBytes); expect(result.stagedBytes).toBe(stagedBytes);
  expect(result.transactionRoot).toBe(scope.transactionRoot);
  expect(result.stagingWorkspaceRoot).toBe(scope.stagingWorkspaceRoot);
  expect(result.verificationCapabilityPlan?.status).toBe('runnable');
});

test('request or live-base rejection cannot allocate a staging scope', async () => {
  for (const kind of ['request', 'live-base'] as const) {
    const run = setup();
    if (kind === 'live-base') run.operations.readCurrentBundle = () => {
      run.events.push('read-current'); return { snapshot: stagedSnapshot, semanticContractSources: [] };
    };
    const result = await deriveSemanticMutation(kind === 'request'
      ? { ...input, request: { ...input.request, requestId: '' } } : input, run.adapter, run.operations);
    expect(result.plan.status).toBe('rejected');
    expect(run.events).toEqual(['read-current']);
    expect(result.transactionRoot).toBeUndefined();
    expect(result.verificationCapabilityPlan).toBeUndefined();
  }
});

test('source-plan and CAS rejection retain created scope without starting later effects', async () => {
  for (const kind of ['source-plan', 'cas'] as const) {
    const run = setup();
    if (kind === 'source-plan') run.operations.planSourceEdit = (_scope, selected) => {
      run.events.push('source-plan');
      if (selected.preflight.status !== 'ready') throw new Error('Expected ready preflight');
      return { status: 'rejected', rejectedAt: 'source-resolution',
        preflightRevision: selected.preflight.preflightRevision!, diagnostics: [{
          origin: 'semantic-mutation', code: 'SEMANTIC-MUTATION-004', stage: 'source-resolution',
          message: 'No owned source in the selected workspace'
        }] };
    };
    else run.operations.readOriginalBytes = () => { run.events.push('read-source'); return stagedBytes; };
    const result = await deriveSemanticMutation(input, run.adapter, run.operations);
    expect(result.plan.status).toBe('rejected');
    if (result.plan.status !== 'rejected') throw new Error('Expected rejection');
    expect(result.plan.rejectedAt).toBe(kind === 'cas' ? 'cas' : 'source-resolution');
    expect(run.events).toEqual(successOrder.slice(0, kind === 'cas' ? 5 : 3));
    expect(result.transactionRoot).toBe(scope.transactionRoot);
    expect(result.stagingWorkspaceRoot).toBeUndefined();
    expect(result.verificationCapabilityPlan).toBeUndefined();
    if (kind === 'cas') { expect(result.editPlan).toBe(editPlan); expect(result.rollbackManifest).toBe(rollbackManifest); }
  }
});

test('failures before staged preparation propagate unchanged and never become rebuild diagnostics', async () => {
  for (const key of ['prepareScope', 'planSourceEdit', 'assertScope', 'readOriginalBytes', 'renderSourceEdit'] as const) {
    const run = setup(); const failure = Object.freeze({ at: key });
    run.operations[key] = (() => { throw failure; }) as never;
    await expect(deriveSemanticMutation(input, run.adapter, run.operations)).rejects.toBe(failure);
    expect(run.events).not.toContain('diagnostic'); expect(run.events).not.toContain('prepare-workspace');
  }
});

test('staged preparation, rebuild and capability failures redact native details while retaining recovery inputs', async () => {
  for (const key of ['prepareWorkspace', 'readStagedBundle', 'capabilityPlan'] as const) {
    const run = setup();
    const fail = () => { throw Object.assign(new Error('/private/secret/path'), { code: 'EIO' }); };
    if (key === 'capabilityPlan') run.adapter.capabilityPlan = fail;
    else run.operations[key] = fail;
    const result = await deriveSemanticMutation(input, run.adapter, run.operations);
    expect(result.plan.status).toBe('rejected');
    if (result.plan.status !== 'rejected') throw new Error('Expected rejection');
    expect(result.plan.rejectedAt).toBe(key === 'capabilityPlan' ? 'impact-verification' : 'staged-rebuild');
    expect(result.plan.diagnostics).toContainEqual(key === 'capabilityPlan'
      ? { origin: 'semantic-mutation', code: 'SEMANTIC-MUTATION-010',
          stage: 'impact-verification', message: 'Verification capability planning failed' }
      : { origin: 'semantic-mutation', code: 'SEMANTIC-MUTATION-008',
          stage: 'staged-rebuild', message: 'Isolated staged semantic rebuild failed', details: { errorCode: 'EIO' } });
    expect(JSON.stringify(result)).not.toContain('/private/secret/path');
    expect(result.transactionRoot).toBe(scope.transactionRoot); expect(result.stagingWorkspaceRoot).toBe(scope.stagingWorkspaceRoot);
    expect(result.editPlan).toBe(editPlan); expect(result.rollbackManifest).toBe(rollbackManifest);
    expect(result.originalBytes).toEqual(originalBytes); expect(result.stagedBytes).toBe(stagedBytes);
    expect(result.verificationCapabilityPlan).toBeUndefined();
    if (key === 'capabilityPlan') expect(run.events).not.toContain('diagnostic');
    else expect(run.events.at(-1)).toBe('diagnostic');
  }
});
