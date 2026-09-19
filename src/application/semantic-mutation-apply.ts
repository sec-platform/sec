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
  SemanticMutationRequestIdentity,
  SemanticMutationRequestRecord
} from '../semantics/mutation/transaction.ts';
import type { NormalizedSemanticMutationRequest } from '../semantics/mutation/types.ts';
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
