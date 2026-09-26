import type { SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import type { StagedVerificationProof } from '../../assurance/verification/staged-proof/contract.ts';
import {
  SemanticMutationContractError,
  exactOwnKeys,
  isPlainObject,
  mutationDiagnostic
} from '../../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest } from '../../compiler/semantic-mutation/identity.ts';
import {
  normalizeSemanticMutationAuthorization,
  normalizeSemanticMutationRequest
} from '../../compiler/semantic-mutation/normalize-request.ts';
import { buildSemanticMutationResult } from '../../compiler/semantic-mutation/result.ts';
import { withAcquiredResource } from '../../execution/resource-settlement.ts';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type {
  SemanticMutationApplyInput,
  SemanticMutationApplyOutcome,
  SemanticMutationInternalRecoveryOutcome,
  SemanticMutationRecoveryFailureState,
  SemanticMutationRecoveryRecord,
  SemanticMutationRequestIdentity,
  SemanticMutationRequestRecord
} from '../../semantics/mutation/transaction.ts';
import type {
  NormalizedSemanticMutationRequest,
  SemanticMutationPlan,
  SemanticMutationResult,
  SemanticMutationRollbackManifest,
  SemanticMutationSourceEditPlan,
  SemanticMutationVerificationExecutionRef
} from '../../semantics/mutation/types.ts';
import {
  semanticMutationRequestRejected,
  semanticMutationTerminalRecoveryOutcome,
  semanticMutationUntrustedRequestId
} from './state.ts';

/** Invoke an already-selected port without consulting a mutable method table
 * or a caller-replaced Function.call/bind property. The receiver is preserved. */
function invokeMutationPort<Args extends unknown[], Result>(
  receiver: object,
  operation: (...args: Args) => Result,
  ...args: Args
): Result {
  return Reflect.apply(operation, receiver, args) as Result;
}

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
  let capturedInput: SemanticMutationApplyInput;
  try {
    normalized = normalizeSemanticMutationRequest(input.request);
    const { base, authorization, expectedPlanRevision } = input;
    if (!isPlainObject(base) ||
        !exactOwnKeys(base, ['transactionId', 'inputRevision', 'semanticRevision', 'snapshot'])) {
      throw new SemanticMutationContractError(mutationDiagnostic(
        'SEMANTIC-MUTATION-001', 'request', 'Trusted base must be an exact FactDeltaEndpointContext'
      ));
    }
    // Borrow the validated immutable IR snapshot; own the surrounding endpoint
    // coordinates, request and authorization values. Capturing these values
    // neither validates a forged IR nor grants future physical write authority.
    const capturedBase: FactDeltaEndpointContext = Object.freeze({
      transactionId: base.transactionId,
      inputRevision: base.inputRevision,
      semanticRevision: base.semanticRevision,
      snapshot: base.snapshot
    });
    const { requestRevision: _requestRevision, ...capturedRequest } = normalized;
    capturedInput = Object.freeze({
      request: Object.freeze(capturedRequest),
      base: capturedBase,
      authorization: normalizeSemanticMutationAuthorization(authorization),
      expectedPlanRevision
    });
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
      input: capturedInput,
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

interface SemanticMutationWriterLeaseHandle<TLease> {
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
 * guarantees release after every admitted execution path. A failed release
 * must not replace the execution failure or imply that its effects were undone.
 */
export async function executeSemanticMutationApplyAdmission<TLease>(
  input: SemanticMutationApplyInput,
  operations: SemanticMutationApplyAdmissionOperations<TLease>
): Promise<SemanticMutationApplyOutcome> {
  const { acquire, isWriterAdmissionFailure, execute } = operations;
  if (typeof acquire !== 'function' || typeof isWriterAdmissionFailure !== 'function' ||
      typeof execute !== 'function') {
    throw new TypeError('Semantic Mutation apply admission operations must be callable');
  }

  const preparation = prepareSemanticMutationApply(input);
  if (preparation.status === 'rejected') return preparation.outcome;
  const prepared = preparation.prepared;

  let handle: SemanticMutationWriterLeaseHandle<TLease>;
  try {
    handle = await invokeMutationPort(operations, acquire);
  } catch (error) {
    if (invokeMutationPort(operations, isWriterAdmissionFailure, error)) {
      return rejectSemanticMutationWorkspaceWriterAdmission(prepared);
    }
    throw error;
  }

  // Transfer the admitted handle, not its authority, to the shared scope.
  // Capture release before invoking execute or reading the lease: neither can
  // redirect closeout. An unusable release port is a provider contract failure,
  // not an admission refusal and not evidence that a resource was settled.
  const release = handle.release;
  if (typeof release !== 'function') {
    throw new TypeError('Admitted workspace writer has no callable release operation');
  }
  return withAcquiredResource({
    operationLabel: 'semantic-mutation-apply',
    resourceLabel: 'workspace-writer-lease',
    acquire: () => handle,
    use: selected => invokeMutationPort(operations, execute, prepared, selected.lease),
    release: selected => invokeMutationPort(selected, release)
  });
}

function preparedValue(
  preparation: SemanticMutationApplyPreparation
): PreparedSemanticMutationApply {
  if (preparation.status !== 'ready') {
    throw new TypeError('Semantic Mutation apply preparation is not ready');
  }
  return preparation.prepared;
}

function resolveSemanticMutationApplyRecovery(
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

function resolveSemanticMutationRetainedRequest(
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

type SemanticMutationRejectedPlanDecision =
  | Readonly<{ status: 'request-rejected'; outcome: SemanticMutationApplyOutcome }>
  | Readonly<{
      status: 'terminal-rejected';
      result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>;
      planRevision: string;
    }>;

function resolveSemanticMutationRejectedPlan(
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

function resolveSemanticMutationPlanCas(
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

function buildSemanticMutationVerificationRejection(input: Readonly<{
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

interface SemanticMutationApplyDerivation {
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

interface SemanticMutationApplyVerificationOutcome {
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
    diagnostics?: readonly import('../../semantics/mutation/types.ts').SemanticMutationDiagnostic[]
  ): Promise<SemanticMutationRecoveryRecord>;
  markRecoveryRequired(
    record: SemanticMutationRecoveryRecord,
    state: SemanticMutationRecoveryFailureState,
    diagnostic: import('../../semantics/mutation/types.ts').SemanticMutationDiagnostic
  ): Promise<Extract<SemanticMutationInternalRecoveryOutcome, { readonly status: 'recovery-required' }>>;
  rollbackCommitted(
    record: SemanticMutationRecoveryRecord,
    diagnostic: import('../../semantics/mutation/types.ts').SemanticMutationDiagnostic
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
    ? (error as { readonly diagnostic: import('../../semantics/mutation/types.ts').SemanticMutationDiagnostic }).diagnostic
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
  // The complete recovery/publish/settlement protocol is selected once before
  // any callback or await. Validation cannot be separated from later use by a
  // second read of the caller-owned operation table.
  const {
    recover, readRetained, derive, publishRejected, verify, issueTransactionId,
    writeTransactionArtifacts, persistPrepared, afterPrepared, publishSource,
    observeCurrentDigest, appendAuthoringCommitted, markRecoveryRequired,
    rollbackCommitted, completeCommitted, prune, isExecutionBoundaryFailure
  } = operations;
  const required = [
    recover, readRetained, derive, publishRejected, verify, issueTransactionId,
    writeTransactionArtifacts, persistPrepared, publishSource, observeCurrentDigest,
    appendAuthoringCommitted, markRecoveryRequired, rollbackCommitted,
    completeCommitted, prune, isExecutionBoundaryFailure
  ];
  if (required.some(operation => typeof operation !== 'function') ||
      (afterPrepared !== undefined && typeof afterPrepared !== 'function')) {
    throw new TypeError('Semantic Mutation apply execution operations must be callable');
  }
  const preparation = Object.freeze({ status: 'ready' as const, prepared });

  const recovery = await invokeMutationPort(operations, recover);
  const recoveryDecision = resolveSemanticMutationApplyRecovery(preparation, recovery);
  if (recoveryDecision !== null) return recoveryDecision;

  const retained = await invokeMutationPort(operations, readRetained, prepared.identity);
  const retainedDecision = resolveSemanticMutationRetainedRequest(preparation, retained);
  if (retainedDecision !== null) return retainedDecision;

  const derived = await invokeMutationPort(operations, derive);
  if (derived.plan.status === 'rejected') {
    const decision = resolveSemanticMutationRejectedPlan(preparation, derived.plan);
    if (decision.status === 'request-rejected') return decision.outcome;
    await invokeMutationPort(operations, publishRejected, decision.result, decision.planRevision);
    return { status: 'terminal', result: decision.result };
  }

  const ready = readyDerivation(derived);
  const casRejection = resolveSemanticMutationPlanCas(preparation, ready.plan);
  if (casRejection !== null) {
    await invokeMutationPort(operations, publishRejected, casRejection, ready.plan.planRevision);
    return { status: 'terminal', result: casRejection };
  }

  const verified = await invokeMutationPort(operations, verify, ready);
  const transactionId = invokeMutationPort(operations, issueTransactionId);
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
    await invokeMutationPort(operations, publishRejected, result, ready.plan.planRevision);
    return { status: 'terminal', result };
  }

  await invokeMutationPort(operations, writeTransactionArtifacts, ready);
  let record = await invokeMutationPort(
    operations, persistPrepared, ready,
    verified.verification,
    transactionId
  );
  if (afterPrepared !== undefined) invokeMutationPort(operations, afterPrepared);

  try {
    await invokeMutationPort(operations, publishSource, ready);
  } catch (error) {
    const diagnostic = semanticMutationPublishFailureDiagnostic(error);
    let currentDigest: string;
    try {
      currentDigest = await invokeMutationPort(operations, observeCurrentDigest, ready);
    } catch {
      return semanticMutationTerminalRecoveryOutcome(
        await invokeMutationPort(
          operations, markRecoveryRequired, record,
          'rebuild-failed',
          semanticMutationRollbackDiagnostic(
            'Atomic publish failure could not prove the current live source digest'
          )
        )
      );
    }

    if (currentDigest === ready.editPlan.stagedByteDigest) {
      record = await invokeMutationPort(operations, appendAuthoringCommitted, record, [diagnostic]);
      const rolledBack = await invokeMutationPort(operations, rollbackCommitted, record, diagnostic);
      if (rolledBack.status === 'terminal') {
        await invokeMutationPort(operations, prune);
        return { status: 'terminal', result: rolledBack.result };
      }
      if (rolledBack.status === 'recovery-required') {
        return semanticMutationTerminalRecoveryOutcome(rolledBack);
      }
      throw new Error('Post-publish rollback returned a non-terminal recovery outcome');
    }

    if (currentDigest !== ready.editPlan.beforeByteDigest) {
      return semanticMutationTerminalRecoveryOutcome(
        await invokeMutationPort(
          operations, markRecoveryRequired, record,
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
    await invokeMutationPort(operations, publishRejected, result, ready.plan.planRevision);
    return { status: 'terminal', result };
  }

  try {
    record = await invokeMutationPort(operations, appendAuthoringCommitted, record);
  } catch (error) {
    if (invokeMutationPort(operations, isExecutionBoundaryFailure, error)) throw error;
    return semanticMutationTerminalRecoveryOutcome(
      await invokeMutationPort(
        operations, markRecoveryRequired, record,
        'rebuild-failed',
        semanticMutationRollbackDiagnostic(
          'Published source could not durably record its authoring commit'
        )
      )
    );
  }

  const terminal = await invokeMutationPort(operations, completeCommitted, record, verified.stagedVerificationProof);
  await invokeMutationPort(operations, prune);
  if (terminal.status === 'terminal') {
    return { status: 'terminal', result: terminal.result };
  }
  if (terminal.status === 'recovery-required') {
    return semanticMutationTerminalRecoveryOutcome(terminal);
  }
  throw new Error('Committed Semantic Mutation did not reach a terminal recovery outcome');
}
