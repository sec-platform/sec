import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  buildFactDelta,
  buildImpactPropagation,
  buildSemanticMutationResult,
  buildSemanticMutationVerificationPlanningContext,
  buildValidatedEngineeringIR,
  planSemanticMutation,
  preflightSemanticMutation,
  type BuildEngineeringIRInput,
  type SemanticMutationAuthorizationContextV2,
  type SemanticMutationDiagnosticV2,
  type SemanticMutationRequestV2,
  type VerificationRequirementV1
} from '../../platform/compiler/index.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../platform/compiler/semantic-mutation/semantic-mutation-result.ts';
import { canonicalVerificationUnion, sha256 } from '../../platform/compiler/semantic-mutation/canonical.ts';
import { semanticMutationStagedRebuildDiagnostic } from '../../platform/compiler/semantic-mutation/derive-staged-mutation.ts';
import { expectationFromFactDelta } from '../../platform/compiler/semantic-mutation/match-expectation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  assertSemanticMutationRecoveryRecordInvariant,
  loadSemanticMutationRecoveryRecords,
  projectSemanticMutationRequestRecordView,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord,
  semanticMutationRecoveryRecordRevision
} from '../../platform/compiler/semantic-mutation/mutation-recovery-record.ts';
import {
  assertSemanticMutationRejectedTerminalRecordInvariant,
  readRejectedSemanticMutationTerminal,
  reserveSemanticMutationTerminalSequence,
  writeRejectedSemanticMutationTerminal
} from '../../platform/compiler/semantic-mutation/mutation-terminal-record.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationRequestIdentityDigest,
  semanticMutationStagedTransactionId,
  semanticMutationTransactionRoot
} from '../../platform/compiler/semantic-mutation/transaction-identity.ts';
import { semanticMutationAuthorizationRevision } from '../../platform/compiler/semantic-mutation/normalize-request.ts';
import { semanticMutationRequiredVerificationDigest } from '../../platform/compiler/semantic-mutation/verification-policy.ts';
import {
  applySemanticMutation,
  querySemanticMutationRequest,
  recoverSemanticMutationWorkspace
} from '../../platform/orchestrator.ts';
import type { FactDeltaEndpointContext } from '../../platform/shared/engineering-ir-types.ts';
import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';
import {
  SEMANTIC_MUTATION_TERMINAL_RETENTION,
  type SemanticMutationRecoveryRecordV1
} from '../../platform/shared/semantic-mutation-transaction-types.ts';
import {
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
  SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION
} from '../../platform/shared/verification-types.ts';
import { semanticMutationVerificationReportFixture } from '../helpers/semantic-mutation-verification-report.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

const allowCommit = async (): Promise<void> => undefined;

test('staged rebuild diagnostics redact native absolute paths from apply and query projections', async () => {
  const secretPath = 'C:\\Users\\secret\\workspace\\.sec\\semantic-mutation\\v1\\transactions\\private';
  const error = Object.assign(new Error(`ENOENT: no such file or directory, open '${secretPath}'`), {
    code: 'ENOENT'
  });
  const diagnostic = semanticMutationStagedRebuildDiagnostic(error);

  expect(diagnostic).toEqual({
    origin: 'semantic-mutation',
    code: 'SEMANTIC-MUTATION-008',
    stage: 'staged-rebuild',
    message: 'Isolated staged semantic rebuild failed',
    details: { errorCode: 'ENOENT' }
  });
  expect(JSON.stringify(diagnostic)).not.toContain(secretPath);
  expect(semanticMutationStagedRebuildDiagnostic({ code: secretPath }).details).toEqual({
    errorCode: 'UNKNOWN'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:path-redaction');
    const result = rejectedResult(draft, [diagnostic]);
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      draft.requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );
    const identity = {
      graphId: draft.request.graphId,
      appId: draft.request.appId,
      requestId: draft.request.requestId
    } as const;
    const applyProjection = { status: 'terminal' as const, result };
    const queryProjection = await querySemanticMutationRequest(workspaceRoot, identity);
    expect(JSON.stringify(applyProjection)).not.toContain(secretPath);
    expect(JSON.stringify(queryProjection)).not.toContain(secretPath);
  }, 'engineering-compiler-sm3-diagnostic-redaction-');
});

