import crypto from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCanonicalBunRuntimeVersion } from './bun-runtime-version.ts';
import { CompilerError } from './errors.ts';
import {
  ensureDir,
  formatJsonFile,
  pathExists,
  readJson,
  readText,
  writeJson,
  writeText,
  type CommitFence
} from './fs.ts';
import { compilerRoot, isPathInside } from './paths.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  pathEnvKey,
  runCommand,
  type CommandResult
} from './process.ts';
import {
  buildRuntimePackageManifest,
  isRuntimeDependencyPackageManifest,
  isRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  type RootPackageJson
} from './runtime-dependency-spec.ts';

export interface RuntimeDepsStamp {
  manifestHash: string;
  packageManager: 'bun';
  installedAt: string;
}

export interface SharedDepsReadyState {
  packageManager: 'bun';
  root: string;
  nodeModulesPath: string;
  manifestHash: string;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  root: string;
  source: 'existing' | 'installed';
}

export interface DependencyAuthorityPaths {
  readonly browserCache: string;
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
  readonly sharedDepsRoot: string;
}

interface CompilerDependencyPackageBinding {
  entry?: {
    path: string;
    sha256: string;
  };
  manifestSha256: string;
  name: string;
  version: string;
}

interface CompilerDepsBinding {
  architecture: string;
  bunVersion: string;
  declaredBunVersion: string;
  formatVersion: 'compiler-deps-binding-v2';
  manifestHash: string;
  packages: readonly CompilerDependencyPackageBinding[];
  platform: NodeJS.Platform;
}

export interface RuntimeDependencyInstallOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  lockTimeoutMs?: number;
  now?: () => string;
  pollIntervalMs?: number;
  preferSharedCopy?: boolean;
  rematerialize?: boolean;
  runtimeArchitecture?: string;
  runtimePlatform?: NodeJS.Platform;
  runtimeVersion?: string;
  sharedDepsRoot?: string;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  testCompilerPublishHook?: (stage: 'active-backed-up') => void | Promise<void>;
}

export interface ExternalNodeRuntimeResolutionOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  environment?: NodeJS.ProcessEnv;
  nodeExecutablePath?: string;
  signal?: AbortSignal;
}

export interface ExternalNodeRuntimeAuthority {
  readonly executablePath: string;
  readonly version: string;
}

export interface PlaywrightBrowserCacheInstallOptions extends RuntimeDependencyInstallOptions {
  environment?: NodeJS.ProcessEnv;
  nodeExecutablePath?: string;
  playwrightProjectRoot?: string;
}

export type PlaywrightBrowserCacheMaterializationResult = Readonly<
  | {
    browserCachePath: string;
    browserExecutablePath: null;
    commandResult: CommandResult;
    source: null;
    status: 'failed';
  }
  | {
    browserCachePath: string;
    browserExecutablePath: string;
    commandResult: CommandResult;
    source: 'existing' | 'installed';
    status: 'ready';
  }
>;

export type PlaywrightBrowserCacheReadyState = Readonly<{
  browserCachePath: string;
  browserExecutablePath: string;
}>;

export const EXTERNAL_NODE_MINIMUM_MAJOR_VERSION = 22;
const EXTERNAL_NODE_RUNTIME_PROBE = [
  "process.stdout.write(JSON.stringify({",
  "  bunVersion: process.versions.bun ?? null,",
  "  executablePath: process.execPath,",
  "  format: 'sec-external-node-runtime-v1',",
  "  releaseName: process.release?.name ?? null,",
  "  version: process.versions.node ?? null",
  '}));'
].join('\n');
const PLAYWRIGHT_BROWSER_EXECUTABLE_PROBE = [
  "const path = require('node:path');",
  "const { createRequire } = require('node:module');",
  'const projectRoot = process.argv[1];',
  "const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));",
  "const { registry } = requireFromProject('playwright-core/lib/server');",
  "process.stdout.write(registry.findExecutable('chromium-headless-shell').executablePath());"
].join('\n');

export function dependencyAuthorityPaths(
  dependencyRoot = compilerRoot
): Readonly<DependencyAuthorityPaths> {
  const root = path.resolve(dependencyRoot);
  const sharedDepsRoot = path.join(root, '.shared-deps');
  return Object.freeze({
    browserCache: path.join(sharedDepsRoot, '.playwright-browsers'),
    compilerModulesRoot: path.join(root, 'node_modules'),
    dependencyModules: path.join(sharedDepsRoot, 'node_modules'),
    sharedDepsRoot
  });
}

function defaultSharedDepsRoot(): string {
  return dependencyAuthorityPaths().sharedDepsRoot;
}

function sortedRecord(record: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

interface CompilerDependencyIdentity {
  architecture: string;
  bunVersion: string;
  declaredBunVersion: string;
  manifestHash: string;
  packageNames: string[];
  packageVersions: Record<string, string>;
  platform: NodeJS.Platform;
}

async function compilerDependencyIdentity(
  root: string,
  options: RuntimeDependencyInstallOptions
): Promise<CompilerDependencyIdentity> {
  const packageJson = await readJson<RootPackageJson & { packageManager?: string }>(path.join(root, 'package.json'));
  const lockfile = await readText(path.join(root, 'bun.lock'));
  const dependencies = sortedRecord(packageJson.dependencies);
  const devDependencies = sortedRecord(packageJson.devDependencies);
  const canonicalBunVersion = await loadCanonicalBunRuntimeVersion(root);
  const packageManagerMatch = /^bun@([^\s]+)$/u.exec(packageJson.packageManager ?? '');
  if (!packageManagerMatch) {
    throw new CompilerError('IMPORT-AUTHORITY-001', 'Root packageManager must pin one Bun version exactly');
  }
  const runtime = {
    architecture: options.runtimeArchitecture ?? process.arch,
    bunVersion: options.runtimeVersion ?? process.versions.bun ?? 'unknown',
    declaredBunVersion: packageManagerMatch[1]!,
    platform: options.runtimePlatform ?? process.platform
  };
  if (runtime.bunVersion === 'unknown') {
    throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency bootstrap must run under Bun');
  }
  if (runtime.declaredBunVersion !== canonicalBunVersion || runtime.bunVersion !== canonicalBunVersion) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-001',
      `Bun runtime identity mismatch: canonical=${canonicalBunVersion}, packageManager=${runtime.declaredBunVersion}, actual=${runtime.bunVersion}`
    );
  }
  const packageVersions = { ...dependencies, ...devDependencies };
  return {
    ...runtime,
    manifestHash: crypto.createHash('sha256').update(JSON.stringify({
      dependencies,
      devDependencies,
      lockfile,
      runtime
    })).digest('hex'),
    packageNames: Object.keys(packageVersions).sort((left, right) => left.localeCompare(right)),
    packageVersions
  };
}

