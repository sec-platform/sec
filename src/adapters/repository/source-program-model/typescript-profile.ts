import ts from 'typescript';
import {
  sha256
} from '../../../contracts/canonical.ts';
import {
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
} from './typescript-fact-shards.ts';

/** Compiler profile and process-issued identity; external toolchain observation has one owner. */
const SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH =
  'src/adapters/repository/source-program-model/typescript.ts' as const;

const typeScriptCompilerIdentityBrand: unique symbol = Symbol('typescript-source-program-compiler-identity');

const issuedTypeScriptCompilerIdentities = new WeakSet<object>();

export const TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS: ts.CompilerOptions = Object.freeze({
  allowImportingTsExtensions: true,
  allowJs: true,
  checkJs: false,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  lib: ['lib.es2022.d.ts'],
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
  verbatimModuleSyntax: true
});

const TYPESCRIPT_WORKSPACE_COMPILER_CONFIG_DIGEST =
  sha256(TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS);

function typeScriptWorkspaceDependencyGenerationDigest(): string {
  const runtimePath = ts.sys.getExecutingFilePath();
  const defaultLibraryPath = ts.getDefaultLibFilePath(TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS);
  const runtimeSource = ts.sys.readFile(runtimePath);
  const defaultLibrarySource = ts.sys.readFile(defaultLibraryPath);
  if (runtimeSource === undefined || defaultLibrarySource === undefined) {
    throw new Error('Source Program TypeScript dependency generation is unavailable');
  }
  return sha256({
    defaultLibrary: sha256(defaultLibrarySource),
    runtime: sha256(runtimeSource),
    typescriptRevision: ts.version
  });
}

export const TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST =
  typeScriptWorkspaceDependencyGenerationDigest();

export const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER = Object.freeze({
  id: 'typescript-compiler-api',
  revision: ts.version
});

export const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION = sha256(TYPESCRIPT_SOURCE_PROGRAM_PROVIDER);

export const TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION = sha256({
  compilerConfigDigest: TYPESCRIPT_WORKSPACE_COMPILER_CONFIG_DIGEST,
  dependencyGenerationDigest: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST,
  factShardSchemaDigest: SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
  provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
  semanticOwner: SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH
});

export interface TypeScriptCompilerIdentity {
  readonly [typeScriptCompilerIdentityBrand]: true;
  readonly compilerRevision: `sha256:${string}`;
  readonly providerRevision: `sha256:${string}`;
  readonly compilerConfigDigest: `sha256:${string}`;
  readonly dependencyGenerationDigest: `sha256:${string}`;
  readonly environmentDigest: `sha256:${string}`;
  readonly provider: Readonly<{ readonly id: string; readonly revision: string }>;
}

/**
 * Canonical projection of the semantic inputs owned by this compiler. Cache
 * consumers bind to this receipt; they never reproduce compiler identity.
 */
export function typeScriptCompilerIdentity(): TypeScriptCompilerIdentity {
  const identity = Object.freeze({
    [typeScriptCompilerIdentityBrand]: true as const,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION as `sha256:${string}`,
    providerRevision: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION as `sha256:${string}`,
    compilerConfigDigest: TYPESCRIPT_WORKSPACE_COMPILER_CONFIG_DIGEST as `sha256:${string}`,
    dependencyGenerationDigest: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST as `sha256:${string}`,
    environmentDigest: sha256({
      architecture: process.arch,
      caseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      platform: process.platform
    }) as `sha256:${string}`,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER
  });
  issuedTypeScriptCompilerIdentities.add(identity);
  return identity;
}

export function assertTypeScriptCompilerIdentity(
  identity: TypeScriptCompilerIdentity
): void {
  if (!issuedTypeScriptCompilerIdentities.has(identity)) {
    throw new Error('TypeScript Source Program compiler identity is not owner-issued');
  }
}
