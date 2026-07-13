import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
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
import { compilerRoot } from './paths.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  pathEnvKey,
  runCommand,
  type CommandResult
} from './process.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';

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

export interface RuntimeDependencyInstallOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  installMode?: 'allow' | 'offline-copy-only';
  lockTimeoutMs?: number;
  now?: () => string;
  pollIntervalMs?: number;
  preferSharedCopy?: boolean;
  rematerialize?: boolean;
  sharedDepsRoot?: string;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSharedDepsRoot(): string {
  return path.join(compilerRoot, '.shared-deps');
}

function buildEnv(
  additionalEnv: NodeJS.ProcessEnv = {},
  isolatedWritableRoot?: string
): NodeJS.ProcessEnv {
  const envPathKey = pathEnvKey();
  const overrides = {
    ...(isolatedWritableRoot ? {} : {
      [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
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

async function hasInstalledRuntimeDeps(nodeModulesPath: string): Promise<boolean> {
  const nextPackagePath = path.join(nodeModulesPath, 'next', 'package.json');
  if (!(await pathExists(nextPackagePath))) {
    return false;
  }

  try {
    const manifest = await readJson<{ name?: string; version?: string }>(nextPackagePath);
    return manifest.name === 'next' && typeof manifest.version === 'string';
  } catch {
    return false;
  }
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
    hasInstalledRuntimeDeps(nodeModulesPath)
  ]);
  return installed && stamp?.manifestHash === manifestHash;
}

function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
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

  await ensureDir(path.dirname(lockPath), options.beforeCommit);

  while (true) {
    let handle: FileHandle | null = null;

    try {
      await options.beforeCommit?.();
      handle = await fs.open(lockPath, 'wx');
      const createdAt = (options.now ?? (() => new Date().toISOString()))();
      await options.beforeCommit?.();
      await handle.writeFile(formatJsonFile({ pid: process.pid, createdAt }), 'utf8');
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') {
        throw error;
      }

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
    await fs.rm(lockPath, { force: true });
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
  if (!(await hasInstalledRuntimeDeps(source))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Preinstalled dependency tree is unavailable for isolated verification');
  }
  await commitFence?.();
  await fs.rm(target, { recursive: true, force: true });
  await copyPhysicalDependencyTree(source, target, commitFence);
}

async function resolveProjectDependencyBridgeTarget(): Promise<string> {
  const compilerNodeModules = path.join(compilerRoot, 'node_modules');
  if (await hasInstalledRuntimeDeps(compilerNodeModules)) {
    return compilerNodeModules;
  }

  const sharedNodeModules = path.join(defaultSharedDepsRoot(), 'node_modules');
  if (await hasInstalledRuntimeDeps(sharedNodeModules)) {
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
  const isolated = options.installMode === 'offline-copy-only';
  const sharedDeps =
    isolated || options.skipSharedDepsWarmup === true ? null : await ensureSharedDepsReady(options);
  const sharedDepsRoot = options.sharedDepsRoot ?? sharedDeps?.root ?? defaultSharedDepsRoot();
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
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
    const compilerNodeModules = path.join(compilerRoot, 'node_modules');
    if (await hasInstalledRuntimeDeps(compilerNodeModules)) {
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
    if (sharedStamp && (await hasInstalledRuntimeDeps(sharedNodeModulesPath))) {
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
