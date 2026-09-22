import { cloneAndDeepFreeze } from '../compiler/semantic-mutation/canonical.ts';
import { semanticMutationRequestIdentityDigest } from '../compiler/semantic-mutation/identity.ts';
import {
  SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION,
  type SemanticMutationRecoveryRecord,
  type SemanticMutationRejectedTerminalRecord,
  type SemanticMutationRequestIdentity,
  type SemanticMutationRequestRecord,
  type SemanticMutationRequestRecordView
} from '../semantics/mutation/transaction.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface SemanticMutationRequestQueryOperations {
  read(identity: SemanticMutationRequestIdentity): Awaitable<SemanticMutationRequestRecord | null>;
  project(
    record: SemanticMutationRequestRecord,
    identity: SemanticMutationRequestIdentity
  ): SemanticMutationRequestRecordView;
}

export function projectSemanticMutationRequestRecordView(
  record: SemanticMutationRecoveryRecord,
  suppliedIdentity?: SemanticMutationRequestIdentity
): Extract<SemanticMutationRequestRecordView, { readonly recordKind: 'transaction' }>;
export function projectSemanticMutationRequestRecordView(
  record: SemanticMutationRejectedTerminalRecord,
  suppliedIdentity: SemanticMutationRequestIdentity
): Extract<SemanticMutationRequestRecordView, { readonly recordKind: 'rejected-terminal' }>;
export function projectSemanticMutationRequestRecordView(
  record: SemanticMutationRequestRecord,
  suppliedIdentity?: SemanticMutationRequestIdentity
): SemanticMutationRequestRecordView;
export function projectSemanticMutationRequestRecordView(
  record: SemanticMutationRequestRecord,
  suppliedIdentity?: SemanticMutationRequestIdentity
): SemanticMutationRequestRecordView {
  const identity = 'state' in record
    ? {
        graphId: record.request.graphId,
        appId: record.request.appId,
        requestId: record.request.requestId
      }
    : suppliedIdentity === undefined
      ? undefined
      : {
          graphId: suppliedIdentity.graphId,
          appId: suppliedIdentity.appId,
          requestId: suppliedIdentity.requestId
        };
  if (!identity || semanticMutationRequestIdentityDigest(identity) !== record.requestIdentityDigest) {
    throw new Error('Semantic Mutation request record view requires the exact request identity');
  }
  if ('state' in record) {
    const common = {
      formatRevision: SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION,
      recordKind: 'transaction' as const,
      identity,
      requestIdentityDigest: record.requestIdentityDigest,
      transactionId: record.transactionId,
      requestRevision: record.requestRevision,
      authorizationRevision: record.authorizationRevision,
      expectedPlanRevision: record.expectedPlanRevision,
      planRevision: record.planRevision,
      editPlanRevision: record.editPlanRevision,
      rollbackManifestDigest: record.rollbackManifestDigest,
      base: record.base,
      staged: record.staged,
      verificationExecutionRevision: record.verificationExecutionRevision,
      verificationReportRevision: record.verificationReportRevision,
      diagnostics: record.diagnostics,
      recordRevision: record.recordRevision
    } as const;
    if (record.state === 'prepared' || record.state === 'authoring-committed') {
      return cloneAndDeepFreeze({ ...common, state: record.state });
    }
    if (record.state === 'verified') {
      if (record.result?.status !== 'accepted') {
        throw new Error('Verified request record view requires an accepted terminal result');
      }
      return cloneAndDeepFreeze({
        ...common,
        state: record.state,
        terminalSequence: record.terminalSequence,
        result: record.result
      });
    }
    if (record.state === 'rolled-back') {
      if (record.result?.status !== 'rolled-back') {
        throw new Error('Rolled-back request record view requires a rolled-back terminal result');
      }
      return cloneAndDeepFreeze({
        ...common,
        state: record.state,
        terminalSequence: record.terminalSequence,
        result: record.result
      });
    }
    if (record.result?.status !== 'recovery-required' || record.recoveryState === undefined) {
      throw new Error('Recovery-required request record view requires matching terminal evidence');
    }
    return cloneAndDeepFreeze({
      ...common,
      state: record.state,
      result: record.result,
      recoveryState: record.recoveryState
    });
  }
  return cloneAndDeepFreeze({
    formatRevision: SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION,
    recordKind: 'rejected-terminal' as const,
    identity,
    requestIdentityDigest: record.requestIdentityDigest,
    state: 'rejected' as const,
    requestRevision: record.requestRevision,
    planRevision: record.planRevision,
    terminalSequence: record.terminalSequence,
    result: record.result,
    diagnostics: record.result.diagnostics,
    recordRevision: record.recordRevision
  });
}

/** Project one durable request record into the stable application-facing query
 * view. Persistence adapters only load records; this owner decides the result
 * shape and validates identity-to-record binding. */
export async function querySemanticMutationRequestView(
  identity: SemanticMutationRequestIdentity,
  operations: SemanticMutationRequestQueryOperations
): Promise<SemanticMutationRequestRecordView | null> {
  const { read, project } = operations;
  if (typeof read !== 'function' || typeof project !== 'function') {
    throw new TypeError('Semantic Mutation request query operations must be callable');
  }
  const record = await read.call(operations, identity);
  return record === null ? null : project.call(operations, record, identity);
}
