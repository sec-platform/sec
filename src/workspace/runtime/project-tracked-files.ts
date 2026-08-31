import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { posixPath } from './paths.ts';

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
  return withAuthorityGitReadSession({
      cwd: workspaceRoot,
      environment: { LANG: 'C', LC_ALL: 'C' },
      budget: {
        maxProcesses: 1,
        maxStdoutBytes: TRACKED_PROJECT_PATH_OUTPUT_MAX_BYTES,
        maxStderrBytes: TRACKED_PROJECT_PATH_STDERR_MAX_BYTES,
        maxRecords: 250_000
      }
    }, async (session) => {
      const command = await session.run(['ls-files', '-z', '--']);
      if (command.kind !== 'completed') {
        throw new GitReadAuthorityError('Unable to observe tracked project paths.', command);
      }
      if (command.result.code !== 0) {
        if (/not a git repository/u.test(command.result.stderr)) return null;
        throw new Error(
          `Unable to observe tracked project paths (git exit ${command.result.code}): ` +
          `${command.result.stderr.trim() || 'no stderr'}`
        );
      }
      const paths = exactNulPaths(command.result.stdout);
      const recordFailure = session.consumeRecords(paths.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Tracked project path inventory exceeded its authority budget.', recordFailure);
      }
      return new Set(uniqueSorted(paths.map(posixPath)));
    });
}
