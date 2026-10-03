import path from 'node:path';
import { isProxy } from 'node:util/types';
import { mutationDiagnostic } from '../../compiler/semantic-mutation/canonical.ts';
import { assertSameNoFollowDirectoryIdentity } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { createSemanticMutationPathProofDirectory, createSemanticMutationTransactionDirectory } from './transaction-directories.ts';
import { semanticMutationTransactionRoot, type SemanticMutationCommitFence } from './transaction-identity.ts';
export { semanticMutationStagingCopyOptions } from './staging-workspace.ts';

/** Create and retain the original no-follow directory identity and live fence.
 * Partial creation remains under the existing mutation recovery lifecycle. */
export async function prepareSemanticMutationDerivationScope(
  workspaceRoot: string,
  requestIdentityDigest: string,
  commitFence: SemanticMutationCommitFence
) {
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
  const transactionIdentity = await createSemanticMutationTransactionDirectory(
    workspaceRoot, transactionRoot, commitFence
  );
  const assertCurrent = async (): Promise<void> => {
    await commitFence();
    assertSameNoFollowDirectoryIdentity(transactionIdentity, 'Mutation staging transaction');
  };
  const pathProofDirectory = (await createSemanticMutationPathProofDirectory(
    transactionIdentity, assertCurrent
  )).path;
  return Object.freeze({
    transactionRoot,
    stagingWorkspaceRoot: path.join(transactionRoot, 'workspace'),
    pathProofDirectory,
    assertCurrent
  });
}

function safeStagedRebuildErrorCode(error: unknown): string {
  if (error === null || typeof error !== 'object' || isProxy(error)) return 'UNKNOWN';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? code
    : 'UNKNOWN';
}

/**
 * Public mutation diagnostics must never copy native error messages: Node and
 * Bun routinely include absolute workspace and transaction paths in them.
 */
export function semanticMutationStagedRebuildDiagnostic(
  error: unknown
): ReturnType<typeof mutationDiagnostic> {
  return mutationDiagnostic(
    'SEMANTIC-MUTATION-008',
    'staged-rebuild',
    'Isolated staged semantic rebuild failed',
    { details: { errorCode: safeStagedRebuildErrorCode(error) } }
  );
}
