import {
  SemanticMutationContractError,
  mutationDiagnostic
} from '../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest } from '../compiler/semantic-mutation/identity.ts';
import { normalizeSemanticMutationRequest } from '../compiler/semantic-mutation/normalize-request.ts';
import type {
  SemanticMutationApplyInput,
  SemanticMutationApplyOutcome,
  SemanticMutationInternalRecoveryOutcome,
  SemanticMutationRecoveryFailureState,
  SemanticMutationRecoveryRecord,
  SemanticMutationRequestIdentity,
  SemanticMutationRequestRecord
} from '../semantics/mutation/transaction.ts';
import type {
  NormalizedSemanticMutationRequest,
  SemanticMutationPlan,
  SemanticMutationResult,
  SemanticMutationRollbackManifest,
  SemanticMutationSourceEditPlan,
  SemanticMutationVerificationExecutionRef
} from '../semantics/mutation/types.ts';
import type { FactDeltaEndpointContext } from '../semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationVerificationCapabilityPlan } from '../assurance/verification/contract/types.ts';
import type { StagedVerificationProof } from '../assurance/verification/staged-proof/contract.ts';
import { buildSemanticMutationResult } from '../compiler/semantic-mutation/result.ts';
import {
  semanticMutationRequestRejected,
  semanticMutationTerminalRecoveryOutcome,
  semanticMutationUntrustedRequestId
} from './semantic-mutation-state.ts';

export type PreparedSemanticMutationApply = Readonly<{
  input: SemanticMutationApplyInput;
  normalized: NormalizedSemanticMutationRequest;
  identity: SemanticMutationRequestIdentity;
  requestIdentityDigest: string;
}>;

export type SemanticMutationApplyPreparation =
  | Readonly<{ status: 'ready'; prepared: PreparedSemanticMutationApply }>
  | Readonly<{ status: 'rejected'; outcome: SemanticMutationApplyOutcome }>;

export function prepareSemanticMutationApply(
  input: SemanticMutationApplyInput
): SemanticMutationApplyPreparation {
  let normalized: NormalizedSemanticMutationRequest;
  try {
    normalized = normalizeSemanticMutationRequest(input.request);
  } catch (error) {
    if (error instanceof SemanticMutationContractError) {
      return Object.freeze({
        status: 'rejected' as const,
        outcome: semanticMutationRequestRejected(
          semanticMutationUntrustedRequestId(input),
          '',
          [error.diagnostic]
        )
      });
    }
    throw error;
  }
  const identity: SemanticMutationRequestIdentity = Object.freeze({
    graphId: normalized.graphId,
    appId: normalized.appId,
    requestId: normalized.requestId
  });
  return Object.freeze({
    status: 'ready' as const,
    prepared: Object.freeze({
      input,
      normalized,
      identity,
      requestIdentityDigest: semanticMutationRequestIdentityDigest(identity)
    })
  });
}

/**
 * Project a physical workspace-writer admission refusal into the stable
 * Semantic Mutation request outcome. Bootstrap decides whether the physical
 * error is this admission class; application owns the domain diagnostic.
 */
export function rejectSemanticMutationWorkspaceWriterAdmission(
  prepared: PreparedSemanticMutationApply
): SemanticMutationApplyOutcome {
  return semanticMutationRequestRejected(
    prepared.normalized.requestId,
    prepared.normalized.requestRevision,
    [mutationDiagnostic(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Workspace writer lease is busy or cannot be safely reclaimed'
    )]
  );
}

export interface SemanticMutationWriterLeaseHandle<TLease> {
  readonly lease: TLease;
  release(): Promise<void>;
}

export interface SemanticMutationApplyAdmissionOperations<TLease> {
  acquire(): Promise<SemanticMutationWriterLeaseHandle<TLease>>;
  isWriterAdmissionFailure(error: unknown): boolean;
  execute(
    prepared: PreparedSemanticMutationApply,
    lease: TLease
  ): Promise<SemanticMutationApplyOutcome>;
}

/**
 * Own request preparation plus writer-admission lifetime without depending on
 * the physical lease implementation. The injected adapter classifies only its
 * concrete acquisition failure; application owns the stable rejection and
 * guarantees release after every admitted execution path.
 */