function contract(withTransition: boolean): LoadedSemanticContract {
  return {
    blockId: 'item/basic',
    contractPath: 'source/model/item.yaml',
    contract: {
      formatVersion: '1',
      id: 'item-core',
      namespace: 'item',
      entities: [{ id: 'Item', fields: [{ id: 'status', type: 'ItemStatus', mutable: true }] }],
      states: [{
        id: 'item-status',
        entity: 'Item',
        field: 'status',
        owner: 'ItemStateMachine',
        values: ['closed', 'open'],
        transitions: withTransition ? [{ from: 'open', to: 'closed', by: 'closeItem' }] : []
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
    }
  };
}

function buildInput(withTransition: boolean): BuildEngineeringIRInput {
  return {
    app: { id: 'mutation-app', name: 'Mutation App' },
    resolvedBlocks: [{
      id: 'item/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'source/model/block.manifest.yaml',
      registrySourceId: 'workspace',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'source/model'
    }],
    manifests: [],
    slotTasks: [],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contract(withTransition)]
  };
}

function endpoint(
  snapshot: ReturnType<typeof buildValidatedEngineeringIR>,
  transactionId: string
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

function authorization(): SemanticMutationAuthorizationContextV2 {
  const draft: Omit<SemanticMutationAuthorizationContextV2, 'authorizationRevision'> = {
    taskId: 'task:mutation-journal',
    envelopeRevision: 'envelope:v2',
    allowedOperationKinds: ['add-state-transition'],
    allowedTargetEntityIds: ['state:item:item-status'],
    allowedSourceOwnerIds: ['owner:item-core'],
    allowedPathPrefixes: ['source/model/'],
    requiredPreconditions: [],
    requiredPostconditions: [],
    minimumVerification: []
  };
  return { ...draft, authorizationRevision: semanticMutationAuthorizationRevision(draft) };
}

function readyTransactionFixture(requestId = 'request:add-transition') {
  const before = buildValidatedEngineeringIR(buildInput(false));
  const after = buildValidatedEngineeringIR(buildInput(true));
  const base = endpoint(before, 'tx:base');
  const staged = endpoint(after, 'tx:staged');
  const delta = buildFactDelta(base, staged);
  const request: SemanticMutationRequestV2 = {
    contractVersion: '2',
    requestId,
    graphId: before.ir.graphId,
    appId: before.ir.appId,
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
    expectation: expectationFromFactDelta(delta, before, after),
    postconditions: [],
    additionalVerification: []
  };
  const auth = authorization();
  const preflight = preflightSemanticMutation({ request, base, authorization: auth });
  if (preflight.status !== 'ready') throw new Error(JSON.stringify(preflight));
  const impact = buildImpactPropagation({ delta, from: base, to: staged });
  const impactVerification: VerificationRequirementV1[] = impact.verification.map((entry) =>
    entry.kind === 'acceptance'
      ? { kind: 'acceptance', acceptanceEntityId: entry.acceptanceEntityId }
      : { kind: 'selector', selector: entry.selector });
  const requiredVerification = canonicalVerificationUnion(
    impactVerification,
    [{ kind: 'pass', passId: 'verify' }]
  );
  const verificationPlanning = buildSemanticMutationVerificationPlanningContext({
    adapterId: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID,
    adapterRevision: SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION,
    impactRevision: impact.impactRevision,
    uncertaintyStatus: 'covered',
    capabilities: requiredVerification.map((requirement) => ({
      requirement,
      status: 'runnable',
      isolated: true
    }))
  }, requiredVerification);
  const plan = planSemanticMutation({
    request,
    base,
    authorization: auth,
    preparation: {
      status: 'prepared',
      preflightRevision: preflight.preflightRevision,
      sourceChanges: [{
        ownerId: 'owner:item-core',
        adapterId: 'semantic-contract-yaml',
        adapterRevision: 'semantic-contract-yaml-v1',
        relativePath: 'source/model/item.yaml',
        beforeByteDigest: digest('before'),
        stagedByteDigest: digest('after'),
        invalidationFromStage: 'resolve'
      }],
      staged,
      rollbackManifestDigest: digest('rollback')
    },
    verificationPlanning
  });
  if (plan.status !== 'ready') throw new Error(JSON.stringify(plan));
  const verification = buildSemanticMutationVerificationExecutionRef(semanticMutationVerificationReportFixture({
    adapterId: plan.verificationAdapterId,
    adapterRevision: plan.verificationAdapterRevision,
    planRevision: plan.planRevision,
    attempted: plan.staged,
    stagedSourceDigest: plan.sourceChanges[0].stagedByteDigest,
    requiredVerificationDigest: semanticMutationRequiredVerificationDigest(plan.requiredVerification),
    status: 'passed',
    requirements: plan.requiredVerification
  }));
  return { request, auth, base, plan, verification };
}

type RecoveryDraft = Omit<
  SemanticMutationRecoveryRecordV1,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

function recoveryDraft(requestId = 'request:add-transition'): RecoveryDraft {
  const { request, auth, plan, verification } = readyTransactionFixture(requestId);
  return {
    state: 'prepared',
    transactionId: 'tx:live',
    requestIdentityDigest: semanticMutationRequestIdentityDigest({
      graphId: request.graphId,
      appId: request.appId,
      requestId: request.requestId
    }),
    requestRevision: plan.requestRevision,
    authorizationRevision: plan.authorizationRevision,
    expectedPlanRevision: plan.planRevision,
    planRevision: plan.planRevision,
    editPlanRevision: digest('edit-plan'),
    rollbackManifestDigest: plan.rollbackManifestDigest,
    relativePath: plan.sourceChanges[0].relativePath,
    beforeByteDigest: plan.sourceChanges[0].beforeByteDigest,
    committedByteDigest: plan.sourceChanges[0].stagedByteDigest,
    base: plan.base,
    staged: plan.staged,
    verificationExecutionRevision: verification.verificationExecutionRevision,
    verificationReportRevision: verification.reportRevision,
    request,
    authorization: auth,
    plan,
    verification,
    diagnostics: []
  };
}

function diagnostic(code: 'SEMANTIC-MUTATION-007' | 'SEMANTIC-MUTATION-012') {
  return {
    origin: 'semantic-mutation' as const,
    code,
    stage: code === 'SEMANTIC-MUTATION-007' ? 'cas' as const : 'rollback' as const,
    message: code === 'SEMANTIC-MUTATION-007' ? 'Plan CAS failed' : 'Recovery is required'
  };
}

function nextDraft(
  record: SemanticMutationRecoveryRecordV1,
  state: SemanticMutationRecoveryRecordV1['state'],
  fields: {
    readonly diagnostics?: RecoveryDraft['diagnostics'];
    readonly result?: RecoveryDraft['result'];
    readonly recoveryState?: RecoveryDraft['recoveryState'];
  } = {}
): RecoveryDraft {
  return {
    state,
    transactionId: record.transactionId,
    requestIdentityDigest: record.requestIdentityDigest,
    requestRevision: record.requestRevision,
    authorizationRevision: record.authorizationRevision,
    expectedPlanRevision: record.expectedPlanRevision,
    planRevision: record.planRevision,
    editPlanRevision: record.editPlanRevision,
    rollbackManifestDigest: record.rollbackManifestDigest,
    relativePath: record.relativePath,
    beforeByteDigest: record.beforeByteDigest,
    committedByteDigest: record.committedByteDigest,
    base: record.base,
    staged: record.staged,
    verificationExecutionRevision: record.verificationExecutionRevision,
    verificationReportRevision: record.verificationReportRevision,
    request: record.request,
    authorization: record.authorization,
    plan: record.plan,
    verification: record.verification,
    ...(fields.result === undefined ? {} : { result: fields.result }),
    ...(fields.recoveryState === undefined ? {} : { recoveryState: fields.recoveryState }),
    diagnostics: fields.diagnostics ?? []
  };
}

function acceptedResult(draft: RecoveryDraft) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'accepted',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    accepted: draft.plan.staged,
    verification: draft.verification as typeof draft.verification & { readonly status: 'passed' }
  });
}

