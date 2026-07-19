import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANAGED_HOOKS_PATH = '.githooks';
const MANAGED_COMMON_DIRECTORY = 'sec-managed-hooks-v2';
const LEGACY_MANAGED_COMMON_DIRECTORIES = ['sec-managed-hooks-v1'] as const;
const DEPS_ENSURE_COMMAND = 'bun ./platform/dev-runner.ts deps:ensure';
const IMPORTS_FREEZE_COMMAND = 'bun ./platform/dev-runner.ts imports:freeze';
const MANAGED_PRE_COMMIT = `${MANAGED_HOOKS_PATH}/pre-commit`;
const MANAGED_HOOKS = [
  MANAGED_PRE_COMMIT,
  `${MANAGED_HOOKS_PATH}/pre-push`,
  `${MANAGED_HOOKS_PATH}/post-checkout`,
  `${MANAGED_HOOKS_PATH}/post-merge`,
  `${MANAGED_HOOKS_PATH}/post-rewrite`
] as const;

export interface GitHookInstallationResult {
  readonly status: 'installed' | 'managed' | 'conflict';
  readonly message: string;
}

interface ManagedHookSnapshot {
  readonly deployedBytes: Buffer;
  readonly name: string;
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

function isLegacyManagedSetting(configured: string): boolean {
  return configured.replaceAll('\\', '/').replace(/^\.\//u, '') === MANAGED_HOOKS_PATH;
}

function managedCommonRoot(commonGitDir: string): string {
  return path.join(commonGitDir, MANAGED_COMMON_DIRECTORY);
}

function isCurrentManagedCommonSetting(configured: string, commonGitDir: string): boolean {
  return path.isAbsolute(configured)
    && canonicalPath(path.dirname(configured)) === canonicalPath(managedCommonRoot(commonGitDir))
    && /^generation-[0-9a-f]{64}(?:-[0-9a-f-]{36})?$/u.test(path.basename(configured));
}

function isManagedCommonSetting(configured: string, commonGitDir: string): boolean {
  if (isLegacyManagedSetting(configured)) return true;
  if (!path.isAbsolute(configured)) return false;
  return isCurrentManagedCommonSetting(configured, commonGitDir)
    || LEGACY_MANAGED_COMMON_DIRECTORIES.some((directory) => (
      canonicalPath(path.dirname(configured)) === canonicalPath(path.join(commonGitDir, directory))
      && /^generation-[0-9a-f]{64}(?:-[0-9a-f-]{36})?$/u.test(path.basename(configured))
    ));
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

function worktreeRoots(repoRoot: string): readonly string[] {
  const output = gitText(repoRoot, ['worktree', 'list', '--porcelain']);
  if (output === null) return Object.freeze([repoRoot]);
  return Object.freeze(output
    .split(/\r?\n/gu)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length))));
}

