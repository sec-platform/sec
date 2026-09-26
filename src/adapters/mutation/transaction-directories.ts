import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  PhysicalNoFollowError,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertSemanticMutationRecoveryRecordsDirectory,
  assertSemanticMutationTerminalOrderDirectory,
  assertSemanticMutationTransactionRoot,
  semanticMutationJournalRoot,
  semanticMutationTransactionLayout,
  semanticMutationWorkspaceRootFromTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';

const STAGING_RETIREMENT_MAXIMUM_ENTRIES = 100_000;
const STAGING_RETIREMENT_DURATION_MS = 30_000;

/** Allocate only the already-admitted transaction namespace, without lexical mkdir. */
export async function createSemanticMutationTransactionDirectory(
  workspaceRoot: string,
  transactionRoot: string,
  commitFence: SemanticMutationCommitFence
): Promise<PhysicalDirectoryIdentity> {
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const workspace = inspectNoFollowDirectoryChain(path.resolve(workspaceRoot), 'Mutation workspace').target;
  if (semanticMutationTransactionLayout(transactionRoot) === 'legacy') {
    const legacy = inspectExactNoFollowDirectoryPresence(
      path.resolve(transactionRoot),
      'Legacy Semantic Mutation transaction'
    );
    if (legacy.state !== 'present') {
      throw new Error('Semantic Mutation cannot create a transaction in the legacy state layout');
    }
    return legacy.directory.target;
  }
  await commitFence();
  const transaction = createNoFollowOrdinaryDirectoryChain(
    workspace,
    path.relative(workspace.path, path.resolve(transactionRoot)).split(path.sep)
  );
  await commitFence();
  assertSameNoFollowDirectoryIdentity(workspace, 'Mutation workspace allocation readback');
  return assertSameNoFollowDirectoryIdentity(transaction, 'Mutation transaction allocation readback').target;
}

export async function createSemanticMutationPathProofDirectory(
  transaction: PhysicalDirectoryIdentity,
  commitFence: SemanticMutationCommitFence
): Promise<PhysicalDirectoryIdentity> {
  assertSameNoFollowDirectoryIdentity(transaction, 'Mutation path-proof parent');
  await commitFence();
  const proof = createNoFollowOrdinaryDirectoryChain(transaction, ['path-proof']);
  await commitFence();
  assertSameNoFollowDirectoryIdentity(transaction, 'Mutation path-proof parent readback');
  return assertSameNoFollowDirectoryIdentity(proof, 'Mutation path-proof readback').target;
}

export async function createSemanticMutationRecoveryRecordsDirectory(
  transactionRoot: string,
  requestIdentityDigest: string,
  commitFence: SemanticMutationCommitFence
): Promise<PhysicalDirectoryIdentity> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  const transaction = await createSemanticMutationTransactionDirectory(
    workspaceRoot,
    transactionRoot,
    commitFence
  );
  await commitFence();
  const records = createNoFollowOrdinaryDirectoryChain(transaction, ['records']);
  await commitFence();
  await assertSemanticMutationRecoveryRecordsDirectory(
    transactionRoot,
    requestIdentityDigest
  );
  assertSameNoFollowDirectoryIdentity(transaction, 'Mutation recovery records parent readback');
  return assertSameNoFollowDirectoryIdentity(records, 'Mutation recovery records readback').target;
}

export async function createSemanticMutationTerminalOrderDirectory(
  transactionRoot: string,
  requestIdentityDigest: string,
  commitFence: SemanticMutationCommitFence
): Promise<PhysicalDirectoryIdentity> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(
    workspaceRoot,
    transactionRoot,
    requestIdentityDigest
  );
  const workspace = inspectNoFollowDirectoryChain(
    path.resolve(workspaceRoot),
    'Mutation terminal-order workspace'
  ).target;
  const directory = path.join(semanticMutationJournalRoot(workspaceRoot), 'terminal-order');
  await commitFence();
  const terminalOrder = createNoFollowOrdinaryDirectoryChain(
    workspace,
    path.relative(workspace.path, directory).split(path.sep)
  );
  await commitFence();
  await assertSemanticMutationTerminalOrderDirectory(
    transactionRoot,
    requestIdentityDigest
  );
  assertSameNoFollowDirectoryIdentity(workspace, 'Mutation terminal-order workspace readback');
  return assertSameNoFollowDirectoryIdentity(
    terminalOrder,
    'Mutation terminal-order readback'
  ).target;
}

/**
 * Retire only the observed workspace child and its exact inventoried entries.
 * Inventory and deletion share one recovery deadline. Ordinary file bytes are
 * not cleanup authority and are never read or hashed during this operation.
 * A substituted root, unsafe alias or added residue fails closed; it is not
 * recursively removed under a fresh path-only interpretation.
 */
export async function retireSemanticMutationStagingWorkspace(
  transaction: PhysicalDirectoryIdentity,
  commitFence: SemanticMutationCommitFence
): Promise<void> {
  const deadlineAtMonotonicMs = performance.now() + STAGING_RETIREMENT_DURATION_MS;
  const assertCurrent = (): void => {
    if (performance.now() >= deadlineAtMonotonicMs) {
      throw new PhysicalNoFollowError(
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        'Mutation staging retirement deadline exceeded'
      );
    }
    assertSameNoFollowDirectoryIdentity(transaction, 'Mutation staging retirement parent');
  };
  assertCurrent();
  const root = inspectNoFollowDirectoryLeaf(transaction, 'workspace', 'Mutation staging retirement root');
  await commitFence();
  assertCurrent();
  if (root === null) {
    if (inspectNoFollowDirectoryLeaf(transaction, 'workspace', 'Mutation staging retirement absence') !== null) {
      throw new PhysicalNoFollowError(
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
        'Mutation staging workspace appeared after absence admission'
      );
    }
    return;
  }
  assertSameNoFollowDirectoryIdentity(root, 'Mutation staging retirement root');
  const inventory = scanNoFollowDirectoryTreeMetadata(root, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: STAGING_RETIREMENT_MAXIMUM_ENTRIES,
    includePermissionMode: true
  });
  await commitFence();
  assertCurrent();
  assertSameNoFollowDirectoryIdentity(root, 'Mutation staging retirement root before effect');
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs,
    inventory,
    parent: transaction,
    restoreOwnerPermissions: true,
    root
  });
  assertCurrent();
}