function rolledBackResult(draft: RecoveryDraft) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'rolled-back',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    verification: draft.verification as typeof draft.verification & { readonly status: 'passed' },
    diagnostics: [diagnostic('SEMANTIC-MUTATION-012')]
  });
}

function recoveryRequiredResult(draft: RecoveryDraft) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'recovery-required',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    verification: draft.verification as typeof draft.verification & { readonly status: 'passed' },
    recoveryState: 'concurrent-write',
    diagnostics: [diagnostic('SEMANTIC-MUTATION-012')]
  });
}

function rejectedResult(
  draft: RecoveryDraft,
  diagnostics: readonly SemanticMutationDiagnosticV2[] = [diagnostic('SEMANTIC-MUTATION-007')]
) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'rejected',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    verification: draft.verification,
    diagnostics
  });
}

test('SM-3 request identity and staged transaction IDs use hand-reproducible frozen domains', () => {
  const identity = { graphId: 'graph:1', appId: 'app:1', requestId: 'request:1' } as const;
  expect(semanticMutationRequestIdentityDigest(identity)).toBe(digest({
    domain: 'semantic-mutation-request-identity-v1',
    ...identity
  }));
  const stagedInput = {
    requestRevision: digest('request'),
    authorizationRevision: digest('authorization'),
    base: {
      transactionId: 'tx:base',
      inputRevision: digest('input'),
      semanticRevision: digest('semantic')
    },
    sourceEditPlanRevision: digest('edit-plan')
  };
  expect(semanticMutationStagedTransactionId(stagedInput)).toBe(
    `tx:semantic-mutation-stage:${digest({
      domain: 'semantic-mutation-staged-transaction-v1',
      ...stagedInput
    }).slice('sha256:'.length)}`
  );
});

