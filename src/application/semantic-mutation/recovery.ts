import { semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import { buildSemanticMutationResult } from '../../compiler/semantic-mutation/result.ts';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type {
  SemanticMutationApplyInput,
  SemanticMutationRecoveryFailureState,
  SemanticMutationRecoveryRecord
} from '../../semantics/mutation/transaction.ts';
import type {
  SemanticMutationBase,
  SemanticMutationDiagnostic,
  SemanticMutationPlan,
  SemanticMutationResult,
  SemanticMutationRollbackManifest,
  SemanticMutationSourceEditPlan,
  SemanticMutationVerificationExecutionRef
} from '../../semantics/mutation/types.ts';

export type SemanticMutationRecoveryRecordDraft = Omit<
  SemanticMutationRecoveryRecord,
  'formatRevision' | 'sequence' | 'previousRecordRevision' | 'terminalSequence' | 'recordRevision'
>;
export type ReadySemanticMutationPlan = Extract<SemanticMutationPlan, { readonly status: 'ready' }>;

export function buildPreparedSemanticMutationRecoveryRecord(input: {
  readonly request: SemanticMutationApplyInput;
  readonly plan: ReadySemanticMutationPlan;
  readonly editPlan: SemanticMutationSourceEditPlan;
  readonly rollbackManifest: SemanticMutationRollbackManifest;
  readonly transactionId: string;
  readonly requestIdentityDigest: string;
  readonly verification: SemanticMutationVerificationExecutionRef;
  readonly diagnostics?: readonly SemanticMutationDiagnostic[];
}): SemanticMutationRecoveryRecordDraft {
  return {
    state: 'prepared',
    transactionId: input.transactionId,
    requestIdentityDigest: input.requestIdentityDigest,
    requestRevision: input.plan.requestRevision,
    authorizationRevision: input.plan.authorizationRevision,
    expectedPlanRevision: input.request.expectedPlanRevision,
    planRevision: input.plan.planRevision,
    editPlanRevision: input.editPlan.editPlanRevision,
    rollbackManifestDigest: input.rollbackManifest.rollbackManifestDigest,
    relativePath: input.editPlan.relativePath,
    beforeByteDigest: input.editPlan.beforeByteDigest,
    committedByteDigest: input.editPlan.stagedByteDigest,
    base: input.plan.base,
    staged: input.plan.staged,
    verificationExecutionRevision: input.verification.verificationExecutionRevision,
    verificationReportRevision: input.verification.reportRevision,
    request: input.request.request,
    authorization: input.request.authorization,
    plan: input.plan,
    verification: input.verification,
    diagnostics: input.diagnostics ?? []
  };
}

export function advanceSemanticMutationRecoveryRecord(
  record: SemanticMutationRecoveryRecord,
  state: Exclude<SemanticMutationRecoveryRecord['state'], 'prepared'>,
  fields: {
    readonly diagnostics?: readonly SemanticMutationDiagnostic[];
    readonly result?: SemanticMutationResult;
    readonly recoveryState?: SemanticMutationRecoveryFailureState;
  } = {}
): SemanticMutationRecoveryRecordDraft {
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
    diagnostics: fields.diagnostics ?? record.diagnostics
  };
}

export interface PreparedSemanticMutationCandidate {
  readonly plan: SemanticMutationPlan;
  readonly editPlan?: SemanticMutationSourceEditPlan;
  readonly rollbackManifest?: SemanticMutationRollbackManifest;
  readonly originalBytes?: Uint8Array;
  readonly stagedBytes?: Uint8Array;
  readonly staged?: FactDeltaEndpointContext;
}

export interface PreparedSemanticMutationArtifacts {
  readonly plan: SemanticMutationSourceEditPlan;
  readonly manifest: SemanticMutationRollbackManifest;
  readonly originalBytes: Uint8Array;
  readonly stagedBytes: Uint8Array;
}

