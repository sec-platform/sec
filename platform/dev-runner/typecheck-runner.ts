import path from 'node:path';
import { ensureCompilerDepsReady } from '../shared/project-runtime.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey } from './env-manager.ts';

type TypecheckDependencyContext = {
  binPath: string;
};

async function typecheckDependencyContext(): Promise<TypecheckDependencyContext> {
  const compilerDeps = await ensureCompilerDepsReady();
  return { binPath: path.join(compilerDeps.nodeModulesPath, '.bin') };
}

export async function runTypecheckWithBinPath(
  binPath: string,
  args: string[] = []
): Promise<number> {
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  return runDevCommand(commandPath(binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env);
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const deps = await typecheckDependencyContext();
  return runTypecheckWithBinPath(deps.binPath, args);
}