test('SM-3 recovery generations are immutable, chained, digest-bound, and fail closed on tampering', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await mkdir(transactionRoot, { recursive: true });
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);
    const committed = await appendSemanticMutationRecoveryRecord(transactionRoot, {
      ...draft,
      state: 'authoring-committed'
    }, allowCommit);
    expect(prepared.sequence).toBe(1);
    expect(committed.sequence).toBe(2);
    expect(committed.previousRecordRevision).toBe(prepared.recordRevision);
    expect(await loadSemanticMutationRecoveryRecords(transactionRoot)).toEqual([prepared, committed]);
    expect(Object.isFrozen(committed)).toBe(true);

    const forged = structuredClone(committed) as unknown as Record<string, unknown>;
    forged.committedByteDigest = digest('forged');
    expect(() => assertSemanticMutationRecoveryRecordInvariant(
      forged as unknown as SemanticMutationRecoveryRecordV1,
      prepared
    )).toThrow(
      'revision chain or content is invalid'
    );
    const { recordRevision: _revision, ...withoutRevision } = committed;
    expect(semanticMutationRecoveryRecordRevision(withoutRevision)).toBe(committed.recordRevision);
  });
});

test('SM-3 transaction root binding rejects copied authority under another valid identity', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDraft = recoveryDraft('request:source-authority');
    const sourceRoot = semanticMutationTransactionRoot(workspaceRoot, sourceDraft.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(sourceRoot, sourceDraft, allowCommit);

    const aliasDraft = recoveryDraft('request:copied-alias');
    const aliasRoot = semanticMutationTransactionRoot(workspaceRoot, aliasDraft.requestIdentityDigest);
    await cp(sourceRoot, aliasRoot, { recursive: true });
    const aliasIdentity = {
      graphId: aliasDraft.request.graphId,
      appId: aliasDraft.request.appId,
      requestId: aliasDraft.request.requestId
    } as const;

    await expect(loadSemanticMutationRecoveryRecords(aliasRoot)).rejects.toThrow('transaction root binding');
    await expect(querySemanticMutationRequestRecord(workspaceRoot, aliasIdentity))
      .rejects.toThrow('transaction root binding');
    await rm(sourceRoot, { recursive: true, force: true });
    await expect(recoverSemanticMutationWorkspace(workspaceRoot)).rejects.toThrow('transaction root binding');
    await expect(pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit))
      .rejects.toThrow('transaction root binding');
  }, 'engineering-compiler-sm3-transaction-root-alias-');
});

test('SM-3 transaction root binding rejects ancestor and transaction reparse aliases before writes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-transaction-escape-'));
    try {
      await symlink(
        externalRoot,
        path.join(workspaceRoot, '.sec'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const requestIdentityDigest = digest('ancestor-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
      await expect(assertSemanticMutationTransactionRoot(
        workspaceRoot,
        transactionRoot,
        requestIdentityDigest
      )).rejects.toThrow('transaction root binding');
      await expect(access(path.join(externalRoot, 'semantic-mutation')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-transaction-ancestor-junction-');

  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDigest = digest('root-junction-source');
    const aliasDigest = digest('root-junction-alias');
    const sourceRoot = semanticMutationTransactionRoot(workspaceRoot, sourceDigest);
    const aliasRoot = semanticMutationTransactionRoot(workspaceRoot, aliasDigest);
    await mkdir(sourceRoot, { recursive: true });
    await symlink(sourceRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertSemanticMutationTransactionRoot(workspaceRoot, aliasRoot, aliasDigest))
      .rejects.toThrow('transaction root binding');
  }, 'engineering-compiler-sm3-transaction-root-junction-');
});

test('SM-3 recovery records reject a pre-existing reparse directory without writing through it', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-escape-'));
    try {
      const draft = recoveryDraft('request:records-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      await mkdir(transactionRoot, { recursive: true });
      await symlink(
        externalRoot,
        path.join(transactionRoot, 'records'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit))
        .rejects.toThrow('journal directory binding');
      await expect(loadSemanticMutationRecoveryRecords(transactionRoot))
        .rejects.toThrow('journal directory binding');
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-junction-');
});

test('SM-3 terminal receipts reject a pre-existing reparse directory without writing through it', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-terminal-order-escape-'));
    try {
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      await mkdir(journalRoot, { recursive: true });
      await symlink(
        externalRoot,
        path.join(journalRoot, 'terminal-order'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const draft = recoveryDraft('request:terminal-order-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit
      )).rejects.toThrow('journal directory binding');
      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit
      )).rejects.toThrow('journal directory binding');
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-terminal-order-junction-');
});

test('SM-3 recovery record revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-pre-open-'));
    try {
      const draft = recoveryDraft('request:records-pre-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const records = path.join(transactionRoot, 'records');
      const parkedRecords = path.join(transactionRoot, 'records-after-fence');
      let swapped = false;

      await expect(appendSemanticMutationRecoveryRecord(
        transactionRoot,
        draft,
        allowCommit,
        {
          beforeTempOpenAfterFence: async () => {
            await rename(records, parkedRecords);
            await symlink(externalRoot, records, process.platform === 'win32' ? 'junction' : 'dir');
            swapped = true;
          }
        }
      )).rejects.toThrow('journal directory binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedRecords)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-pre-open-junction-');
});

test('SM-3 terminal completion revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-completion-pre-open-'));
    try {
      const draft = recoveryDraft('request:completion-pre-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      const terminalOrder = path.join(journalRoot, 'terminal-order');
      const parkedTerminalOrder = path.join(journalRoot, 'terminal-order-after-fence');
      let swapped = false;

      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit,
        {
          beforeCompletionTempOpenAfterFence: async () => {
            await rename(terminalOrder, parkedTerminalOrder);
            await symlink(
              externalRoot,
              terminalOrder,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            swapped = true;
          }
        }
      )).rejects.toThrow('journal directory binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedTerminalOrder)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-completion-pre-open-junction-');
});

