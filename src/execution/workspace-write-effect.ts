import type { CommitFence } from '../contracts/commit-fence.ts';
import {
  createWorkspaceWriteCommitFence,
  type WorkspaceWriteLeaseToken
} from '../adapters/filesystem/write-lease.ts';

/** Execute one already-authorized workspace write effect. This helper does not
 * acquire a lease or retry: it binds the existing lease to one commit fence,
 * checks it immediately, then passes that same fence to the physical effect. */
export async function executeWorkspaceWriteEffect<Value>(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  operation: (commitFence: CommitFence) => Promise<Value>
): Promise<Value> {
  if (typeof operation !== 'function') {
    throw new TypeError('Workspace write effect must be callable');
  }
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
  await commitFence();
  return operation(commitFence);
}
