import { CompilerError } from '../../../compiler/errors.ts';
import { runDevCommand } from '../../../adapters/self-hosting/development/runner/command-runner.ts';
import { compilerRoot } from "../../../adapters/workspace-context.ts";
import {
  REFERENCE_TRACKED_DIFF_ARGS,
  REFERENCE_UNTRACKED_SCAN_ARGS,
  scanReferenceDrift
} from '../runtime/drift-scan.ts';

export type ReferenceCheckStatus = 'clean' | 'drifted' | 'refresh-failed' | 'diff-failed';
export type ReferenceCheckFailedStage = 'none' | 'refresh' | 'diff';

export type ReferenceCheckReport = {
  status: ReferenceCheckStatus;
  failedStage: ReferenceCheckFailedStage;
  root: string;
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

function commandText(args: readonly string[]): string {
  return `git ${args.join(' ')}`;
}

export function projectReferenceCheckReport(input: Readonly<{
  root: string;
  refreshExitCode: number;
  drift: Readonly<{
    exitCode: number;
    trackedExitCode: number;
    untrackedExitCode: number;
    changedPaths: readonly string[];
  }>;
}>): ReferenceCheckReport {
  const status: ReferenceCheckStatus = input.refreshExitCode !== 0
    ? 'refresh-failed'
    : input.drift.exitCode === 0
      ? 'clean'
      : input.drift.exitCode === 1
        ? 'drifted'
        : 'diff-failed';
  const failedStage: ReferenceCheckFailedStage = status === 'clean'
    ? 'none'
    : status === 'refresh-failed'
      ? 'refresh'
      : 'diff';

  return {
    status,
    failedStage,
    root: input.root,
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    refreshExitCode: input.refreshExitCode,
    diffCommand: commandText(REFERENCE_TRACKED_DIFF_ARGS),
    diffExitCode: input.drift.exitCode,
    trackedDiffExitCode: input.drift.trackedExitCode,
    untrackedScanCommand: commandText(REFERENCE_UNTRACKED_SCAN_ARGS),
    untrackedScanExitCode: input.drift.untrackedExitCode,
    changedPathCount: input.drift.changedPaths.length,
    changedPaths: [...input.drift.changedPaths],
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

export async function buildReferenceCheckReport(): Promise<ReferenceCheckReport> {
  const refreshExitCode = await runDevCommand(
    'bun',
    ['run', 'reference:refresh'],
    process.env
  );
  const drift = refreshExitCode === 0
    ? await scanReferenceDrift(compilerRoot)
    : {
        exitCode: -1,
        trackedExitCode: -1,
        untrackedExitCode: -1,
        changedPaths: []
      };
  return projectReferenceCheckReport({
    root: compilerRoot,
    refreshExitCode,
    drift
  });
}

export function formatReferenceCheck(report: ReferenceCheckReport, command: string): string {
  return [
    `Reference workspace ${report.status}`,
    `Failed stage: ${report.failedStage}`,
    `Command: ${command}`,
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
