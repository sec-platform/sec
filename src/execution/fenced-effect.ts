import type { CommitFence } from '../contracts/commit-fence.ts';

/**
 * Execute one already-authorized effect behind an existing commit fence.
 * Execution owns the ordering contract: validate the operation, prove the
 * fence immediately before the effect, and pass that exact fence through.
 * Physical lease/token construction remains with the supplying adapter.
 */
export async function executeFencedEffect<Value>(
  commitFence: CommitFence,
  operation: (commitFence: CommitFence) => Promise<Value>
): Promise<Value> {
  if (typeof commitFence !== 'function') {
    throw new TypeError('Commit fence must be callable');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('Fenced effect must be callable');
  }
  await commitFence();
  return operation(commitFence);
}
