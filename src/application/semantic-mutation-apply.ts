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
import type {
  NormalizedSemanticMutationRequest,
  SemanticMutationPlan,
  SemanticMutationResult,
  SemanticMutationVerificationExecutionRef
} from '../semantics/mutation/types.ts';
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

