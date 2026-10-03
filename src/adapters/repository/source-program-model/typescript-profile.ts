import path from 'node:path';
import ts from 'typescript';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { SecError } from '../../../contracts/failure.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { parseRuntimeDependencyPackageReference } from '../../toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { compilerDependencyManifestAuthority } from '../../toolchain/dependencies/runtime/compiler-input-contract.ts';
import { compilerRoot } from '../../workspace-context.ts';
import {
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST
} from './typescript-fact-shards.ts';
import { TYPESCRIPT_MODULE_LOAD_SEMANTICS } from './typescript-module-loader.ts';

/** Compiler profile and process-issued identity; external toolchain observation has one owner. */
const SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH =
  'src/adapters/repository/source-program-model/typescript.ts' as const;

const typeScriptCompilerIdentityBrand: unique symbol = Symbol('typescript-source-program-compiler-identity');

const issuedTypeScriptCompilerIdentities = new WeakSet<object>();
const loadedTypeScriptRuntimePath = ts.sys.getExecutingFilePath();

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

/** Readiness for this compiler API only. Lock bytes bind the input snapshot;
 * they do not prove official package integrity or whole dependency readiness. */
function currentTypeScriptCompilerApiInputDigest(): `sha256:${string}` {
  const read = (file: string): Uint8Array => {
    const bytes = readOptionalRetainedOrdinaryFile(file, 'TypeScript compiler API capability');
    if (bytes === null) throw new Error(`Required compiler API input is absent: ${file}`);
    return bytes;
  };
  try {
    const manifest = read(path.join(compilerRoot, 'package.json'));
    const lock = read(path.join(compilerRoot, 'bun.lock'));
    const declaration = compilerDependencyManifestAuthority(manifest);
    const reference = declaration.dependencies.typescript ?? declaration.devDependencies.typescript;
    const expected = typeof reference === 'string' ? parseRuntimeDependencyPackageReference('typescript', reference) : null;
    if (expected === null || expected.packageName !== 'typescript' || expected.version !== ts.version) {
      throw new Error('Loaded TypeScript compiler API does not match the canonical exact declaration.');
    }
    const runtime = decodeExactUtf8(read(loadedTypeScriptRuntimePath));
    const library = decodeExactUtf8(read(ts.getDefaultLibFilePath(TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS)));
    if (sha256({ defaultLibrary: sha256(library), runtime: sha256(runtime), typescriptRevision: ts.version }) !==
        TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST) {
      throw new Error('Loaded TypeScript compiler API bytes changed; a fresh compiler process is required.');
    }
    return sha256({ manifest: rawSha256(manifest), lock: rawSha256(lock) }) as `sha256:${string}`;
  } catch (cause) {
    throw new SecError('SOURCE-PROGRAM-TYPESCRIPT-CAPABILITY-BLOCKED',
      'Required locked TypeScript compiler API is unavailable or stale; no dependency installation was selected.', {}, { cause });
  }
}

export const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER = Object.freeze({
  id: 'typescript-compiler-api',
  revision: ts.version
});

export const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION = sha256(TYPESCRIPT_SOURCE_PROGRAM_PROVIDER);
const TYPESCRIPT_COMPILER_API_INPUT_DIGEST = currentTypeScriptCompilerApiInputDigest();

export const TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION = sha256({
  compilerConfigDigest: TYPESCRIPT_WORKSPACE_COMPILER_CONFIG_DIGEST,
  dependencyGenerationDigest: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST,
  compilerApiInputsDigest: TYPESCRIPT_COMPILER_API_INPUT_DIGEST,
  factShardSchemaDigest: SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
  moduleLoadSemantics: TYPESCRIPT_MODULE_LOAD_SEMANTICS,
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
  const inputDigest = currentTypeScriptCompilerApiInputDigest();
  if (inputDigest !== TYPESCRIPT_COMPILER_API_INPUT_DIGEST) {
    throw new SecError('SOURCE-PROGRAM-TYPESCRIPT-CAPABILITY-BLOCKED', 'TypeScript compiler API inputs changed; a fresh compiler process is required.');
  }
  const identity = Object.freeze({
    [typeScriptCompilerIdentityBrand]: true as const,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION as `sha256:${string}`,
    providerRevision: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION as `sha256:${string}`,
    compilerConfigDigest: TYPESCRIPT_WORKSPACE_COMPILER_CONFIG_DIGEST as `sha256:${string}`,
    dependencyGenerationDigest: sha256({ compiler: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST,
      inputs: inputDigest }) as `sha256:${string}`,
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
  if (identity.dependencyGenerationDigest !== sha256({ compiler: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST,
    inputs: currentTypeScriptCompilerApiInputDigest() })) {
    throw new SecError('SOURCE-PROGRAM-TYPESCRIPT-CAPABILITY-BLOCKED', 'TypeScript compiler API inputs changed after capability issuance.');
  }
}
