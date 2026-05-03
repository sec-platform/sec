import path from 'node:path';
import { pathExists } from '../shared/fs.ts';
import { compilerRoot } from '../shared/paths.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

async function rootTscPath(): Promise<string | null> {
  const rootBinPath = path.join(compilerRoot, 'node_modules', '.bin');
  const tscPath = commandPath(rootBinPath, 'tsc');
  return await pathExists(tscPath) ? tscPath : null;
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const rootTsc = await rootTscPath();
  if (rootTsc) {
    const rootBinPath = path.dirname(rootTsc);
    return runDevCommand(rootTsc, ['--noEmit', '-p', 'tsconfig.json', ...args], {
      [pathEnvKey()]: `${rootBinPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
    });
  }

  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    exitCode = await runDevCommand(commandPath(binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env);
  });
  return exitCode;
}
