import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot } from './paths.ts';
import { ensureDir, pathExists, readJson, readText, writeJson, writeText } from './fs.ts';
import { CompilerError } from './errors.ts';
import { runCommand, type CommandResult } from './process.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';

export interface RuntimeDepsStamp {
  manifestHash: string;
  packageManager: 'bun' | 'npm';
  installedAt: string;
}

export interface SharedDepsReadyState {
  packageManager: 'bun' | 'npm';
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

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
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
  return pathExists(path.join(nodeModulesPath, 'next', 'package.json'));
}

async function writeManifestIfChanged(filePath: string, value: unknown): Promise<void> {
  const nextText = `${JSON.stringify(value, null, 2)}\n`;
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
    let handle: fs.FileHandle | null = null;

    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: (options.now ?? (() => new Date().toISOString()))() }, null, 2)}\n`,
        'utf8'
      );
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

async function runInstallWithFallback(
  workingDirectory: string,
  options: RuntimeDependencyInstallOptions,
  bunArgs: string[],
  npmArgs: string[],
  cacheDir?: string
): Promise<{ packageManager: 'bun' | 'npm'; result: CommandResult }> {
  const commandRunner = options.commandRunner ?? runCommand;
  const bunResult = await commandRunner('bun', bunArgs, {
    cwd: workingDirectory,
    env: buildEnv(cacheDir ? { BUN_INSTALL_CACHE_DIR: cacheDir } : {})
  });

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  const npmResult = await commandRunner(npmCommand(), npmArgs, {
    cwd: workingDirectory,
    env: buildEnv()
  });

  if (npmResult.code === 0) {
    return { packageManager: 'npm', result: npmResult };
  }

  throw new CompilerError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult,
    npmResult
  });
}

export async function withProjectDependencyBridge<T>(projectRoot: string, callback: () => Promise<T>): Promise<T> {
  const bridgePath = path.join(projectRoot, 'node_modules');
  const compilerNodeModules = path.join(compilerRoot, 'node_modules');
  let createdBridge = false;

  if (!(await pathExists(bridgePath))) {
    await fs.symlink(compilerNodeModules, bridgePath, 'junction');
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

    const { packageManager } = await runInstallWithFallback(
      sharedDepsRoot,
      options,
      ['install'],
      ['install', '--prefer-offline', '--no-audit', '--no-fund', '--no-package-lock']
    );

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

  if (options.preferSharedCopy !== false) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    if (sharedStamp && (await hasInstalledRuntimeDeps(path.join(sharedDepsRoot, 'node_modules')))) {
      try {
        await fs.cp(path.join(sharedDepsRoot, 'node_modules'), nodeModulesPath, { recursive: true });
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

  const { packageManager } = await runInstallWithFallback(
    projectRoot,
    options,
    ['install', '--no-save', '--frozen-lockfile=false'],
    ['install', '--prefer-offline', '--no-audit', '--no-fund', '--no-package-lock'],
    sharedDepsRoot
  );

  await writeRuntimeDepsStamp(stampPath, {
    manifestHash: runtimeSpec.manifestHash,
    packageManager,
    installedAt: (options.now ?? (() => new Date().toISOString()))()
  });
}