export async function executeSemanticMutationApplyAdmission<TLease>(
  input: SemanticMutationApplyInput,
  operations: SemanticMutationApplyAdmissionOperations<TLease>
): Promise<SemanticMutationApplyOutcome> {
  if (typeof operations.acquire !== 'function' ||
      typeof operations.isWriterAdmissionFailure !== 'function' ||
      typeof operations.execute !== 'function') {
    throw new TypeError('Semantic Mutation apply admission operations must be callable');
  }

  const preparation = prepareSemanticMutationApply(input);
  if (preparation.status === 'rejected') return preparation.outcome;
  const prepared = preparation.prepared;

  let handle: SemanticMutationWriterLeaseHandle<TLease>;
  try {
    handle = await operations.acquire.call(operations);
  } catch (error) {
    if (operations.isWriterAdmissionFailure.call(operations, error)) {
      return rejectSemanticMutationWorkspaceWriterAdmission(prepared);
    }
    throw error;
  }

  try {
    return await operations.execute.call(operations, prepared, handle.lease);
  } finally {
    await handle.release();
  }
}

function preparedValue(
  preparation: SemanticMutationApplyPreparation
): PreparedSemanticMutationApply {
  if (preparation.status !== 'ready') {
    throw new TypeError('Semantic Mutation apply preparation is not ready');
  }
  return preparation.prepared;
}

export function resolveSemanticMutationApplyRecovery(
  preparation: SemanticMutationApplyPreparation,
  recovery: SemanticMutationInternalRecoveryOutcome
): SemanticMutationApplyOutcome | null {
  if (recovery.status !== 'recovery-required') return null;
  const prepared = preparedValue(preparation);
  if (recovery.record.requestIdentityDigest === prepared.requestIdentityDigest) {
    return semanticMutationTerminalRecoveryOutcome(recovery);
  }
  return semanticMutationRequestRejected(
    prepared.normalized.requestId,
    prepared.normalized.requestRevision,
    [mutationDiagnostic(
      'SEMANTIC-MUTATION-012',
      'rollback',
      'Workspace has an unresolved Semantic Mutation recovery record'
    )]
  );
}

export function resolveSemanticMutationRetainedRequest(
  preparation: SemanticMutationApplyPreparation,
  retained: SemanticMutationRequestRecord | null
): SemanticMutationApplyOutcome | null {
  if (retained === null) return null;
  const prepared = preparedValue(preparation);
  if (retained.requestRevision !== prepared.normalized.requestRevision) {
    return semanticMutationRequestRejected(
      prepared.normalized.requestId,
      prepared.normalized.requestRevision,
      [mutationDiagnostic(
        'SEMANTIC-MUTATION-001',
        'request',
        'Retained request identity is already bound to a different request revision'
      )]
    );
  }
  if ('formatRevision' in retained &&
      retained.formatRevision === 'semantic-mutation-rejected-terminal-record-v1') {
    return { status: 'terminal', result: retained.result };
  }
  if ('state' in retained && (retained.state === 'verified' || retained.state === 'rolled-back')) {
    if (!retained.result) {
      throw new Error('Retained terminal history is missing its immutable result');
    }
    return { status: 'terminal', result: retained.result };
  }
  if ('state' in retained) {
    throw new Error('Semantic Mutation recovery left an unfinished request authority');
  }
  return null;
}

export type SemanticMutationRejectedPlanDecision =
  | Readonly<{ status: 'request-rejected'; outcome: SemanticMutationApplyOutcome }>
  | Readonly<{
      status: 'terminal-rejected';
      result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>;
      planRevision: string;
    }>;

export function resolveSemanticMutationRejectedPlan(
  preparation: SemanticMutationApplyPreparation,
  plan: Extract<SemanticMutationPlan, { readonly status: 'rejected' }>
): SemanticMutationRejectedPlanDecision {
  const prepared = preparedValue(preparation);
  if (plan.rejectedAt === 'request') {
    return Object.freeze({
      status: 'request-rejected' as const,
      outcome: semanticMutationRequestRejected(
        plan.requestId ?? prepared.normalized.requestId,
        prepared.normalized.requestRevision,
        plan.diagnostics
      )
    });
  }
  const result = buildSemanticMutationResult(plan);
  if (result.status !== 'rejected') {
    throw new Error('Rejected plan did not form a rejected result');
  }
  return Object.freeze({
    status: 'terminal-rejected' as const,
    result,
    planRevision: plan.planRevision
  });
}

