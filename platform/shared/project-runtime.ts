import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerRoot } from './paths.ts';
import { pathExists } from './fs.ts';
import { CompilerError } from './errors.ts';
import { runCommand } from './process.ts';

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
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

export async function ensureProjectDependencies(projectRoot: string): Promise<void> {
  const nextPackagePath = path.join(projectRoot, 'node_modules', 'next', 'package.json');
  if (await pathExists(nextPackagePath)) {
    return;
  }

  const projectLockfilePath = path.join(projectRoot, 'package-lock.json');
  if (await pathExists(projectLockfilePath)) {
    await fs.rm(projectLockfilePath, { force: true });
  }

  const envPathKey = pathEnvKey();
  const result = await runCommand(
    npmCommand(),
    ['install', '--prefer-offline', '--no-audit', '--no-fund', '--no-package-lock'],
    {
      cwd: projectRoot,
      env: {
        [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`,
        npm_config_cache: path.join(compilerRoot, '.npm-cache')
      }
    }
  );

  if (result.code !== 0) {
    throw new CompilerError('RUNTIME-DEPS-001', 'Failed to install generated runtime dependencies', result);
  }
}
