import { isolatedGitReadEnvironment } from '../git/read-environment.ts';
import { uniqueSorted } from './collections.ts';
import {
  runCommandBytes,
  type ByteCommandResult,
  type RunCommandOptions
} from './process.ts';

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
  commandRunner: ReferenceGitCommandRunner = runCommandBytes
): Promise<ReferenceDriftScan> {
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
