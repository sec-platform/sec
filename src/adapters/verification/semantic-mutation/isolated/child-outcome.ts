/**
 * Durable failed-child outcome publication for isolated Semantic Mutation
 * verification. Canonical outcome meaning/bytes are owned by Assurance; this
 * adapter owns only staging paths and physical pending->final publication.
 */
import path from 'node:path';

import { retainNoFollowFileTransaction } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

import {
  isolatedChildOutcomeBytes,
  type IsolatedChildOutcome
} from '../../../../assurance/verification/semantic-mutation/isolated/child-outcome.ts';

const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH =
  '.isolated-process/child/semantic-mutation-isolated-child-outcome-v1.json' as const;
const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH =
  '.isolated-process/child/.semantic-mutation-isolated-child-outcome-v1.pending' as const;

export function isolatedChildOutcomePath(
  stagingWorkspaceRoot: string
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH.split('/')
  );
}

export function isolatedChildOutcomePendingPath(
  stagingWorkspaceRoot: string
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH.split('/')
  );
}

export async function publishSemanticMutationIsolatedChildOutcome(
  stagingWorkspaceRoot: string,
  value: IsolatedChildOutcome
): Promise<void> {
  const bytes = isolatedChildOutcomeBytes(value);
  const root = path.resolve(stagingWorkspaceRoot);
  const transaction = retainNoFollowFileTransaction(
    root,
    'Semantic Mutation isolated child outcome publication'
  );
  const pendingRelativePath = SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH;
  const finalRelativePath = SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH;
  let primaryFailure: unknown = null;
  try {
    const pending = await transaction.createExclusive(
      pendingRelativePath,
      bytes,
      'Semantic Mutation isolated child outcome pending publication',
      0o600
    );
    await transaction.renameNoReplace(
      pendingRelativePath,
      finalRelativePath,
      pending,
      'Semantic Mutation isolated child outcome final publication'
    );
    transaction.assertCurrent();
  } catch (error) {
    primaryFailure = error;
  }

  let cleanupFailure: unknown = null;
  if (primaryFailure !== null) {
    try {
      const pending = transaction.observe(
        pendingRelativePath,
        'Semantic Mutation isolated child outcome pending cleanup observation'
      );
      if (pending !== null) {
        await transaction.removeExact(
          pendingRelativePath,
          pending,
          'Semantic Mutation isolated child outcome pending cleanup'
        );
      }
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    transaction.dispose();
  } catch (error) {
    cleanupFailure = cleanupFailure === null
      ? error
      : new AggregateError([cleanupFailure, error], 'Semantic Mutation isolated child outcome transaction disposal failed');
  }

  if (primaryFailure !== null && cleanupFailure !== null) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      `Semantic Mutation isolated child outcome publication failed and pending cleanup did not converge: ${isolatedChildOutcomePendingPath(root)}`
    );
  }
  if (primaryFailure !== null) throw primaryFailure;
  if (cleanupFailure !== null) throw cleanupFailure;
}
