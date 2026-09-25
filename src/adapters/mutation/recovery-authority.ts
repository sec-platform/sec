import path from 'node:path';

import type { SemanticMutationRecoveryRecord } from '../../semantics/mutation/transaction.ts';
import { semanticMutationTransactionsRoot } from '../../workspace/contract/semantic-mutation/state-layout.ts';
import { retainNoFollowFileTransaction } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { retainOptionalDirectory } from '../runtime-state/physical/runtime/retained-file-read.ts';
import {
  assertSameSemanticMutationTransactionCensus,
  loadLatestSemanticMutationRecoveryRecord,
  scanSemanticMutationTransactionCensus
} from './mutation-recovery-record.ts';
import { readRejectedSemanticMutationTerminal } from './mutation-terminal-record.ts';
import { inspectSemanticMutationStateLayoutStatus } from './state-layout-migration.ts';

export interface SemanticMutationRecoveryAuthoritySnapshot {
  readonly unfinished: readonly {
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecord;
  }[];
  readonly blocked: {
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecord;
  } | undefined;
}

/** Observe durable mutation recovery authority from the workspace. This is a
 * physical read only; deciding what a use case may do with it belongs above. */
export async function inspectSemanticMutationRecoveryAuthority(
  workspaceRoot: string
): Promise<SemanticMutationRecoveryAuthoritySnapshot> {
  const root = path.resolve(workspaceRoot);
  const status = inspectSemanticMutationStateLayoutStatus(root);
  if (status === 'ambiguous') {
    throw new Error('Semantic Mutation recovery authority has both current and legacy state roots');
  }
  if (status === 'absent') {
    return { unfinished: [], blocked: undefined };
  }
  const transactionsRoot = semanticMutationTransactionsRoot(
    root,
    status === 'legacy' ? 'legacy' : 'current'
  );
  const transactionsParent = retainOptionalDirectory(
    transactionsRoot,
    `Semantic Mutation ${status} recovery authority transactions root`
  );
  if (transactionsParent === null) {
    return { unfinished: [], blocked: undefined };
  }
  const initialCensus = scanSemanticMutationTransactionCensus(transactionsParent);
  const authorities: Array<{
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecord;
  }> = [];
  for (const transaction of initialCensus) {
    const transactionRoot = path.join(transactionsRoot, transaction.relativePath);
    const retained = retainNoFollowFileTransaction(
      transactionRoot,
      `Semantic Mutation recovery authority ${transaction.relativePath}`
    );
    try {
      if (retained.rootIdentity.device !== transaction.device
          || retained.rootIdentity.inode !== transaction.inode
          || path.dirname(retained.rootIdentity.path) !== transactionsParent.path) {
        throw new Error('Semantic Mutation recovery authority transaction changed after census');
      }
      retained.assertCurrent();
      if (await readRejectedSemanticMutationTerminal(transactionRoot, {}, retained)) continue;
      const record = await loadLatestSemanticMutationRecoveryRecord(transactionRoot, {}, retained);
      retained.assertCurrent();
      if (record && (record.state === 'prepared' || record.state === 'authoring-committed' ||
        record.state === 'recovery-required')) {
        authorities.push({ transactionRoot, record });
      }
    } finally {
      retained.dispose();
    }
  }
  assertSameSemanticMutationTransactionCensus(
    initialCensus,
    scanSemanticMutationTransactionCensus(transactionsParent)
  );
  const unfinished = authorities.filter(({ record }) =>
    record.state === 'prepared' || record.state === 'authoring-committed'
  );
  if (unfinished.length > 1) {
    throw new Error('Semantic Mutation recovery found multiple unfinished transactions');
  }
  return {
    unfinished,
    blocked: authorities.find(({ record }) => record.state === 'recovery-required')
  };
}