function dependencyPackagePath(nodeModulesPath: string, packageName: string): string {
  return path.join(nodeModulesPath, ...packageName.split('/'), 'package.json');
}

const criticalCompilerDependencyEntries = new Set([
  '@ts-morph/common',
  'code-block-writer',
  'ts-morph',
  'typescript'
]);

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isExactPackageVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}

async function compilerDependencyPackageBinding(
  nodeModulesPath: string,
  packageName: string,
  requestedVersion: string
): Promise<CompilerDependencyPackageBinding> {
  const packageRoot = path.dirname(dependencyPackagePath(nodeModulesPath, packageName));
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJsonBytes = await fs.readFile(packageJsonPath);
  const manifest = JSON.parse(packageJsonBytes.toString('utf8')) as {
    main?: unknown;
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== packageName || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new CompilerError('IMPORT-AUTHORITY-002', `Compiler dependency manifest is invalid: ${packageName}`);
  }
  if (isExactPackageVersion(requestedVersion) && manifest.version !== requestedVersion) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency version mismatch: ${packageName}@${manifest.version} != ${requestedVersion}`
    );
  }

  let entry: CompilerDependencyPackageBinding['entry'];
  if (criticalCompilerDependencyEntries.has(packageName)) {
    if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
      throw new CompilerError('IMPORT-AUTHORITY-002', `Critical compiler dependency has no main entry: ${packageName}`);
    }
    const entryPath = manifest.main.replace(/^\.\//u, '').replace(/\\/gu, '/');
    const absoluteEntry = path.resolve(packageRoot, ...entryPath.split('/'));
    const relativeEntry = path.relative(packageRoot, absoluteEntry);
    if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
      throw new CompilerError('IMPORT-AUTHORITY-002', `Critical compiler dependency entry escapes its package: ${packageName}`);
    }
    entry = {
      path: entryPath,
      sha256: sha256(await fs.readFile(absoluteEntry))
    };
  }

  return {
    ...(entry ? { entry } : {}),
    manifestSha256: sha256(packageJsonBytes),
    name: packageName,
    version: manifest.version
  };
}

async function compilerDependencyPackageBindings(
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity
): Promise<readonly CompilerDependencyPackageBinding[]> {
  const packageNames = [...identity.packageNames];
  if (identity.packageVersions['ts-morph']) {
    packageNames.push('@ts-morph/common', 'code-block-writer');
  }
  return Promise.all([...new Set(packageNames)].sort().map((packageName) => compilerDependencyPackageBinding(
    nodeModulesPath,
    packageName,
    identity.packageVersions[packageName] ?? '*'
  )));
}

async function compilerDependencyTreeReady(
  nodeModulesPath: string,
  bindingPath: string,
  identity: CompilerDependencyIdentity
): Promise<boolean> {
  const binding = await readJson<CompilerDepsBinding>(bindingPath).catch(() => null);
  if (
    binding?.formatVersion !== 'compiler-deps-binding-v2' ||
    binding.manifestHash !== identity.manifestHash ||
    binding.bunVersion !== identity.bunVersion ||
    binding.declaredBunVersion !== identity.declaredBunVersion ||
    binding.platform !== identity.platform ||
    binding.architecture !== identity.architecture
  ) return false;
  const packages = await compilerDependencyPackageBindings(nodeModulesPath, identity).catch(() => null);
  return packages !== null && JSON.stringify(packages) === JSON.stringify(binding.packages);
}

function buildEnv(
  additionalEnv: NodeJS.ProcessEnv = {},
  isolatedWritableRoot?: string
): NodeJS.ProcessEnv {
  const envPathKey = pathEnvKey();
  const overrides = {
    ...(isolatedWritableRoot ? {} : {
      [envPathKey]: `${path.join(dependencyAuthorityPaths().compilerModulesRoot, '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
    }),
    ...additionalEnv
  };
  return isolatedWritableRoot
    ? buildIsolatedProcessEnvironment(isolatedWritableRoot, overrides)
    : overrides;
}

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function hasCompleteRuntimeDeps(nodeModulesPath: string): Promise<boolean> {
  const manifests = await Promise.all(RUNTIME_DEPENDENCY_PACKAGE_NAMES.map(async (packageName) => {
    try {
      return isRuntimeDependencyPackageManifest(
        await readJson<unknown>(dependencyPackagePath(nodeModulesPath, packageName)),
        packageName
      );
    } catch {
      return false;
    }
  }));
  return manifests.every(Boolean);
}

async function writeManifestIfChanged(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  const nextText = formatJsonFile(value);
  if ((await pathExists(filePath)) && (await readText(filePath)) === nextText) {
    return;
  }
  await writeText(filePath, nextText, commitFence);
}

export async function readRuntimeDepsStamp(stampPath: string): Promise<RuntimeDepsStamp | null> {
  if (!(await pathExists(stampPath))) {
    return null;
  }

  try {
    return await readJson<RuntimeDepsStamp>(stampPath);
  } catch {
    return null;
  }
}

