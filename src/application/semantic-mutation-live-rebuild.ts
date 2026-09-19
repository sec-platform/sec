import type { SemanticMutationBase } from '../semantics/mutation/types.ts';

export interface SemanticMutationLiveRebuildReceipt {
  readonly transactionId: string;
  readonly semanticContext?: Readonly<{
    transactionId: string;
    inputRevision: string;
    semanticRevision: string;
  }>;
  readonly completionProof?: Readonly<{
    transactionId: string;
    inputRevision: string;
    semanticRevision: string;
  }>;
}

/** Require one pipeline completion proof and semantic context to bind the same
 * rebuild transaction and revisions, then project the mutation endpoint. */
export function projectSemanticMutationLiveRebuild(
  compiled: SemanticMutationLiveRebuildReceipt
): SemanticMutationBase {
  const semantic = compiled.semanticContext;
  const proof = compiled.completionProof;
  if (!semantic || !proof ||
    proof.transactionId !== compiled.transactionId ||
    proof.transactionId !== semantic.transactionId ||
    proof.inputRevision !== semantic.inputRevision ||
    proof.semanticRevision !== semantic.semanticRevision) {
    throw new Error(
      'Live Semantic Mutation rebuild did not complete the registry-owned downstream closure'
    );
  }
  return Object.freeze({
    transactionId: semantic.transactionId,
    inputRevision: semantic.inputRevision,
    semanticRevision: semantic.semanticRevision
  });
}
