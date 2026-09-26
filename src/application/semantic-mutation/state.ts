import { canonicalDiagnostics, diagnosticRevision } from '../../compiler/semantic-mutation/canonical.ts';
import type {
  SemanticMutationApplyInput,
  SemanticMutationApplyOutcome,
  SemanticMutationInternalRecoveryOutcome,
  SemanticMutationRecoveryRecord
} from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationDiagnostic, SemanticMutationPlan } from '../../semantics/mutation/types.ts';

export type ReadySemanticMutationPlan = Extract<SemanticMutationPlan, { readonly status: 'ready' }>;

export function semanticMutationRequestRejected(
  requestId: string,
  requestRevision: string,
  diagnostics: readonly SemanticMutationDiagnostic[]
): SemanticMutationApplyOutcome {
  const canonical = canonicalDiagnostics(diagnostics);
  return {
    status: 'request-rejected', requestId, requestRevision, diagnostics: canonical,
    diagnosticRevision: diagnosticRevision(canonical)
  };
}

export function semanticMutationTerminalRecoveryOutcome(
  outcome: Extract<SemanticMutationInternalRecoveryOutcome, { readonly status: 'recovery-required' }>
): SemanticMutationApplyOutcome {
  const result = outcome.record.result;
  if (!result || result.status !== 'recovery-required') {
    throw new Error('Recovery-required outcome is missing its durable terminal result');
  }
  return { status: 'terminal', result };
}

export function semanticMutationUntrustedRequestId(input: SemanticMutationApplyInput): string {
  return typeof input.request?.requestId === 'string' ? input.request.requestId : '';
}

export function requireReadySemanticMutationPlan(record: SemanticMutationRecoveryRecord): ReadySemanticMutationPlan {
  if (record.plan.status !== 'ready') throw new Error('Active recovery record does not bind a ready plan');
  return record.plan;
}
