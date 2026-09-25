import path from 'node:path';

import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitReadSession
} from '../../src/adapters/providers/git-read/runtime/session.ts';
import { acquireExactGitTreeSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';

/**
 * Test helper that exercises the same production Git read authority used by
 * repository code. It provides no alternate process transport or raw Git
 * command seam; tests that need malformed protocol bytes should exercise the
 * pure parsers directly.
 */
export function withTestGitReadAuthority<T>(
  repositoryRoot: string,
  operation: (session: GitReadSession) => Promise<T>
): Promise<T> {
  return withAuthorityGitReadSession({
    cwd: path.resolve(repositoryRoot),
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, operation);
}

export function acquireExactGitTreeWorkspaceSourceSnapshotForTests(
  repositoryRoot: string,
  commitSha: string
) {
  return withTestGitReadAuthority(repositoryRoot, (session) => (
    acquireExactGitTreeSnapshot({ session, commitSha })
  ));
}
