import type { FactDeltaEndpointContext } from '../semantics/engineering-ir/delta-types.ts';
import type {
  SemanticMutationInternalRecoveryOutcome,
  SemanticMutationRecoveryFailureState,
  SemanticMutationRecoveryRecord
} from '../semantics/mutation/transaction.ts';
import type {
  SemanticMutationBase,
  SemanticMutationDiagnostic,
  SemanticMutationVerificationExecutionRef
} from '../semantics/mutation/types.ts';
import type { SemanticMutationVerificationCapabilityPlan } from '../assurance/verification/contract/types.ts';
import {
  buildStagedVerificationProofBinding,
  type StagedVerificationProof,
  type StagedVerificationProofBinding
} from '../assurance/verification/staged-proof/contract.ts';
import { mutationDiagnostic } from '../compiler/semantic-mutation/canonical.ts';
import { recoveryDiagnostic } from '../compiler/semantic-mutation/recovery-diagnostic.ts';
import {
  advanceSemanticMutationRecoveryRecord,
  exactPreparedSemanticMutationRecoveryBinding,
  prepareSemanticMutationPreparedRejection,
  prepareSemanticMutationRecoveryRequiredTransition,
  prepareSemanticMutationRolledBackTransition,
  prepareSemanticMutationAcceptedTransition,
  type PreparedSemanticMutationArtifacts,
  type PreparedSemanticMutationCandidate,
  type SemanticMutationRecoveryRecordDraft
} from './semantic-mutation-recovery.ts';
import {
  requireReadySemanticMutationPlan
} from './semantic-mutation-state.ts';

type Awaitable<T> = T | PromiseLike<T>;

export type SemanticMutationPreparedRecoveryDerivation =
  PreparedSemanticMutationCandidate & Readonly<{
    stagingWorkspaceRoot?: string;
    verificationCapabilityPlan?: SemanticMutationVerificationCapabilityPlan;
  }>;

export interface SemanticMutationRecordRecoveryOperations {
  isExecutionBoundaryFailure(error: unknown): boolean;
  observeLiveDigest(record: SemanticMutationRecoveryRecord): Promise<string>;
  appendDraft(draft: SemanticMutationRecoveryRecordDraft): Promise<SemanticMutationRecoveryRecord>;
  restoreSource(): Promise<void>;
  rebuildLive(proof?: StagedVerificationProof): Promise<SemanticMutationBase>;
  assertProofBinding(proof: StagedVerificationProof, binding: StagedVerificationProofBinding): void;
  buildPreparedBase(record: SemanticMutationRecoveryRecord): Promise<FactDeltaEndpointContext>;
  derivePrepared(
    record: SemanticMutationRecoveryRecord,
    base: FactDeltaEndpointContext
  ): Promise<SemanticMutationPreparedRecoveryDerivation>;
  verifyPrepared(
    derived: SemanticMutationPreparedRecoveryDerivation & Readonly<{
      plan: ReturnType<typeof requireReadySemanticMutationPlan>;
      staged: FactDeltaEndpointContext;
      stagingWorkspaceRoot: string;
      verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
    }>
  ): Promise<SemanticMutationVerificationExecutionRef>;
  readPreparedArtifacts(): Promise<PreparedSemanticMutationArtifacts>;
  publishPreparedArtifacts(artifacts: PreparedSemanticMutationArtifacts): Promise<void>;
  publishRejected(result: Extract<
    import('../semantics/mutation/types.ts').SemanticMutationResult,
    { readonly status: 'rejected' }
  >): Promise<void>;
}

function ensureOperations(operations: SemanticMutationRecordRecoveryOperations): void {
  if ([
    operations.isExecutionBoundaryFailure,
    operations.observeLiveDigest,
    operations.appendDraft,
    operations.restoreSource,
    operations.rebuildLive,
    operations.assertProofBinding,
    operations.buildPreparedBase,
    operations.derivePrepared,
    operations.verifyPrepared,
    operations.readPreparedArtifacts,
    operations.publishPreparedArtifacts,
    operations.publishRejected
  ].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Semantic Mutation record recovery operations must be callable');
  }
}

export async function markRecoveryRequired(
  record: SemanticMutationRecoveryRecord,
  state: SemanticMutationRecoveryFailureState,
  diagnostic: SemanticMutationDiagnostic,
  operations: SemanticMutationRecordRecoveryOperations
): Promise<Extract<SemanticMutationInternalRecoveryOutcome, { readonly status: 'recovery-required' }>> {
  const transition = prepareSemanticMutationRecoveryRequiredTransition(record, state, diagnostic);
  return {
    status: 'recovery-required',
    record: await operations.appendDraft.call(operations, transition.draft)
  };
}

