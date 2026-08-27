import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANAGED_HOOKS_PATH = '.githooks';
const MANAGED_COMMON_DIRECTORY = 'sec-managed-hooks-v3';
const LEGACY_MANAGED_COMMON_DIRECTORIES = ['sec-managed-hooks-v1', 'sec-managed-hooks-v2'] as const;
const DEPS_ENSURE_COMMAND = 'bun ./platform/dev-runner.ts deps:ensure';
const HOOKS_RECONCILE_COMMAND = 'bun ./scripts/install-git-hooks.ts --lifecycle';
const IMPORTS_FREEZE_COMMAND = 'bun ./platform/dev-runner.ts imports:freeze';
const MANAGED_PRE_COMMIT = `${MANAGED_HOOKS_PATH}/pre-commit`;
const MANAGED_HOOKS = [
  MANAGED_PRE_COMMIT,
  `${MANAGED_HOOKS_PATH}/pre-push`,
  `${MANAGED_HOOKS_PATH}/post-checkout`,
  `${MANAGED_HOOKS_PATH}/post-merge`,
  `${MANAGED_HOOKS_PATH}/post-rewrite`
] as const;
const MARKER_FILE_NAME = '.last-install';

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
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (options.allowMissing && result.status === 1 && stdout.trim().length === 0) return null;
  if (result.error || result.status !== 0) {
    const detail = stderr.trim();
    throw new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
  }
  return stdout.trim();
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

function shellQuotedRuntimeExecutable(executable: string): string {
  if (executable.length === 0 || /[\0\r\n]/u.test(executable)) {
    throw new Error('Bun runtime executable path is invalid');
  }
  const shellPath = process.platform === 'win32' ? executable.replaceAll('\\', '/') : executable;
  return `'${shellPath.replaceAll("'", `'"'"'`)}'`;
}

function bindHookCommandToRuntime(command: string, runtimeExecutable: string): string {
  if (!command.startsWith('bun ')) throw new Error('Managed hook command must use canonical Bun syntax');
  return `${shellQuotedRuntimeExecutable(runtimeExecutable)}${command.slice('bun'.length)}`;
}

function deployedHookBytes(name: string, sourceBytes: Buffer): Buffer {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  let deployed = source;
  if (name === 'pre-commit' || name === 'pre-push') {
    const firstFreeze = source.indexOf(IMPORTS_FREEZE_COMMAND);
    if (firstFreeze < 0 || firstFreeze !== source.lastIndexOf(IMPORTS_FREEZE_COMMAND)) {
      throw new Error(`${name} must contain exactly one canonical imports:freeze command`);
    }
    deployed = source.replace(
      IMPORTS_FREEZE_COMMAND,
      `${DEPS_ENSURE_COMMAND}\n${IMPORTS_FREEZE_COMMAND}`
    );
  }
  return Buffer.from(deployed
    .replaceAll(DEPS_ENSURE_COMMAND, bindHookCommandToRuntime(DEPS_ENSURE_COMMAND, process.execPath))
    .replaceAll(HOOKS_RECONCILE_COMMAND, bindHookCommandToRuntime(HOOKS_RECONCILE_COMMAND, process.execPath))
    .replaceAll(IMPORTS_FREEZE_COMMAND, bindHookCommandToRuntime(IMPORTS_FREEZE_COMMAND, process.execPath)), 'utf8');
}

