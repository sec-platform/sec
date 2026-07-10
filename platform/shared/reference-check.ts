import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { CompilerError } from './errors.ts';
import { compilerRoot } from './paths.ts';
import { platformCommand } from './platform-command.ts';
import { runCommand } from './process.ts';
import {
  REFERENCE_TRACKED_DIFF_ARGS,
  REFERENCE_UNTRACKED_SCAN_ARGS,
  scanReferenceDrift
} from './reference-drift-scan.ts';

export type ReferenceCheckStatus = 'clean' | 'drifted' | 'refresh-failed' | 'diff-failed';
export type ReferenceCheckFailedStage = 'none' | 'refresh' | 'diff';

export type ReferenceCheckReport = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: ReferenceCheckStatus;
  failedStage: ReferenceCheckFailedStage;
  root: string;
  command: string;
  runnerCommand: string;
  refreshCommand: string;
  refreshExitCode: number;
  diffCommand: string;
  diffExitCode: number;
  trackedDiffExitCode: number;
  untrackedScanCommand: string;
  untrackedScanExitCode: number;
  changedPathCount: number;
  changedPaths: string[];
  recommendedAction: string;
};

type ReferenceCommandRunner = typeof runCommand;

function commandText(args: readonly string[]): string {
  return `git ${args.join(' ')}`;
}

export async function buildReferenceCheckReport(options: {
  root?: string;
  commandRunner?: ReferenceCommandRunner;
} = {}): Promise<ReferenceCheckReport> {
  const root = options.root ?? compilerRoot;
  const commandRunner = options.commandRunner ?? runCommand;
  const refreshArgs = ['run', 'reference:refresh'];
  const refreshResult = await commandRunner('bun', refreshArgs, {
    cwd: root
  });
  const drift = refreshResult.code === 0
    ? await scanReferenceDrift(root, commandRunner)
    : {
        exitCode: -1,
        trackedExitCode: -1,
        untrackedExitCode: -1,
        changedPaths: []
      };
  const status: ReferenceCheckStatus = refreshResult.code !== 0
    ? 'refresh-failed'
    : drift.exitCode === 0
      ? 'clean'
      : drift.exitCode === 1
        ? 'drifted'
        : 'diff-failed';
  const failedStage: ReferenceCheckFailedStage = status === 'clean'
    ? 'none'
    : status === 'refresh-failed'
      ? 'refresh'
      : 'diff';

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status,
    failedStage,
    root,
    command: platformCommand('reference', 'check', '--json'),
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    refreshExitCode: refreshResult.code,
    diffCommand: commandText(REFERENCE_TRACKED_DIFF_ARGS),
    diffExitCode: drift.exitCode,
    trackedDiffExitCode: drift.trackedExitCode,
    untrackedScanCommand: commandText(REFERENCE_UNTRACKED_SCAN_ARGS),
    untrackedScanExitCode: drift.untrackedExitCode,
    changedPathCount: drift.changedPaths.length,
    changedPaths: drift.changedPaths,
    recommendedAction:
      status === 'clean'
        ? 'none'
        : status === 'drifted'
          ? 'inspect-workspace-drift-and-refresh-reference'
          : status === 'refresh-failed'
            ? 'fix-reference-refresh-before-reference-check'
            : 'inspect-git-diff-command'
  };
}

export function formatReferenceCheck(report: ReferenceCheckReport): string {
  return [
    `Reference workspace ${report.status}`,
    `Failed stage: ${report.failedStage}`,
    `Command: ${report.command}`,
    `Runner command: ${report.runnerCommand}`,
    `Commands: refresh=${report.refreshCommand}; diff=${report.diffCommand}; untracked=${report.untrackedScanCommand}`,
    `Refresh: exit=${report.refreshExitCode}; diff: exit=${report.diffExitCode}; tracked=${report.trackedDiffExitCode}; untracked=${report.untrackedScanExitCode}`,
    `Changed paths: ${report.changedPathCount > 0 ? report.changedPaths.join(', ') : 'none'}`,
    `Recommended action: ${report.recommendedAction}`
  ].join('\n');
}

const REFERENCE_DRIFT_CODES: Record<Exclude<ReferenceCheckStatus, 'clean'>, { code: string; message: string }> = {
  drifted: { code: 'VERIFY-REFERENCE-DRIFT-001', message: 'reference workspace drift detected' },
  'refresh-failed': { code: 'VERIFY-REFERENCE-DRIFT-002', message: 'reference refresh failed' },
  'diff-failed': { code: 'VERIFY-REFERENCE-DRIFT-003', message: 'reference diff command failed' }
};

export function assertReferenceCheckClean(report: ReferenceCheckReport): void {
  if (report.status === 'clean') {
    return;
  }

  const { code, message } = REFERENCE_DRIFT_CODES[report.status];
  throw new CompilerError(code, message, report);
}
