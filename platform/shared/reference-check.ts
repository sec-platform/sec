import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { CompilerError } from './errors.ts';
import { compilerRoot } from './paths.ts';
import { platformCommand } from './platform-command.ts';
import { runCommand, type CommandResult } from './process.ts';

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
  changedPathCount: number;
  changedPaths: string[];
  recommendedAction: string;
};

type ReferenceCommandRunner = typeof runCommand;

export async function buildReferenceCheckReport(options: {
  root?: string;
  commandRunner?: ReferenceCommandRunner;
} = {}): Promise<ReferenceCheckReport> {
  const root = options.root ?? compilerRoot;
  const commandRunner = options.commandRunner ?? runCommand;
  const refreshArgs = ['run', 'reference:refresh'];
  const diffArgs = ['diff', '--name-only', '--exit-code', '--', 'source', 'project', 'control'];
  const refreshResult = await commandRunner('bun', refreshArgs, {
    cwd: root
  });
  const diffResult: CommandResult = refreshResult.code === 0
    ? await commandRunner('git', diffArgs, { cwd: root })
    : { code: -1, stdout: '', stderr: '' };
  const changedPaths = uniqueSorted(diffResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim()));
  const status: ReferenceCheckStatus = refreshResult.code !== 0
    ? 'refresh-failed'
    : diffResult.code === 0
      ? 'clean'
      : diffResult.code === 1
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
    diffCommand: 'git diff --name-only --exit-code -- source project control',
    diffExitCode: diffResult.code,
    changedPathCount: changedPaths.length,
    changedPaths,
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
    `Commands: refresh=${report.refreshCommand}; diff=${report.diffCommand}`,
    `Refresh: exit=${report.refreshExitCode}; diff: exit=${report.diffExitCode}`,
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