export function resolveSemanticMutationPlanCas(
  preparation: SemanticMutationApplyPreparation,
  plan: Extract<SemanticMutationPlan, { readonly status: 'ready' }>
): Extract<SemanticMutationResult, { readonly status: 'rejected' }> | null {
  const prepared = preparedValue(preparation);
  if (plan.planRevision === prepared.input.expectedPlanRevision) return null;
  const result = buildSemanticMutationResult(plan, {
    status: 'rejected',
    diagnostics: [mutationDiagnostic(
      'SEMANTIC-MUTATION-007',
      'cas',
      'Expected plan revision does not match the lease-recomputed plan'
    )]
  });
  if (result.status !== 'rejected') {
    throw new Error('Plan CAS rejection did not form rejected result');
  }
  return result;
}

export function buildSemanticMutationVerificationRejection(input: Readonly<{
  plan: Extract<SemanticMutationPlan, { readonly status: 'ready' }>;
  transactionId: string;
  verification: SemanticMutationVerificationExecutionRef;
  isolatedVerificationFailure?: unknown;
}>): Extract<SemanticMutationResult, { readonly status: 'rejected' }> {
  const result = buildSemanticMutationResult(input.plan, {
    status: 'rejected',
    transactionId: input.transactionId,
    attempted: input.plan.staged,
    verification: input.verification,
    diagnostics: [mutationDiagnostic(
      'SEMANTIC-MUTATION-010',
      'impact-verification',
      'Isolated Semantic Mutation Verification did not pass',
      input.isolatedVerificationFailure === undefined
        ? {}
        : { details: { isolatedVerification: input.isolatedVerificationFailure } }
    )]
  });
  if (result.status !== 'rejected') {
    throw new Error('Verification rejection did not form rejected result');
  }
  return result;
}

export interface SemanticMutationApplyDerivation {
  readonly plan: SemanticMutationPlan;
  readonly transactionRoot?: string;
  readonly stagingWorkspaceRoot?: string;
  readonly editPlan?: SemanticMutationSourceEditPlan;
  readonly rollbackManifest?: SemanticMutationRollbackManifest;
  readonly originalBytes?: Uint8Array;
  readonly stagedBytes?: Uint8Array;
  readonly staged?: FactDeltaEndpointContext;
  readonly verificationCapabilityPlan?: SemanticMutationVerificationCapabilityPlan;
}

export type ReadySemanticMutationApplyDerivation = SemanticMutationApplyDerivation & Readonly<{
  plan: Extract<SemanticMutationPlan, { readonly status: 'ready' }>;
  transactionRoot: string;
  stagingWorkspaceRoot: string;
  editPlan: SemanticMutationSourceEditPlan;
  rollbackManifest: SemanticMutationRollbackManifest;
  originalBytes: Uint8Array;
  stagedBytes: Uint8Array;
  staged: FactDeltaEndpointContext;
  verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
}>;

export interface SemanticMutationApplyVerificationOutcome {
  readonly verification: SemanticMutationVerificationExecutionRef;
  readonly isolatedVerificationFailure?: unknown;
  readonly stagedVerificationProof?: StagedVerificationProof;
}

