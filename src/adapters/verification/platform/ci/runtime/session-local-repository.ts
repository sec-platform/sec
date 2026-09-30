/** VerificationSession physical owner recovered from current-main semantics. */
import { createRuntimeStateJournalFileSystem } from '../../../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeJournalAuthority } from '../../../../runtime-state/workspace-state/physical-authority.ts';
import { createBranchLifecycleGitChildEnvironment, decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import type { VerificationSessionJournalFileSystem } from './verification-session-journal.ts';
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

const SESSION_COMMAND_TIMEOUT_MS = 60_000;

export const SESSION_COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

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

export function comparableFileSystemPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export function exactRealPath(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  const metadata = lstatSync(resolved);
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symlink or reparse point.`);
  const real = realpathSync.native(resolved);
  if (comparableFileSystemPath(real) !== comparableFileSystemPath(resolved)) {
    throw new Error(`${label} must resolve without filesystem indirection.`);
  }
  return real;
}

export function gitText(ctx: VerificationSessionScope, cwd: string, args: readonly string[], label: string): string {
  return requireVerificationSessionCommandText(ctx, 'git', args, label, cwd).trim();
}

export function commonGitDirectory(ctx: VerificationSessionScope, repositoryRoot: string): string {
  const source = gitText(ctx, repositoryRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'Git common directory readback');
  return exactRealPath(source, 'Git common directory');
}

export function inspectLocalVerificationActionRepositoryWithScope(
  ctx: VerificationSessionScope,
  repositoryRoot: string
) {
  const read = (args: readonly string[], label: string): string => (
    gitText(ctx, repositoryRoot, args, label)
  );
  return Object.freeze({
    headSha: read(['rev-parse', 'HEAD'], 'local VerificationAction HEAD readback'),
    headTreeSha: read(['rev-parse', 'HEAD^{tree}'], 'local VerificationAction tree readback'),
    trackedClean:
      read(
        ['diff', '--name-only', '--ignore-cr-at-eol'],
        'local VerificationAction unstaged tracked-state readback'
      ) === ''
      && read(
        ['diff', '--cached', '--name-only', '--ignore-cr-at-eol'],
        'local VerificationAction staged tracked-state readback'
      ) === ''
      && read(
        ['ls-files', '--others', '--exclude-standard'],
        'local VerificationAction untracked-state readback'
      ) === '',
    gitCommonDirectory: commonGitDirectory(ctx, repositoryRoot)
  });
}

export async function openRuntimeJournalFileSystem(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<VerificationSessionJournalFileSystem> {
  const authority = await acquireSecRuntimeJournalAuthority({ repositoryRoot, environment });
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment });
  return createRuntimeStateJournalFileSystem(authority.directory(roots.workspaceStateRoot));
}