test('SM-3 rejected terminal revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-rejected-pre-open-'));
    try {
      const draft = recoveryDraft('request:rejected-pre-open-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const parkedTransaction = path.join(
        path.dirname(transactionRoot),
        `.${path.basename(transactionRoot)}-after-fence`
      );
      let swapped = false;

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit,
        {
          beforeRejectedTempOpenAfterFence: async () => {
            await rename(transactionRoot, parkedTransaction);
            await symlink(
              externalRoot,
              transactionRoot,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            swapped = true;
          }
        }
      )).rejects.toThrow('transaction root binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedTransaction)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-rejected-pre-open-junction-');
});

test('SM-3 recovery record post-open directory swap preserves containment failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-post-open-'));
    try {
      const draft = recoveryDraft('request:records-post-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const records = path.join(transactionRoot, 'records');
      const parkedRecords = path.join(transactionRoot, 'records-before-junction');
      let swapped = false;
      let externalDecoy = '';

      await expect(appendSemanticMutationRecoveryRecord(
        transactionRoot,
        draft,
        allowCommit,
        {
          afterTempFileClosed: async () => {
            const tempName = (await readdir(records)).find((name) => name.startsWith('.record-'));
            if (!tempName) throw new Error('Recovery temp was not opened before the swap hook');
            await rename(records, parkedRecords);
            await symlink(externalRoot, records, process.platform === 'win32' ? 'junction' : 'dir');
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected recovery post-open failure');
          }
        }
      )).rejects.toThrow('injected recovery post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-post-open-junction-');
});

test('SM-3 terminal completion post-open directory swap preserves containment failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-completion-post-open-'));
    try {
      const draft = recoveryDraft('request:completion-post-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      const terminalOrder = path.join(journalRoot, 'terminal-order');
      const parkedTerminalOrder = path.join(journalRoot, 'terminal-order-before-junction');
      let swapped = false;
      let externalDecoy = '';

      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit,
        {
          afterCompletionTempFileClosed: async () => {
            const tempName = (await readdir(terminalOrder))
              .find((name) => name.startsWith('.completion-'));
            if (!tempName) throw new Error('Completion temp was not opened before the swap hook');
            await rename(terminalOrder, parkedTerminalOrder);
            await symlink(
              externalRoot,
              terminalOrder,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected terminal completion post-open failure');
          }
        }
      )).rejects.toThrow('injected terminal completion post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-completion-post-open-junction-');
});

test('SM-3 rejected terminal post-open directory swap preserves root failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-rejected-post-open-'));
    try {
      const draft = recoveryDraft('request:rejected-post-open-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const parkedTransaction = path.join(
        path.dirname(transactionRoot),
        `.${path.basename(transactionRoot)}-before-junction`
      );
      let swapped = false;
      let externalDecoy = '';

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit,
        {
          afterRejectedTempFileClosed: async () => {
            const tempName = (await readdir(transactionRoot)).find((name) => name.startsWith('.terminal-'));
            if (!tempName) throw new Error('Rejected terminal temp was not opened before the swap hook');
            await rename(transactionRoot, parkedTransaction);
            await symlink(
              externalRoot,
              transactionRoot,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected rejected terminal post-open failure');
          }
        }
      )).rejects.toThrow('injected rejected terminal post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-rejected-post-open-junction-');
});

test('SM-3 recovery journal freezes cross-bindings and keeps retained terminals immutable', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await mkdir(transactionRoot, { recursive: true });
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);

    await expect(appendSemanticMutationRecoveryRecord(transactionRoot, {
      ...draft,
      state: 'verified',
      result: acceptedResult(draft)
    }, allowCommit)).rejects.toThrow('state transition');

    const committed = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(prepared, 'authoring-committed'),
      allowCommit
    );
    const accepted = acceptedResult(draft);
    const verified = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(committed, 'verified', { result: accepted }),
      allowCommit
    );
    expect(verified.terminalSequence).toBe(1);

    const recoveryResult = recoveryRequiredResult(draft);
    await expect(appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(verified, 'recovery-required', {
        result: recoveryResult,
        recoveryState: 'concurrent-write',
        diagnostics: recoveryResult.diagnostics
      }),
      allowCommit
    )).rejects.toThrow('state transition');
    expect((await loadSemanticMutationRecoveryRecords(transactionRoot)).map(({ state }) => state))
      .toEqual(['prepared', 'authoring-committed', 'verified']);

    const forged = structuredClone(committed) as unknown as Record<string, unknown>;
    forged.requestRevision = digest('forged-request');
    const { recordRevision: _oldRevision, ...forgedDraft } = forged;
    forged.recordRevision = semanticMutationRecoveryRecordRevision(
      forgedDraft as unknown as Omit<SemanticMutationRecoveryRecordV1, 'recordRevision'>
    );
    expect(() => assertSemanticMutationRecoveryRecordInvariant(
      forged as unknown as SemanticMutationRecoveryRecordV1,
      prepared
    )).toThrow(
      'identity/revision/source bindings'
    );
  }, 'engineering-compiler-sm3-recovery-transitions-');
});

