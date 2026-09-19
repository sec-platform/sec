import type {
  SemanticMutationRequestIdentity,
  SemanticMutationRequestRecord,
  SemanticMutationRequestRecordView
} from '../semantics/mutation/transaction.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface SemanticMutationRequestQueryOperations {
  read(identity: SemanticMutationRequestIdentity): Awaitable<SemanticMutationRequestRecord | null>;
  project(
    record: SemanticMutationRequestRecord,
    identity: SemanticMutationRequestIdentity
  ): SemanticMutationRequestRecordView;
}

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
