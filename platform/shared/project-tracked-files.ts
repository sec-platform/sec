import { uniqueSortedLines } from './collections.ts';
import { posixPath, projectRelativePath } from './paths.ts';
import { runCommand } from './process.ts';

/**
 * Returns null only when Git itself explicitly reports that the workspace is
 * not a repository. Process launch failures, permission/ownership failures,
 * index corruption, and other observation errors are not equivalent to
 * "untracked" and must propagate to the integrity caller.
 */
export async function listTrackedProjectPaths(workspaceRoot: string): Promise<Set<string> | null> {
  const result = await runCommand('git', ['ls-files', '--', projectRelativePath], {
    cwd: workspaceRoot,
    env: {
      LANG: 'C',
      LC_ALL: 'C'
    }
  });
  if (result.code !== 0) {
    if (/not a git repository/u.test(result.stderr)) return null;
    throw new Error(
      `Unable to observe tracked project paths (git exit ${result.code}): ${result.stderr.trim() || 'no stderr'}`
    );
  }

  const prefix = `${posixPath(projectRelativePath)}/`;
  return new Set(
    uniqueSortedLines(result.stdout)
      .map(posixPath)
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length))
  );
}
