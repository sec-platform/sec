import type { SemanticMutationRequestIdentity } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationBase } from '../../semantics/mutation/types.ts';
import { sha256 } from './canonical.ts';

export function semanticMutationRequestIdentityDigest(
  identity: SemanticMutationRequestIdentity
): string {
  return sha256({
    domain: 'semantic-mutation-request-identity-v1',
    graphId: identity.graphId,
    appId: identity.appId,
    requestId: identity.requestId
  });
}

export function semanticMutationStagedTransactionId(input: {
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly base: SemanticMutationBase;
  readonly sourceEditPlanRevision: string;
}): string {
  return `tx:semantic-mutation-stage:${sha256({
    domain: 'semantic-mutation-staged-transaction-v1',
    requestRevision: input.requestRevision,
    authorizationRevision: input.authorizationRevision,
    base: input.base,
    sourceEditPlanRevision: input.sourceEditPlanRevision
  }).slice('sha256:'.length)}`;
}
