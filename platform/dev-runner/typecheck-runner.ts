import path from 'node:path';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey, withRootDependencyBridge } from './env-manager.ts';
import { ensureSharedDepsReady } from '../shared/project-runtime.ts';

export async function runTypecheck(args: string[] = []): Promise<number> {
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