async function managedHookSnapshots(repoRoot: string): Promise<readonly ManagedHookSnapshot[] | null> {
  const trackedRecords = gitText(
    repoRoot,
    ['ls-files', '--stage', '-z', '--', ...MANAGED_HOOKS]
  )?.split('\0').filter((record) => record.length > 0) ?? [];
  const trackedByPath = new Map<string, string>();
  for (const record of trackedRecords) {
    const match = /^(100755) ([0-9a-f]{40,64}) 0\t(.+)$/u.exec(record);
    if (match === null || !MANAGED_HOOKS.includes(match[3] as typeof MANAGED_HOOKS[number])
        || trackedByPath.has(match[3]!)) return null;
    trackedByPath.set(match[3]!, match[2]!);
  }
  if (trackedByPath.size !== MANAGED_HOOKS.length) return null;
  const snapshots: ManagedHookSnapshot[] = [];
  for (const hook of MANAGED_HOOKS) {
    const trackedObjectId = trackedByPath.get(hook);
    if (trackedObjectId === undefined) return null;
    const sourcePath = path.join(repoRoot, ...hook.split('/'));
    try {
      if (!(await lstat(sourcePath)).isFile()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const sourceBytes = await readFile(sourcePath);
    const objectHash = trackedObjectId.length === 40 ? 'sha1' : 'sha256';
    const workingBlob = createHash(objectHash)
      .update(`blob ${sourceBytes.byteLength}\0`)
      .update(sourceBytes)
      .digest('hex');
    if (workingBlob !== trackedObjectId) return null;
    const name = path.basename(hook);
    snapshots.push(Object.freeze({
      deployedBytes: deployedHookBytes(name, sourceBytes),
      name
    }));
  }
  return Object.freeze(snapshots);
}

function managedGenerationDigest(
  snapshots: readonly ManagedHookSnapshot[],
  worktreeGitDir: string
): string {
  const hash = createHash('sha256');
  hash.update('sec-managed-hooks-v3\0');
  hash.update(`worktree-git-dir\0${canonicalPath(worktreeGitDir)}\0`);
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

async function managedGenerationDigestMatches(
  generationPath: string,
  expectedDigest: string,
  worktreeGitDir: string
): Promise<boolean> {
  const snapshots: ManagedHookSnapshot[] = [];
  for (const name of MANAGED_HOOKS.map((hook) => path.basename(hook))) {
    const installedPath = path.join(generationPath, name);
    try {
      const [metadata, deployedBytes] = await Promise.all([
        stat(installedPath),
        readFile(installedPath)
      ]);
      if (!metadata.isFile()
          || (process.platform !== 'win32' && (metadata.mode & 0o111) === 0)) return false;
      snapshots.push(Object.freeze({ deployedBytes, name }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return managedGenerationDigest(snapshots, worktreeGitDir) === expectedDigest;
}

/**
 * Marker file lives inside the invoking worktree's own Git directory, so one
 * worktree can never admit another worktree's source fingerprint or binding.
 * Content format: two lines — managedGenerationDigest and sourceFingerprint.
 * sourceFingerprint is compiled from the exact index-identical source bytes;
 * metadata such as size/mtime is never accepted as a tracked-byte identity.
 */
function markerFilePath(worktreeGitDir: string): string {
  return path.join(worktreeGitDir, MANAGED_COMMON_DIRECTORY, MARKER_FILE_NAME);
}

interface HookMarkerRecord {
  readonly digest: string;
  readonly fingerprint: string;
}

function computeSourceFingerprint(snapshots: readonly ManagedHookSnapshot[]): string {
  const hash = createHash('sha256');
  hash.update('sec-managed-hook-source-fingerprint-v2\0');
  for (const snapshot of snapshots) {
    hash.update(`${snapshot.name}\0${snapshot.deployedBytes.byteLength}\0`);
    hash.update(snapshot.deployedBytes);
  }
  return hash.digest('hex');
}

async function currentManagedHookSourceMatches(
  repoRoot: string,
  worktreeGitDir: string,
  expectedDigest: string
): Promise<boolean> {
  const snapshots = await managedHookSnapshots(repoRoot);
  return snapshots !== null
    && managedGenerationDigest(snapshots, worktreeGitDir) === expectedDigest;
}

async function readMarkerFile(markerPath: string): Promise<HookMarkerRecord | null> {
  let raw: string;
  try {
    raw = await readFile(markerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
  const lines = raw.split('\n');
  const digest = lines[0]?.trim();
  const fingerprint = lines[1]?.trim();
  if (
    !digest
    || !/^[0-9a-f]{64}$/u.test(digest)
    || !fingerprint
    || !/^[0-9a-f]{64}$/u.test(fingerprint)
  ) return null;
  return { digest, fingerprint };
}

async function writeMarkerFile(
  markerPath: string,
  record: HookMarkerRecord
): Promise<void> {
  try {
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeFile(markerPath, `${record.digest}\n${record.fingerprint}\n`, { mode: 0o644 });
  } catch {
    // marker write is best-effort; failures must not break hook installation.
  }
}

async function materializeManagedGeneration(
  commonGitDir: string,
  worktreeGitDir: string,
  snapshots: readonly ManagedHookSnapshot[],
  preferredGeneration: string | null
): Promise<string> {
  const commonRoot = managedCommonRoot(commonGitDir);
  const digest = managedGenerationDigest(snapshots, worktreeGitDir);
  const primaryGeneration = path.join(commonRoot, `generation-${digest}`);
  if (preferredGeneration !== null
      && canonicalPath(preferredGeneration) === canonicalPath(primaryGeneration)
      && await managedGenerationReady(preferredGeneration, snapshots)) {
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
  const commonGitDirText = gitText(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const worktreeGitDirText = gitText(repoRoot, ['rev-parse', '--path-format=absolute', '--absolute-git-dir']);
  if (commonGitDirText === null || worktreeGitDirText === null) {
    throw new Error('Git worktree identity is unavailable');
  }
  const commonGitDir = path.resolve(commonGitDirText);
  const worktreeGitDir = path.resolve(worktreeGitDirText);
  const worktreeConfigPathText = gitText(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--git-path', 'config.worktree']
  );
  if (worktreeConfigPathText === null) throw new Error('Git worktree config identity is unavailable');
  const worktreeConfigPath = path.resolve(worktreeConfigPathText);
  const primaryRepoRoot = path.dirname(commonGitDir);
  const primaryTopLevel = gitText(primaryRepoRoot, ['rev-parse', '--show-toplevel']);
  if (primaryTopLevel === null || canonicalPath(primaryTopLevel) !== canonicalPath(primaryRepoRoot)) {
    throw new Error('Primary worktree bootstrap identity is unavailable');
  }
  const isPrimaryWorktree = canonicalPath(worktreeGitDir) === canonicalPath(commonGitDir);
  const markerPath = markerFilePath(worktreeGitDir);
  const bootstrapMarkerPath = markerFilePath(commonGitDir);
  const snapshots = await managedHookSnapshots(repoRoot);
  const bootstrapSnapshots = isPrimaryWorktree
    ? snapshots
    : await managedHookSnapshots(primaryRepoRoot);
  if (snapshots === null || bootstrapSnapshots === null) {
    return stoppedResult(
      'Tracked, executable, index-identical managed hooks are unavailable in the current or primary-bootstrap worktree; Git hook authority was not changed.',
      options.lifecycle ?? false
    );
  }
  const sourceFingerprint = computeSourceFingerprint(snapshots);
  const bootstrapFingerprint = isPrimaryWorktree
    ? sourceFingerprint
    : computeSourceFingerprint(bootstrapSnapshots);
  const sourceDigest = managedGenerationDigest(snapshots, worktreeGitDir);
  const bootstrapDigest = managedGenerationDigest(bootstrapSnapshots, commonGitDir);
  const marker = await readMarkerFile(markerPath);
  const bootstrapMarker = isPrimaryWorktree
    ? marker
    : await readMarkerFile(bootstrapMarkerPath);
  if (marker !== null && marker.fingerprint === sourceFingerprint
      && marker.digest === sourceDigest
      && bootstrapMarker !== null && bootstrapMarker.fingerprint === bootstrapFingerprint
      && bootstrapMarker.digest === bootstrapDigest) {
    const worktreeConfigEnabledFast = gitText(
      repoRoot,
      ['config', '--local', '--type=bool', '--get', 'extensions.worktreeConfig'],
      { allowMissing: true }
    ) === 'true';
    const commonConfiguredFast = gitText(
      repoRoot,
      ['config', '--local', '--path', '--get', 'core.hooksPath'],
      { allowMissing: true }
    );
    const worktreeConfiguredFast = worktreeConfigEnabledFast
      ? gitText(repoRoot, ['config', '--file', worktreeConfigPath, '--path', '--get', 'core.hooksPath'], { allowMissing: true })
      : null;
    const expectedGenerationPath = path.join(
      commonGitDir,
      MANAGED_COMMON_DIRECTORY,
      `generation-${marker.digest}`
    );
    const expectedBootstrapPath = path.join(
      commonGitDir,
      MANAGED_COMMON_DIRECTORY,
      `generation-${bootstrapMarker.digest}`
    );
    if (
      worktreeConfigEnabledFast
      && commonConfiguredFast !== null
      && worktreeConfiguredFast !== null
      && canonicalPath(resolveGitPath(repoRoot, commonConfiguredFast)) === canonicalPath(expectedBootstrapPath)
      && canonicalPath(resolveGitPath(repoRoot, worktreeConfiguredFast)) === canonicalPath(expectedGenerationPath)
      && await pathExists(expectedGenerationPath)
      && await pathExists(expectedBootstrapPath)
      && await managedGenerationDigestMatches(expectedGenerationPath, marker.digest, worktreeGitDir)
      && (expectedBootstrapPath === expectedGenerationPath
        || await managedGenerationDigestMatches(expectedBootstrapPath, bootstrapMarker.digest, commonGitDir))
      && await currentManagedHookSourceMatches(repoRoot, worktreeGitDir, marker.digest)
      && (isPrimaryWorktree
        || await currentManagedHookSourceMatches(primaryRepoRoot, commonGitDir, bootstrapMarker.digest))
    ) {
      return Object.freeze({
        status: 'managed',
        message: `Git hooks already use worktree-bound generation ${expectedGenerationPath}.`
      });
    }
  }

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
    ? gitText(repoRoot, ['config', '--file', worktreeConfigPath, '--path', '--get', 'core.hooksPath'], { allowMissing: true })
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

  const preferredGeneration = worktreeConfigured !== null
    && isCurrentManagedCommonSetting(worktreeConfigured, commonGitDir)
    ? resolveGitPath(repoRoot, worktreeConfigured)
    : null;
  const preferredBootstrap = commonConfigured !== null
    && isCurrentManagedCommonSetting(commonConfigured, commonGitDir)
    ? resolveGitPath(repoRoot, commonConfigured)
    : null;
  const generationPath = await materializeManagedGeneration(
    commonGitDir,
    worktreeGitDir,
    snapshots,
    preferredGeneration
  );
  const bootstrapGenerationPath = isPrimaryWorktree
    ? generationPath
    : await materializeManagedGeneration(
      commonGitDir,
      commonGitDir,
      bootstrapSnapshots,
      preferredBootstrap
    );
  const commonMatchesBootstrap = commonConfigured !== null
    && canonicalPath(resolveGitPath(repoRoot, commonConfigured)) === canonicalPath(bootstrapGenerationPath);
  const worktreeMatchesGeneration = worktreeConfigured !== null
    && canonicalPath(resolveGitPath(repoRoot, worktreeConfigured)) === canonicalPath(generationPath);
  if (!worktreeConfigEnabled) {
    gitText(repoRoot, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  }
  if (!commonMatchesBootstrap) {
    gitText(repoRoot, ['config', '--local', 'core.hooksPath', bootstrapGenerationPath]);
  }
  if (!worktreeMatchesGeneration) {
    gitText(repoRoot, ['config', '--worktree', 'core.hooksPath', generationPath]);
  }
  const commonReadback = gitText(repoRoot, ['config', '--local', '--path', '--get', 'core.hooksPath']);
  const worktreeReadback = gitText(
    repoRoot,
    ['config', '--file', worktreeConfigPath, '--path', '--get', 'core.hooksPath']
  );
  if (commonReadback === null || worktreeReadback === null
      || canonicalPath(resolveGitPath(repoRoot, commonReadback)) !== canonicalPath(bootstrapGenerationPath)
      || canonicalPath(resolveGitPath(repoRoot, worktreeReadback)) !== canonicalPath(generationPath)) {
    throw new Error('Git hook authority changed during exact configuration readback');
  }

  await writeMarkerFile(markerPath, { digest: sourceDigest, fingerprint: sourceFingerprint });
  if (!isPrimaryWorktree) {
    await writeMarkerFile(bootstrapMarkerPath, {
      digest: bootstrapDigest,
      fingerprint: bootstrapFingerprint
    });
  }
  if (!await currentManagedHookSourceMatches(repoRoot, worktreeGitDir, sourceDigest)
      || (!isPrimaryWorktree
        && !await currentManagedHookSourceMatches(primaryRepoRoot, commonGitDir, bootstrapDigest))) {
    throw new Error('Tracked managed hook bytes changed during exact generation publication');
  }

  if (commonMatchesBootstrap && worktreeMatchesGeneration) {
    return Object.freeze({
      status: 'managed',
      message: `Git hooks already use worktree-bound generation ${generationPath}.`
    });
  }
  return Object.freeze({
    status: 'installed',
    message: `Configured worktree core.hooksPath=${generationPath}; repository bootstrap remains ${bootstrapGenerationPath}.`
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
