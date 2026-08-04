import { spawnSync } from 'node:child_process';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export interface BranchLifecycleCommandResult {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

export type BranchLifecycleCommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; timeoutMs?: number; maxBuffer?: number }>
) => BranchLifecycleCommandResult;

export interface BranchLifecycleContext {
  repositoryRoot: string;
  run: BranchLifecycleCommandRunner;
  remote?: string;
  repositoryFullName?: string;
  defaultBranch?: string;
  recoveryRoot?: string;
}

export const defaultBranchLifecycleCommandRunner: BranchLifecycleCommandRunner = (
  command,
  args,
  options
) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? COMMAND_MAX_BUFFER,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
};

export function commandText(result: BranchLifecycleCommandResult): string {
  return result.stdout.toString('utf8').trim();
}

export function commandErrorText(result: BranchLifecycleCommandResult): string {
  return result.stderr.toString('utf8').trim() || `exit ${result.status ?? 'unknown'}`;
}

export function runBranchCommand(
  ctx: BranchLifecycleContext,
  command: string,
  args: readonly string[],
  cwd = ctx.repositoryRoot
): BranchLifecycleCommandResult {
  return ctx.run(command, args, { cwd });
}

export function requireBranchCommandText(
  ctx: BranchLifecycleContext,
  command: string,
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runBranchCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${commandErrorText(result)}`);
  }
  return commandText(result);
}

export function optionalBranchCommandText(
  ctx: BranchLifecycleContext,
  command: string,
  args: readonly string[],
  cwd = ctx.repositoryRoot
): string | null {
  const result = runBranchCommand(ctx, command, args, cwd);
  return result.status === 0 ? commandText(result) : null;
}
