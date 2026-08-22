import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../shared/canonical-primitives.ts';
import { compilerRoot, isPathInside } from '../shared/paths.ts';
import {
  resolveInstalledTypecheckProviderV1,
  typecheckProviderExecutionArguments,
  type TypecheckProviderV1
} from '../toolchain/typecheck-provider.ts';
import { runDevCommand } from './command-runner.ts';
import { ensureFastTestDependencies } from './dependency-bootstrap.ts';
import { pathEnvKey } from './env-manager.ts';

type TypecheckDependencyContext = {
  nodeModulesPath: string;
};

export function resolveTypecheckBuildInfoPathV1(input: Readonly<{
  provider: TypecheckProviderV1;
  compilerRootPath?: string;
  cacheRoot?: string;
}>): string {
  const resolvedCompilerRoot = path.resolve(input.compilerRootPath ?? compilerRoot);
  const normalizedCompilerRoot = process.platform === 'win32'
    ? resolvedCompilerRoot.toLowerCase()
    : resolvedCompilerRoot;
  const derivedCacheRoot = path.resolve(
    input.cacheRoot ?? path.join(tmpdir(), 'sec', 'typecheck', 'v1')
  );
  const cacheKey = sha256(Object.freeze({
    schema: 'sec-typecheck-build-info-cache-key-v1',
    compilerRoot: normalizedCompilerRoot,
    providerRevision: input.provider.providerRevision,
    projectConfig: input.provider.projectConfig
  })).slice(7);
  const buildInfoFile = path.join(derivedCacheRoot, cacheKey, 'tsconfig.tsbuildinfo');
  if (isPathInside(resolvedCompilerRoot, buildInfoFile)) {
    throw new Error('TypeCheck derived build-info cache must remain outside the compiler tree');
  }
  return buildInfoFile;
}

async function typecheckDependencyContext(): Promise<TypecheckDependencyContext> {
  const compilerDeps = await ensureFastTestDependencies();
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
  const buildInfoFile = resolveTypecheckBuildInfoPathV1({ provider });
  await fs.mkdir(path.dirname(buildInfoFile), { recursive: true });
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${process.env[pathEnvKey()] ?? ''}`,
    SEC_TYPECHECK_PROVIDER_REVISION: provider.providerRevision
  };

  return runDevCommand(
    process.execPath,
    [
      cliEntryPath,
      ...typecheckProviderExecutionArguments(provider, buildInfoFile, args)
    ],
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
