import type { CommitFence } from '../../contracts/commit-fence.ts';
import { executeFencedEffect } from '../../execution/fenced-effect.ts';
import {
  createWorkspaceWriteCommitFence,
  type WorkspaceWriteLeaseToken
} from './write-lease.ts';

/** Bind the physical workspace lease to Execution's generic fenced-effect contract. */
export function executeWorkspaceWriteEffect<Value>(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken,
  operation: (commitFence: CommitFence) => Promise<Value>
): Promise<Value> {
  return executeFencedEffect(
    createWorkspaceWriteCommitFence(workspaceRoot, token),
    operation
  );
}
