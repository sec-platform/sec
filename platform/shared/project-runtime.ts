import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { CompilerError } from './errors.ts';
import { ensureDir, formatJsonFile, pathExists, readJson, readText, writeJson, writeText } from './fs.ts';
import { compilerRoot } from './paths.ts';
import { pathEnvKey, runCommand, type CommandResult } from './process.ts';
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
  commandRunner?: typeof runCommand;
  lockTimeoutMs?: number;
  now?: () => string;
  pollIntervalMs?: number;
  preferSharedCopy?: boolean;
  sharedDepsRoot?: string;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSharedDepsRoot(): string {
  return path.join(compilerRoot, '.shared-deps');
}

function buildEnv(additionalEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const envPathKey = pathEnvKey();
  return {
    [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`,
    ...additionalEnv
  };
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

async function writeManifestIfChanged(filePath: string, value: unknown): Promise<void> {
  const nextText = formatJsonFile(value);
  if ((await pathExists(filePath)) && (await readText(filePath)) === nextText) {
    return;
  }
  await writeText(filePath, nextText);
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

export async function writeRuntimeDepsStamp(stampPath: string, stamp: RuntimeDepsStamp): Promise<void> {
  await writeJson(stampPath, stamp);
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

  await ensureDir(path.dirname(lockPath));

  while (true) {
    let handle: FileHandle | null = null;

    try {
      handle = await fs.open(lockPath, 'wx');
      const createdAt = (options.now ?? (() => new Date().toISOString()))();
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
  const bunResult = await commandRunner('bun', bunArgs, {
    cwd: workingDirectory,
    env: buildEnv(cacheDir ? { BUN_INSTALL_CACHE_DIR: cacheDir } : {})
  });

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new CompilerError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult
  });
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

  await ensureDir(sharedDepsRoot);
  await writeManifestIfChanged(sharedPackagePath, manifest);

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
    await writeManifestIfChanged(sharedPackagePath, manifest);

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
    });

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
  const sharedDeps =
    options.skipSharedDepsWarmup === true ? null : await ensureSharedDepsReady(options);
  const sharedDepsRoot = options.sharedDepsRoot ?? sharedDeps?.root ?? defaultSharedDepsRoot();
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  const stampPath = projectStampPath(projectRoot);

  if (await isCacheReady(nodeModulesPath, stampPath, runtimeSpec.manifestHash)) {
    return;
  }

  if (await pathExists(nodeModulesPath)) {
    await fs.rm(nodeModulesPath, { recursive: true, force: true });
  }

  if (options.skipSharedDepsWarmup === true && options.preferSharedCopy !== false) {
    const compilerNodeModules = path.join(compilerRoot, 'node_modules');
    if (await hasInstalledRuntimeDeps(compilerNodeModules)) {
      await fs.symlink(compilerNodeModules, nodeModulesPath, 'junction');
      await writeRuntimeDepsStamp(stampPath, {
        manifestHash: runtimeSpec.manifestHash,
        packageManager: 'bun',
        installedAt: (options.now ?? (() => new Date().toISOString()))()
      });
      return;
    }
  }

  if (options.preferSharedCopy !== false) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    const sharedNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
    if (sharedStamp && (await hasInstalledRuntimeDeps(sharedNodeModulesPath))) {
      try {
        await fs.symlink(sharedNodeModulesPath, nodeModulesPath, 'junction');
        await writeRuntimeDepsStamp(stampPath, {
          manifestHash: runtimeSpec.manifestHash,
          packageManager: sharedStamp.packageManager,
          installedAt: (options.now ?? (() => new Date().toISOString()))()
        });
        return;
      } catch {
        if (await pathExists(nodeModulesPath)) {
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
  });
}
