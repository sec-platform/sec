import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { isolatedGitReadEnvironment } from '../../external-capabilities/git-read/runtime/session.ts';
import { type ByteCommandResult, type RunCommandOptions } from '../../runtime-state/physical/runtime/process.ts';
import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';

export type ReferenceDriftScan = {
  exitCode: number;
  trackedExitCode: number;
  untrackedExitCode: number;
  changedPaths: string[];
};

export type ReferenceGitCommandRunner = (
  command: string,
  args: string[],
  options: RunCommandOptions
) => Promise<ByteCommandResult>;

const REFERENCE_PATHS = ['source', 'project', 'control'] as const;
const REFERENCE_GIT_STDOUT_MAX_BYTES = 64 * 1024 * 1024;
const REFERENCE_GIT_STDERR_MAX_BYTES = 1024 * 1024;
export const REFERENCE_TRACKED_DIFF_ARGS = ['diff', '--name-only', '--exit-code', '-z', '--', ...REFERENCE_PATHS];
export const REFERENCE_UNTRACKED_SCAN_ARGS = ['ls-files', '-z', '--others', '--exclude-standard', '--', ...REFERENCE_PATHS];

function parseGitPathRecords(stdout: Uint8Array, label: string): string[] {
  const bytes = Buffer.from(stdout);
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new Error(`${label} did not return NUL-terminated path records`);
  }
  const payload = bytes.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error(`${label} returned a non-UTF-8 path record`);
  }
  return uniqueSorted(text.split('\0'));
}

function aggregateExitCode(
  tracked: ByteCommandResult,
  untracked: ByteCommandResult,
  untrackedPaths: string[]
): number {
  if (tracked.code !== 0 && tracked.code !== 1) return tracked.code;
  if (untracked.code !== 0) return untracked.code;
  return tracked.code === 1 || untrackedPaths.length > 0 ? 1 : 0;
}

function gitObservationOptions(root: string): RunCommandOptions {
  return {
    cwd: root,
    envMode: 'replace',
    env: isolatedGitReadEnvironment({ LANG: 'C', LC_ALL: 'C' }),
    maxStdoutBytes: REFERENCE_GIT_STDOUT_MAX_BYTES,
    maxStderrBytes: REFERENCE_GIT_STDERR_MAX_BYTES
  };
}

export async function scanReferenceDrift(
  root: string,
  commandRunner?: ReferenceGitCommandRunner
): Promise<ReferenceDriftScan> {
  if (commandRunner === undefined) {
    return withAuthorityGitReadSession({
      cwd: root,
      environment: { LANG: 'C', LC_ALL: 'C' },
      budget: {
        maxProcesses: 2,
        maxStdoutBytes: REFERENCE_GIT_STDOUT_MAX_BYTES,
        maxStderrBytes: REFERENCE_GIT_STDERR_MAX_BYTES,
        maxRecords: 250_000
      }
    }, async (session) => {
      const run = async (args: readonly string[]): Promise<ByteCommandResult> => {
        const command = await session.run(args);
        if (command.kind !== 'completed') {
          throw new GitReadAuthorityError('Reference Git observation failed.', command);
        }
        return command.result;
      };
      const tracked = await run(REFERENCE_TRACKED_DIFF_ARGS);
      if (tracked.code !== 0 && tracked.code !== 1) {
        return {
          exitCode: tracked.code,
          trackedExitCode: tracked.code,
          untrackedExitCode: -1,
          changedPaths: []
        };
      }
      const trackedPaths = parseGitPathRecords(tracked.stdout, 'git diff');
      const untracked = await run(REFERENCE_UNTRACKED_SCAN_ARGS);
      const untrackedPaths = untracked.code === 0
        ? parseGitPathRecords(untracked.stdout, 'git ls-files')
        : [];
      const recordFailure = session.consumeRecords(trackedPaths.length + untrackedPaths.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Reference Git record budget failed.', recordFailure);
      }
      return {
        exitCode: aggregateExitCode(tracked, untracked, untrackedPaths),
        trackedExitCode: tracked.code,
        untrackedExitCode: untracked.code,
        changedPaths: uniqueSorted([...trackedPaths, ...untrackedPaths])
      };
    });
  }
  const tracked = await commandRunner('git', REFERENCE_TRACKED_DIFF_ARGS, gitObservationOptions(root));
  if (tracked.code !== 0 && tracked.code !== 1) {
    return {
      exitCode: tracked.code,
      trackedExitCode: tracked.code,
      untrackedExitCode: -1,
      changedPaths: []
    };
  }

  const trackedPaths = parseGitPathRecords(tracked.stdout, 'git diff');
  const untracked = await commandRunner('git', REFERENCE_UNTRACKED_SCAN_ARGS, gitObservationOptions(root));
  const untrackedPaths = untracked.code === 0
    ? parseGitPathRecords(untracked.stdout, 'git ls-files')
    : [];
  return {
    exitCode: aggregateExitCode(tracked, untracked, untrackedPaths),
    trackedExitCode: tracked.code,
    untrackedExitCode: untracked.code,
    changedPaths: uniqueSorted([...trackedPaths, ...untrackedPaths])
  };
}