export interface SemanticMutationApplyExecutionOperations {
  recover(): Promise<SemanticMutationInternalRecoveryOutcome>;
  readRetained(identity: SemanticMutationRequestIdentity): Promise<SemanticMutationRequestRecord | null>;
  derive(): Promise<SemanticMutationApplyDerivation>;
  publishRejected(
    result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>,
    planRevision: string
  ): Promise<void>;
  verify(derived: ReadySemanticMutationApplyDerivation): Promise<SemanticMutationApplyVerificationOutcome>;
  issueTransactionId(): string;
  writeTransactionArtifacts(derived: ReadySemanticMutationApplyDerivation): Promise<void>;
  persistPrepared(
    derived: ReadySemanticMutationApplyDerivation,
    verification: SemanticMutationVerificationExecutionRef,
    transactionId: string
  ): Promise<SemanticMutationRecoveryRecord>;
  afterPrepared?(): void;
  publishSource(derived: ReadySemanticMutationApplyDerivation): Promise<void>;
  observeCurrentDigest(derived: ReadySemanticMutationApplyDerivation): Promise<string>;
  appendAuthoringCommitted(
    record: SemanticMutationRecoveryRecord,
    diagnostics?: readonly import('../semantics/mutation/types.ts').SemanticMutationDiagnostic[]
  ): Promise<SemanticMutationRecoveryRecord>;
  markRecoveryRequired(
    record: SemanticMutationRecoveryRecord,
    state: SemanticMutationRecoveryFailureState,
    diagnostic: import('../semantics/mutation/types.ts').SemanticMutationDiagnostic
  ): Promise<Extract<SemanticMutationInternalRecoveryOutcome, { readonly status: 'recovery-required' }>>;
  rollbackCommitted(
    record: SemanticMutationRecoveryRecord,
    diagnostic: import('../semantics/mutation/types.ts').SemanticMutationDiagnostic
  ): Promise<SemanticMutationInternalRecoveryOutcome>;
  completeCommitted(
    record: SemanticMutationRecoveryRecord,
    proof?: StagedVerificationProof
  ): Promise<SemanticMutationInternalRecoveryOutcome>;
  prune(): Promise<void>;
  isExecutionBoundaryFailure(error: unknown): boolean;
}

function semanticMutationRollbackDiagnostic(message: string) {
  return mutationDiagnostic('SEMANTIC-MUTATION-012', 'rollback', message);
}

function semanticMutationPublishFailureDiagnostic(error: unknown) {
  return error instanceof Error && 'diagnostic' in error
    ? (error as { readonly diagnostic: import('../semantics/mutation/types.ts').SemanticMutationDiagnostic }).diagnostic
    : mutationDiagnostic('SEMANTIC-MUTATION-011', 'publish', 'Atomic source publish failed');
}

function readyDerivation(
  derived: SemanticMutationApplyDerivation
): ReadySemanticMutationApplyDerivation {
  if (derived.plan.status !== 'ready' ||
    !derived.transactionRoot || !derived.stagingWorkspaceRoot || !derived.editPlan ||
    !derived.rollbackManifest || !derived.originalBytes || !derived.stagedBytes ||
    !derived.staged || !derived.verificationCapabilityPlan) {
    throw new Error('Ready Semantic Mutation plan is missing staged transaction evidence');
  }
  return derived as ReadySemanticMutationApplyDerivation;
}

/** Run the business state machine under an already-acquired workspace lease.
 * Physical writes, isolated execution, journal persistence and rebuilds are
 * injected effects; this layer owns terminal/recovery decisions and ordering. */
