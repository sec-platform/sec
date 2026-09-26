import {
  SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION,
  SEMANTIC_MUTATION_RECOVERY_TRANSITIONS,
  type SemanticMutationRecoveryRecord,
  type SemanticMutationRecoveryState
} from '../../semantics/mutation/transaction.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from './canonical.ts';
import { semanticMutationRequestIdentityDigest } from './identity.ts';
import {
  normalizeSemanticMutationAuthorization,
  normalizeSemanticMutationRequest
} from './normalize-request.ts';
import { assertSemanticMutationPlanInvariant } from './plan.ts';
import { assertSemanticMutationResultInvariant } from './result.ts';
import { semanticMutationRequiredVerificationDigest } from './verification-policy.ts';

export function semanticMutationRecoveryRecordRevision(
  value: Omit<SemanticMutationRecoveryRecord, 'recordRevision'>
): string {
  return sha256({ domain: 'semantic-mutation-recovery-record-v1', ...value });
}

export function isSemanticMutationRetainedTerminalState(
  state: SemanticMutationRecoveryState
): state is 'verified' | 'rolled-back' {
  return state === 'verified' || state === 'rolled-back';
}

export function isSemanticMutationRecoveryTransitionAllowed(
  previous: SemanticMutationRecoveryState,
  next: SemanticMutationRecoveryState
): boolean {
  return (
    SEMANTIC_MUTATION_RECOVERY_TRANSITIONS[previous] as readonly SemanticMutationRecoveryState[]
  ).includes(next);
}

function isRecoveryState(value: unknown): value is SemanticMutationRecoveryState {
  return value === 'prepared' ||
    value === 'authoring-committed' ||
    value === 'verified' ||
    value === 'rolled-back' ||
    value === 'recovery-required';
}

function exactBase(value: unknown): boolean {
  return isPlainObject(value) &&
    exactOwnKeys(value, ['transactionId', 'inputRevision', 'semanticRevision']) &&
    nonEmptyString(value.transactionId) &&
    nonEmptyString(value.inputRevision) &&
    nonEmptyString(value.semanticRevision);
}

function assertVerificationBinding(
  record: SemanticMutationRecoveryRecord
): void {
  const verification = record.verification;
  if (!isPlainObject(verification) ||
      !exactOwnKeys(verification, [
        'adapterId',
        'adapterRevision',
        'reportRevision',
        'planRevision',
        'attempted',
        'stagedSourceDigest',
        'requiredVerificationDigest',
        'status',
        'verificationExecutionRevision'
      ])) {
    throw new Error(
      'Semantic Mutation recovery Verification violates the frozen execution schema'
    );
  }
  const plan = record.plan;
  if (plan.status !== 'ready') {
    throw new Error(
      'Semantic Mutation recovery record requires a ready canonical plan'
    );
  }
  const { verificationExecutionRevision, ...withoutRevision } = verification;
  if (!nonEmptyString(verification.adapterId) ||
      !nonEmptyString(verification.adapterRevision) ||
      !digestString(verification.reportRevision) ||
      verification.status !== 'passed' ||
      verification.adapterId !== plan.verificationAdapterId ||
      verification.adapterRevision !== plan.verificationAdapterRevision ||
      verification.planRevision !== plan.planRevision ||
      !canonicalEquals(verification.attempted, plan.staged) ||
      verification.stagedSourceDigest !==
        plan.sourceChanges[0].stagedByteDigest ||
      verification.requiredVerificationDigest !==
        semanticMutationRequiredVerificationDigest(plan.requiredVerification) ||
      verificationExecutionRevision !== sha256({
        domain: 'semantic-mutation-verification-execution-v1',
        ...withoutRevision
      }) ||
      record.verificationExecutionRevision !== verificationExecutionRevision ||
      record.verificationReportRevision !== verification.reportRevision) {
    throw new Error(
      'Semantic Mutation recovery Verification is not bound to its plan/source/report'
    );
  }
}

function assertRecoveryCrossBindings(
  record: SemanticMutationRecoveryRecord
): void {
  assertSemanticMutationPlanInvariant(record.plan);
  if (record.plan.status !== 'ready') {
    throw new Error(
      'Semantic Mutation recovery record cannot bind a rejected plan'
    );
  }
  const request = normalizeSemanticMutationRequest(record.request);
  const authorization = normalizeSemanticMutationAuthorization(
    record.authorization
  );
  const identity = {
    graphId: request.graphId,
    appId: request.appId,
    requestId: request.requestId
  } as const;
  const sourceChange = record.plan.sourceChanges[0];
  if (!exactBase(record.base) ||
      !exactBase(record.staged) ||
      request.requestRevision !== record.requestRevision ||
      authorization.authorizationRevision !== record.authorizationRevision ||
      record.requestIdentityDigest !==
        semanticMutationRequestIdentityDigest(identity) ||
      record.requestRevision !== record.plan.requestRevision ||
      record.authorizationRevision !== record.plan.authorizationRevision ||
      record.expectedPlanRevision !== record.plan.planRevision ||
      record.planRevision !== record.plan.planRevision ||
      !canonicalEquals(record.base, record.plan.base) ||
      !canonicalEquals(record.staged, record.plan.staged) ||
      !canonicalEquals(request.base, record.base) ||
      record.rollbackManifestDigest !== record.plan.rollbackManifestDigest ||
      record.relativePath !== sourceChange.relativePath ||
      record.beforeByteDigest !== sourceChange.beforeByteDigest ||
      record.committedByteDigest !== sourceChange.stagedByteDigest) {
    throw new Error(
      'Semantic Mutation recovery identity/revision/source bindings are inconsistent'
    );
  }
  assertVerificationBinding(record);
  if (record.result !== undefined) {
    assertSemanticMutationResultInvariant(record.result, record.plan);
    if (record.result.transactionId !== record.transactionId ||
        !canonicalEquals(record.result.diagnostics, record.diagnostics)) {
      throw new Error(
        'Semantic Mutation recovery result does not bind its transaction/diagnostics'
      );
    }
  }
}

