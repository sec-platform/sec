import {
  applyViewMutations,
  type ViewMutationReport
} from '../compiler/index.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';

export async function applyWorkbenchMutations(
  workspaceRoot = process.cwd(),
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<ViewMutationReport> {
  return withWorkspaceWriteLease(
    workspaceRoot,
    workspaceWriteLease,
    async (token) => {
      const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
      await commitFence();
      return applyViewMutations(workspaceRoot, commitFence);
    }
  );
}