async function firstConfiguredHookAuthority(
  repoRoot: string,
  configured: string
): Promise<string | null> {
  const candidateRoots = path.isAbsolute(configured) ? [repoRoot] : worktreeRoots(repoRoot);
  for (const candidateRoot of candidateRoots) {
    const configuredPath = resolveGitPath(candidateRoot, configured);
    if (await pathExists(configuredPath)) return configuredPath;
  }
  return null;
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

function deployedHookBytes(name: string, sourceBytes: Buffer): Buffer {
  if (name !== 'pre-commit' && name !== 'pre-push') return sourceBytes;
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  const firstFreeze = source.indexOf(IMPORTS_FREEZE_COMMAND);
  if (firstFreeze < 0 || firstFreeze !== source.lastIndexOf(IMPORTS_FREEZE_COMMAND)) {
    throw new Error(`${name} must contain exactly one canonical imports:freeze command`);
  }
  return Buffer.from(source.replace(
    IMPORTS_FREEZE_COMMAND,
    `${DEPS_ENSURE_COMMAND}\n${IMPORTS_FREEZE_COMMAND}`
  ), 'utf8');
}

async function managedHookSnapshots(repoRoot: string): Promise<readonly ManagedHookSnapshot[] | null> {
  const snapshots: ManagedHookSnapshot[] = [];
  for (const hook of MANAGED_HOOKS) {
    const tracked = gitText(
      repoRoot,
      ['ls-files', '--error-unmatch', '--stage', '--', hook],
      { allowMissing: true }
    );
    const escapedHook = hook.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = tracked === null
      ? null
      : (new RegExp(`^100755 ([0-9a-f]{40,64}) 0\\t${escapedHook}$`, 'u')).exec(tracked);
    if (match === null) return null;
    const sourcePath = path.join(repoRoot, ...hook.split('/'));
    try {
      if (!(await stat(sourcePath)).isFile()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const sourceBytes = await readFile(sourcePath);
    const objectHash = match[1].length === 40 ? 'sha1' : 'sha256';
    const workingBlob = createHash(objectHash)
      .update(`blob ${sourceBytes.byteLength}\0`)
      .update(sourceBytes)
      .digest('hex');
    if (workingBlob !== match[1]) return null;
    const name = path.basename(hook);
    snapshots.push(Object.freeze({
      deployedBytes: deployedHookBytes(name, sourceBytes),
      name
    }));
  }
  return Object.freeze(snapshots);
}

function managedGenerationDigest(snapshots: readonly ManagedHookSnapshot[]): string {
  const hash = createHash('sha256');
  hash.update('sec-managed-hooks-v2\0');
  for (const snapshot of snapshots) {
    hash.update(`${snapshot.name}\0${snapshot.deployedBytes.byteLength}\0`);
    hash.update(snapshot.deployedBytes);
  }
  return hash.digest('hex');
}

async function managedGenerationReady(
  generationPath: string,
  snapshots: readonly ManagedHookSnapshot[]
): Promise<boolean> {
  for (const snapshot of snapshots) {
    const installedPath = path.join(generationPath, snapshot.name);
    try {
      const [installedStat, installedBytes] = await Promise.all([
        stat(installedPath),
        readFile(installedPath)
      ]);
      if (
        !installedStat.isFile()
        || !installedBytes.equals(snapshot.deployedBytes)
        || (process.platform !== 'win32' && (installedStat.mode & 0o111) === 0)
      ) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

async function materializeManagedGeneration(
  commonGitDir: string,
  snapshots: readonly ManagedHookSnapshot[],
  preferredGeneration: string | null
): Promise<string> {
  const commonRoot = managedCommonRoot(commonGitDir);
  const digest = managedGenerationDigest(snapshots);
  const primaryGeneration = path.join(commonRoot, `generation-${digest}`);
  if (preferredGeneration !== null && await managedGenerationReady(preferredGeneration, snapshots)) {
    return preferredGeneration;
  }
  if (await managedGenerationReady(primaryGeneration, snapshots)) return primaryGeneration;

  await mkdir(commonRoot, { recursive: true });
  const stagingPath = path.join(commonRoot, `.staging-${process.pid}-${randomUUID()}`);
  await mkdir(stagingPath);
  try {
    await Promise.all(snapshots.map(async (snapshot) => {
      const installedPath = path.join(stagingPath, snapshot.name);
      await writeFile(installedPath, snapshot.deployedBytes, { mode: 0o755 });
      await chmod(installedPath, 0o755);
    }));

    let publishedPath = primaryGeneration;
    try {
      await rename(stagingPath, publishedPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) throw error;
      if (await managedGenerationReady(primaryGeneration, snapshots)) return primaryGeneration;
      publishedPath = `${primaryGeneration}-${randomUUID()}`;
      await rename(stagingPath, publishedPath);
    }
    if (!await managedGenerationReady(publishedPath, snapshots)) {
      throw new Error('Published repository-common Git hook generation failed validation');
    }
    return publishedPath;
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}

export async function installGitHooks(options: {
  readonly repoRoot: string;
  readonly lifecycle?: boolean;
}): Promise<GitHookInstallationResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const snapshots = await managedHookSnapshots(repoRoot);
  if (snapshots === null) {
    return stoppedResult(
      `Tracked, executable, index-identical managed hooks are unavailable; Git hook authority was not changed.`,
      options.lifecycle ?? false
    );
  }
  const commonGitDir = gitText(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (commonGitDir === null) throw new Error('Git common directory is unavailable');
  const worktreeConfigEnabled = gitText(
    repoRoot,
    ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'],
    { allowMissing: true }
  ) === 'true';
  const commonConfigured = gitText(
    repoRoot,
    ['config', '--local', '--path', '--get', 'core.hooksPath'],
    { allowMissing: true }
  );
  const worktreeConfigured = worktreeConfigEnabled
    ? gitText(repoRoot, ['config', '--worktree', '--path', '--get', 'core.hooksPath'], { allowMissing: true })
    : null;

  if (
    worktreeConfigured !== null
    && !isManagedCommonSetting(worktreeConfigured, commonGitDir)
  ) {
    const authority = await firstConfiguredHookAuthority(repoRoot, worktreeConfigured);
    if (authority !== null) return conflictResult(authority, options.lifecycle ?? false);
  }

  if (commonConfigured !== null && !isManagedCommonSetting(commonConfigured, commonGitDir)) {
    const authority = await firstConfiguredHookAuthority(repoRoot, commonConfigured);
    if (authority !== null) return conflictResult(authority, options.lifecycle ?? false);
  } else if (commonConfigured === null) {
    const realHook = await firstRealHook(path.join(commonGitDir, 'hooks'));
    if (realHook !== null) return conflictResult(realHook, options.lifecycle ?? false);
  }

  const preferredGeneration = commonConfigured !== null
    && isCurrentManagedCommonSetting(commonConfigured, commonGitDir)
    ? resolveGitPath(repoRoot, commonConfigured)
    : null;
  const generationPath = await materializeManagedGeneration(commonGitDir, snapshots, preferredGeneration);
  const commonMatchesGeneration = commonConfigured !== null
    && canonicalPath(resolveGitPath(repoRoot, commonConfigured)) === canonicalPath(generationPath);
  const worktreeOverridePresent = worktreeConfigured !== null;
  if (!worktreeConfigEnabled) {
    gitText(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  }
  if (!commonMatchesGeneration) {
    gitText(repoRoot, ['config', '--local', 'core.hooksPath', generationPath]);
  }
  if (worktreeOverridePresent) {
    gitText(repoRoot, ['config', '--worktree', '--unset-all', 'core.hooksPath'], { allowMissing: true });
  }

  if (commonMatchesGeneration && !worktreeOverridePresent) {
    return Object.freeze({
      status: 'managed',
      message: `Git hooks already use validated repository-common generation ${generationPath}.`
    });
  }
  return Object.freeze({
    status: 'installed',
    message: `Configured repository-common core.hooksPath=${generationPath}; future worktrees inherit it before checkout.`
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
