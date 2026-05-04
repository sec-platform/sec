import path from 'node:path';
import { pathExists } from '../shared/fs.ts';
import { compilerRoot } from '../shared/paths.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';

type TypecheckDependencyContext = {
  binPath: string;
  bridgeNodeModulesPath?: string;
};

async function typecheckDependencyContext(): Promise<TypecheckDependencyContext> {
  const rootNodeModulesPath = path.join(compilerRoot, 'node_modules');
  if (await pathExists(rootNodeModulesPath)) {
    return { binPath: path.join(rootNodeModulesPath, '.bin') };
  }

  const sharedDeps = await ensureSharedDepsReady();
  return {
    binPath: path.join(sharedDeps.nodeModulesPath, '.bin'),
    bridgeNodeModulesPath: sharedDeps.nodeModulesPath
  };
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const deps = await typecheckDependencyContext();
  const env = {
    [pathEnvKey()]: `${deps.binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  let exitCode = 1;
  const run = async (): Promise<void> => {
    exitCode = await runDevCommand(commandPath(deps.binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env);
  };

  if (deps.bridgeNodeModulesPath) {
    await withRootDependencyBridge(deps.bridgeNodeModulesPath, run);
  } else {
    await run();
  }

  return exitCode;
}