test('SM-3 rejected terminals are immutable, ordered, non-destructive, and project to a redacted view', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const transaction = readyTransactionFixture();
    const identity = {
      graphId: transaction.request.graphId,
      appId: transaction.request.appId,
      requestId: transaction.request.requestId
    } as const;
    const requestIdentityDigest = semanticMutationRequestIdentityDigest(identity);
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
    const prepared = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      recoveryDraft(),
      allowCommit
    );
    expect(await querySemanticMutationRequestRecord(workspaceRoot, identity)).toEqual(prepared);
    await writeFile(`${transactionRoot}/original.backup`, 'original', 'utf8');
    const result = rejectedResult(recoveryDraft());
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const terminal = await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );

    expect(terminal.terminalSequence).toBe(1);
    expect(await readRejectedSemanticMutationTerminal(transactionRoot)).toEqual(terminal);
    expect(await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    )).toEqual(terminal);
    expect(() => assertSemanticMutationRejectedTerminalRecordInvariant(terminal)).not.toThrow();
    await expect(access(`${transactionRoot}/records/000001-prepared.json`)).resolves.toBeNull();
    await expect(access(`${transactionRoot}/original.backup`)).resolves.toBeNull();

    const pollutedIdentity = { ...identity, injected: 'must-not-escape' };
    const rejectedView = projectSemanticMutationRequestRecordView(terminal, pollutedIdentity);
    expect(rejectedView).toMatchObject({
      recordKind: 'rejected-terminal',
      state: 'rejected',
      identity,
      terminalSequence: 1
    });
    expect(Object.keys(rejectedView)).not.toContain('request');
    expect(Object.keys(rejectedView)).not.toContain('authorization');
    expect(Object.keys(rejectedView)).not.toContain('plan');
    expect(Object.keys(rejectedView.identity)).toEqual(['graphId', 'appId', 'requestId']);
    expect(JSON.stringify(rejectedView)).not.toContain('must-not-escape');
    const activeView = projectSemanticMutationRequestRecordView(prepared);
    expect(activeView.recordKind).toBe('transaction');
    expect(Object.keys(activeView)).not.toContain('relativePath');
    expect(Object.keys(activeView)).not.toContain('beforeByteDigest');
    expect(Object.keys(activeView)).not.toContain('committedByteDigest');
    expect(Object.isFrozen(rejectedView)).toBe(true);
    expect(Object.isFrozen(rejectedView.identity)).toBe(true);
    expect(await querySemanticMutationRequest(workspaceRoot, pollutedIdentity)).toEqual(rejectedView);

    const exactReplay = await applySemanticMutation(workspaceRoot, {
      request: transaction.request,
      base: transaction.base,
      authorization: transaction.auth,
      expectedPlanRevision: transaction.plan.planRevision
    });
    expect(exactReplay).toEqual({ status: 'terminal', result: terminal.result });
    const collision = await applySemanticMutation(workspaceRoot, {
      request: {
        ...transaction.request,
        additionalVerification: [{ kind: 'pass', passId: 'verify' }]
      },
      base: transaction.base,
      authorization: transaction.auth,
      expectedPlanRevision: transaction.plan.planRevision
    });
    expect(collision.status).toBe('request-rejected');
    if (collision.status !== 'request-rejected') throw new Error(JSON.stringify(collision));
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SEMANTIC-MUTATION-001',
      stage: 'request'
    }));
    expect(await querySemanticMutationRequest(workspaceRoot, identity)).toEqual(rejectedView);

    const forged = structuredClone(terminal) as unknown as Record<string, unknown>;
    forged.requestRevision = digest('forged-request');
    expect(() => assertSemanticMutationRejectedTerminalRecordInvariant(
      forged as unknown as typeof terminal
    )).toThrow();
  }, 'engineering-compiler-sm3-rejected-terminal-');
});

