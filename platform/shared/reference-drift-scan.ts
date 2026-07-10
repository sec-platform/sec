import { uniqueSortedLines } from './collections.ts';
import { runCommand, type CommandResult } from './process.ts';

export type ReferenceDriftScan = {
  exitCode: number;
  trackedExitCode: number;
  untrackedExitCode: number;
  changedPaths: string[];
};

type ReferenceCommandRunner = typeof runCommand;

const REFERENCE_PATHS = ['source', 'project', 'control'] as const;
export const REFERENCE_TRACKED_DIFF_ARGS = ['diff', '--name-only', '--exit-code', '--', ...REFERENCE_PATHS];
export const REFERENCE_UNTRACKED_SCAN_ARGS = ['ls-files', '--others', '--exclude-standard', '--', ...REFERENCE_PATHS];

function aggregateExitCode(
  tracked: CommandResult,
  untracked: CommandResult,
  untrackedPaths: string[]
): number {
  if (tracked.code !== 0 && tracked.code !== 1) return tracked.code;
  if (untracked.code !== 0) return untracked.code;
  return tracked.code === 1 || untrackedPaths.length > 0 ? 1 : 0;
}

export async function scanReferenceDrift(
  root: string,
  commandRunner: ReferenceCommandRunner = runCommand
): Promise<ReferenceDriftScan> {
  const tracked = await commandRunner('git', REFERENCE_TRACKED_DIFF_ARGS, { cwd: root });
  if (tracked.code !== 0 && tracked.code !== 1) {
    return {
      exitCode: tracked.code,
      trackedExitCode: tracked.code,
      untrackedExitCode: -1,
      changedPaths: uniqueSortedLines(tracked.stdout)
    };
  }

  const untracked = await commandRunner('git', REFERENCE_UNTRACKED_SCAN_ARGS, { cwd: root });
  const untrackedPaths = uniqueSortedLines(untracked.stdout);
  return {
    exitCode: aggregateExitCode(tracked, untracked, untrackedPaths),
    trackedExitCode: tracked.code,
    untrackedExitCode: untracked.code,
    changedPaths: uniqueSortedLines(`${tracked.stdout}\n${untracked.stdout}`)
  };
}
