import { isolatedGitReadEnvironment } from '../git/read-environment.ts';
import { uniqueSorted } from './collections.ts';
import { posixPath, projectRelativePath } from './paths.ts';
import { runCommandBytes } from './process.ts';

const TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const TRACKED_PROJECT_PATH_STDERR_MAX_BYTES = 1024 * 1024;

function exactNulPaths(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0) return [];
  if (buffer[buffer.byteLength - 1] !== 0) {
    throw new Error('git ls-files returned a non-terminated tracked-path inventory');
  }
  const payload = buffer.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error('git ls-files returned a non-UTF-8 tracked path');
  }
  return text.split('\0');
}

/**
 * Returns null only when Git itself explicitly reports that the workspace is
 * not a repository. Process launch failures, permission/ownership failures,
 * index corruption, malformed path bytes and other observation errors are not
 * equivalent to "untracked" and must propagate to the integrity caller.
 */
export async function listTrackedProjectPaths(workspaceRoot: string): Promise<Set<string> | null> {
  const result = await runCommandBytes('git', ['ls-files', '-z', '--', projectRelativePath], {
    cwd: workspaceRoot,
    envMode: 'replace',
    env: isolatedGitReadEnvironment({ LANG: 'C', LC_ALL: 'C' }),
    maxStdoutBytes: TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES,
    maxStderrBytes: TRACKED_PROJECT_PATH_STDERR_MAX_BYTES
  });
  if (result.code !== 0) {
    if (/not a git repository/u.test(result.stderr)) return null;
    throw new Error(
      `Unable to observe tracked project paths (git exit ${result.code}): ${result.stderr.trim() || 'no stderr'}`
    );
  }

  const prefix = `${posixPath(projectRelativePath)}/`;
  return new Set(
    uniqueSorted(exactNulPaths(result.stdout)
      .map(posixPath)
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length)))
  );
}