export function assertSemanticMutationRecoveryRecordInvariant(
  record: SemanticMutationRecoveryRecord,
  previous?: SemanticMutationRecoveryRecord
): void {
  if (!isPlainObject(record) ||
      !exactOwnKeys(record, [
        'formatRevision',
        'sequence',
        'previousRecordRevision',
        'state',
        'transactionId',
        'requestIdentityDigest',
        'requestRevision',
        'authorizationRevision',
        'expectedPlanRevision',
        'planRevision',
        'editPlanRevision',
        'rollbackManifestDigest',
        'relativePath',
        'beforeByteDigest',
        'committedByteDigest',
        'base',
        'staged',
        'verificationExecutionRevision',
        'verificationReportRevision',
        'request',
        'authorization',
        'plan',
        'verification',
        'diagnostics',
        'recordRevision'
      ], ['result', 'recoveryState', 'terminalSequence'])) {
    throw new Error(
      'Semantic Mutation recovery record violates the frozen v1 schema'
    );
  }

  const { recordRevision: revision, ...withoutRevision } = record;
  const validSequence = Number.isSafeInteger(record.sequence) &&
    record.sequence > 0 &&
    (previous === undefined
      ? record.sequence === 1 &&
        record.previousRecordRevision === '' &&
        record.state === 'prepared'
      : record.sequence === previous.sequence + 1 &&
        record.previousRecordRevision === previous.recordRevision &&
        isSemanticMutationRecoveryTransitionAllowed(previous.state, record.state));
  const validTerminalSequence = isSemanticMutationRetainedTerminalState(
    record.state
  )
    ? Number.isSafeInteger(record.terminalSequence) &&
      (record.terminalSequence ?? 0) > 0
    : record.terminalSequence === undefined;

  if (record.formatRevision !== SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION ||
      !validSequence ||
      !isRecoveryState(record.state) ||
      !nonEmptyString(record.transactionId) ||
      !digestString(record.requestIdentityDigest) ||
      !digestString(record.requestRevision) ||
      !digestString(record.authorizationRevision) ||
      !digestString(record.expectedPlanRevision) ||
      !digestString(record.planRevision) ||
      !digestString(record.editPlanRevision) ||
      !digestString(record.rollbackManifestDigest) ||
      !nonEmptyString(record.relativePath) ||
      !digestString(record.beforeByteDigest) ||
      !digestString(record.committedByteDigest) ||
      !digestString(record.verificationExecutionRevision) ||
      !digestString(record.verificationReportRevision) ||
      !Array.isArray(record.diagnostics) ||
      !canonicalEquals(
        record.diagnostics,
        canonicalDiagnostics(record.diagnostics)
      ) ||
      !validTerminalSequence ||
      !digestString(revision) ||
      revision !== semanticMutationRecoveryRecordRevision(withoutRevision)) {
    throw new Error(
      'Semantic Mutation recovery record revision chain or content is invalid'
    );
  }

  const active = record.state === 'prepared' ||
    record.state === 'authoring-committed';
  if (active &&
      (record.result !== undefined || record.recoveryState !== undefined)) {
    throw new Error(
      'Active Semantic Mutation recovery record cannot contain terminal evidence'
    );
  }
  if (record.state === 'verified' &&
      record.result?.status !== 'accepted') {
    throw new Error(
      'Verified recovery record requires an accepted terminal result'
    );
  }
  if (record.state === 'rolled-back' &&
      record.result?.status !== 'rolled-back') {
    throw new Error(
      'Rolled-back recovery record requires a rolled-back terminal result'
    );
  }
  if (record.state === 'recovery-required' &&
      (record.result?.status !== 'recovery-required' ||
        record.recoveryState === undefined ||
        record.recoveryState !== record.result.recoveryState)) {
    throw new Error(
      'Recovery-required record requires matching terminal evidence'
    );
  }
  if (record.state !== 'recovery-required' &&
      record.recoveryState !== undefined) {
    throw new Error(
      'Only recovery-required records may contain a recovery failure state'
    );
  }
  assertRecoveryCrossBindings(record);
}