test('SM-3 terminal allocator validates every durable receipt and rejects duplicate sequence evidence', async () => {
  const completionPath = (workspaceRoot: string, sequence: number): string => path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order',
    `${sequence.toString().padStart(12, '0')}.json`
  );
  const writeRejected = async (workspaceRoot: string, label: string): Promise<void> => {
    const draft = recoveryDraft(`request:${label}`);
    const result = rejectedResult(draft);
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const requestIdentityDigest = draft.requestIdentityDigest;
    await writeRejectedSemanticMutationTerminal(
      semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest),
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );
  };

  await withTempWorkspace(async (workspaceRoot) => {
    await writeRejected(workspaceRoot, 'receipt-one');
    await writeRejected(workspaceRoot, 'receipt-two');
    await writeRejected(workspaceRoot, 'receipt-three');
    const firstPath = completionPath(workspaceRoot, 1);
    const first = JSON.parse(await readFile(firstPath, 'utf8')) as Record<string, unknown>;
    first.completionRevision = digest('corrupted-non-latest-receipt');
    await writeFile(firstPath, `${JSON.stringify(first, null, 2)}\n`, 'utf8');
    await expect(writeRejected(workspaceRoot, 'receipt-four'))
      .rejects.toThrow('terminal completion content is invalid');
  }, 'engineering-compiler-sm3-terminal-order-full-scan-');

  await withTempWorkspace(async (workspaceRoot) => {
    await writeRejected(workspaceRoot, 'sequence-one');
    await writeRejected(workspaceRoot, 'sequence-two');
    const firstReceipt = await readFile(completionPath(workspaceRoot, 1), 'utf8');
    await writeFile(completionPath(workspaceRoot, 2), firstReceipt, 'utf8');
    await expect(writeRejected(workspaceRoot, 'sequence-three'))
      .rejects.toThrow('terminal completion content is invalid');
  }, 'engineering-compiler-sm3-terminal-order-duplicate-');

  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:terminal-sequence-exhausted');
    const terminalSequence = 999_999_999_999;
    const completion = {
      formatRevision: 'semantic-mutation-terminal-completion-v1' as const,
      terminalSequence,
      requestIdentityDigest: draft.requestIdentityDigest,
      state: 'rejected' as const
    };
    const receipt = {
      ...completion,
      completionRevision: sha256({
        domain: 'semantic-mutation-terminal-completion-v1',
        ...completion
      })
    };
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    const receiptPath = completionPath(workspaceRoot, terminalSequence);
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await expect(reserveSemanticMutationTerminalSequence(
      transactionRoot,
      draft.requestIdentityDigest,
      'rejected',
      allowCommit
    )).rejects.toThrow('terminal completion sequence is exhausted');
  }, 'engineering-compiler-sm3-terminal-order-exhausted-');
});

test('SM-3 query and pruning require the terminal record completion receipt', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:receipt-binding');
    const result = rejectedResult(draft);
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      draft.requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );
    await rm(path.join(
      workspaceRoot,
      '.sec',
      'semantic-mutation',
      'v1',
      'terminal-order',
      '000000000001.json'
    ));
    const identity = {
      graphId: draft.request.graphId,
      appId: draft.request.appId,
      requestId: draft.request.requestId
    } as const;
    await expect(readRejectedSemanticMutationTerminal(transactionRoot))
      .rejects.toThrow('completion receipt');
    await expect(querySemanticMutationRequestRecord(workspaceRoot, identity))
      .rejects.toThrow('completion receipt');
    await expect(pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit))
      .rejects.toThrow('completion receipt');
  }, 'engineering-compiler-sm3-terminal-receipt-binding-');
});

test('SM-3 public workspace recovery redacts its durable recovery-required record', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);
    const result = recoveryRequiredResult(draft);
    await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(prepared, 'recovery-required', {
        result,
        recoveryState: 'concurrent-write',
        diagnostics: result.diagnostics
      }),
      allowCommit
    );

    const outcome = await recoverSemanticMutationWorkspace(workspaceRoot);
    expect(outcome.status).toBe('recovery-required');
    if (outcome.status !== 'recovery-required') throw new Error(JSON.stringify(outcome));
    expect(outcome.record).toMatchObject({
      formatRevision: 'semantic-mutation-request-record-view-v1',
      recordKind: 'transaction',
      state: 'recovery-required',
      result: { status: 'recovery-required' }
    });
    expect(Object.keys(outcome.record)).not.toContain('request');
    expect(Object.keys(outcome.record)).not.toContain('authorization');
    expect(Object.keys(outcome.record)).not.toContain('plan');
    expect(Object.keys(outcome.record)).not.toContain('relativePath');
    expect(Object.keys(outcome.record)).not.toContain('beforeByteDigest');
    expect(Object.keys(outcome.record)).not.toContain('committedByteDigest');
    expect(JSON.stringify(outcome.record)).not.toContain('snapshot');
    expect(Object.isFrozen(outcome.record)).toBe(true);
  }, 'engineering-compiler-sm3-public-recovery-view-');
});