export async function rollbackCommitted(
  record: SemanticMutationRecoveryRecord,
  cause: SemanticMutationDiagnostic,
  operations: SemanticMutationRecordRecoveryOperations
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const plan = requireReadySemanticMutationPlan(record);
  try {
    await operations.restoreSource.call(operations);
    const restored = await operations.rebuildLive.call(operations);
    if (restored.inputRevision !== plan.base.inputRevision ||
        restored.semanticRevision !== plan.base.semanticRevision) {
      return markRecoveryRequired(
        record,
        'rebuild-failed',
        recoveryDiagnostic('Restored source did not rebuild the exact base semantic endpoint'),
        operations
      );
    }
    const transition = prepareSemanticMutationRolledBackTransition(record, cause);
    await operations.appendDraft.call(operations, transition.draft);
    return { status: 'terminal', result: transition.result };
  } catch (error) {
    if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
    const concurrent = error instanceof Error &&
      error.message.includes('not committed by this transaction');
    return markRecoveryRequired(
      record,
      concurrent ? 'concurrent-write' : 'rollback-failed',
      recoveryDiagnostic(
        concurrent
          ? 'Rollback CAS detected source bytes not owned by this transaction'
          : 'Atomic rollback or restored rebuild failed'
      ),
      operations
    );
  }
}

export async function completeCommitted(
  record: SemanticMutationRecoveryRecord,
  operations: SemanticMutationRecordRecoveryOperations,
  stagedVerificationProof?: StagedVerificationProof
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const plan = requireReadySemanticMutationPlan(record);
  const verifiedExecution = record.verification as
    SemanticMutationVerificationExecutionRef & { readonly status: 'passed' };
  let accepted: SemanticMutationBase;
  try {
    if (stagedVerificationProof !== undefined) {
      operations.assertProofBinding.call(
        operations,
        stagedVerificationProof,
        buildStagedVerificationProofBinding(
          verifiedExecution,
          stagedVerificationProof.verificationReportDigest
        )
      );
    }
    accepted = await operations.rebuildLive.call(operations, stagedVerificationProof);
    const currentDigest = await operations.observeLiveDigest.call(operations, record);
    if (accepted.inputRevision !== plan.staged.inputRevision ||
        accepted.semanticRevision !== plan.staged.semanticRevision ||
        currentDigest !== record.committedByteDigest) {
      throw new Error(
        'Live rebuild does not exactly match staged revisions and committed source digest'
      );
    }
  } catch (error) {
    if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
    return rollbackCommitted(
      record,
      mutationDiagnostic(
        'SEMANTIC-MUTATION-012',
        'rollback',
        'Post-publish live rebuild failed exact staged endpoint validation'
      ),
      operations
    );
  }

  const transition = prepareSemanticMutationAcceptedTransition(record, accepted);
  try {
    await operations.appendDraft.call(operations, transition.draft);
    return { status: 'terminal', result: transition.result };
  } catch (error) {
    if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
    return markRecoveryRequired(
      record,
      'rebuild-failed',
      recoveryDiagnostic(
        'Committed source could not durably finalize its verified journal state'
      ),
      operations
    );
  }
}

async function rejectPrepared(
  record: SemanticMutationRecoveryRecord,
  diagnostic: SemanticMutationDiagnostic,
  operations: SemanticMutationRecordRecoveryOperations
): Promise<SemanticMutationInternalRecoveryOutcome> {
  const result = prepareSemanticMutationPreparedRejection(record, diagnostic);
  await operations.publishRejected.call(operations, result);
  return { status: 'terminal', result };
}

function readyPreparedDerivation(
  derived: SemanticMutationPreparedRecoveryDerivation
): derived is SemanticMutationPreparedRecoveryDerivation & Readonly<{
  plan: ReturnType<typeof requireReadySemanticMutationPlan>;
  staged: FactDeltaEndpointContext;
  stagingWorkspaceRoot: string;
  verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan;
}> {
  return derived.plan.status === 'ready' &&
    derived.staged !== undefined &&
    typeof derived.stagingWorkspaceRoot === 'string' &&
    derived.stagingWorkspaceRoot.length > 0 &&
    derived.verificationCapabilityPlan !== undefined;
}