export async function writeRuntimeDepsStamp(
  stampPath: string,
  stamp: RuntimeDepsStamp,
  commitFence?: CommitFence
): Promise<void> {
  await writeJson(stampPath, stamp, commitFence);
}

async function isCacheReady(nodeModulesPath: string, stampPath: string, manifestHash: string): Promise<boolean> {
  const [stamp, installed] = await Promise.all([
    readRuntimeDepsStamp(stampPath),
    hasCompleteRuntimeDeps(nodeModulesPath)
  ]);
  return installed && stamp?.manifestHash === manifestHash;
}

function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
}

interface InstallLockOwner {
  createdAt: string;
  pid: number;
  token: string;
}

function isInstallLockOwner(value: unknown): value is InstallLockOwner {
  const owner = value as Partial<InstallLockOwner> | null;
  return owner !== null && typeof owner === 'object' &&
    typeof owner.createdAt === 'string' && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function reclaimOrphanInstallLock(lockPath: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimHandle: FileHandle | null = null;
  try {
    try {
      reclaimHandle = await fs.open(reclaimPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }

    const metadata = await fs.stat(lockPath).catch(() => null);
    if (metadata === null) return true;
    const owner = await readJson<unknown>(lockPath).catch(() => null);
    if (isInstallLockOwner(owner) && processIsAlive(owner.pid)) return false;
    if (!isInstallLockOwner(owner) && Date.now() - metadata.mtimeMs < 5000) return false;

    const orphanPath = `${lockPath}.orphan-${crypto.randomUUID()}`;
    try {
      await fs.rename(lockPath, orphanPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
    await fs.rm(orphanPath, { force: true });
    return true;
  } finally {
    await reclaimHandle?.close().catch(() => undefined);
    if (reclaimHandle !== null) await fs.rm(reclaimPath, { force: true }).catch(() => undefined);
  }
}

async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: () => Promise<T>
): Promise<T> {
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const lockTimeoutMs = options.lockTimeoutMs ?? 300000;
  const sleep = options.sleep ?? sleepMs;
  const startTime = Date.now();
  let owner: InstallLockOwner | null = null;

  await ensureDir(path.dirname(lockPath), options.beforeCommit);

  while (true) {
    let handle: FileHandle | null = null;

    try {
      if (await pathExists(`${lockPath}.reclaim`)) {
        await sleep(pollIntervalMs);
        continue;
      }
      await options.beforeCommit?.();
      handle = await fs.open(lockPath, 'wx');
      owner = {
        createdAt: (options.now ?? (() => new Date().toISOString()))(),
        pid: process.pid,
        token: crypto.randomUUID()
      };
      await options.beforeCommit?.();
      await handle.writeFile(formatJsonFile(owner), 'utf8');
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') {
        throw error;
      }

      if (await reclaimOrphanInstallLock(lockPath)) continue;

      if (Date.now() - startTime > lockTimeoutMs) {
        throw new CompilerError('RUNTIME-DEPS-003', `Timed out waiting for install lock ${lockPath}`);
      }

      await sleep(pollIntervalMs);
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  try {
    return await callback();
  } finally {
    await options.beforeCommit?.();
    const currentOwner = await readJson<unknown>(lockPath).catch(() => null);
    if (owner !== null && isInstallLockOwner(currentOwner) && currentOwner.token === owner.token) {
      await fs.rm(lockPath, { force: true });
    }
  }
}

async function runBunInstall(
  workingDirectory: string,
  options: RuntimeDependencyInstallOptions,
  bunArgs: string[],
  cacheDir?: string
): Promise<{ packageManager: 'bun'; result: CommandResult }> {
  const commandRunner = options.commandRunner ?? runCommand;
  const isolated = options.installMode === 'offline-copy-only';
  const isolatedWritableRoot = path.join(workingDirectory, '.isolated-process', 'dependency-install');
  if (isolated) await ensureIsolatedProcessDirectories(isolatedWritableRoot, options.beforeCommit);
  const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml');
  if (isolated) await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
  await options.beforeCommit?.();
  const commandArgs = isolated
    ? ['--no-env-file', `--config=${isolatedConfigPath}`, ...bunArgs]
    : bunArgs;
  const bunResult = await commandRunner(isolated ? process.execPath : 'bun', commandArgs, {
    beforeSpawn: options.beforeCommit,
    cwd: workingDirectory,
    env: buildEnv(cacheDir ? {
      BUN_INSTALL_CACHE_DIR: cacheDir,
      ...(isolated ? {
        [ISOLATED_VERIFICATION_ENV_KEY]: '1',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
      } : {})
    } : {}, isolated ? isolatedWritableRoot : undefined),
    signal: options.signal,
    ...(isolated ? { envMode: 'replace' as const } : {})
  });
  await options.beforeCommit?.();

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new CompilerError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult
  });
}

function playwrightBrowserInstallFailure(
  message: string,
  details: Record<string, unknown> = {}
): CompilerError {
  return new CompilerError('RUNTIME-DEPS-005', message, details);
}

async function assertPlaywrightCli(playwrightProjectRoot: string): Promise<string> {
  const playwrightCli = path.join(playwrightProjectRoot, 'node_modules', 'playwright', 'cli.js');
  const metadata = await fs.lstat(playwrightCli).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw playwrightBrowserInstallFailure('Canonical Playwright installer entry is unavailable', {
      playwrightCli
    });
  }
  return playwrightCli;
}

async function physicalExecutablePath(candidatePath: string): Promise<string | null> {
  const physicalPath = await fs.realpath(candidatePath).catch(() => null);
  if (physicalPath === null) return null;
  const metadata = await fs.lstat(physicalPath).catch(() => null);
  return metadata?.isFile() === true ? physicalPath : null;
}

function sameExecutablePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

function externalNodeEnvironment(environment: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined
  };
}