export function exactPreparedSemanticMutationRecoveryBinding(
  record: SemanticMutationRecoveryRecord,
  derived: PreparedSemanticMutationCandidate,
  verification: SemanticMutationVerificationExecutionRef,
  artifacts: PreparedSemanticMutationArtifacts
): boolean {
  if (derived.plan.status !== 'ready' || !derived.editPlan || !derived.rollbackManifest ||
    !derived.originalBytes || !derived.stagedBytes || !derived.staged) return false;
  return JSON.stringify(derived.plan) === JSON.stringify(record.plan) &&
    derived.plan.planRevision === record.planRevision &&
    derived.editPlan.editPlanRevision === record.editPlanRevision &&
    derived.rollbackManifest.rollbackManifestDigest === record.rollbackManifestDigest &&
    derived.editPlan.relativePath === record.relativePath &&
    derived.editPlan.beforeByteDigest === record.beforeByteDigest &&
    derived.editPlan.stagedByteDigest === record.committedByteDigest &&
    JSON.stringify(derived.plan.base) === JSON.stringify(record.base) &&
    JSON.stringify(derived.plan.staged) === JSON.stringify(record.staged) &&
    JSON.stringify(verification) === JSON.stringify(record.verification) &&
    JSON.stringify(artifacts.plan) === JSON.stringify(derived.editPlan) &&
    JSON.stringify(artifacts.manifest) === JSON.stringify(derived.rollbackManifest) &&
    semanticMutationByteDigest(artifacts.originalBytes) === record.beforeByteDigest &&
    semanticMutationByteDigest(artifacts.stagedBytes) === record.committedByteDigest &&
    semanticMutationByteDigest(derived.originalBytes) === record.beforeByteDigest &&
    semanticMutationByteDigest(derived.stagedBytes) === record.committedByteDigest;
}

function readyRecoveryPlan(record: SemanticMutationRecoveryRecord): ReadySemanticMutationPlan {
  if (record.plan.status !== 'ready') {
    throw new Error('Active recovery record does not bind a ready plan');
  }
  return record.plan;
}

export function prepareSemanticMutationRecoveryRequiredTransition(
  record: SemanticMutationRecoveryRecord,
  recoveryState: SemanticMutationRecoveryFailureState,
  diagnostic: SemanticMutationDiagnostic
) {
  const plan = readyRecoveryPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'recovery-required',
    transactionId: record.transactionId,
    attempted: plan.staged,
    verification: record.verification as SemanticMutationVerificationExecutionRef & { readonly status: 'passed' },
    recoveryState,
    diagnostics: [diagnostic]
  });
  if (result.status !== 'recovery-required') {
    throw new Error('Recovery-required evidence did not form a recovery result');
  }
  return Object.freeze({
    result,
    draft: advanceSemanticMutationRecoveryRecord(record, 'recovery-required', {
      recoveryState,
      result,
      diagnostics: [diagnostic]
    })
  });
}

export function prepareSemanticMutationRolledBackTransition(
  record: SemanticMutationRecoveryRecord,
  diagnostic: SemanticMutationDiagnostic
) {
  const plan = readyRecoveryPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'rolled-back',
    transactionId: record.transactionId,
    attempted: plan.staged,
    verification: record.verification as SemanticMutationVerificationExecutionRef & { readonly status: 'passed' },
    diagnostics: [diagnostic]
  });
  if (result.status !== 'rolled-back') {
    throw new Error('Rollback evidence did not form a rolled-back result');
  }
  return Object.freeze({
    result,
    draft: advanceSemanticMutationRecoveryRecord(record, 'rolled-back', {
      result,
      diagnostics: [diagnostic]
    })
  });
}

export function prepareSemanticMutationAcceptedTransition(
  record: SemanticMutationRecoveryRecord,
  accepted: SemanticMutationBase
) {
  const plan = readyRecoveryPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'accepted',
    transactionId: record.transactionId,
    attempted: plan.staged,
    accepted,
    verification: record.verification as SemanticMutationVerificationExecutionRef & { readonly status: 'passed' }
  });
  if (result.status !== 'accepted') {
    throw new Error('Accepted evidence did not form an accepted result');
  }
  return Object.freeze({
    result,
    draft: advanceSemanticMutationRecoveryRecord(record, 'verified', {
      result,
      diagnostics: []
    })
  });
}

export function prepareSemanticMutationPreparedRejection(
  record: SemanticMutationRecoveryRecord,
  diagnostic: SemanticMutationDiagnostic
) {
  const plan = readyRecoveryPlan(record);
  const result = buildSemanticMutationResult(plan, {
    status: 'rejected',
    transactionId: record.transactionId,
    attempted: plan.staged,
    verification: record.verification,
    diagnostics: [diagnostic]
  });
  if (result.status !== 'rejected') {
    throw new Error('Prepared recovery rejection did not form a rejected terminal result');
  }
  return result;
}
