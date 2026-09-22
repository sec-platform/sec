import { CompilerError } from '../compiler/errors.ts';

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

export function projectReferenceCheckReport(input: Readonly<{
  root: string;
  runnerCommand: string;
  refreshCommand: string;
  diffCommand: string;
  untrackedScanCommand: string;
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
    runnerCommand: input.runnerCommand,
    refreshCommand: input.refreshCommand,
    refreshExitCode: input.refreshExitCode,
    diffCommand: input.diffCommand,
    diffExitCode: input.drift.exitCode,
    trackedDiffExitCode: input.drift.trackedExitCode,
    untrackedScanCommand: input.untrackedScanCommand,
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

const REFERENCE_DRIFT_CODES: Record<Exclude<ReferenceCheckStatus, 'clean'>, {
  code: string;
  message: string;
}> = {
  drifted: {
    code: 'VERIFY-REFERENCE-DRIFT-001',
    message: 'reference workspace drift detected'
  },
  'refresh-failed': {
    code: 'VERIFY-REFERENCE-DRIFT-002',
    message: 'reference refresh failed'
  },
  'diff-failed': {
    code: 'VERIFY-REFERENCE-DRIFT-003',
    message: 'reference diff command failed'
  }
};

export function assertReferenceCheckClean(report: ReferenceCheckReport): void {
  if (report.status === 'clean') return;
  const { code, message } = REFERENCE_DRIFT_CODES[report.status];
  throw new CompilerError(code, message, report);
}
