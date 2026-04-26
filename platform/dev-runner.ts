import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSharedDepsReady } from './shared/project-runtime.ts';
import { compilerRoot } from './shared/paths.ts';
import { pathExists } from './shared/fs.ts';

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <typecheck|test|clean-test-workspaces> [args...]');
  process.exit(1);
}

function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

async function withRootDependencyBridge<T>(nodeModulesPath: string, callback: () => Promise<T>): Promise<T> {
  const rootNodeModulesPath = path.join(compilerRoot, 'node_modules');
  const hadRootNodeModules = await pathExists(rootNodeModulesPath);

  if (!hadRootNodeModules) {
    await fs.symlink(nodeModulesPath, rootNodeModulesPath, 'junction');
  }

  try {
    return await callback();
  } finally {
    if (!hadRootNodeModules) {
      await fs.rm(rootNodeModulesPath, { recursive: true, force: true });
    }
  }
}

function getTestWorkspaceTempRoot(): string {
  return path.join(compilerRoot, '.tmp', 'test-workspaces');
}

async function cleanTestWorkspaces(): Promise<void> {
  await fs.rm(getTestWorkspaceTempRoot(), { recursive: true, force: true });
}

function runDevCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: compilerRoot,
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          ...env
        }).filter(([, value]) => value !== undefined)
      ) as NodeJS.ProcessEnv,
      shell: false,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2);
  if (!target) {
    usage();
  }

  if (target === 'clean-test-workspaces') {
    await cleanTestWorkspaces();
    return;
  }

  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const envPathKey = pathEnvKey();
  const env = {
    [envPathKey]: `${binPath}${path.delimiter}${process.env[envPathKey] ?? ''}`
  };

  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    const code =
      target === 'typecheck'
        ? await runDevCommand(commandPath(binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env)
        : target === 'test'
          ? await runDevCommand(commandPath(binPath, 'vitest'), ['run', ...args], env)
          : usage();

    process.exitCode = code;
  });
}

await main();
