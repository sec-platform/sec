import { CompilerError } from './errors.ts';
import { compilerRoot } from './paths.ts';
import { resolveNpmInvocation, runCommand, type CommandResult } from './process.ts';

export type ReferenceCheckStatus = 'clean' | 'drifted' | 'refresh-failed' | 'diff-failed';
export type ReferenceCheckFailedStage = 'none' | 'refresh' | 'diff';

export type ReferenceCheckReport = {
  formatVersion: '1';
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
  const refreshInvocation = resolveNpmInvocation(refreshArgs);
  const refreshResult = await commandRunner(refreshInvocation.command, refreshInvocation.args, {
    cwd: root
  });
  const diffResult: CommandResult = refreshResult.code === 0
    ? await commandRunner('git', diffArgs, { cwd: root })
    : { code: -1, stdout: '', stderr: '' };
  const changedPaths = diffResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
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
    formatVersion: '1',
    status,
    failedStage,
    root,
    command: 'npm run platform -- reference check --json',
    runnerCommand: 'npm run reference:check',
    refreshCommand: 'npm run reference:refresh',
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

export function assertReferenceCheckClean(report: ReferenceCheckReport): void {
  if (report.status === 'clean') {
    return;
  }

  throw new CompilerError(
    report.status === 'drifted'
      ? 'VERIFY-REFERENCE-DRIFT-001'
      : report.status === 'refresh-failed'
        ? 'VERIFY-REFERENCE-DRIFT-002'
        : 'VERIFY-REFERENCE-DRIFT-003',
    report.status === 'drifted'
      ? 'reference workspace drift detected'
      : report.status === 'refresh-failed'
        ? 'reference refresh failed'
        : 'reference diff command failed',
    report
  );
}