function pathEnvironmentValue(environment: NodeJS.ProcessEnv): string {
  return Object.entries(environment)
    .find(([key]) => key.toLocaleLowerCase('en-US') === 'path')?.[1] ?? '';
}

type ExternalNodeRuntimeProbe = Readonly<{
  bunVersion: string | null;
  executablePath: string;
  format: 'sec-external-node-runtime-v1';
  releaseName: string;
  version: string;
}>;

function parseExternalNodeRuntimeProbe(stdout: string): ExternalNodeRuntimeProbe | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const probe = value as Record<string, unknown>;
  if (probe.format !== 'sec-external-node-runtime-v1' ||
    probe.bunVersion !== null ||
    typeof probe.executablePath !== 'string' ||
    !path.isAbsolute(probe.executablePath) ||
    probe.releaseName !== 'node' ||
    typeof probe.version !== 'string') {
    return null;
  }
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(probe.version);
  if (!versionMatch ||
    Number.parseInt(versionMatch[1]!, 10) < EXTERNAL_NODE_MINIMUM_MAJOR_VERSION) return null;
  return Object.freeze({
    bunVersion: null,
    executablePath: probe.executablePath,
    format: 'sec-external-node-runtime-v1',
    releaseName: 'node',
    version: probe.version
  });
}

async function validateExternalNodeRuntime(
  executablePath: string,
  options: ExternalNodeRuntimeResolutionOptions,
  workingDirectory: string
): Promise<Readonly<ExternalNodeRuntimeAuthority>> {
  const commandRunner = options.commandRunner ?? runCommand;
  let commandResult: CommandResult;
  try {
    commandResult = await commandRunner(executablePath, ['-e', EXTERNAL_NODE_RUNTIME_PROBE], {
      beforeSpawn: options.beforeCommit,
      cwd: workingDirectory,
      env: externalNodeEnvironment(options.environment),
      signal: options.signal
    });
  } catch (error) {
    throw playwrightBrowserInstallFailure('Configured Node.js runtime cannot be executed', {
      cause: error instanceof Error ? error.message : String(error),
      nodeExecutablePath: executablePath
    });
  }
  const probe = commandResult.code === 0
    ? parseExternalNodeRuntimeProbe(commandResult.stdout)
    : null;
  const reportedPhysicalPath = probe
    ? await physicalExecutablePath(probe.executablePath)
    : null;
  if (!probe || reportedPhysicalPath === null || !sameExecutablePath(executablePath, reportedPhysicalPath)) {
    throw playwrightBrowserInstallFailure(
      `Configured runtime is not the required external Node.js ${EXTERNAL_NODE_MINIMUM_MAJOR_VERSION}+ authority`,
      {
        commandResult,
        nodeExecutablePath: executablePath,
        reportedExecutablePath: probe?.executablePath ?? null,
        reportedVersion: probe?.version ?? null
      }
    );
  }
  return Object.freeze({ executablePath, version: probe.version });
}

export async function resolveExternalNodeRuntimeAuthority(
  options: ExternalNodeRuntimeResolutionOptions = {},
  workingDirectory = compilerRoot
): Promise<Readonly<ExternalNodeRuntimeAuthority>> {
  options.signal?.throwIfAborted();
  const environment = options.environment ?? process.env;
  const candidates: string[] = [];
  if (options.nodeExecutablePath) {
    candidates.push(path.resolve(options.nodeExecutablePath));
  } else {
    if (/^node(?:\.exe)?$/iu.test(path.basename(process.execPath))) {
      candidates.push(process.execPath);
    }
    const executableNames = process.platform === 'win32' ? ['node.exe', 'node'] : ['node'];
    const pathEntries = pathEnvironmentValue(environment)
      .split(path.delimiter)
      .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
      .filter((entry) => entry.length > 0);
    for (const pathEntry of pathEntries) {
      for (const executableName of executableNames) {
        candidates.push(path.join(pathEntry, executableName));
      }
    }
  }

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const physicalPath = await physicalExecutablePath(candidate);
    if (physicalPath === null) continue;
    const identity = process.platform === 'win32'
      ? physicalPath.toLocaleLowerCase('en-US')
      : physicalPath;
    if (visited.has(identity)) continue;
    visited.add(identity);
    return validateExternalNodeRuntime(physicalPath, options, path.resolve(workingDirectory));
  }
  throw playwrightBrowserInstallFailure(
    `Canonical external Node.js ${EXTERNAL_NODE_MINIMUM_MAJOR_VERSION}+ runtime is unavailable for Playwright installation`,
    { nodeExecutablePath: options.nodeExecutablePath ? path.resolve(options.nodeExecutablePath) : null }
  );
}

type PlaywrightBrowserCacheProbe = Readonly<{
  browserExecutablePath: string;
  commandResult: CommandResult;
}>;

function playwrightBrowserEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  browserCachePath: string
): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined,
    PLAYWRIGHT_BROWSERS_PATH: browserCachePath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: undefined
  };
}

