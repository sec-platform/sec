/**
 * Durable failed-child outcome publication for isolated Semantic Mutation
 * verification. Canonical outcome meaning/bytes are owned by Assurance; this
 * adapter owns only staging paths and physical pending->final publication.
 */
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  semanticMutationIsolatedChildOutcomeBytes,
  type SemanticMutationIsolatedChildOutcome
} from '../../../assurance/verification/semantic-mutation/isolated-child-outcome.ts';

export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH =
  '.isolated-process/child/semantic-mutation-isolated-child-outcome-v1.json' as const;
export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH =
  '.isolated-process/child/.semantic-mutation-isolated-child-outcome-v1.pending' as const;

export function semanticMutationIsolatedChildOutcomePath(
  stagingWorkspaceRoot: string
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_RELATIVE_PATH.split('/')
  );
}

export function semanticMutationIsolatedChildOutcomePendingPath(
  stagingWorkspaceRoot: string
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    ...SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_PENDING_RELATIVE_PATH.split('/')
  );
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' ||
        !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function cleanupOwnedPendingPath(pendingPath: string): Promise<void> {
  await rm(pendingPath, { force: true });
}

export async function publishSemanticMutationIsolatedChildOutcome(
  stagingWorkspaceRoot: string,
  value: SemanticMutationIsolatedChildOutcome
): Promise<void> {
  const bytes = semanticMutationIsolatedChildOutcomeBytes(value);
  const finalPath = semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot);
  const pendingPath = semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot);
  let pendingOwned = false;
  let primaryFailure: unknown = null;
  try {
    const handle = await open(pendingPath, 'wx', 0o600);
    pendingOwned = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pendingPath, finalPath);
    pendingOwned = false;
    await fsyncDirectory(path.dirname(finalPath));
  } catch (error) {
    primaryFailure = error;
  }

  let cleanupFailure: unknown = null;
  if (pendingOwned) {
    try {
      await cleanupOwnedPendingPath(pendingPath);
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (primaryFailure !== null && cleanupFailure !== null) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      `Semantic Mutation isolated child outcome publication failed and pending cleanup did not converge: ${pendingPath}`
    );
  }
  if (primaryFailure !== null) throw primaryFailure;
  if (cleanupFailure !== null) throw cleanupFailure;
}
