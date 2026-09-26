import { SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_ID, SEMANTIC_MUTATION_LOCAL_VERIFICATION_ADAPTER_REVISION } from '../../../src/assurance/verification/contract/types.ts';
import { buildSemanticMutationVerificationExecutionRef } from '../../../src/assurance/verification/semantic-mutation/execution-ref.ts';
import { type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildFactDelta } from '../../../src/compiler/ir/build-fact-delta.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { buildImpactPropagation } from '../../../src/compiler/semantic-impact/build-impact-propagation.ts';
import { canonicalVerificationUnion, sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest } from '../../../src/compiler/semantic-mutation/identity.ts';
import { expectationFromFactDelta } from '../../../src/compiler/semantic-mutation/match-expectation.ts';
import { semanticMutationAuthorizationRevision } from '../../../src/compiler/semantic-mutation/normalize-request.ts';
import { planSemanticMutation } from '../../../src/compiler/semantic-mutation/plan.ts';
import { preflightSemanticMutation } from '../../../src/compiler/semantic-mutation/preflight.ts';
import { buildSemanticMutationResult } from '../../../src/compiler/semantic-mutation/result.ts';
import { buildSemanticMutationVerificationPlanningContext, semanticMutationRequiredVerificationDigest } from '../../../src/compiler/semantic-mutation/verification-policy.ts';
import type { LoadedSemanticContract } from '../../../src/semantics/definitions/types.ts';
import type { FactDeltaEndpointContext } from '../../../src/semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationRecoveryRecord } from '../../../src/semantics/mutation/transaction.ts';
import { type SemanticMutationAuthorizationContext, type SemanticMutationDiagnostic, type SemanticMutationRequest, type VerificationRequirement } from '../../../src/semantics/mutation/types.ts';
import { semanticMutationVerificationReportFixture } from './verification-report.ts';

export function digest(value: unknown): string {
  return sha256(value);
}

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

function authorization(): SemanticMutationAuthorizationContext {
  const draft: Omit<SemanticMutationAuthorizationContext, 'authorizationRevision'> = {
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

export function readyTransactionFixture(requestId = 'request:add-transition') {
  const before = buildValidatedEngineeringIR(buildInput(false));
  const after = buildValidatedEngineeringIR(buildInput(true));
  const base = endpoint(before, 'tx:base');
  const staged = endpoint(after, 'tx:staged');
  const delta = buildFactDelta(base, staged);
  const request: SemanticMutationRequest = {
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
  const impactVerification: VerificationRequirement[] = impact.verification.map((entry) =>
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

export type RecoveryDraft = Omit<
  SemanticMutationRecoveryRecord,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;

export function recoveryDraft(requestId = 'request:add-transition'): RecoveryDraft {
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

export function nextDraft(
  record: SemanticMutationRecoveryRecord,
  state: SemanticMutationRecoveryRecord['state'],
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

export function acceptedResult(draft: RecoveryDraft) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'accepted',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    accepted: draft.plan.staged,
    verification: draft.verification as typeof draft.verification & { readonly status: 'passed' }
  });
}

export function rolledBackResult(draft: RecoveryDraft) {
  if (draft.plan.status !== 'ready') throw new Error('Expected ready plan');
  return buildSemanticMutationResult(draft.plan, {
    status: 'rolled-back',
    transactionId: draft.transactionId,
    attempted: draft.plan.staged,
    verification: draft.verification as typeof draft.verification & { readonly status: 'passed' },
    diagnostics: [diagnostic('SEMANTIC-MUTATION-012')]
  });
}

export function recoveryRequiredResult(draft: RecoveryDraft) {
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

export function rejectedResult(
  draft: RecoveryDraft,
  diagnostics: readonly SemanticMutationDiagnostic[] = [diagnostic('SEMANTIC-MUTATION-007')]
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
