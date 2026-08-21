import path from 'node:path';
import { ensureCompilerDepsReady } from '../shared/project-runtime.ts';
import {
  resolveInstalledTypecheckProviderV1,
  typecheckProviderArguments,
  type TypecheckProviderV1
} from '../toolchain/typecheck-provider.ts';
import { runDevCommand } from './command-runner.ts';
import { pathEnvKey } from './env-manager.ts';

type TypecheckDependencyContext = {
  nodeModulesPath: string;
};

async function typecheckDependencyContext(): Promise<TypecheckDependencyContext> {
  const compilerDeps = await ensureCompilerDepsReady();
  return {
    nodeModulesPath: compilerDeps.nodeModulesPath
  };
}

export async function runTypecheckWithProvider(
  nodeModulesPath: string,
  provider: TypecheckProviderV1,
  args: string[] = []
): Promise<number> {
  const binPath = path.join(nodeModulesPath, '.bin');
  const cliEntryPath = path.join(
    nodeModulesPath,
    provider.packageName,
    ...provider.cliEntryRelativePath.split('/')
  );
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`,
    SEC_TYPECHECK_PROVIDER_REVISION: provider.providerRevision
  };

  return runDevCommand(
    process.execPath,
    [cliEntryPath, ...typecheckProviderArguments(provider, args)],
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
  return runTypecheckWithProvider(path.dirname(binPath), provider, args);
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const deps = await typecheckDependencyContext();
  const provider = await resolveInstalledTypecheckProviderV1(deps.nodeModulesPath);
  return runTypecheckWithProvider(deps.nodeModulesPath, provider, args);
}
