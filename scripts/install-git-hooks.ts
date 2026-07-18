import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const MANAGED_HOOKS_PATH = '.githooks';
const MANAGED_PRE_COMMIT = `${MANAGED_HOOKS_PATH}/pre-commit`;

export interface GitHookInstallationResult {
  readonly status: 'installed' | 'managed' | 'conflict';
  readonly message: string;
}

function gitText(
  cwd: string,
  args: readonly string[],
  options: { readonly allowMissing?: boolean } = {}
): string | null {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (options.allowMissing && result.status === 1 && result.stdout.trim().length === 0) return null;
  if (result.error || result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function resolveGitPath(repoRoot: string, configured: string): string {
  if (configured.length === 0) throw new Error('Git returned an empty hooks path');
  return path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(repoRoot, configured);
}

async function firstRealHook(hooksPath: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(hooksPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const hook = entries.find((entry) => (
    !entry.name.endsWith('.sample') && (entry.isFile() || entry.isSymbolicLink())
  ));
  return hook ? path.join(hooksPath, hook.name) : null;
}

function stoppedResult(message: string, lifecycle: boolean): GitHookInstallationResult {
  if (!lifecycle) throw new Error(message);
  return Object.freeze({ status: 'conflict', message });
}

function conflictResult(configured: string, lifecycle: boolean): GitHookInstallationResult {
  return stoppedResult(
    `Existing Git hook authority is preserved at ${configured}; integrate ${MANAGED_PRE_COMMIT} manually.`,
    lifecycle
  );
}

async function managedHookReady(repoRoot: string): Promise<boolean> {
  const tracked = gitText(
    repoRoot,
    ['ls-files', '--error-unmatch', '--stage', '--', MANAGED_PRE_COMMIT],
    { allowMissing: true }
  );
  if (tracked === null || !/^100755 [0-9a-f]{40,64} 0\t\.githooks\/pre-commit$/u.test(tracked)) {
    return false;
  }
  try {
    return (await stat(path.join(repoRoot, ...MANAGED_PRE_COMMIT.split('/')))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function installGitHooks(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
}): Promise<GitHookInstallationResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const managedAbsolute = path.resolve(repoRoot, MANAGED_HOOKS_PATH);
  if (!await managedHookReady(repoRoot)) {
    return stoppedResult(
      `Tracked executable ${MANAGED_PRE_COMMIT} is unavailable; Git hook authority was not changed.`,
      options.lifecycle ?? false
    );
  }
  const configured = gitText(
    repoRoot,
    ['config', '--path', '--get', 'core.hooksPath'],
    { allowMissing: true }
  );
  const gitHooksPath = gitText(repoRoot, ['rev-parse', '--git-path', 'hooks']);
  if (gitHooksPath === null) throw new Error('Git hooks path is unavailable');
  const effectiveHooksAbsolute = resolveGitPath(repoRoot, gitHooksPath);

  if (configured !== null) {
    if (
      canonicalPath(effectiveHooksAbsolute) !== canonicalPath(managedAbsolute)
      && await pathExists(effectiveHooksAbsolute)
    ) {
      return conflictResult(configured, options.lifecycle ?? false);
    }
  } else {
    const realHook = await firstRealHook(effectiveHooksAbsolute);
    if (realHook !== null) return conflictResult(realHook, options.lifecycle ?? false);
  }

  const worktreeConfigEnabled = gitText(
    repoRoot,
    ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'],
    { allowMissing: true }
  ) === 'true';
  const worktreeConfigured = worktreeConfigEnabled
    ? gitText(repoRoot, ['config', '--worktree', '--path', '--get', 'core.hooksPath'], { allowMissing: true })
    : null;
  if (
    worktreeConfigured !== null
    && canonicalPath(resolveGitPath(repoRoot, worktreeConfigured)) === canonicalPath(managedAbsolute)
  ) {
    return Object.freeze({
      status: 'managed',
      message: `Git hooks already use worktree-local ${MANAGED_HOOKS_PATH}.`
    });
  }

  if (!worktreeConfigEnabled) {
    gitText(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  }
  gitText(repoRoot, ['config', '--worktree', 'core.hooksPath', MANAGED_HOOKS_PATH]);
  return Object.freeze({
    status: 'installed',
    message: `Configured worktree-local core.hooksPath=${MANAGED_HOOKS_PATH}.`
  });
}

export async function installGitHooksMain(options: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const lifecycle = argv.includes('--lifecycle');
  const env = options.env ?? process.env;
  if (lifecycle && (env.CI === 'true' || env.CI === '1')) {
    console.log('Skipped Git hook installation in CI lifecycle.');
    return 0;
  }
  try {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    let repoRoot: string | null;
    try {
      repoRoot = gitText(cwd, ['rev-parse', '--show-toplevel']);
    } catch (error) {
      if (!lifecycle) throw error;
      console.warn('Skipped Git hook installation because no Git worktree is available.');
      return 0;
    }
    if (repoRoot === null || repoRoot.length === 0) throw new Error('Git repository root is unavailable');
    const result = await installGitHooks({ repoRoot, lifecycle });
    if (result.status === 'conflict') console.warn(result.message);
    else console.log(result.message);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await installGitHooksMain();
}