async function probePlaywrightBrowserCache(
  commandRunner: typeof runCommand,
  nodeExecutablePath: string,
  playwrightProjectRoot: string,
  browserCachePath: string,
  options: PlaywrightBrowserCacheInstallOptions
): Promise<PlaywrightBrowserCacheProbe> {
  options.signal?.throwIfAborted();
  let commandResult: CommandResult;
  try {
    commandResult = await commandRunner(
      nodeExecutablePath,
      ['-e', PLAYWRIGHT_BROWSER_EXECUTABLE_PROBE, playwrightProjectRoot],
      {
        beforeSpawn: options.beforeCommit,
        cwd: playwrightProjectRoot,
        env: playwrightBrowserEnvironment(options.environment, browserCachePath),
        signal: options.signal
      }
    );
  } catch (error) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry probe could not execute', {
      browserCachePath,
      cause: error instanceof Error ? error.message : String(error),
      nodeExecutablePath
    });
  }
  if (commandResult.code !== 0) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry probe failed', {
      browserCachePath,
      commandResult,
      nodeExecutablePath
    });
  }

  const executableLines = commandResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (executableLines.length !== 1 || !path.isAbsolute(executableLines[0]!)) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry returned an invalid executable path', {
      browserCachePath,
      commandResult,
      nodeExecutablePath
    });
  }

  const browserExecutablePath = path.resolve(executableLines[0]!);
  if (!isPathInside(browserCachePath, browserExecutablePath) ||
    path.resolve(browserCachePath) === browserExecutablePath) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry escaped the canonical browser cache', {
      browserCachePath,
      browserExecutablePath,
      commandResult,
      nodeExecutablePath
    });
  }
  return Object.freeze({ browserExecutablePath, commandResult });
}

async function optionalMetadata(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw playwrightBrowserInstallFailure('Playwright browser cache metadata cannot be inspected', {
      cause: error instanceof Error ? error.message : String(error),
      targetPath
    });
  }
}

async function inspectPlaywrightBrowserCache(
  dependencyRoot: string,
  browserCachePath: string,
  browserExecutablePath: string
): Promise<'missing' | 'ready'> {
  const resolvedRoot = path.resolve(dependencyRoot);
  const resolvedCachePath = path.resolve(browserCachePath);
  const resolvedExecutablePath = path.resolve(browserExecutablePath);
  if (!isPathInside(resolvedRoot, resolvedCachePath) ||
    sameExecutablePath(resolvedRoot, resolvedCachePath) ||
    !isPathInside(resolvedCachePath, resolvedExecutablePath) ||
    sameExecutablePath(resolvedCachePath, resolvedExecutablePath)) {
    throw playwrightBrowserInstallFailure('Canonical Playwright browser path escaped its lexical dependency authority', {
      browserCachePath: resolvedCachePath,
      browserExecutablePath: resolvedExecutablePath,
      dependencyRoot: resolvedRoot
    });
  }

  const rootMetadata = await optionalMetadata(resolvedRoot);
  const physicalRoot = await fs.realpath(resolvedRoot).catch(() => null);
  if (rootMetadata === null || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || physicalRoot === null) {
    throw playwrightBrowserInstallFailure('Playwright dependency root is not a physical directory', {
      dependencyRoot: resolvedRoot,
      physicalRoot
    });
  }

  let currentPath = resolvedRoot;
  let expectedPhysicalPath = physicalRoot;
  const relativeExecutablePath = path.relative(resolvedRoot, resolvedExecutablePath);
  for (const segment of relativeExecutablePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    expectedPhysicalPath = path.join(expectedPhysicalPath, segment);
    const metadata = await optionalMetadata(currentPath);
    if (metadata === null) return 'missing';

    const isExecutable = sameExecutablePath(currentPath, resolvedExecutablePath);
    if (metadata.isSymbolicLink() ||
      (isExecutable ? !metadata.isFile() : !metadata.isDirectory())) {
      throw playwrightBrowserInstallFailure(
        isExecutable
          ? 'Canonical Playwright browser executable is not a physical file'
          : 'Canonical Playwright browser path contains a non-physical directory',
        {
          browserCachePath: resolvedCachePath,
          browserExecutablePath: resolvedExecutablePath,
          targetPath: currentPath
        }
      );
    }

    const physicalPath = await fs.realpath(currentPath).catch(() => null);
    if (physicalPath === null ||
      !sameExecutablePath(physicalPath, expectedPhysicalPath) ||
      !isPathInside(physicalRoot, physicalPath)) {
      throw playwrightBrowserInstallFailure('Canonical Playwright browser path escaped physical dependency containment', {
        browserCachePath: resolvedCachePath,
        browserExecutablePath: resolvedExecutablePath,
        dependencyRoot: resolvedRoot,
        expectedPhysicalPath,
        physicalPath,
        targetPath: currentPath
      });
    }
  }
  return 'ready';
}

