import path from 'node:path';
import { ensureCompilerDepsReady } from '../shared/project-runtime.ts';
import {
  resolveInstalledTypecheckProviderV1,
  typecheckProviderArguments,
  type TypecheckProviderV1
} from '../toolchain/typecheck-provider.ts';
import { runDevCommand } from './command-runner.ts';
import { commandPath, pathEnvKey } from './env-manager.ts';

type TypecheckDependencyContext = {
  binPath: string;
  nodeModulesPath: string;
};

async function typecheckDependencyContext(): Promise<TypecheckDependencyContext> {
  const compilerDeps = await ensureCompilerDepsReady();
  return {
    binPath: path.join(compilerDeps.nodeModulesPath, '.bin'),
    nodeModulesPath: compilerDeps.nodeModulesPath
  };
}

export async function runTypecheckWithProvider(
  binPath: string,
  provider: TypecheckProviderV1,
  args: string[] = []
): Promise<number> {
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`,
    SEC_TYPECHECK_PROVIDER_REVISION: provider.providerRevision
  };

  return runDevCommand(
    commandPath(binPath, provider.binaryName),
    typecheckProviderArguments(provider, args),
    env
  );
}

/**
 * Compatibility seam for focused tests/callers that already supply a bin root.
 * The provider revision is still observed from the sibling node_modules root;
 * this path is not allowed to invent an unresolved/fake revision.
 */
export async function runTypecheckWithBinPath(
  binPath: string,
  args: string[] = []
): Promise<number> {
  const provider = await resolveInstalledTypecheckProviderV1(path.dirname(binPath));
  return runTypecheckWithProvider(binPath, provider, args);
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const deps = await typecheckDependencyContext();
  const provider = await resolveInstalledTypecheckProviderV1(deps.nodeModulesPath);
  return runTypecheckWithProvider(deps.binPath, provider, args);
}
