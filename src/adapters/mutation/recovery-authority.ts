import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { SemanticMutationRecoveryRecord } from '../../semantics/mutation/transaction.ts';
import { assertSemanticMutationTransactionRoot } from './transaction-identity.ts';
import { readRejectedSemanticMutationTerminal } from './mutation-terminal-record.ts';
import { loadLatestSemanticMutationRecoveryRecord } from './mutation-recovery-record.ts';

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
  const transactionsRoot = path.join(root, '.sec', 'semantic-mutation', 'v1', 'transactions');
  let transactionNames: string[];
  try {
    transactionNames = (await readdir(transactionsRoot)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { unfinished: [], blocked: undefined };
    }
    throw error;
  }
  const authorities: Array<{
    readonly transactionRoot: string;
    readonly record: SemanticMutationRecoveryRecord;
  }> = [];
  for (const name of transactionNames) {
    const transactionRoot = path.join(transactionsRoot, name);
    await assertSemanticMutationTransactionRoot(root, transactionRoot);
    if (await readRejectedSemanticMutationTerminal(transactionRoot)) continue;
    const record = await loadLatestSemanticMutationRecoveryRecord(transactionRoot);
    if (record && (record.state === 'prepared' || record.state === 'authoring-committed' ||
      record.state === 'recovery-required')) {
      authorities.push({ transactionRoot, record });
    }
  }
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