async function waitWithAbort(
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await sleep(delayMs);
    return;
  }
  signal.throwIfAborted();
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal.reason ?? new Error('Playwright browser cache bootstrap was aborted'));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    await Promise.race([sleep(delayMs), aborted]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export async function materializePlaywrightBrowserCache(
  options: PlaywrightBrowserCacheInstallOptions = {},
  dependencyRoot = compilerRoot
): Promise<PlaywrightBrowserCacheMaterializationResult> {
  const root = path.resolve(dependencyRoot);
  const authority = dependencyAuthorityPaths(root);
  const playwrightProjectRoot = path.resolve(options.playwrightProjectRoot ?? root);
  options.signal?.throwIfAborted();
  const commandRunner = options.commandRunner ?? runCommand;
  const nodeRuntime = await resolveExternalNodeRuntimeAuthority({
    beforeCommit: options.beforeCommit,
    commandRunner,
    environment: options.environment,
    nodeExecutablePath: options.nodeExecutablePath,
    signal: options.signal
  }, playwrightProjectRoot);
  const playwrightCli = await assertPlaywrightCli(playwrightProjectRoot);
  const initialRegistryProbe = await probePlaywrightBrowserCache(
    commandRunner,
    nodeRuntime.executablePath,
    playwrightProjectRoot,
    authority.browserCache,
    options
  );
  const lockPath = path.join(authority.sharedDepsRoot, 'playwright-browser-install.lock');
  const sleep = options.sleep ?? sleepMs;
  await inspectPlaywrightBrowserCache(
    root,
    authority.browserCache,
    initialRegistryProbe.browserExecutablePath
  );

  return withInstallLock(lockPath, {
    ...options,
    sleep: (delayMs) => waitWithAbort(delayMs, sleep, options.signal)
  }, async () => {
    options.signal?.throwIfAborted();
    if (await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      initialRegistryProbe.browserExecutablePath
    ) === 'ready') {
      return Object.freeze({
        browserCachePath: authority.browserCache,
        browserExecutablePath: initialRegistryProbe.browserExecutablePath,
        commandResult: { code: 0, stdout: '', stderr: '' },
        source: 'existing' as const,
        status: 'ready' as const
      });
    }

    await options.beforeCommit?.();
    options.signal?.throwIfAborted();
    if (await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      initialRegistryProbe.browserExecutablePath
    ) === 'ready') {
      return Object.freeze({
        browserCachePath: authority.browserCache,
        browserExecutablePath: initialRegistryProbe.browserExecutablePath,
        commandResult: { code: 0, stdout: '', stderr: '' },
        source: 'existing' as const,
        status: 'ready' as const
      });
    }
    let commandResult: CommandResult;
    try {
      commandResult = await commandRunner(nodeRuntime.executablePath, [playwrightCli, 'install', 'chromium'], {
        beforeSpawn: async () => {
          await options.beforeCommit?.();
          options.signal?.throwIfAborted();
          if (await inspectPlaywrightBrowserCache(
            root,
            authority.browserCache,
            initialRegistryProbe.browserExecutablePath
          ) === 'ready') {
            throw playwrightBrowserInstallFailure(
              'Playwright browser cache identity changed before installer execution',
              {
                browserCachePath: authority.browserCache,
                browserExecutablePath: initialRegistryProbe.browserExecutablePath
              }
            );
          }
        },
        cwd: playwrightProjectRoot,
        env: playwrightBrowserEnvironment(options.environment, authority.browserCache),
        signal: options.signal
      });
    } catch (error) {
      throw playwrightBrowserInstallFailure('Canonical Playwright installer could not execute', {
        browserCachePath: authority.browserCache,
        cause: error instanceof Error ? error.message : String(error),
        nodeExecutablePath: nodeRuntime.executablePath,
        playwrightCli
      });
    }
    await options.beforeCommit?.();
    options.signal?.throwIfAborted();

    if (commandResult.code !== 0) {
      return Object.freeze({
        browserCachePath: authority.browserCache,
        browserExecutablePath: null,
        commandResult,
        source: null,
        status: 'failed' as const
      });
    }

    const finalProbe = await probePlaywrightBrowserCache(
      commandRunner,
      nodeRuntime.executablePath,
      playwrightProjectRoot,
      authority.browserCache,
      options
    );
    if (!sameExecutablePath(
      initialRegistryProbe.browserExecutablePath,
      finalProbe.browserExecutablePath
    ) || await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      finalProbe.browserExecutablePath
    ) !== 'ready') {
      throw playwrightBrowserInstallFailure(
        'Playwright browser cache materialization has no current executable postcondition',
        {
          browserCachePath: authority.browserCache,
          commandResult,
          initialBrowserExecutablePath: initialRegistryProbe.browserExecutablePath,
          readinessProbe: finalProbe.commandResult
        }
      );
    }
    return Object.freeze({
      browserCachePath: authority.browserCache,
      browserExecutablePath: finalProbe.browserExecutablePath,
      commandResult,
      source: 'installed' as const,
      status: 'ready' as const
    });
  });
}

export async function ensurePlaywrightBrowserCacheReady(
  options: PlaywrightBrowserCacheInstallOptions = {},
  dependencyRoot = compilerRoot
): Promise<PlaywrightBrowserCacheReadyState> {
  const result = await materializePlaywrightBrowserCache(options, dependencyRoot);
  if (result.status !== 'ready' || result.browserExecutablePath === null) {
    throw playwrightBrowserInstallFailure('Failed to materialize the canonical Playwright browser cache', {
      browserCachePath: result.browserCachePath,
      commandResult: result.commandResult
    });
  }
  return Object.freeze({
    browserCachePath: result.browserCachePath,
    browserExecutablePath: result.browserExecutablePath
  });
}

async function copyPhysicalDependencyTree(
  source: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  const metadata = await fs.lstat(source);
  if (metadata.isSymbolicLink()) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Preinstalled dependency tree contains a reparse entry');
  }
  if (metadata.isDirectory()) {
    await commitFence?.();
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source);
    for (const name of entries.sort((left, right) => left.localeCompare(right))) {
      await copyPhysicalDependencyTree(path.join(source, name), path.join(target, name), commitFence);
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Preinstalled dependency tree contains a special entry');
  }
  await commitFence?.();
  await fs.copyFile(source, target);
}

async function materializeIsolatedNodeModules(
  sharedDepsRoot: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  const source = path.join(sharedDepsRoot, 'node_modules');
  if (!(await hasCompleteRuntimeDeps(source))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Preinstalled dependency tree is unavailable for isolated verification');
  }
  await commitFence?.();
  await fs.rm(target, { recursive: true, force: true });
  await copyPhysicalDependencyTree(source, target, commitFence);
}

async function resolveProjectDependencyBridgeTarget(): Promise<string> {
  const compilerNodeModules = dependencyAuthorityPaths().compilerModulesRoot;
  if (await hasCompleteRuntimeDeps(compilerNodeModules)) {
    return compilerNodeModules;
  }

  const sharedNodeModules = path.join(defaultSharedDepsRoot(), 'node_modules');
  if (await hasCompleteRuntimeDeps(sharedNodeModules)) {
    return sharedNodeModules;
  }

  return compilerNodeModules;
}

export async function withProjectDependencyBridge<T>(projectRoot: string, callback: () => Promise<T>): Promise<T> {
  const bridgePath = path.join(projectRoot, 'node_modules');
  let createdBridge = false;

  if (!(await pathExists(bridgePath))) {
    await fs.symlink(await resolveProjectDependencyBridgeTarget(), bridgePath, 'junction');
    createdBridge = true;
  }

  try {
    return await callback();
  } finally {
    if (createdBridge) {
      await fs.rm(bridgePath, { recursive: true, force: true });
    }
  }
}

