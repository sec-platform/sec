/**
 * Fixed VerificationSession command transport. Command scope describes the
 * observed repository; it never issues session, integration, or effect authority.
 * Keep command bounds and child environment handling shared by CLI orchestration
 * and the hosted closeout executor without caller-injected process callbacks.
 */
import { spawnSync } from 'node:child_process';
import { createBranchLifecycleGitChildEnvironment, decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { ActiveWorkPackageOwnerObservation } from '../../../../self-hosting/control/task/contract/active-work-observation.ts';

const SESSION_COMMAND_TIMEOUT_MS = 60_000;

export const SESSION_COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export interface VerificationSessionScope {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
  readonly recoveryRoot?: string;
  readonly activeWorkPackageObservation?: ActiveWorkPackageOwnerObservation;
}

export function runVerificationSessionCommand(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot,
  stdin?: string | Uint8Array
) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('VerificationSession command argument contains NUL.');
  }
  const spawned = spawnSync(command, [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: SESSION_COMMAND_TIMEOUT_MS,
    maxBuffer: SESSION_COMMAND_MAX_BUFFER,
    input: stdin === undefined ? undefined : typeof stdin === 'string' ? Buffer.from(stdin, 'utf8') : Buffer.from(stdin),
    env: {
      ...(command === 'git'
        ? createBranchLifecycleGitChildEnvironment(process.env)
        : process.env),
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    status: spawned.status,
    stdout: Buffer.isBuffer(spawned.stdout)
      ? spawned.stdout
      : Buffer.from(String(spawned.stdout ?? '')),
    stderr: Buffer.isBuffer(spawned.stderr)
      ? spawned.stderr
      : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
  };
}

export function requireVerificationSessionCommandText(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runVerificationSessionCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

export function requireCommand(
  ctx: VerificationSessionScope,
  command: 'git' | 'gh',
  args: readonly string[],
  label: string
): string {
  const result = runVerificationSessionCommand(ctx, command, args);
  if (result.status !== 0) throw new Error(`Trusted runtime ${label} failed.`);
  return decodeBranchLifecycleChildStdout(result);
}
