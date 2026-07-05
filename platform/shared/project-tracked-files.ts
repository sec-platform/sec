import { uniqueSortedLines } from './collections.ts';
import { projectRelativePath, posixPath } from './paths.ts';
import { runCommand } from './process.ts';

export async function listTrackedProjectPaths(workspaceRoot: string): Promise<Set<string> | null> {
  const result = await runCommand('git', ['ls-files', '--', projectRelativePath], {
    cwd: workspaceRoot
  }).catch(() => null);
  if (!result || result.code !== 0) return null;

  const prefix = `${posixPath(projectRelativePath)}/`;
  return new Set(
    uniqueSortedLines(result.stdout)
      .map(posixPath)
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length))
  );
}
