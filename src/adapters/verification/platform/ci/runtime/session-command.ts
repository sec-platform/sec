/**
 * Fixed VerificationSession command transport. Command scope describes the
 * observed repository; it never issues session, integration, or effect authority.
 * Keep command bounds and child environment handling shared by CLI orchestration
 * and the hosted closeout executor without caller-injected process callbacks.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { settleResources } from '../../../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type RetainedNoFollowChildProcessDirectory
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR } from '../../../../runtime-state/physical/runtime/process.ts';
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

/**
 * This transport consumes the Physical owner's retained cwd capability. Linux
 * executes against the retained inode, including after a pathname rename;
 * Windows pins its directory chain. An unavailable backend (including Darwin)
 * fails before spawning. This does not narrow unrelated Darwin capabilities.
 */
function retainedVerificationSessionSpawnBoundary(
  directory: RetainedNoFollowChildProcessDirectory
): Readonly<{ cwd: string; stdio: Array<'pipe' | 'ignore' | number> }> {
  directory.assertCurrent();
  const stdio: Array<'pipe' | 'ignore' | number> = ['pipe', 'pipe', 'pipe'];
  if (process.platform === 'linux') {
    const descriptor = directory.stdioSourceDescriptor;
    if (directory.childPath !== `/proc/self/fd/${RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR}`
        || descriptor === null || !Number.isSafeInteger(descriptor) || descriptor < 5) {
      throw new Error('VerificationSession retained Linux cwd capability is malformed.');
    }
    while (stdio.length <= RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR) stdio.push('ignore');
    stdio[RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR] = descriptor;
    return Object.freeze({ cwd: `/proc/self/fd/${descriptor}`, stdio });
  }
  if (process.platform === 'win32') {
    if (directory.stdioSourceDescriptor !== null || !path.isAbsolute(directory.childPath)) {
      throw new Error('VerificationSession retained Windows cwd capability is malformed.');
    }
    return Object.freeze({ cwd: directory.childPath, stdio });
  }
  // The production Physical acquisition rejects this before issuing a handle.
  throw new Error(`VerificationSession retained command cwd is unavailable on ${process.platform}.`);
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
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(path.resolve(cwd), 'VerificationSession command working directory'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'VerificationSession command working directory'
  );
  let primary: { readonly label: string; readonly error: unknown } | undefined;
  try {
    const boundary = retainedVerificationSessionSpawnBoundary(workingDirectory);
    const spawned = spawnSync(command, [...args], {
      cwd: boundary.cwd,
      stdio: boundary.stdio,
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
    workingDirectory.assertCurrent();
    return {
      status: spawned.status,
      stdout: Buffer.isBuffer(spawned.stdout)
        ? spawned.stdout
        : Buffer.from(String(spawned.stdout ?? '')),
      stderr: Buffer.isBuffer(spawned.stderr)
        ? spawned.stderr
        : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
    };
  } catch (error) {
    primary = { label: 'VerificationSession command', error };
    throw error;
  } finally {
    settleResources({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [{ label: 'VerificationSession command cwd dispose', settle: () => workingDirectory.dispose() }]
    });
  }
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