test('SM-3 recovery fails closed before mutating either of multiple unfinished transactions', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const first = recoveryDraft('request:unfinished-first');
    const second = recoveryDraft('request:unfinished-second');
    const firstRoot = semanticMutationTransactionRoot(workspaceRoot, first.requestIdentityDigest);
    const secondRoot = semanticMutationTransactionRoot(workspaceRoot, second.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(firstRoot, first, allowCommit);
    await appendSemanticMutationRecoveryRecord(secondRoot, second, allowCommit);

    await expect(recoverSemanticMutationWorkspace(workspaceRoot))
      .rejects.toThrow('multiple unfinished transactions');
    expect((await loadSemanticMutationRecoveryRecords(firstRoot)).map(({ state }) => state))
      .toEqual(['prepared']);
    expect((await loadSemanticMutationRecoveryRecords(secondRoot)).map(({ state }) => state))
      .toEqual(['prepared']);
  }, 'engineering-compiler-sm3-multiple-unfinished-');
});

test('SM-3 retention uses durable completion sequence across all retained terminal kinds', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const rejected = rejectedResult(recoveryDraft());
    if (rejected.status !== 'rejected') throw new Error('Expected rejected result');

    const oldestRejectedDigest = digest('identity:oldest-rejected');
    const oldestRejectedRoot = semanticMutationTransactionRoot(workspaceRoot, oldestRejectedDigest);
    await writeRejectedSemanticMutationTerminal(
      oldestRejectedRoot,
      oldestRejectedDigest,
      rejected.requestRevision,
      rejected.planRevision,
      rejected,
      allowCommit
    );

    const oldestDraft = recoveryDraft('request:oldest-verified');
    const oldestVerifiedRoot = semanticMutationTransactionRoot(workspaceRoot, oldestDraft.requestIdentityDigest);
    const oldestPrepared = await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      oldestDraft,
      allowCommit
    );
    const oldestCommitted = await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      nextDraft(oldestPrepared, 'authoring-committed'),
      allowCommit
    );
    await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      nextDraft(oldestCommitted, 'verified', { result: acceptedResult(oldestDraft) }),
      allowCommit
    );

    for (let index = 0; index < SEMANTIC_MUTATION_TERMINAL_RETENTION - 2; index += 1) {
      const middleDigest = digest(`identity:middle:${index}`);
      await writeRejectedSemanticMutationTerminal(
        semanticMutationTransactionRoot(workspaceRoot, middleDigest),
        middleDigest,
        rejected.requestRevision,
        rejected.planRevision,
        rejected,
        allowCommit
      );
    }

    const rolledDraft = recoveryDraft('request:newest-rolled-back');
    const newestRolledBackRoot = semanticMutationTransactionRoot(workspaceRoot, rolledDraft.requestIdentityDigest);
    const rolledPrepared = await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      rolledDraft,
      allowCommit
    );
    const rolledCommitted = await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      nextDraft(rolledPrepared, 'authoring-committed'),
      allowCommit
    );
    const rolledResult = rolledBackResult(rolledDraft);
    await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      nextDraft(rolledCommitted, 'rolled-back', {
        result: rolledResult,
        diagnostics: rolledResult.diagnostics
      }),
      allowCommit
    );

    const newestDraft = recoveryDraft('request:newest-verified');
    const newestVerifiedRoot = semanticMutationTransactionRoot(workspaceRoot, newestDraft.requestIdentityDigest);
    const newestPrepared = await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      newestDraft,
      allowCommit
    );
    const newestCommitted = await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      nextDraft(newestPrepared, 'authoring-committed'),
      allowCommit
    );
    await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      nextDraft(newestCommitted, 'verified', { result: acceptedResult(newestDraft) }),
      allowCommit
    );

    const activeDraft = recoveryDraft('request:active');
    const activeRoot = semanticMutationTransactionRoot(workspaceRoot, activeDraft.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(activeRoot, activeDraft, allowCommit);
    const recoveryDraftValue = recoveryDraft('request:recovery-required');
    const recoveryRoot = semanticMutationTransactionRoot(workspaceRoot, recoveryDraftValue.requestIdentityDigest);
    const recoveryPrepared = await appendSemanticMutationRecoveryRecord(
      recoveryRoot,
      recoveryDraftValue,
      allowCommit
    );
    const recoveryResult = recoveryRequiredResult(recoveryDraftValue);
    await appendSemanticMutationRecoveryRecord(
      recoveryRoot,
      nextDraft(recoveryPrepared, 'recovery-required', {
        result: recoveryResult,
        recoveryState: 'concurrent-write',
        diagnostics: recoveryResult.diagnostics
      }),
      allowCommit
    );

    await pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit);

    await expect(access(oldestRejectedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(oldestVerifiedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(newestRolledBackRoot)).resolves.toBeNull();
    await expect(access(newestVerifiedRoot)).resolves.toBeNull();
    await expect(access(activeRoot)).resolves.toBeNull();
    await expect(access(recoveryRoot)).resolves.toBeNull();
  }, 'engineering-compiler-sm3-terminal-retention-');
}, 180_000);
