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

export async function runTypecheck(args: string[] = []): Promise<number> {
  const deps = await typecheckDependencyContext();
  const env = {
    [pathEnvKey()]: `${deps.binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`
  };

  return runDevCommand(commandPath(deps.binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env);
}