async function stageCompilerDependencyGeneration(
  root: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<{ binding: CompilerDepsBinding; stagingRoot: string }> {
  const stagingRoot = path.join(
    root,
    '.tmp',
    'dependency-installs',
    `compiler-${identity.manifestHash}.staging-${crypto.randomUUID()}`
  );
  await options.beforeCommit?.();
  await fs.mkdir(stagingRoot, { recursive: true });
  try {
    const rootPackage = await readJson<Record<string, unknown>>(path.join(root, 'package.json'));
    await writeJson(path.join(stagingRoot, 'package.json'), rootPackage, options.beforeCommit);
    await options.beforeCommit?.();
    await fs.copyFile(path.join(root, 'bun.lock'), path.join(stagingRoot, 'bun.lock'));
    const rootBunfig = path.join(root, 'bunfig.toml');
    if (await pathExists(rootBunfig)) {
      await options.beforeCommit?.();
      await fs.copyFile(rootBunfig, path.join(stagingRoot, 'bunfig.toml'));
    }

    const cacheDir = path.join(root, '.shared-deps', '.bun-cache');
    await runBunInstall(stagingRoot, options, ['install', '--frozen-lockfile', '--ignore-scripts'], cacheDir);
    const nodeModulesPath = path.join(stagingRoot, 'node_modules');
    const packages = await compilerDependencyPackageBindings(nodeModulesPath, identity);
    const binding = {
      architecture: identity.architecture,
      bunVersion: identity.bunVersion,
      declaredBunVersion: identity.declaredBunVersion,
      formatVersion: 'compiler-deps-binding-v2',
      manifestHash: identity.manifestHash,
      packages,
      platform: identity.platform
    } satisfies CompilerDepsBinding;
    await writeJson(
      path.join(nodeModulesPath, '.sec-compiler-deps-binding-v2.json'),
      binding,
      options.beforeCommit
    );
    return { binding, stagingRoot };
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof CompilerError && error.code.startsWith('IMPORT-AUTHORITY-')) throw error;
    const causeMessage = error instanceof CompilerError
      ? JSON.stringify(error.details).slice(-2000)
      : error instanceof Error ? error.message : String(error);
    throw new CompilerError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency generation could not be materialized: ${causeMessage}`,
      {
      cause: error instanceof CompilerError ? {
        code: error.code,
        details: error.details,
        message: error.message
      } : error instanceof Error ? error.message : String(error)
      }
    );
  }
}

async function retainOnlyLatestCompilerDependencyBackup(backupsRoot: string, retainedPath: string): Promise<void> {
  const entries = await fs.readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && path.join(backupsRoot, entry.name) !== retainedPath)
    .map((entry) => fs.rm(path.join(backupsRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)));
}

async function publishCompilerDependencyGeneration(
  root: string,
  activeNodeModulesPath: string,
  stagingRoot: string,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const backupsRoot = path.join(root, '.tmp', 'dependency-installs', 'compiler-backups');
  const backupPath = path.join(backupsRoot, `node_modules-${Date.now()}-${crypto.randomUUID()}`);
  let activeBackedUp = false;
  let published = false;
  await options.beforeCommit?.();
  await fs.mkdir(backupsRoot, { recursive: true });
  try {
    if (await pathExists(activeNodeModulesPath)) {
      await options.beforeCommit?.();
      await fs.rename(activeNodeModulesPath, backupPath);
      activeBackedUp = true;
      await options.testCompilerPublishHook?.('active-backed-up');
    }
    await options.beforeCommit?.();
    await fs.rename(stagingNodeModulesPath, activeNodeModulesPath);
    published = true;
  } catch (error) {
    let rollbackFailure: unknown;
    if (activeBackedUp && !(await pathExists(activeNodeModulesPath))) {
      try {
        await fs.rename(backupPath, activeNodeModulesPath);
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    }
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency generation publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      rollbackFailure: rollbackFailure instanceof Error ? rollbackFailure.message : rollbackFailure
    });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  if (published && activeBackedUp) {
    await retainOnlyLatestCompilerDependencyBackup(backupsRoot, backupPath);
  }
}

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  const root = path.resolve(compilerDependencyRoot);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  const bindingPath = path.join(nodeModulesPath, '.sec-compiler-deps-binding-v2.json');
  const installLockPath = path.join(root, '.tmp', 'dependency-installs', 'compiler.lock');
  const identity = await compilerDependencyIdentity(root, options);
  const ready = () => compilerDependencyTreeReady(
    nodeModulesPath,
    bindingPath,
    identity
  );

  if (await ready()) {
    return {
      manifestHash: identity.manifestHash,
      nodeModulesPath,
      packageManager: 'bun',
      root,
      source: 'existing'
    };
  }

  return withInstallLock(installLockPath, options, async () => {
    if (await ready()) {
      return {
        manifestHash: identity.manifestHash,
        nodeModulesPath,
        packageManager: 'bun' as const,
        root,
        source: 'existing' as const
      };
    }

    const staged = await stageCompilerDependencyGeneration(root, identity, options);
    await publishCompilerDependencyGeneration(root, nodeModulesPath, staged.stagingRoot, options);
    if (!(await compilerDependencyTreeReady(nodeModulesPath, bindingPath, identity))) {
      throw new CompilerError('IMPORT-AUTHORITY-002', 'Published compiler dependency generation failed validation');
    }

    return {
      manifestHash: identity.manifestHash,
      nodeModulesPath,
      packageManager: 'bun',
      root,
      source: 'installed'
    };
  });
}

export async function ensureSharedDepsReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const sharedDepsRoot = options.sharedDepsRoot ?? defaultSharedDepsRoot();
  const sharedPackagePath = path.join(sharedDepsRoot, 'package.json');
  const sharedNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
  const sharedStampPath = path.join(sharedDepsRoot, 'runtime-deps.stamp.json');
  const sharedLockPath = path.join(sharedDepsRoot, 'install.lock');
  const manifest = buildRuntimePackageManifest('shared-runtime-deps', runtimeSpec);

  await ensureDir(sharedDepsRoot, options.beforeCommit);
  await writeManifestIfChanged(sharedPackagePath, manifest, options.beforeCommit);

  if (await isCacheReady(sharedNodeModulesPath, sharedStampPath, runtimeSpec.manifestHash)) {
    const sharedStamp = await readRuntimeDepsStamp(sharedStampPath);
    return {
      packageManager: sharedStamp?.packageManager ?? 'bun',
      root: sharedDepsRoot,
      nodeModulesPath: sharedNodeModulesPath,
      manifestHash: runtimeSpec.manifestHash
    };
  }

  return withInstallLock(sharedLockPath, options, async () => {
    await writeManifestIfChanged(sharedPackagePath, manifest, options.beforeCommit);

    if (await isCacheReady(sharedNodeModulesPath, sharedStampPath, runtimeSpec.manifestHash)) {
      const sharedStamp = await readRuntimeDepsStamp(sharedStampPath);
      return {
        packageManager: sharedStamp?.packageManager ?? 'bun',
        root: sharedDepsRoot,
        nodeModulesPath: sharedNodeModulesPath,
        manifestHash: runtimeSpec.manifestHash
      };
    }

    const sharedCacheDir = path.join(sharedDepsRoot, '.bun-cache');
    const { packageManager } = await runBunInstall(sharedDepsRoot, options, ['install'], sharedCacheDir);
    if (!(await hasCompleteRuntimeDeps(sharedNodeModulesPath))) {
      throw new CompilerError(
        'RUNTIME-DEPS-002',
        'Installed shared runtime dependency generation failed complete package validation'
      );
    }

    await writeRuntimeDepsStamp(sharedStampPath, {
      manifestHash: runtimeSpec.manifestHash,
      packageManager,
      installedAt: (options.now ?? (() => new Date().toISOString()))()
    }, options.beforeCommit);

    return {
      packageManager,
      root: sharedDepsRoot,
      nodeModulesPath: sharedNodeModulesPath,
      manifestHash: runtimeSpec.manifestHash
    };
  });
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (options.installMode === 'prebound-only') {
    await options.beforeCommit?.();
    const [binding, installed] = await Promise.all([
      readJson<unknown>(path.join(nodeModulesPath, RUNTIME_DEPS_PREBOUND_BINDING_FILE))
        .catch(() => null),
      hasCompleteRuntimeDeps(nodeModulesPath)
    ]);
    await options.beforeCommit?.();
    if (!installed || !isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Plan-bound dependency tree is unavailable for isolated verification'
      );
    }
    return;
  }
  const isolated = options.installMode === 'offline-copy-only';
  const sharedDeps =
    isolated || options.skipSharedDepsWarmup === true ? null : await ensureSharedDepsReady(options);
  const sharedDepsRoot = options.sharedDepsRoot ?? sharedDeps?.root ?? defaultSharedDepsRoot();
  const stampPath = projectStampPath(projectRoot);
  await options.beforeCommit?.();
  const cacheReady = !options.rematerialize &&
    await isCacheReady(nodeModulesPath, stampPath, runtimeSpec.manifestHash);
  await options.beforeCommit?.();
  if (cacheReady) {
    return;
  }

  if (await pathExists(nodeModulesPath)) {
    await options.beforeCommit?.();
    await fs.rm(nodeModulesPath, { recursive: true, force: true });
  }

  if (isolated) {
    await materializeIsolatedNodeModules(sharedDepsRoot, nodeModulesPath, options.beforeCommit);
    await writeRuntimeDepsStamp(stampPath, {
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun',
      installedAt: (options.now ?? (() => new Date().toISOString()))()
    }, options.beforeCommit);
    return;
  }

  if (!isolated && options.skipSharedDepsWarmup === true && options.preferSharedCopy !== false) {
    const compilerNodeModules = dependencyAuthorityPaths().compilerModulesRoot;
    if (await hasCompleteRuntimeDeps(compilerNodeModules)) {
      await options.beforeCommit?.();
      await fs.symlink(compilerNodeModules, nodeModulesPath, 'junction');
      await writeRuntimeDepsStamp(stampPath, {
        manifestHash: runtimeSpec.manifestHash,
        packageManager: 'bun',
        installedAt: (options.now ?? (() => new Date().toISOString()))()
      }, options.beforeCommit);
      return;
    }
  }

  if (!isolated && options.preferSharedCopy !== false) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    const sharedNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
    if (sharedStamp && (await hasCompleteRuntimeDeps(sharedNodeModulesPath))) {
      try {
        await options.beforeCommit?.();
        await fs.symlink(sharedNodeModulesPath, nodeModulesPath, 'junction');
        await writeRuntimeDepsStamp(stampPath, {
          manifestHash: runtimeSpec.manifestHash,
          packageManager: sharedStamp.packageManager,
          installedAt: (options.now ?? (() => new Date().toISOString()))()
        }, options.beforeCommit);
        return;
      } catch {
        if (await pathExists(nodeModulesPath)) {
          await options.beforeCommit?.();
          await fs.rm(nodeModulesPath, { recursive: true, force: true });
        }
      }
    }
  }

  const { packageManager } = await runBunInstall(
    projectRoot,
    options,
    ['install', '--no-save', '--frozen-lockfile=false'],
    path.join(sharedDepsRoot, '.bun-cache')
  );

  await writeRuntimeDepsStamp(stampPath, {
    manifestHash: runtimeSpec.manifestHash,
    packageManager,
    installedAt: (options.now ?? (() => new Date().toISOString()))()
  }, options.beforeCommit);
}