/** Recover one durable non-terminal mutation record. Physical source, staging,
 * Verification, journal and rebuild operations are injected; application owns
 * state transitions and exact recovery/terminal decisions. */
export async function recoverSemanticMutationRecord(
  record: SemanticMutationRecoveryRecord,
  operations: SemanticMutationRecordRecoveryOperations
): Promise<SemanticMutationInternalRecoveryOutcome> {
  ensureOperations(operations);
  if (record.state === 'verified' || record.state === 'rolled-back') {
    throw new Error('Retained terminal history is not recoverable workspace authority');
  }
  if (record.state === 'recovery-required') {
    return { status: 'recovery-required', record };
  }

  let digest: string;
  try {
    digest = await operations.observeLiveDigest.call(operations, record);
  } catch (error) {
    if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
    return markRecoveryRequired(
      record,
      'concurrent-write',
      recoveryDiagnostic('Crash recovery could not safely observe the live source'),
      operations
    );
  }
  if (digest !== record.beforeByteDigest && digest !== record.committedByteDigest) {
    return markRecoveryRequired(
      record,
      'concurrent-write',
      recoveryDiagnostic('Crash recovery detected third-party source bytes'),
      operations
    );
  }

  if (record.state === 'prepared' && digest === record.beforeByteDigest) {
    let base: FactDeltaEndpointContext;
    try {
      base = await operations.buildPreparedBase.call(operations, record);
    } catch (error) {
      if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
      return markRecoveryRequired(
        record,
        'rebuild-failed',
        recoveryDiagnostic('Prepared recovery could not rebuild the live semantic workspace'),
        operations
      );
    }
    let artifacts: PreparedSemanticMutationArtifacts;
    try {
      const derived = await operations.derivePrepared.call(operations, record, base);
      if (!readyPreparedDerivation(derived)) {
        return rejectPrepared(
          record,
          mutationDiagnostic(
            'SEMANTIC-MUTATION-007',
            'cas',
            'Prepared recovery could not reproduce the retained staged transaction'
          ),
          operations
        );
      }
      const verification = await operations.verifyPrepared.call(operations, derived);
      artifacts = await operations.readPreparedArtifacts.call(operations);
      if (!exactPreparedSemanticMutationRecoveryBinding(
        record,
        derived,
        verification,
        artifacts
      )) {
        return rejectPrepared(
          record,
          mutationDiagnostic(
            verification.verificationExecutionRevision === record.verificationExecutionRevision
              ? 'SEMANTIC-MUTATION-007'
              : 'SEMANTIC-MUTATION-010',
            verification.verificationExecutionRevision === record.verificationExecutionRevision
              ? 'cas'
              : 'impact-verification',
            'Prepared recovery evidence no longer exactly binds the retained transaction'
          ),
          operations
        );
      }
    } catch (error) {
      if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
      return rejectPrepared(
        record,
        mutationDiagnostic(
          'SEMANTIC-MUTATION-007',
          'cas',
          'Prepared recovery could not safely reproduce retained transaction evidence'
        ),
        operations
      );
    }
    await operations.publishPreparedArtifacts.call(operations, artifacts);
  }

  let committedRecord = record;
  if (record.state === 'prepared') {
    committedRecord = await operations.appendDraft.call(
      operations,
      advanceSemanticMutationRecoveryRecord(record, 'authoring-committed')
    );
  }

  if (digest === record.beforeByteDigest && record.state === 'authoring-committed') {
    let restored: SemanticMutationBase;
    try {
      restored = await operations.rebuildLive.call(operations);
    } catch (error) {
      if (operations.isExecutionBoundaryFailure.call(operations, error)) throw error;
      return markRecoveryRequired(
        record,
        'restore-validation-failed',
        recoveryDiagnostic(
          'Crash recovery could not validate the restored semantic endpoint'
        ),
        operations
      );
    }
    const plan = requireReadySemanticMutationPlan(record);
    if (restored.inputRevision !== plan.base.inputRevision ||
        restored.semanticRevision !== plan.base.semanticRevision) {
      return markRecoveryRequired(
        record,
        'restore-validation-failed',
        recoveryDiagnostic('Crash recovery found restored bytes but not the exact base endpoint'),
        operations
      );
    }
    const transition = prepareSemanticMutationRolledBackTransition(
      record,
      recoveryDiagnostic('Crash recovery verified an already-restored source')
    );
    await operations.appendDraft.call(operations, transition.draft);
    return { status: 'terminal', result: transition.result };
  }

  return completeCommitted(committedRecord, operations);
}