export async function executePreparedSemanticMutationApply(
  prepared: PreparedSemanticMutationApply,
  operations: SemanticMutationApplyExecutionOperations
): Promise<SemanticMutationApplyOutcome> {
  const required = [
    operations.recover, operations.readRetained, operations.derive,
    operations.publishRejected, operations.verify, operations.issueTransactionId,
    operations.writeTransactionArtifacts, operations.persistPrepared,
    operations.publishSource, operations.observeCurrentDigest,
    operations.appendAuthoringCommitted, operations.markRecoveryRequired,
    operations.rollbackCommitted, operations.completeCommitted, operations.prune,
    operations.isExecutionBoundaryFailure
  ];
  if (required.some(operation => typeof operation !== 'function') ||
      (operations.afterPrepared !== undefined && typeof operations.afterPrepared !== 'function')) {
    throw new TypeError('Semantic Mutation apply execution operations must be callable');
  }
  const preparation = Object.freeze({ status: 'ready' as const, prepared });

  const recovery = await operations.recover.call(operations);
  const recoveryDecision = resolveSemanticMutationApplyRecovery(preparation, recovery);
  if (recoveryDecision !== null) return recoveryDecision;

  const retained = await operations.readRetained.call(operations, prepared.identity);
  const retainedDecision = resolveSemanticMutationRetainedRequest(preparation, retained);
  if (retainedDecision !== null) return retainedDecision;

  const derived = await operations.derive.call(operations);
  if (derived.plan.status === 'rejected') {
    const decision = resolveSemanticMutationRejectedPlan(preparation, derived.plan);
    if (decision.status === 'request-rejected') return decision.outcome;
    await operations.publishRejected.call(
      operations,
      decision.result,
      decision.planRevision
    );
    return { status: 'terminal', result: decision.result };
  }

  const ready = readyDerivation(derived);
  const casRejection = resolveSemanticMutationPlanCas(preparation, ready.plan);
  if (casRejection !== null) {
    await operations.publishRejected.call(operations, casRejection, ready.plan.planRevision);
    return { status: 'terminal', result: casRejection };
  }

  const verified = await operations.verify.call(operations, ready);
  const transactionId = operations.issueTransactionId.call(operations);
  if (typeof transactionId !== 'string' || transactionId.length === 0) {
    throw new TypeError('Semantic Mutation live transaction identity must be non-empty');
  }
  if (verified.verification.status !== 'passed') {
    const result = buildSemanticMutationVerificationRejection({
      plan: ready.plan,
      transactionId,
      verification: verified.verification,
      ...(verified.isolatedVerificationFailure === undefined
        ? {}
        : { isolatedVerificationFailure: verified.isolatedVerificationFailure })
    });
    await operations.publishRejected.call(operations, result, ready.plan.planRevision);
    return { status: 'terminal', result };
  }

  await operations.writeTransactionArtifacts.call(operations, ready);
  let record = await operations.persistPrepared.call(
    operations,
    ready,
    verified.verification,
    transactionId
  );
  operations.afterPrepared?.call(operations);

  try {
    await operations.publishSource.call(operations, ready);
  } catch (error) {
    const diagnostic = semanticMutationPublishFailureDiagnostic(error);
    let currentDigest: string;
    try {
      currentDigest = await operations.observeCurrentDigest.call(operations, ready);
    } catch {
      return semanticMutationTerminalRecoveryOutcome(
        await operations.markRecoveryRequired.call(
          operations,
          record,
          'rebuild-failed',
          semanticMutationRollbackDiagnostic(
            'Atomic publish failure could not prove the current live source digest'
          )
        )
      );
    }

    if (currentDigest === ready.editPlan.stagedByteDigest) {
      record = await operations.appendAuthoringCommitted.call(
        operations,
        record,
        [diagnostic]
      );
      const rolledBack = await operations.rollbackCommitted.call(
        operations,
        record,
        diagnostic
      );
      if (rolledBack.status === 'terminal') {
        await operations.prune.call(operations);
        return { status: 'terminal', result: rolledBack.result };
      }
      if (rolledBack.status === 'recovery-required') {
        return semanticMutationTerminalRecoveryOutcome(rolledBack);
      }
      throw new Error('Post-publish rollback returned a non-terminal recovery outcome');
    }

    if (currentDigest !== ready.editPlan.beforeByteDigest) {
      return semanticMutationTerminalRecoveryOutcome(
        await operations.markRecoveryRequired.call(
          operations,
          record,
          'concurrent-write',
          semanticMutationRollbackDiagnostic(
            'Atomic publish failure left unowned live source bytes'
          )
        )
      );
    }

    const result = buildSemanticMutationResult(ready.plan, {
      status: 'rejected',
      transactionId,
      attempted: ready.plan.staged,
      verification: verified.verification,
      diagnostics: [diagnostic]
    });
    if (result.status !== 'rejected') {
      throw new Error('Publish rejection did not form rejected result');
    }
    await operations.publishRejected.call(operations, result, ready.plan.planRevision);
    return { status: 'terminal', result };
  }

  try {
    record = await operations.appendAuthoringCommitted.call(operations, record);
  } catch (error) {
    if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
    return semanticMutationTerminalRecoveryOutcome(
      await operations.markRecoveryRequired.call(
        operations,
        record,
        'rebuild-failed',
        semanticMutationRollbackDiagnostic(
          'Published source could not durably record its authoring commit'
        )
      )
    );
  }

  const terminal = await operations.completeCommitted.call(
    operations,
    record,
    verified.stagedVerificationProof
  );
  await operations.prune.call(operations);
  if (terminal.status === 'terminal') {
    return { status: 'terminal', result: terminal.result };
  }
  if (terminal.status === 'recovery-required') {
    return semanticMutationTerminalRecoveryOutcome(terminal);
  }
  throw new Error('Committed Semantic Mutation did not reach a terminal recovery outcome');
}

