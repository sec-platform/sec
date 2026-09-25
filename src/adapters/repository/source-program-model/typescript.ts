import path from 'node:path';

import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  normalizeRepositoryModulePath,
  type ModuleImportKind,
  type RepositoryModuleGraph,
  type RepositoryModuleGraphImport,
  type RepositoryModuleGraphImportObservation,
  type RepositoryModuleMembership
} from '../architecture/contract.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation,
  type SourceProgramCompilationPhase
} from './compilation-operation.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramCompilation,
  SourceProgramDeclaration,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramFileInput,
  SourceProgramFileSemanticKind,
  SourceProgramLiteral,
  SourceProgramLiteralContext,
  SourceProgramModel,
  SourceProgramQueryResult,
  SourceProgramReference,
  SourceProgramReferenceKind,
  SourceProgramReturnProvenance,
  SourceProgramReturnValueProvenance,
  SourceProgramSpan,
  SourceProgramUnknown
} from './contract.ts';
import { sourceProgramSurfaceForPath } from './contract.ts';
import {
  assembleRepositoryModuleGraph,
  resolveRepositoryModuleImportCandidates
} from './module-graph.ts';
import {
  assembleTypeScriptModel,
  compileTypeScriptSourceProgramFactShard,
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
  type TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
export interface TypeScriptModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: RepositoryModuleMembership;
  readonly operation?: SourceProgramCompilationOperation;
}

type TypeScriptModelInternalInput = TypeScriptModelInput & Readonly<{
  repositoryCompilation?: SourceProgramCompilation;
  sourceFileIdentities?: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
}>;

const preparedTypeScriptSourceProgramInputBrand: unique symbol = Symbol(
  'prepared-typescript-source-program-input'
);
const issuedPreparedTypeScriptSourceProgramInputs = new WeakSet<object>();

type PreparedTypeScriptModelInput = TypeScriptModelInternalInput & Readonly<{
  readonly [preparedTypeScriptSourceProgramInputBrand]: true;
  readonly operation: SourceProgramCompilationOperation;
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
}>;

type TypeScriptSourceProgramFileIdentity = Readonly<{
  file: SourceProgramFileInput;
  moduleDigest: `sha256:${string}`;
  rawFileDigest: `sha256:${string}`;
}>;

const SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH =
  'src/adapters/repository/source-program-model/typescript.ts' as const;

export interface TypeScriptIncrementalState {
  readonly [typeScriptIncrementalStateBrand]: true;
  readonly providerRevision: string;
  readonly sourceRevision: string;
  readonly fileDigests: Readonly<Record<string, string>>;
  readonly semanticSourceDigests: Readonly<Record<string, `sha256:${string}`>>;
  readonly moduleDigests: Readonly<Record<string, string>>;
  readonly semanticDependencyScopes: Readonly<Record<
    string,
    TypeScriptSourceProgramFactShard['semanticDependencyScope']
  >>;
  readonly moduleGraphDigest: `sha256:${string}`;
  /** Candidate-path reverse edges preserve additions, removals and resolver fallback changes. */
  readonly reverseConsumers: Readonly<Record<string, readonly string[]>>;
  readonly factShards: readonly TypeScriptSourceProgramFactShard[];
  readonly model: SourceProgramModel;
}

export interface TypeScriptIncrementalResult {
  readonly mode: 'exact' | 'incremental' | 'full';
  readonly invalidatedPaths: readonly string[];
  readonly model: SourceProgramModel;
  readonly state: TypeScriptIncrementalState;
}

interface SourceProgramTypeScriptDiagnosticEvidence {
  readonly path: string | null;
  readonly code: number;
  readonly category: 'error' | 'warning' | 'suggestion' | 'message';
  readonly message: string;
}

export interface TypeScriptDiagnosticSnapshot {
  readonly sourceRevision: string;
  readonly diagnostics: readonly SourceProgramTypeScriptDiagnosticEvidence[];
  readonly evidenceDigest: string;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;
const RUNTIME_BUILTIN_MODULE = /^(?:node:|bun(?::|$))/u;

/** Canonical compiler classification for host runtime built-ins. */
export function isRuntimeBuiltinModuleSpecifier(specifier: string): boolean {
  return RUNTIME_BUILTIN_MODULE.test(specifier);
}
const compiledTypeScriptModels = new WeakSet<object>();
const factShardsByModel = new WeakMap<object, readonly TypeScriptSourceProgramFactShard[]>();
const repositoryCompilationDigestByModel = new WeakMap<object, `sha256:${string}`>();
const typeScriptIncrementalStateBrand: unique symbol = Symbol('typescript-source-program-incremental-state');
const issuedTypeScriptIncrementalStates = new WeakSet<object>();
const typeScriptCompilerIdentityBrand: unique symbol = Symbol('typescript-source-program-compiler-identity');
const issuedTypeScriptCompilerIdentities = new WeakSet<object>();
const typeScriptSourceProgramPerformance = {
  dependencyAdjacencyLookups: 0,
  dependencyReferenceVisits: 0,
  rawSourceHashBytes: 0,
  rawSourceHashOperations: 0,
  semanticScopeParseOperations: 0,
  semanticSymbolLookupOperations: 0,
  semanticSymbolLookupSkippedIdentifiers: 0
};

export interface TypeScriptPerformanceObservation {
  readonly dependencyAdjacencyLookups: number;
  readonly dependencyReferenceVisits: number;
  readonly rawSourceHashBytes: number;
  readonly rawSourceHashOperations: number;
  readonly semanticScopeParseOperations: number;
  readonly semanticSymbolLookupOperations: number;
  readonly semanticSymbolLookupSkippedIdentifiers: number;
}

/** Monotonic process-local diagnostics for focused performance tests only. */
export function observeTypeScriptPerformanceForTests():
TypeScriptPerformanceObservation {
  return Object.freeze({ ...typeScriptSourceProgramPerformance });
}
const typeScriptRequiredApiClosureBrand: unique symbol = Symbol('typescript-required-api-closure');
const issuedTypeScriptRequiredApiClosures = new WeakSet<object>();

interface SourceProgramTypeScriptApiRequirement {
  readonly apiPath: string;
  readonly consumerPaths: readonly string[];
  readonly space: 'type' | 'value';
  readonly usageCount: number;
}

interface SourceProgramTypeScriptApiUnknown {
  readonly code:
    | 'typescript-api-member-unresolved'
    | 'typescript-computed-api-unresolved'
    | 'typescript-import-unresolved'
    | 'typescript-namespace-escape'
    | 'typescript-unstable-entrypoint';
  readonly detail: string;
  readonly path: string;
}

export interface TypeScriptRequiredApiClosure {
  readonly [typeScriptRequiredApiClosureBrand]: true;
  readonly authoringDependencyGenerationDigest: `sha256:${string}`;
  readonly authoringPackageName: 'typescript';
  readonly authoringProviderRevision: string;
  readonly closureDigest: `sha256:${string}`;
  readonly requirements: readonly SourceProgramTypeScriptApiRequirement[];
  readonly sourceRevision: string;
  readonly unknowns: readonly SourceProgramTypeScriptApiUnknown[];
}

export function assertTypeScriptRequiredApiClosure(
  closure: TypeScriptRequiredApiClosure
): void {
  if (!issuedTypeScriptRequiredApiClosures.has(closure)) {
    throw new Error('TypeScript required API closure is not Source Program issued');
  }
}

export function workspaceSnapshotIdentityForTypeScriptModel(
  model: SourceProgramModel
): `sha256:${string}` | null {
  return repositoryCompilationDigestByModel.get(model) ?? null;
}

function bindTypeScriptModelToRepositoryCompilation(
  model: SourceProgramModel,
  context: SourceProgramCompilation | undefined
): SourceProgramModel {
  if (context !== undefined) {
    repositoryCompilationDigestByModel.set(model, context.identityDigest);
  }
  return model;
}

export function isCompiledTypeScriptModel(
  value: SourceProgramModel
): boolean {
  return compiledTypeScriptModels.has(value);
}

function canonicalPath(value: string): string {
  const normalized = normalizeRepositoryModulePath(value);
  if (normalized !== value || value.length === 0 || value.startsWith('../') || path.posix.isAbsolute(value)) {
    throw new Error(`Source Program Model path is not canonical: ${value}`);
  }
  return normalized;
}

function moduleExtensionFor(fileName: string): ts.Extension {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.d.mts')) return ts.Extension.Dmts;
  if (lower.endsWith('.d.cts')) return ts.Extension.Dcts;
  if (lower.endsWith('.d.ts')) return ts.Extension.Dts;
  if (lower.endsWith('.mts')) return ts.Extension.Mts;
  if (lower.endsWith('.cts')) return ts.Extension.Cts;
  if (lower.endsWith('.tsx')) return ts.Extension.Tsx;
  if (lower.endsWith('.jsx')) return ts.Extension.Jsx;
  if (lower.endsWith('.mjs')) return ts.Extension.Mjs;
  if (lower.endsWith('.cjs')) return ts.Extension.Cjs;
  if (lower.endsWith('.js')) return ts.Extension.Js;
  return ts.Extension.Ts;
}

function sourceProgramScriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

const TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS: ts.CompilerOptions = Object.freeze({
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

const TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST =
  typeScriptWorkspaceDependencyGenerationDigest();

const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER = Object.freeze({
  id: 'typescript-compiler-api',
  revision: ts.version
});
const TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION = sha256(TYPESCRIPT_SOURCE_PROGRAM_PROVIDER);
const TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION = sha256({
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

interface SourceProgramTypeScriptRenameLocation {
  readonly path: string;
  readonly span: SourceProgramSpan;
  readonly prefixText: string;
  readonly suffixText: string;
}

export type TypeScriptRenameObservation = Readonly<{
  readonly status: 'resolved';
  readonly canRename: boolean;
  readonly rejectionReason: string | null;
  readonly locations: readonly SourceProgramTypeScriptRenameLocation[];
  readonly observationDigest: `sha256:${string}`;
}> | Readonly<{
  readonly status: 'unresolved';
  readonly reason:
    | 'exact-generation-unavailable'
    | 'generation-stale'
    | 'position-unresolved'
    | 'rename-location-outside-generation';
  readonly observationDigest: `sha256:${string}`;
}>;

export type TypeScriptSyntaxObservation = Readonly<{
  readonly status: 'resolved';
  readonly syntax: 'valid' | 'invalid';
  readonly firstDiagnostic: string | null;
  readonly observationDigest: `sha256:${string}`;
}> | Readonly<{
  readonly status: 'unresolved';
  readonly reason: 'exact-generation-unavailable' | 'source-file-unavailable';
  readonly observationDigest: `sha256:${string}`;
}>;

type ExactTypeScriptProgram = Readonly<{
  checker: ts.TypeChecker;
  program: ts.Program;
  renameAt(repositoryPath: string, position: number): TypeScriptRenameObservation;
  repositoryPath(sourceFile: ts.SourceFile): string;
  sourceFiles: readonly ts.SourceFile[];
}>;

/**
 * One process owns one exact TypeScript workspace. LanguageService only reuses
 * immutable compiler snapshots; repository facts remain owned by the canonical
 * SourceProgramModel produced below. There is no watcher, daemon or second AST.
 */
class TypeScriptSourceProgramWorkspace {
  readonly #repositoryRoot: string;
  readonly #service: ts.LanguageService;
  readonly #files = new Map<string, Readonly<{
    identityDigest: string;
    snapshot: ts.IScriptSnapshot;
    version: number;
  }>>();
  #canonicalByAbsolute = new Map<string, string>();
  #operation: SourceProgramCompilationOperation | null = null;
  #projectVersion = 0;

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = repositoryRoot;
    const host: ts.LanguageServiceHost = {
      directoryExists: ts.sys.directoryExists,
      fileExists: (fileName) => this.#repositoryPath(fileName) !== null || ts.sys.fileExists(fileName),
      getCompilationSettings: () => TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
      getCurrentDirectory: () => this.#repositoryRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getDirectories: ts.sys.getDirectories,
      getProjectVersion: () => String(this.#projectVersion),
      getScriptFileNames: () => [...this.#files.keys()]
        .sort(compareCodeUnits)
        .map((repositoryPathValue) => path.resolve(this.#repositoryRoot, repositoryPathValue)),
      getScriptSnapshot: (fileName) => {
        this.#checkpoint('program-materialization');
        const repositoryPathValue = this.#repositoryPath(fileName);
        if (repositoryPathValue !== null) return this.#files.get(repositoryPathValue)?.snapshot;
        const source = ts.sys.readFile(fileName);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: (fileName) => {
        const repositoryPathValue = this.#repositoryPath(fileName);
        return repositoryPathValue === null
          ? TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
          : String(this.#files.get(repositoryPathValue)?.version ?? 0);
      },
      readDirectory: ts.sys.readDirectory,
      readFile: (fileName) => {
        const repositoryPathValue = this.#repositoryPath(fileName);
        if (repositoryPathValue === null) return ts.sys.readFile(fileName);
        const snapshot = this.#files.get(repositoryPathValue)?.snapshot;
        return snapshot?.getText(0, snapshot.getLength());
      },
      realpath: ts.sys.realpath,
      resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((moduleName) => {
        this.#checkpoint('program-materialization');
        const containingRepositoryPath = this.#repositoryPath(containingFile);
        if (containingRepositoryPath !== null && moduleName.startsWith('.')) {
          const targetPath = resolveRepositoryModuleImportCandidates(
            containingRepositoryPath,
            moduleName
          ).find((candidate) => this.#files.has(candidate));
          if (targetPath !== undefined) {
            return {
              extension: moduleExtensionFor(targetPath),
              isExternalLibraryImport: false,
              resolvedFileName: path.resolve(this.#repositoryRoot, targetPath)
            };
          }
        }
        // Source Program owns repository-local symbol and capability facts,
        // not package typechecking. Loading external declaration graphs here
        // duplicates the canonical TypeScript checker and turns one repository
        // audit into an unbounded node_modules census. External packages remain
        // explicit opaque dependencies in the model compiled below.
        if (containingRepositoryPath !== null && moduleName !== 'typescript') return undefined;
        return ts.resolveModuleName(
          moduleName,
          containingFile,
          TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
          ts.sys
        ).resolvedModule;
      }),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
    };
    this.#service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  compile(
    filesByPath: ReadonlyMap<string, SourceProgramFileInput>,
    sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>,
    operation: SourceProgramCompilationOperation
  ): ExactTypeScriptProgram {
    this.#operation = operation;
    sourceProgramCompilationCheckpoint(operation, 'program-materialization', 'start');
    const nextPaths = new Set(filesByPath.keys());
    let changed = false;
    for (const repositoryPathValue of this.#files.keys()) {
      if (nextPaths.has(repositoryPathValue)) continue;
      this.#files.delete(repositoryPathValue);
      changed = true;
    }
    for (const [repositoryPathValue, file] of filesByPath) {
      const current = this.#files.get(repositoryPathValue);
      const identityDigest = sourceFileIdentities.get(repositoryPathValue)?.rawFileDigest;
      if (identityDigest === undefined) {
        throw new Error(`TypeScript Program file identity is absent: ${repositoryPathValue}`);
      }
      if (current?.identityDigest === identityDigest) continue;
      this.#files.set(repositoryPathValue, Object.freeze({
        identityDigest,
        snapshot: ts.ScriptSnapshot.fromString(file.source),
        version: (current?.version ?? 0) + 1
      }));
      changed = true;
    }
    if (changed) {
      this.#canonicalByAbsolute = new Map(
        [...this.#files.keys()].map((repositoryPathValue) => [
          this.#absoluteKey(path.resolve(this.#repositoryRoot, repositoryPathValue)),
          repositoryPathValue
        ] as const)
      );
      this.#projectVersion += 1;
    }
    const program = this.#service.getProgram();
    if (program === undefined) throw new Error('Source Program TypeScript workspace has no Program');
    const rootNames = [...this.#files.keys()]
      .sort(compareCodeUnits)
      .map((repositoryPathValue) => path.resolve(this.#repositoryRoot, repositoryPathValue));
    const sourceFiles = rootNames.map((rootName) => program.getSourceFile(rootName)).filter(
      (sourceFile): sourceFile is ts.SourceFile => sourceFile !== undefined
    );
    if (sourceFiles.length !== rootNames.length) {
      throw new Error(
        `TypeScript Program omitted exact repository roots: expected ${rootNames.length}, got ${sourceFiles.length}`
      );
    }
    const generationProjectVersion = this.#projectVersion;
    const sourceFileByRepositoryPath = new Map(sourceFiles.map((sourceFile) => [
      this.#repositoryPath(sourceFile.fileName)!,
      sourceFile
    ] as const));
    const renameAt = (
      repositoryPathValue: string,
      position: number
    ): TypeScriptRenameObservation => {
      const unresolved = (
        reason: Extract<TypeScriptRenameObservation, { status: 'unresolved' }>['reason']
      ): TypeScriptRenameObservation => Object.freeze({
        status: 'unresolved' as const,
        reason,
        observationDigest: sha256({
          status: 'unresolved',
          reason,
          generationProjectVersion,
          repositoryPath: repositoryPathValue,
          position
        }) as `sha256:${string}`
      });
      if (this.#projectVersion !== generationProjectVersion) return unresolved('generation-stale');
      const sourceFile = sourceFileByRepositoryPath.get(repositoryPathValue);
      if (sourceFile === undefined || position < 0 || position >= sourceFile.text.length) {
        return unresolved('position-unresolved');
      }
      const absolutePath = path.resolve(this.#repositoryRoot, repositoryPathValue);
      const renameInfo = this.#service.getRenameInfo(absolutePath, position, {
        allowRenameOfImportPath: false
      });
      const rawLocations = renameInfo.canRename
        ? this.#service.findRenameLocations(absolutePath, position, false, false, true) ?? []
        : [];
      const locations: SourceProgramTypeScriptRenameLocation[] = [];
      for (const location of rawLocations) {
        const locationPath = this.#repositoryPath(location.fileName);
        const locationSource = locationPath === null
          ? undefined
          : sourceFileByRepositoryPath.get(locationPath);
        if (locationPath === null || locationSource === undefined) {
          return unresolved('rename-location-outside-generation');
        }
        const start = location.textSpan.start;
        const end = start + location.textSpan.length;
        if (start < 0 || end < start || end > locationSource.text.length) {
          return unresolved('position-unresolved');
        }
        const startLocation = locationSource.getLineAndCharacterOfPosition(start);
        const endLocation = locationSource.getLineAndCharacterOfPosition(end);
        locations.push(Object.freeze({
          path: locationPath,
          span: Object.freeze({
            start,
            end,
            startLine: startLocation.line + 1,
            startColumn: startLocation.character + 1,
            endLine: endLocation.line + 1,
            endColumn: endLocation.character + 1
          }),
          prefixText: location.prefixText ?? '',
          suffixText: location.suffixText ?? ''
        }));
      }
      locations.sort((left, right) => compareCodeUnits(left.path, right.path)
        || left.span.start - right.span.start);
      const canonical = Object.freeze({
        status: 'resolved' as const,
        canRename: renameInfo.canRename,
        rejectionReason: renameInfo.canRename ? null : renameInfo.localizedErrorMessage,
        locations: Object.freeze(locations),
        generationProjectVersion,
        repositoryPath: repositoryPathValue,
        position
      });
      return Object.freeze({
        status: canonical.status,
        canRename: canonical.canRename,
        rejectionReason: canonical.rejectionReason,
        locations: canonical.locations,
        observationDigest: sha256(canonical) as `sha256:${string}`
      });
    };
    sourceProgramCompilationCheckpoint(operation, 'program-materialization', 'complete');
    return Object.freeze({
      checker: program.getTypeChecker(),
      program,
      renameAt,
      repositoryPath: (sourceFile) => {
        const repositoryPathValue = this.#repositoryPath(sourceFile.fileName);
        if (repositoryPathValue === null) {
          throw new Error(`TypeScript Program source escaped exact repository census: ${sourceFile.fileName}`);
        }
        return repositoryPathValue;
      },
      sourceFiles: Object.freeze(sourceFiles)
    });
  }

  dispose(): void {
    this.#service.cleanupSemanticCache();
    this.#service.dispose();
    this.#files.clear();
    this.#canonicalByAbsolute.clear();
    this.#projectVersion += 1;
  }

  #absoluteKey(value: string): string {
    const normalized = value.replaceAll('\\', '/');
    return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
  }

  #repositoryPath(fileName: string): string | null {
    return this.#canonicalByAbsolute.get(this.#absoluteKey(path.resolve(fileName))) ?? null;
  }

  #checkpoint(phase: SourceProgramCompilationPhase): void {
    if (this.#operation !== null) sourceProgramCompilationCheckpoint(this.#operation, phase);
  }
}

let activeTypeScriptWorkspace: TypeScriptSourceProgramWorkspace | null = null;
let activeTypeScriptWorkspaceRoot: string | null = null;

/** Release one process-local edit snapshot after its compact evidence is sealed. */
export function releaseTypeScriptWorkspace(): void {
  activeTypeScriptWorkspace?.dispose();
  activeTypeScriptWorkspace = null;
  activeTypeScriptWorkspaceRoot = null;
}

function canonicalTypeScriptFile(raw: SourceProgramFileInput): SourceProgramFileInput {
  const repositoryPathValue = canonicalPath(raw.path);
  if (!/^sha256:[0-9a-f]{64}$/u.test(raw.contentDigest)) {
    throw new Error(`Source Program Model file has invalid content digest: ${repositoryPathValue}`);
  }
  return Object.freeze({ ...raw, path: repositoryPathValue });
}

function sourceProgramFileSnapshotDigest(
  file: SourceProgramFileInput,
  sourceDigest?: string
): `sha256:${string}` {
  let exactSourceDigest = sourceDigest;
  if (exactSourceDigest === undefined) {
    typeScriptSourceProgramPerformance.rawSourceHashOperations += 1;
    typeScriptSourceProgramPerformance.rawSourceHashBytes += Buffer.byteLength(file.source, 'utf8');
    exactSourceDigest = rawSha256(file.source);
  }
  return sha256({
    declaredContentDigest: file.contentDigest,
    sourceDigest: exactSourceDigest
  }) as `sha256:${string}`;
}

function prepareTypeScriptSourceProgramInput(
  input: TypeScriptModelInternalInput
): PreparedTypeScriptModelInput {
  if (issuedPreparedTypeScriptSourceProgramInputs.has(input)) {
    return input as PreparedTypeScriptModelInput;
  }
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'admission');
  input.repositoryCompilation?.assertMatches(input);
  const trustedSnapshot = input.repositoryCompilation;
  const identities = new Map<string, TypeScriptSourceProgramFileIdentity>();
  for (const raw of input.files) {
    const surface = sourceProgramSurfaceForPath(raw.path);
    if (!SOURCE_EXTENSION.test(raw.path)
        || (surface !== 'production' && surface !== 'test')) continue;
    const file = canonicalTypeScriptFile(raw);
    if (identities.has(file.path)) {
      throw new Error(`Source Program Model snapshot contains duplicate path: ${file.path}`);
    }
    const trustedFile = trustedSnapshot?.file(file.path) ?? null;
    if (trustedSnapshot !== undefined && (
      trustedFile === null || trustedFile.contentDigest !== file.contentDigest
    )) {
      throw new Error(`Workspace Source Program file identity is unavailable: ${file.path}`);
    }
    identities.set(file.path, Object.freeze({
      file,
      moduleDigest: sha256(input.moduleMembership.moduleForPath(file.path)) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(
        file,
        trustedSnapshot === undefined ? undefined : file.contentDigest
      )
    }));
  }
  return issuePreparedTypeScriptSourceProgramInput({ ...input, operation }, identities);
}

function issuePreparedTypeScriptSourceProgramInput(
  input: TypeScriptModelInternalInput & Readonly<{
    operation: SourceProgramCompilationOperation;
  }>,
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>
): PreparedTypeScriptModelInput {
  const prepared = Object.freeze({
    ...input,
    [preparedTypeScriptSourceProgramInputBrand]: true as const,
    sourceFileIdentities
  });
  issuedPreparedTypeScriptSourceProgramInputs.add(prepared);
  return prepared;
}

function compileExactTypeScriptProgram(
  filesByPath: ReadonlyMap<string, SourceProgramFileInput>,
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>,
  operation: SourceProgramCompilationOperation
): ExactTypeScriptProgram {
  const repositoryRoot = process.cwd();
  if (activeTypeScriptWorkspace === null || activeTypeScriptWorkspaceRoot !== repositoryRoot) {
    activeTypeScriptWorkspace?.dispose();
    activeTypeScriptWorkspace = new TypeScriptSourceProgramWorkspace(repositoryRoot);
    activeTypeScriptWorkspaceRoot = repositoryRoot;
  }
  return activeTypeScriptWorkspace.compile(filesByPath, sourceFileIdentities, operation);
}

export type RepositoryModuleGraphInput = Readonly<{
  readonly files: readonly string[];
  /** Return null when the exact snapshot has no bytes for the address. */
  readonly readSource: (moduleFile: string) => string | null;
  /** Non-TypeScript embedded-language facts issued by their own frontend. */
  readonly readImports?: (
    moduleFile: string,
    source: string
  ) => readonly RepositoryModuleGraphImport[];
  readonly unresolvedFiles?: readonly string[];
  readonly operation?: SourceProgramCompilationOperation;
}>;

function typeScriptModuleImportFacts(
  exact: ExactTypeScriptProgram
): readonly RepositoryModuleGraphImportObservation[] {
  const observations: RepositoryModuleGraphImportObservation[] = [];
  const add = (
    from: string,
    kind: ModuleImportKind,
    specifier: string,
    typeOnly = false
  ): void => {
    observations.push(Object.freeze({ from, kind, specifier, typeOnly }));
  };
  for (const sourceFile of exact.sourceFiles) {
    const from = exact.repositoryPath(sourceFile);
    for (const reference of [
      ...sourceFile.referencedFiles,
      ...sourceFile.typeReferenceDirectives,
      ...sourceFile.libReferenceDirectives
    ]) add(from, 'static', reference.fileName, true);
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          && node.moduleSpecifier !== undefined
          && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause !== undefined && (
              node.importClause.isTypeOnly
              || (node.importClause.name === undefined
                && node.importClause.namedBindings !== undefined
                && ts.isNamedImports(node.importClause.namedBindings)
                && node.importClause.namedBindings.elements.length > 0
                && node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
            )
          : node.isTypeOnly || (
              node.exportClause !== undefined
              && ts.isNamedExports(node.exportClause)
              && node.exportClause.elements.length > 0
              && node.exportClause.elements.every((element) => element.isTypeOnly)
            );
        add(from, 'static', node.moduleSpecifier.text, typeOnly);
      } else if (ts.isImportEqualsDeclaration(node)
          && ts.isExternalModuleReference(node.moduleReference)
          && node.moduleReference.expression !== undefined
          && ts.isStringLiteralLike(node.moduleReference.expression)) {
        add(from, 'require', node.moduleReference.expression.text, node.isTypeOnly);
      } else if (ts.isCallExpression(node)
          && node.arguments.length > 0
          && ts.isStringLiteralLike(node.arguments[0]!)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          add(from, 'dynamic', node.arguments[0]!.text);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          add(from, 'require', node.arguments[0]!.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const unique = new Map<string, RepositoryModuleGraphImportObservation>();
  for (const observation of observations) {
    const key = `${observation.from}\0${observation.kind}\0${observation.specifier}`;
    const existing = unique.get(key);
    if (existing === undefined || (existing.typeOnly && !observation.typeOnly)) {
      unique.set(key, observation);
    }
  }
  return Object.freeze([...unique.values()].sort((left, right) => (
    compareCodeUnits(left.from, right.from)
    || compareCodeUnits(left.specifier, right.specifier)
    || compareCodeUnits(left.kind, right.kind)
  )));
}

/**
 * The only ordinary TypeScript/JavaScript module-graph frontend.  It reuses
 * the process Language Service and feeds typed observations to the pure graph
 * assembler; downstream consumers never parse source bytes themselves.
 */
export function compileRepositoryModuleGraph(
  input: RepositoryModuleGraphInput
): RepositoryModuleGraph {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  const files = Object.freeze([...new Set(input.files.map(normalizeRepositoryModulePath))]
    .sort(compareCodeUnits));
  const sourceByPath = new Map<string, string>();
  const unresolvedFiles = new Set((input.unresolvedFiles ?? []).map(normalizeRepositoryModulePath));
  for (const repositoryPathValue of files) {
    const source = input.readSource(repositoryPathValue);
    if (source === null) unresolvedFiles.add(repositoryPathValue);
    else sourceByPath.set(repositoryPathValue, source);
  }
  const typeScriptFiles = new Map<string, SourceProgramFileInput>();
  const identities = new Map<string, TypeScriptSourceProgramFileIdentity>();
  for (const [repositoryPathValue, source] of sourceByPath) {
    if (!SOURCE_EXTENSION.test(repositoryPathValue)) continue;
    const contentDigest = rawSha256(source) as `sha256:${string}`;
    const file = Object.freeze({ path: repositoryPathValue, source, contentDigest });
    typeScriptFiles.set(repositoryPathValue, file);
    identities.set(repositoryPathValue, Object.freeze({
      file,
      moduleDigest: sha256(null) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(file, contentDigest)
    }));
  }
  const imports: RepositoryModuleGraphImportObservation[] = [];
  if (typeScriptFiles.size > 0) {
    imports.push(...typeScriptModuleImportFacts(
      compileExactTypeScriptProgram(typeScriptFiles, identities, operation)
    ));
  }
  if (input.readImports !== undefined) {
    for (const [repositoryPathValue, source] of sourceByPath) {
      if (SOURCE_EXTENSION.test(repositoryPathValue)) continue;
      try {
        imports.push(...input.readImports(repositoryPathValue, source).map((observation) => (
          Object.freeze({ ...observation, from: repositoryPathValue })
        )));
      } catch {
        unresolvedFiles.add(repositoryPathValue);
      }
    }
  }
  return assembleRepositoryModuleGraph({
    files,
    imports: Object.freeze(imports),
    unresolvedFiles: Object.freeze([...unresolvedFiles])
  });
}

type TypeScriptImportBinding = Readonly<{
  exportName: string | null;
  localSymbol: ts.Symbol;
}>;

function typeScriptApiUseSpace(node: ts.Node): 'type' | 'value' {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isStatement(current) && !ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return 'type';
    current = current.parent;
  }
  return 'value';
}

function typeScriptStaticAccess(
  node: ts.Node,
  checker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, TypeScriptImportBinding>
): Readonly<{
  binding: TypeScriptImportBinding;
  segments: readonly string[];
  terminal: ts.Node;
}> | null {
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    const binding = symbol === undefined ? undefined : bindings.get(symbol);
    return binding === undefined ? null : Object.freeze({ binding, segments: Object.freeze([]), terminal: node });
  }
  if (ts.isPropertyAccessExpression(node)) {
    const parent = typeScriptStaticAccess(node.expression, checker, bindings);
    return parent === null ? null : Object.freeze({
      binding: parent.binding,
      segments: Object.freeze([...parent.segments, node.name.text]),
      terminal: node.name
    });
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const parent = typeScriptStaticAccess(node.expression, checker, bindings);
    return parent === null ? null : Object.freeze({
      binding: parent.binding,
      segments: Object.freeze([...parent.segments, node.argumentExpression.text]),
      terminal: node.argumentExpression
    });
  }
  if (ts.isQualifiedName(node)) {
    const parent = typeScriptStaticAccess(node.left, checker, bindings);
    return parent === null ? null : Object.freeze({
      binding: parent.binding,
      segments: Object.freeze([...parent.segments, node.right.text]),
      terminal: node.right
    });
  }
  return null;
}

function typeScriptAccessContinues(node: ts.Node): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    || (ts.isElementAccessExpression(parent) && parent.expression === node)
    || (ts.isQualifiedName(parent) && parent.left === node);
}

function isTypeScriptImportBindingIdentifier(node: ts.Node): boolean {
  return ts.isIdentifier(node) && (
    ts.isImportClause(node.parent)
    || ts.isNamespaceImport(node.parent)
    || ts.isImportSpecifier(node.parent)
  );
}

function resolvedTypeScriptApiSymbol(
  node: ts.Node,
  checker: ts.TypeChecker
): ts.Symbol | null {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined && ts.isStringLiteralLike(node) && ts.isElementAccessExpression(node.parent)) {
    symbol = checker.getTypeAtLocation(node.parent.expression).getProperty(node.text);
  }
  if (symbol === undefined) return null;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declarations = symbol.declarations ?? [];
  return declarations.some((declaration) => declaration.getSourceFile().isDeclarationFile)
    ? symbol
    : null;
}

function compileTypeScriptRequiredApiClosure(
  exact: ExactTypeScriptProgram,
  sourceRevision: string,
  operation: SourceProgramCompilationOperation
): TypeScriptRequiredApiClosure {
  sourceProgramCompilationCheckpoint(operation, 'required-api-closure', 'start');
  const requirements = new Map<string, {
    apiPath: string;
    consumers: Set<string>;
    space: 'type' | 'value';
    usageCount: number;
  }>();
  const unknowns = new Map<string, SourceProgramTypeScriptApiUnknown>();
  const pushUnknown = (unknown: SourceProgramTypeScriptApiUnknown): void => {
    unknowns.set(sha256(unknown), Object.freeze(unknown));
  };

  for (const sourceFile of exact.sourceFiles) {
    sourceProgramCompilationCheckpoint(operation, 'required-api-closure');
    const sourcePath = exact.repositoryPath(sourceFile);
    if (sourceProgramSurfaceForPath(sourcePath) !== 'production') continue;
    const bindings = new Map<ts.Symbol, TypeScriptImportBinding>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      if (moduleSpecifier !== 'typescript') {
        if (moduleSpecifier.startsWith('typescript/')) {
          pushUnknown({
            code: 'typescript-unstable-entrypoint',
            detail: moduleSpecifier,
            path: sourcePath
          });
        }
        continue;
      }
      const importClause = statement.importClause;
      if (importClause === undefined) {
        pushUnknown({
          code: 'typescript-import-unresolved',
          detail: 'side-effect import has no API binding',
          path: sourcePath
        });
        continue;
      }
      const addBinding = (identifier: ts.Identifier, exportName: string | null): void => {
        const localSymbol = exact.checker.getSymbolAtLocation(identifier);
        if (localSymbol === undefined) {
          pushUnknown({
            code: 'typescript-import-unresolved',
            detail: identifier.text,
            path: sourcePath
          });
          return;
        }
        bindings.set(localSymbol, Object.freeze({ exportName, localSymbol }));
      };
      if (importClause.name !== undefined) addBinding(importClause.name, null);
      const namedBindings = importClause.namedBindings;
      if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
        addBinding(namedBindings.name, null);
      } else if (namedBindings !== undefined) {
        for (const element of namedBindings.elements) {
          addBinding(element.name, (element.propertyName ?? element.name).text);
        }
      }
    }
    // Only files with an admitted `typescript` binding can contribute API
    // member observations. Scanning every production AST here duplicated the
    // full semantic observation walk for the overwhelmingly common no-binding
    // case.
    if (bindings.size === 0) continue;

    let visitedNodes = 0;
    const visit = (node: ts.Node): void => {
      if ((visitedNodes++ & 1023) === 0) {
        sourceProgramCompilationCheckpoint(operation, 'required-api-closure');
      }
      if (ts.isElementAccessExpression(node)
          && !ts.isStringLiteralLike(node.argumentExpression)
          && typeScriptStaticAccess(node.expression, exact.checker, bindings) !== null) {
        pushUnknown({
          code: 'typescript-computed-api-unresolved',
          detail: node.argumentExpression.getText(sourceFile).slice(0, 256),
          path: sourcePath
        });
      }
      const access = typeScriptStaticAccess(node, exact.checker, bindings);
      if (access !== null && !typeScriptAccessContinues(node) && !isTypeScriptImportBindingIdentifier(node)) {
        if (access.binding.exportName === null && access.segments.length === 0) {
          pushUnknown({
            code: 'typescript-namespace-escape',
            detail: node.getText(sourceFile).slice(0, 256),
            path: sourcePath
          });
        } else {
          const apiPath = [access.binding.exportName, ...access.segments]
            .filter((segment): segment is string => segment !== null)
            .join('.');
          const resolved = resolvedTypeScriptApiSymbol(access.terminal, exact.checker);
          if (apiPath.length === 0 || resolved === null) {
            pushUnknown({
              code: 'typescript-api-member-unresolved',
              detail: apiPath || node.getText(sourceFile).slice(0, 256),
              path: sourcePath
            });
          } else {
            const space = typeScriptApiUseSpace(node);
            const key = `${space}\0${apiPath}`;
            const current = requirements.get(key);
            if (current === undefined) {
              requirements.set(key, {
                apiPath,
                consumers: new Set([sourcePath]),
                space,
                usageCount: 1
              });
            } else {
              current.consumers.add(sourcePath);
              current.usageCount += 1;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const canonicalRequirements = Object.freeze([...requirements.values()]
    .map(({ consumers, ...requirement }) => Object.freeze({
      ...requirement,
      consumerPaths: Object.freeze([...consumers].sort(compareCodeUnits))
    }))
    .sort((left, right) => compareCodeUnits(
      `${left.space}\0${left.apiPath}`,
      `${right.space}\0${right.apiPath}`
    )));
  const canonicalUnknowns = Object.freeze([...unknowns.values()].sort((left, right) =>
    compareCodeUnits(
      `${left.path}\0${left.code}\0${left.detail}`,
      `${right.path}\0${right.code}\0${right.detail}`
    )));
  const projection = Object.freeze({
    authoringDependencyGenerationDigest: TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST as `sha256:${string}`,
    authoringPackageName: 'typescript' as const,
    authoringProviderRevision: ts.version,
    requirements: canonicalRequirements,
    sourceRevision,
    unknowns: canonicalUnknowns
  });
  const closure = Object.freeze({
    [typeScriptRequiredApiClosureBrand]: true as const,
    ...projection,
    closureDigest: sha256(projection) as `sha256:${string}`
  });
  issuedTypeScriptRequiredApiClosures.add(closure);
  sourceProgramCompilationCheckpoint(operation, 'required-api-closure', 'complete');
  return closure;
}

function diagnosticCategory(category: ts.DiagnosticCategory): SourceProgramTypeScriptDiagnosticEvidence['category'] {
  switch (category) {
    case ts.DiagnosticCategory.Error: return 'error';
    case ts.DiagnosticCategory.Warning: return 'warning';
    case ts.DiagnosticCategory.Suggestion: return 'suggestion';
    case ts.DiagnosticCategory.Message: return 'message';
  }
}

/**
 * Diagnostic evidence for a virtual reduction is compiled by the same exact
 * Program/LanguageService owner as repository facts.  Positions are omitted:
 * deleting a declaration may shift later nodes without changing diagnostics.
 */
export function compileTypeScriptDiagnosticSnapshot(input: Readonly<{
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
}>): TypeScriptDiagnosticSnapshot {
  const filesByPath = new Map<string, SourceProgramFileInput>();
  for (const raw of input.files) {
    if (!SOURCE_EXTENSION.test(raw.path)
        || sourceProgramSurfaceForPath(raw.path) !== 'production') continue;
    const file = canonicalTypeScriptFile(raw);
    if (filesByPath.has(file.path)) {
      throw new Error(`Source Program diagnostic snapshot contains duplicate path: ${file.path}`);
    }
    filesByPath.set(file.path, file);
  }
  const sourceFileIdentities = new Map([...filesByPath].map(([repositoryPathValue, file]) => [
    repositoryPathValue,
    Object.freeze({
      file,
      moduleDigest: sha256(null) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(file)
    })
  ] as const));
  const exact = compileExactTypeScriptProgram(
    filesByPath,
    sourceFileIdentities,
    resolveSourceProgramCompilationOperation()
  );
  const diagnostics = exact.sourceFiles.flatMap((sourceFile) => [
    ...exact.program.getSyntacticDiagnostics(sourceFile),
    ...exact.program.getSemanticDiagnostics(sourceFile)
  ]).map((diagnostic): SourceProgramTypeScriptDiagnosticEvidence => Object.freeze({
    path: diagnostic.file === undefined ? null : exact.repositoryPath(diagnostic.file),
    code: diagnostic.code,
    category: diagnosticCategory(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  })).sort((left, right) => compareCodeUnits(left.path ?? '', right.path ?? '')
    || left.code - right.code
    || compareCodeUnits(left.category, right.category)
    || compareCodeUnits(left.message, right.message));
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    diagnostics: Object.freeze(diagnostics),
    evidenceDigest: sha256(diagnostics)
  });
}


function spanFor(sourceFile: ts.SourceFile, node: ts.Node): SourceProgramSpan {
  const start = node.getStart(sourceFile, false);
  const end = node.getEnd();
  const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
  const endLocation = sourceFile.getLineAndCharacterOfPosition(end);
  return Object.freeze({
    start,
    end,
    startLine: startLocation.line + 1,
    startColumn: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1
  });
}

function semanticSourceText(source: string): string {
  return source.replace(/\r\n?/gu, '\n');
}

function semanticDeclarationText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return semanticSourceText(node.getText(sourceFile));
}

function executionScopeName(span: SourceProgramSpan): string {
  return `@execution-scope:${span.startLine}:${span.startColumn}`;
}

function declarationNameNode(node: ts.Node): ts.Identifier | ts.StringLiteral | ts.NumericLiteral | null {
  if (ts.isConstructorDeclaration(node)) return null;
  if (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isModuleDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isMethodSignature(node)
    || ts.isPropertyDeclaration(node)
    || ts.isPropertySignature(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
  ) {
    return node.name && (
      ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)
    ) ? node.name : null;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name;
  return null;
}

function declarationName(node: ts.Node): string | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const name = declarationNameNode(node);
  return name?.text ?? null;
}

function isDeclarationName(node: ts.Identifier): boolean {
  return declarationNameNode(node.parent) === node
    || ts.isImportClause(node.parent)
    || ts.isImportSpecifier(node.parent)
    || ts.isNamespaceImport(node.parent)
    || ts.isExportSpecifier(node.parent);
}

function referenceKind(node: ts.Identifier): SourceProgramReferenceKind {
  const parent = node.parent;
  const expression = ts.isPropertyAccessExpression(parent) ? parent : node;
  const invocation = expression.parent;
  if (ts.isNewExpression(invocation) && invocation.expression === expression) return 'construct';
  if (ts.isCallExpression(invocation) && invocation.expression === expression) return 'call';
  return 'reference';
}

function literalContext(node: ts.Node): Readonly<{
  context: SourceProgramLiteralContext;
  owner: ts.Node | null;
}> {
  let descendant = node;
  for (let ancestor = node.parent; ancestor && !ts.isStatement(ancestor); ancestor = ancestor.parent) {
    if (ts.isCallExpression(ancestor)
      && ancestor.arguments.includes(descendant as ts.Expression)
      && ts.isPropertyAccessExpression(ancestor.expression)
      && /^(?:toBe|toContain|toEqual|toHaveProperty|toMatchObject|toStrictEqual)$/u
        .test(ancestor.expression.name.text)) {
      return Object.freeze({ context: 'assertion', owner: ancestor });
    }
    descendant = ancestor;
  }
  let expression: ts.Node = node;
  let parent = node.parent;
  while (parent && (
    (ts.isAsExpression(parent) && parent.expression === expression)
    || (ts.isTypeAssertionExpression(parent) && parent.expression === expression)
    || (ts.isParenthesizedExpression(parent) && parent.expression === expression)
    || (ts.isNonNullExpression(parent) && parent.expression === expression)
    || (ts.isSatisfiesExpression(parent) && parent.expression === expression)
  )) {
    expression = parent;
    parent = parent.parent;
  }
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.initializer === expression) {
    return Object.freeze({ context: 'producer', owner: parent });
  }
  if (ts.isBinaryExpression(parent) || ts.isCaseClause(parent)) {
    return Object.freeze({ context: 'reader', owner: parent });
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node as ts.Expression)) {
    return Object.freeze({ context: 'argument', owner: parent });
  }
  return Object.freeze({ context: 'literal', owner: null });
}

type ReturnProvenanceValues = readonly SourceProgramReturnValueProvenance[];

const OPAQUE_RETURN_PROVENANCE = Object.freeze({ kind: 'opaque' as const });
const LITERAL_RETURN_PROVENANCE = Object.freeze({ kind: 'literal' as const });
const MAX_RETURN_PROVENANCE_VALUES = 32;
const MAX_RETURN_PROVENANCE_ARGUMENTS = 32;
const MAX_RETURN_PROVENANCE_ARGUMENT_VALUES = 8;
const currentExactReturnProvenancesByModel = new WeakMap<
  object,
  readonly SourceProgramReturnProvenance[]
>();
export interface TypeScriptExactFactGenerationReceipt {
  apiClosureDigest: `sha256:${string}`;
  semanticInputDigest: `sha256:${string}`;
  observationInputDigest: `sha256:${string}`;
  provenanceDigest: `sha256:${string}`;
}

export type TypeScriptModuleExportResolution =
  | Readonly<{ readonly status: 'absent'; readonly entrypointPath: string }>
  | Readonly<{
      readonly status: 'resolved';
      readonly entrypointPath: string;
    }>
  | Readonly<{
      readonly status: 'unresolved';
      readonly entrypointPath: string;
      readonly reason:
        | 'entrypoint-module-symbol-unresolved'
        | 'entrypoint-source-unresolved'
        | 'entrypoint-syntax-unresolved'
        | 'export-target-unresolved';
    }>;
type ExactFactGeneration = Readonly<
  TypeScriptExactFactGenerationReceipt & {
  apiClosure: TypeScriptRequiredApiClosure;
  checker: ts.TypeChecker;
  renameAt: ExactTypeScriptProgram['renameAt'];
  returnProvenances: readonly SourceProgramReturnProvenance[];
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
}>;
const exactFactGenerationByModel = new WeakMap<object, ExactFactGeneration>();

/** Shards alone are hints; only an exact Program or exact fact-generation receipt is causal. */
export function currentExactReturnProvenances(
  model: SourceProgramModel
): readonly SourceProgramReturnProvenance[] | null {
  return currentExactReturnProvenancesByModel.get(model) ?? null;
}

/** Exact syntax belongs to the same live TypeChecker generation; consumers cannot reparse bytes. */
export function typeScriptSourceFile(
  model: SourceProgramModel,
  repositoryPath: string
): ts.SourceFile | null {
  return exactFactGenerationByModel.get(model)?.sourceFiles.get(repositoryPath) ?? null;
}

function exactGenerationIdentifier(
  model: SourceProgramModel,
  repositoryPath: string,
  node: ts.Identifier,
  expectedName: string
): Readonly<{ generation: ExactFactGeneration; sourceFile: ts.SourceFile }> | null {
  const generation = exactFactGenerationByModel.get(model);
  const sourceFile = generation?.sourceFiles.get(repositoryPath);
  if (generation === undefined || sourceFile === undefined
      || node.text !== expectedName || node.getSourceFile() !== sourceFile) return null;
  return Object.freeze({ generation, sourceFile });
}

/** Resolve an intrinsic global through the retained exact Program generation. */
export function identifierIsAmbientGlobal(
  model: SourceProgramModel,
  repositoryPath: string,
  node: ts.Identifier,
  expectedName: 'process' | 'Bun'
): boolean {
  if (expectedName !== 'process' && expectedName !== 'Bun') return false;
  const exact = exactGenerationIdentifier(model, repositoryPath, node, expectedName);
  if (exact === null) return false;
  const symbol = exact.generation.checker.getSymbolAtLocation(node);
  // This exact workspace intentionally excludes external ambient declarations.
  // Only runtime-owned intrinsics may use absence of a local checker binding;
  // any declared shadow still has to satisfy the declaration-origin check.
  if (symbol === undefined) return true;
  const declarations = symbol?.declarations ?? [];
  const repositorySourceFiles = new Set(exact.generation.sourceFiles.values());
  return declarations.length > 0 && declarations.every((declaration) => {
    const declarationFile = declaration.getSourceFile();
    return declarationFile.isDeclarationFile && !repositorySourceFiles.has(declarationFile);
  });
}

/** Resolve an imported call owner through the retained exact Program generation. */
export function identifierResolvesToImport(
  model: SourceProgramModel,
  repositoryPath: string,
  node: ts.Identifier,
  moduleSpecifier: string,
  expectedExportName: string
): boolean {
  const exact = exactGenerationIdentifier(model, repositoryPath, node, node.text);
  if (exact === null) return false;
  const symbol = exact.generation.checker.getSymbolAtLocation(node);
  if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0) return false;
  return (symbol.declarations ?? []).some((declaration) => {
    const importedExportName = ts.isImportSpecifier(declaration)
      ? (declaration.propertyName ?? declaration.name).text
      : ts.isNamespaceImport(declaration)
        ? '*'
        : ts.isImportClause(declaration) && declaration.name !== undefined
          ? 'default'
          : null;
    if (importedExportName !== expectedExportName) return false;
    let current: ts.Node | undefined = declaration;
    while (current !== undefined && !ts.isSourceFile(current)) {
      if (ts.isImportDeclaration(current)) {
        return current.getSourceFile() === exact.sourceFile
          && ts.isStringLiteralLike(current.moduleSpecifier)
          && current.moduleSpecifier.text === moduleSpecifier;
      }
      current = current.parent;
    }
    return false;
  });
}

/** Resolve one local identifier reference to its exact variable initializer. */
export function identifierInitializer(
  model: SourceProgramModel,
  repositoryPath: string,
  node: ts.Identifier
): ts.Expression | null {
  const exact = exactGenerationIdentifier(model, repositoryPath, node, node.text);
  if (exact === null) return null;
  const symbol = exact.generation.checker.getSymbolAtLocation(node);
  const declaration = symbol?.valueDeclaration;
  return declaration !== undefined
      && ts.isVariableDeclaration(declaration)
      && declaration.initializer !== undefined
    ? declaration.initializer
    : null;
}

/** Syntax validity is projected from the exact compiler generation; consumers do not reparse source. */
export function observeTypeScriptSyntax(
  model: SourceProgramModel,
  repositoryPath: string
): TypeScriptSyntaxObservation {
  const generation = exactFactGenerationByModel.get(model);
  const unresolved = (
    reason: Extract<TypeScriptSyntaxObservation, { status: 'unresolved' }>['reason']
  ): TypeScriptSyntaxObservation => Object.freeze({
    status: 'unresolved' as const,
    reason,
    observationDigest: sha256({
      status: 'unresolved',
      reason,
      sourceRevision: model.sourceRevision,
      repositoryPath
    }) as `sha256:${string}`
  });
  if (generation === undefined) return unresolved('exact-generation-unavailable');
  const sourceFile = generation.sourceFiles.get(repositoryPath);
  if (sourceFile === undefined) return unresolved('source-file-unavailable');
  const diagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  const firstDiagnostic = diagnostics[0] === undefined
    ? null
    : ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ');
  const canonical = Object.freeze({
    status: 'resolved' as const,
    syntax: diagnostics.length === 0 ? 'valid' as const : 'invalid' as const,
    firstDiagnostic,
    sourceRevision: model.sourceRevision,
    repositoryPath
  });
  return Object.freeze({
    status: canonical.status,
    syntax: canonical.syntax,
    firstDiagnostic: canonical.firstDiagnostic,
    observationDigest: sha256(canonical) as `sha256:${string}`
  });
}

/** Rename facts are available only while this exact Program generation is current. */
export function observeTypeScriptRename(
  model: SourceProgramModel,
  repositoryPath: string,
  position: number
): TypeScriptRenameObservation {
  const generation = exactFactGenerationByModel.get(model);
  if (generation !== undefined) return generation.renameAt(repositoryPath, position);
  return Object.freeze({
    status: 'unresolved' as const,
    reason: 'exact-generation-unavailable' as const,
    observationDigest: sha256({
      status: 'unresolved',
      reason: 'exact-generation-unavailable',
      sourceRevision: model.sourceRevision,
      repositoryPath,
      position
    }) as `sha256:${string}`
  });
}

export type DurableWorkerInputObservation = Readonly<{
  status: 'resolved';
  risk: 'argv' | 'callback' | null;
  observationDigest: `sha256:${string}`;
}> | Readonly<{
  status: 'unresolved';
  reason: 'declaration-node-unresolved' | 'exact-generation-unavailable' | 'parameter-type-unresolved';
  observationDigest: `sha256:${string}`;
}>;

/**
 * Project one durable-worker input boundary from the exact live Program.
 * Consumers receive a compact fact and never reparse source bytes or retain
 * compiler nodes beyond this generation.
 */
export function observeDurableWorkerInput(
  model: SourceProgramModel,
  declaration: SourceProgramDeclaration
): DurableWorkerInputObservation {
  const generation = exactFactGenerationByModel.get(model);
  const unresolved = (
    reason: Extract<DurableWorkerInputObservation, { status: 'unresolved' }>['reason']
  ): DurableWorkerInputObservation => {
    const canonical = Object.freeze({
      status: 'unresolved' as const,
      reason,
      sourceRevision: model.sourceRevision,
      declarationObservationId: declaration.observationId,
      semanticInputDigest: generation?.semanticInputDigest ?? null
    });
    return Object.freeze({
      status: canonical.status,
      reason,
      observationDigest: sha256(canonical) as `sha256:${string}`
    });
  };
  if (generation === undefined) return unresolved('exact-generation-unavailable');
  const sourceFile = generation.sourceFiles.get(declaration.path);
  if (sourceFile === undefined) return unresolved('declaration-node-unresolved');
  const findFunctionLike = (node: ts.Node): ts.SignatureDeclaration | undefined => {
    const named = node as ts.NamedDeclaration;
    const name = named.name;
    if (name !== undefined
        && ts.isIdentifier(name)
        && name.text === declaration.name
        && node.getStart(sourceFile, false) === declaration.span.start
        && node.getEnd() === declaration.span.end) {
      if (ts.isFunctionLike(node)) return node;
      if (ts.isVariableDeclaration(node)
          && node.initializer !== undefined
          && ts.isFunctionLike(node.initializer)) return node.initializer;
    }
    return ts.forEachChild(node, findFunctionLike);
  };
  const functionLike = findFunctionLike(sourceFile);
  if (functionLike === undefined) return unresolved('declaration-node-unresolved');
  let risk: 'argv' | 'callback' | null = null;
  let unresolvedType = false;
  for (const parameter of functionLike.parameters) {
    const type = parameter.type;
    if (type === undefined) {
      unresolvedType = true;
      continue;
    }
    let callback = false;
    let argv = false;
    const inspect = (node: ts.Node): void => {
      if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) callback = true;
      if (ts.isArrayTypeNode(node)
          && node.elementType.kind === ts.SyntaxKind.StringKeyword) argv = true;
      if (ts.isTypeReferenceNode(node)
          && ts.isIdentifier(node.typeName)
          && (node.typeName.text === 'Array' || node.typeName.text === 'ReadonlyArray')
          && node.typeArguments?.length === 1
          && node.typeArguments[0]!.kind === ts.SyntaxKind.StringKeyword) argv = true;
      ts.forEachChild(node, inspect);
    };
    inspect(type);
    if (callback) risk = 'callback';
    else if (argv && risk === null) risk = 'argv';
    else if (!argv) unresolvedType = true;
  }
  if (risk === null && unresolvedType) return unresolved('parameter-type-unresolved');
  const canonical = Object.freeze({
    status: 'resolved' as const,
    risk,
    sourceRevision: model.sourceRevision,
    declarationObservationId: declaration.observationId,
    semanticInputDigest: generation.semanticInputDigest
  });
  return Object.freeze({
    status: canonical.status,
    risk,
    observationDigest: sha256(canonical) as `sha256:${string}`
  });
}

/** Resolve one export through the current exact TypeChecker, including aliases and star re-exports. */
export function resolveTypeScriptModuleExport(
  model: SourceProgramModel,
  entrypointPaths: readonly string[],
  exportName: string
): readonly TypeScriptModuleExportResolution[] | null {
  const generation = exactFactGenerationByModel.get(model);
  if (generation === undefined) return null;
  const pathBySourceFile = new Map<ts.SourceFile, string>([...generation.sourceFiles].map(
    ([repositoryPath, sourceFile]) => [sourceFile, repositoryPath] as const
  ));
  const declarationIdsByPathAndStart = new Map<string, string[]>();
  for (const declaration of model.declarations) {
    const key = `${declaration.path}\0${declaration.span.start}`;
    const ids = declarationIdsByPathAndStart.get(key);
    if (ids === undefined) declarationIdsByPathAndStart.set(key, [declaration.observationId]);
    else ids.push(declaration.observationId);
  }
  return Object.freeze([...new Set(entrypointPaths)].sort(compareCodeUnits).map((entrypointPath) => {
    const sourceFile = generation.sourceFiles.get(entrypointPath);
    if (sourceFile === undefined) return Object.freeze({
      status: 'unresolved' as const,
      entrypointPath,
      reason: 'entrypoint-source-unresolved' as const
    });
    if (((sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0) return Object.freeze({
      status: 'unresolved' as const,
      entrypointPath,
      reason: 'entrypoint-syntax-unresolved' as const
    });
    const moduleSymbol = generation.checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) return Object.freeze({
      status: 'unresolved' as const,
      entrypointPath,
      reason: 'entrypoint-module-symbol-unresolved' as const
    });
    const exportedSymbol = generation.checker.getExportsOfModule(moduleSymbol)
      .find((candidate) => candidate.getName() === exportName);
    if (exportedSymbol === undefined) {
      return Object.freeze({ status: 'absent' as const, entrypointPath });
    }
    let targetSymbol = exportedSymbol;
    const visitedAliases = new Set<ts.Symbol>();
    while ((targetSymbol.flags & ts.SymbolFlags.Alias) !== 0
        && !visitedAliases.has(targetSymbol)) {
      visitedAliases.add(targetSymbol);
      const resolved = generation.checker.getAliasedSymbol(targetSymbol);
      if (resolved === targetSymbol) break;
      targetSymbol = resolved;
    }
    const targetDeclarationObservationIds = new Set<string>();
    const targetPaths = new Set<string>();
    for (const node of targetSymbol.declarations ?? []) {
      const repositoryPath = pathBySourceFile.get(node.getSourceFile());
      if (repositoryPath === undefined) continue;
      targetPaths.add(repositoryPath);
      for (const observationId of declarationIdsByPathAndStart.get(
        `${repositoryPath}\0${node.getStart(node.getSourceFile(), false)}`
      ) ?? []) targetDeclarationObservationIds.add(observationId);
    }
    if ((targetSymbol.flags & ts.SymbolFlags.Value) === 0
        || targetDeclarationObservationIds.size === 0
        || targetPaths.size === 0) {
      return Object.freeze({
        status: 'unresolved' as const,
        entrypointPath,
        reason: 'export-target-unresolved' as const
      });
    }
    return Object.freeze({
      status: 'resolved' as const,
      entrypointPath
    });
  }));
}

/** One exact semantic generation owns both reusable facts and causal provenance. */
export function typeScriptExactFactGenerationReceipt(
  model: SourceProgramModel
): TypeScriptExactFactGenerationReceipt | null {
  const receipt = exactFactGenerationByModel.get(model);
  if (receipt === undefined) return null;
  const {
    apiClosure: _apiClosure,
    checker: _checker,
    renameAt: _renameAt,
    returnProvenances: _returnProvenances,
    sourceFiles: _sourceFiles,
    ...projection
  } = receipt;
  return Object.freeze(projection);
}

export function currentTypeScriptRequiredApiClosure(
  model: SourceProgramModel
): TypeScriptRequiredApiClosure | null {
  return exactFactGenerationByModel.get(model)?.apiClosure ?? null;
}

function typeScriptExactFactGenerationIdentity(
  input: PreparedTypeScriptModelInput
): Readonly<{
  semanticInputDigest: `sha256:${string}`;
  observationInputDigest: `sha256:${string}`;
}> {
  const sourceFacts = [...input.sourceFileIdentities.values()]
    .sort((left, right) => compareCodeUnits(left.file.path, right.file.path))
    .map(({ file, rawFileDigest, moduleDigest }) => Object.freeze({
      path: file.path,
      rawFileDigest,
      moduleDigest
    }));
  const semanticInputDigest = sha256(Object.freeze({
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    sourceFacts
  })) as `sha256:${string}`;
  return Object.freeze({
    semanticInputDigest,
    observationInputDigest: sha256(Object.freeze({
      semanticInputDigest,
      sourceRevision: input.sourceRevision,
      workspaceSnapshotIdentityDigest: input.repositoryCompilation?.identityDigest ?? null
    })) as `sha256:${string}`
  });
}

function issueTypeScriptExactFactGeneration(
  model: SourceProgramModel,
  input: PreparedTypeScriptModelInput,
  apiClosure: TypeScriptRequiredApiClosure,
  returnProvenances: readonly SourceProgramReturnProvenance[],
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  checker: ts.TypeChecker,
  renameAt: ExactTypeScriptProgram['renameAt']
): SourceProgramModel {
  assertTypeScriptRequiredApiClosure(apiClosure);
  const identity = typeScriptExactFactGenerationIdentity(input);
  const canonicalProvenances = Object.freeze([...returnProvenances]);
  const receipt = Object.freeze({
    ...identity,
    apiClosure,
    apiClosureDigest: apiClosure.closureDigest,
    checker,
    renameAt,
    provenanceDigest: sha256(canonicalProvenances) as `sha256:${string}`,
    returnProvenances: canonicalProvenances,
    sourceFiles
  });
  exactFactGenerationByModel.set(model, receipt);
  currentExactReturnProvenancesByModel.set(model, receipt.returnProvenances);
  return model;
}

function canonicalReturnProvenanceValues(
  values: readonly SourceProgramReturnValueProvenance[]
): ReturnProvenanceValues {
  const canonical = [...new Map(values.map((value) => [sha256(value), value] as const))
    .values()].sort((left, right) => compareCodeUnits(sha256(left), sha256(right)));
  return canonical.length <= MAX_RETURN_PROVENANCE_VALUES
    ? Object.freeze(canonical)
    : Object.freeze([OPAQUE_RETURN_PROVENANCE]);
}

function functionLikeForReturnProvenance(node: ts.Node): ts.FunctionLikeDeclaration | null {
  if (ts.isFunctionDeclaration(node)
      || ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)
      || ts.isConstructorDeclaration(node)
      || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node)) return node;
  if (ts.isVariableDeclaration(node)
      && node.initializer !== undefined
      && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) {
    return node.initializer;
  }
  return null;
}

function unwrapReturnProvenanceExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isFailOnlyReturnProvenanceGuard(statement: ts.Statement): boolean {
  if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false;
  const branch = statement.thenStatement;
  return ts.isThrowStatement(branch)
    || (ts.isBlock(branch) && branch.statements.length === 1
      && ts.isThrowStatement(branch.statements[0]!));
}

function compileSourceProgramReturnProvenance(input: Readonly<{
  checker: ts.TypeChecker;
  declaration: SourceProgramDeclaration;
  declarationNode: ts.Node;
  semanticDeclarationAt(node: ts.Node): SourceProgramDeclaration | null;
}>): SourceProgramReturnProvenance | null {
  const functionLike = functionLikeForReturnProvenance(input.declarationNode);
  if (functionLike === null) return null;
  const body = functionLike.body;
  if (body === undefined) {
    return Object.freeze({
      path: input.declaration.path,
      declarationObservationId: input.declaration.observationId,
      normalReturns: Object.freeze([OPAQUE_RETURN_PROVENANCE])
    });
  }

  const parameterBySymbol = new Map<ts.Symbol, number>();
  functionLike.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return;
    const symbol = input.checker.getSymbolAtLocation(parameter.name);
    if (symbol !== undefined) parameterBySymbol.set(symbol, index);
  });
  const symbolFor = (name: ts.Identifier): ts.Symbol | null =>
    input.checker.getSymbolAtLocation(name) ?? null;
  const activeConstSymbols = new Set<ts.Symbol>();
  const expressionValues = (
    rawExpression: ts.Expression
  ): ReturnProvenanceValues => {
    const expression = unwrapReturnProvenanceExpression(rawExpression);
    if (ts.isConditionalExpression(expression)) {
      return canonicalReturnProvenanceValues([
        ...expressionValues(expression.whenTrue),
        ...expressionValues(expression.whenFalse)
      ]);
    }
    if (ts.isStringLiteralLike(expression)
        || ts.isNumericLiteral(expression)
        || ts.isBigIntLiteral(expression)
        || expression.kind === ts.SyntaxKind.TrueKeyword
        || expression.kind === ts.SyntaxKind.FalseKeyword
        || expression.kind === ts.SyntaxKind.NullKeyword) {
      return Object.freeze([LITERAL_RETURN_PROVENANCE]);
    }
    if (ts.isIdentifier(expression)) {
      if (expression.text === 'undefined') return Object.freeze([LITERAL_RETURN_PROVENANCE]);
      const symbol = symbolFor(expression);
      if (symbol === null) return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      const parameterIndex = parameterBySymbol.get(symbol);
      if (parameterIndex !== undefined) {
        return Object.freeze([Object.freeze({ kind: 'parameter' as const, index: parameterIndex })]);
      }
      if (activeConstSymbols.has(symbol)) return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      const declarations = symbol.declarations ?? [];
      if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0])) {
        return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      }
      const declaration = declarations[0];
      const declarationList = declaration.parent;
      if (!ts.isVariableDeclarationList(declarationList)
          || (declarationList.flags & ts.NodeFlags.Const) === 0
          || declaration.initializer === undefined
          || declaration.getStart() >= expression.getStart()) {
        return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      }
      let owner: ts.Node | undefined = declaration;
      while (owner !== undefined && owner !== functionLike && !ts.isFunctionLike(owner)) {
        owner = owner.parent;
      }
      if (owner !== functionLike) return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      activeConstSymbols.add(symbol);
      const resolved = expressionValues(declaration.initializer);
      activeConstSymbols.delete(symbol);
      return resolved;
    }
    if (ts.isCallExpression(expression)) {
      if (expression.questionDotToken !== undefined || expression.arguments.some(ts.isSpreadElement)) {
        return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      }
      const callee = unwrapReturnProvenanceExpression(expression.expression);
      const targetNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      const target = input.semanticDeclarationAt(targetNode);
      if (target === null) return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      if (expression.arguments.length > MAX_RETURN_PROVENANCE_ARGUMENTS) {
        return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      }
      const callArguments = expression.arguments.map((argument) => {
        const values = expressionValues(argument).map((value) => (
          value.kind === 'call-result' ? OPAQUE_RETURN_PROVENANCE : value
        ));
        return values.length > 0 && values.length <= MAX_RETURN_PROVENANCE_ARGUMENT_VALUES
          ? Object.freeze(values)
          : Object.freeze([OPAQUE_RETURN_PROVENANCE]);
      });
      return Object.freeze([Object.freeze({
        kind: 'call-result' as const,
        targetObservationId: target.observationId,
        arguments: Object.freeze(callArguments)
      })]);
    }
    return Object.freeze([OPAQUE_RETURN_PROVENANCE]);
  };
  let normalReturns: ReturnProvenanceValues;
  if (!ts.isBlock(body)) {
    normalReturns = expressionValues(body);
  } else {
    const terminal = body.statements.at(-1);
    const prefix = body.statements.slice(0, -1);
    const prefixPreservesReturnProvenance = prefix.every((statement) => (
      isFailOnlyReturnProvenanceGuard(statement)
      || (ts.isVariableStatement(statement)
        && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
        && statement.declarationList.declarations.every((declaration) => (
          ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
        )))
    ));
    normalReturns = prefixPreservesReturnProvenance
      && terminal !== undefined && ts.isReturnStatement(terminal)
      ? terminal.expression === undefined
        ? Object.freeze([LITERAL_RETURN_PROVENANCE])
        : expressionValues(terminal.expression)
      : Object.freeze([OPAQUE_RETURN_PROVENANCE]);
  }
  return Object.freeze({
    path: input.declaration.path,
    declarationObservationId: input.declaration.observationId,
    normalReturns: canonicalReturnProvenanceValues(normalReturns)
  });
}

function sourceProgramFileSemantics(sourceFile: ts.SourceFile): Readonly<{
  readonly kind: SourceProgramFileSemanticKind;
  readonly observationClass: 'derived' | 'unknown';
}> {
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return Object.freeze({ kind: 'unknown', observationClass: 'unknown' });
  }
  const statements = sourceFile.statements;
  if (statements.length > 0 && statements.every((statement) => (
    ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
  ))) {
    return Object.freeze({ kind: 'pure-reexport', observationClass: 'derived' });
  }
  const declarationOnly = statements.every((statement) => (
    ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement)
    || (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true)
    || (ts.isExportDeclaration(statement) && statement.isTypeOnly)
    || (ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.DeclareKeyword) ?? false))
  ));
  return Object.freeze({
    kind: declarationOnly ? 'declaration-owner' : 'executable',
    observationClass: 'derived'
  });
}

function canonicalTypeScriptModel(input: Readonly<{
  sourceRevision: string;
  fileInputs: ReadonlyMap<string, SourceProgramFileInput>;
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
  semanticDependencyScopes: ReadonlyMap<
    string,
    TypeScriptSourceProgramFactShard['semanticDependencyScope']
  >;
  moduleMembership: RepositoryModuleMembership;
  files: readonly SourceProgramFile[];
  declarations: readonly SourceProgramDeclaration[];
  references: readonly SourceProgramReference[];
  returnProvenances: readonly SourceProgramReturnProvenance[];
  literals: readonly SourceProgramLiteral[];
  entrypoints: readonly SourceProgramEntrypoint[];
  capabilities: readonly SourceProgramCapabilityInvocation[];
  unknowns: readonly SourceProgramUnknown[];
  operation: SourceProgramCompilationOperation;
}>): SourceProgramModel {
  const groupByPath = <Value extends { readonly path: string }>(
    values: readonly Value[]
  ): ReadonlyMap<string, readonly Value[]> => {
    const groups = new Map<string, Value[]>();
    for (const value of values) {
      const group = groups.get(value.path);
      if (group === undefined) groups.set(value.path, [value]);
      else group.push(value);
    }
    return groups;
  };
  const declarationsByPath = groupByPath(input.declarations);
  const referencesByPath = groupByPath(input.references);
  const returnProvenancesByPath = groupByPath(input.returnProvenances);
  const literalsByPath = groupByPath(input.literals);
  const entrypointsByPath = groupByPath(input.entrypoints);
  const capabilitiesByPath = groupByPath(input.capabilities);
  const unknownsByPath = groupByPath(input.unknowns);
  sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly', 'start');
  const shards = input.files.map((file) => {
    sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly');
    const fileInput = input.fileInputs.get(file.path);
    const fileIdentity = input.sourceFileIdentities.get(file.path);
    const semanticDependencyScope = input.semanticDependencyScopes.get(file.path);
    if (fileInput === undefined || fileIdentity === undefined
        || semanticDependencyScope === undefined) {
      throw new Error(`TypeScript Source Program fact shard lacks raw source: ${file.path}`);
    }
    return compileTypeScriptSourceProgramFactShard({
      compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
      providerRevision: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION,
      rawFileDigest: fileIdentity.rawFileDigest,
      moduleDigest: fileIdentity.moduleDigest,
      semanticDependencyScope,
      facts: Object.freeze({
        path: file.path,
        file,
        declarations: declarationsByPath.get(file.path) ?? Object.freeze([]),
        references: referencesByPath.get(file.path) ?? Object.freeze([]),
        returnProvenances: returnProvenancesByPath.get(file.path) ?? Object.freeze([]),
        literals: literalsByPath.get(file.path) ?? Object.freeze([]),
        entrypoints: entrypointsByPath.get(file.path) ?? Object.freeze([]),
        capabilities: capabilitiesByPath.get(file.path) ?? Object.freeze([]),
        unknowns: unknownsByPath.get(file.path) ?? Object.freeze([])
      })
    });
  });
  const model = assembleTypeScriptModel({
    sourceRevision: input.sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, Object.freeze(shards));
  sourceProgramCompilationCheckpoint(input.operation, 'fact-shard-assembly', 'complete');
  return model;
}

function assembleCanonicalTypeScriptModel(
  sourceRevision: string,
  shards: readonly TypeScriptSourceProgramFactShard[]
): SourceProgramModel {
  const model = assembleTypeScriptModel({
    sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, shards);
  return model;
}

function typeScriptSemanticDependencyScopeFromSourceFile(
  repositoryPathValue: string,
  sourceFile: ts.SourceFile
): TypeScriptSourceProgramFactShard['semanticDependencyScope'] {
  if (/\.d\.[cm]?ts$/iu.test(repositoryPathValue)) return 'global-or-ambient';
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) return 'unknown';
  if (!ts.isExternalModule(sourceFile)) return 'global-or-ambient';
  let globalOrAmbient = false;
  const visit = (node: ts.Node): void => {
    if (globalOrAmbient) return;
    if (ts.isModuleDeclaration(node)) {
      const declared = ts.canHaveModifiers(node)
        && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.DeclareKeyword) ?? false);
      if ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0
          || (declared && (ts.isStringLiteral(node.name) || node.name.text === 'global'))) {
        globalOrAmbient = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return globalOrAmbient ? 'global-or-ambient' : 'module-scoped';
}

function typeScriptSemanticDependencyScope(
  file: SourceProgramFileInput
): TypeScriptSourceProgramFactShard['semanticDependencyScope'] {
  if (/\.d\.[cm]?ts$/iu.test(file.path)) return 'global-or-ambient';
  typeScriptSourceProgramPerformance.semanticScopeParseOperations += 1;
  return typeScriptSemanticDependencyScopeFromSourceFile(
    file.path,
    ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      sourceProgramScriptKind(file.path)
    )
  );
}

function compileExactFactGenerationForCachedModel(
  model: SourceProgramModel,
  input: PreparedTypeScriptModelInput
): ExactFactGeneration {
  const filesByPath = new Map([...input.sourceFileIdentities].map(([repositoryPathValue, identity]) => (
    [repositoryPathValue, identity.file] as const
  )));
  const exact = compileExactTypeScriptProgram(
    filesByPath,
    input.sourceFileIdentities,
    input.operation
  );
  const apiClosure = compileTypeScriptRequiredApiClosure(
    exact,
    input.sourceRevision,
    input.operation
  );
  const expectedByPathAndStart = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of model.declarations) {
    const key = `${declaration.path}\0${declaration.span.start}`;
    const expected = expectedByPathAndStart.get(key);
    if (expected === undefined) expectedByPathAndStart.set(key, [declaration]);
    else expected.push(declaration);
  }
  const declarationByNode = new Map<ts.Node, SourceProgramDeclaration>();
  const declarationNodeByObservationId = new Map<string, ts.Node>();
  sourceProgramCompilationCheckpoint(input.operation, 'declaration-index', 'start');
  for (const sourceFile of exact.sourceFiles) {
    sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
    const sourcePath = exact.repositoryPath(sourceFile);
    const sourceSurface = sourceProgramSurfaceForPath(sourcePath);
    let visitedNodes = 0;
    const visit = (node: ts.Node): void => {
      if ((visitedNodes++ & 1023) === 0) {
        sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
      }
      const start = node.getStart(sourceFile, false);
      const expected = expectedByPathAndStart.get(`${sourcePath}\0${start}`) ?? [];
      for (const declaration of expected) {
        // Aliased re-exports are declarations of the ExportSpecifier, while
        // their stable public span is deliberately the exported name token.
        // Rebind that token to its semantic declaration node without widening
        // any other child token into a declaration candidate.
        const declarationNode = node.parent !== undefined && ts.isExportSpecifier(node.parent)
          && node.parent.name === node
          ? node.parent
          : node;
        const span = spanFor(sourceFile, node);
        const name = declarationName(declarationNode) ?? (
          ts.isExportSpecifier(declarationNode)
            ? declarationNode.name.text
            : sourceSurface === 'test' && ts.isFunctionLike(declarationNode)
              ? executionScopeName(span)
              : null
        );
        if (name !== declaration.name || ts.SyntaxKind[declarationNode.kind] !== declaration.kind) continue;
        const declarationDigest = sha256({
          kind: ts.SyntaxKind[declarationNode.kind],
          name,
          source: semanticDeclarationText(sourceFile, declarationNode)
        });
        if (span.end !== declaration.span.end
            || declarationDigest !== declaration.declarationDigest
            || sha256({ declarationDigest, path: sourcePath, start }) !== declaration.observationId) {
          continue;
        }
        if (declarationNodeByObservationId.has(declaration.observationId)) {
          throw new Error(`Cached TypeScript declaration is ambiguous: ${declaration.observationId}`);
        }
        declarationByNode.set(declarationNode, declaration);
        declarationNodeByObservationId.set(declaration.observationId, declarationNode);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  if (declarationNodeByObservationId.size !== model.declarations.length) {
    throw new Error('Cached TypeScript declarations do not match the current exact Program');
  }
  sourceProgramCompilationCheckpoint(input.operation, 'declaration-index', 'complete');

  const declarationBySymbol = new Map<ts.Symbol, SourceProgramDeclaration | null>();
  const semanticDeclarationAt = (node: ts.Node): SourceProgramDeclaration | null => {
    let symbol = exact.checker.getSymbolAtLocation(node);
    if (symbol === undefined
        && ts.isIdentifier(node)
        && ts.isPropertyAccessExpression(node.parent)
        && node.parent.name === node) {
      symbol = exact.checker.getTypeAtLocation(node.parent.expression).getProperty(node.text);
    }
    if (symbol === undefined) return null;
    const initialSymbol = symbol;
    const initialCached = declarationBySymbol.get(initialSymbol);
    if (initialCached !== undefined || declarationBySymbol.has(initialSymbol)) {
      return initialCached ?? null;
    }
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = exact.checker.getAliasedSymbol(symbol);
    const resolvedCached = declarationBySymbol.get(symbol);
    if (resolvedCached !== undefined || declarationBySymbol.has(symbol)) {
      declarationBySymbol.set(initialSymbol, resolvedCached ?? null);
      return resolvedCached ?? null;
    }
    const candidates = new Map<string, SourceProgramDeclaration>();
    for (const nodeDeclaration of symbol.declarations ?? []) {
      const declaration = declarationByNode.get(nodeDeclaration);
      if (declaration !== undefined) candidates.set(declaration.observationId, declaration);
    }
    const declaration = candidates.size === 1 ? candidates.values().next().value ?? null : null;
    declarationBySymbol.set(symbol, declaration);
    declarationBySymbol.set(initialSymbol, declaration);
    return declaration;
  };
  const returnProvenances: SourceProgramReturnProvenance[] = [];
  sourceProgramCompilationCheckpoint(input.operation, 'return-provenance', 'start');
  for (const declaration of model.declarations) {
    sourceProgramCompilationCheckpoint(input.operation, 'return-provenance');
    const declarationNode = declarationNodeByObservationId.get(declaration.observationId)!;
    const provenance = compileSourceProgramReturnProvenance({
      checker: exact.checker,
      declaration,
      declarationNode,
      semanticDeclarationAt
    });
    if (provenance !== null) returnProvenances.push(provenance);
  }
  sourceProgramCompilationCheckpoint(input.operation, 'return-provenance', 'complete');
  const sourceFiles = new Map(exact.sourceFiles.map((sourceFile) => [
    exact.repositoryPath(sourceFile),
    sourceFile
  ] as const));
  issueTypeScriptExactFactGeneration(
    model,
    input,
    apiClosure,
    returnProvenances,
    sourceFiles,
    exact.checker,
    exact.renameAt
  );
  return exactFactGenerationByModel.get(model)!;
}

function bindCurrentExactReturnProvenances(
  model: SourceProgramModel,
  input: PreparedTypeScriptModelInput,
  provenanceSource: SourceProgramModel = model
): SourceProgramModel {
  const sourceGeneration = exactFactGenerationByModel.get(provenanceSource);
  if (sourceGeneration !== undefined
      && sourceGeneration.semanticInputDigest
        === typeScriptExactFactGenerationIdentity(input).semanticInputDigest) {
    return issueTypeScriptExactFactGeneration(
      model,
      input,
      sourceGeneration.apiClosure,
      sourceGeneration.returnProvenances,
      sourceGeneration.sourceFiles,
      sourceGeneration.checker,
      sourceGeneration.renameAt
    );
  }
  compileExactFactGenerationForCachedModel(model, input);
  return model;
}

function assertReusableTypeScriptState(
  state: TypeScriptIncrementalState,
  compilerRevision: string
): boolean {
  if (!issuedTypeScriptIncrementalStates.has(state)
      || state.providerRevision !== compilerRevision
      || state.model.sourceRevision !== state.sourceRevision
      || !Array.isArray(state.factShards)
      || !/^sha256:[0-9a-f]{64}$/u.test(state.moduleGraphDigest)) return false;
  return /^sha256:[0-9a-f]{64}$/u.test(state.model.modelDigest);
}

function buildIncrementalState(
  input: PreparedTypeScriptModelInput,
  model: SourceProgramModel,
  reverseConsumers: Readonly<Record<string, readonly string[]>>,
  compilerRevision: string,
  moduleGraphDigest: `sha256:${string}` = sha256(reverseConsumers) as `sha256:${string}`,
  previousGeneration?: Readonly<{
    fileDigests: Readonly<Record<string, string>>;
    moduleDigests: Readonly<Record<string, string>>;
  }>
): TypeScriptIncrementalState {
  const factShards = factShardsByModel.get(model);
  if (factShards === undefined) {
    throw new Error('TypeScript Source Program incremental state requires canonical fact shards');
  }
  const orderedIdentities = [...input.sourceFileIdentities.values()]
    .sort((left, right) => compareCodeUnits(left.file.path, right.file.path));
  const fileDigests = previousGeneration?.fileDigests ?? Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file, rawFileDigest }) => [file.path, rawFileDigest])
  ));
  const semanticSourceDigests = Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file }) => [
      file.path,
      rawSha256(semanticSourceText(file.source)) as `sha256:${string}`
    ])
  ));
  const moduleDigests = previousGeneration?.moduleDigests ?? Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file, moduleDigest }) => [file.path, moduleDigest])
  ));
  const semanticDependencyScopes = Object.freeze(Object.fromEntries(
    factShards.map((shard) => [shard.path, shard.semanticDependencyScope])
  ));
  const state = Object.freeze({
    [typeScriptIncrementalStateBrand]: true as const,
    providerRevision: compilerRevision,
    sourceRevision: input.sourceRevision,
    fileDigests,
    semanticSourceDigests,
    moduleDigests,
    semanticDependencyScopes,
    moduleGraphDigest,
    reverseConsumers,
    factShards,
    model
  });
  issuedTypeScriptIncrementalStates.add(state);
  return state;
}

/**
 * Reconstitute a reusable state from one validated immutable fact pack. The
 * physical store supplies bytes only; this TypeScript owner rebinds the facts
 * to the current compilation and signs the process-local incremental state.
 */
export function adoptTypeScriptFactShards(
  input: TypeScriptModelInput,
  shards: readonly TypeScriptSourceProgramFactShard[],
  repositoryCompilation: SourceProgramCompilation,
  generation?: Readonly<{ moduleGraphDigest: `sha256:${string}` }>
): TypeScriptIncrementalState {
  const preparedInput = prepareTypeScriptSourceProgramInput({
    ...input,
    repositoryCompilation
  });
  const graph = repositoryCompilation.moduleGraph;
  // A predecessor generation intentionally has a different file census. Its
  // immutable shards seed the incremental compiler, which compares their
  // content/module digests with the current snapshot and recompiles the exact
  // added, removed, or changed reverse-consumer closure. Requiring equal path
  // sets here would turn the valid predecessor fast path into a hard failure.
  const consumersByPath = new Map<string, Set<string>>();
  const addConsumer = (target: string, consumer: string): void => {
    const consumers = consumersByPath.get(target) ?? new Set<string>();
    consumers.add(consumer);
    consumersByPath.set(target, consumers);
  };
  for (const repositoryPathValue of graph.files) {
    typeScriptSourceProgramPerformance.dependencyAdjacencyLookups += 1;
    for (const consumer of graph.directConsumers(repositoryPathValue)) {
      addConsumer(repositoryPathValue, consumer);
    }
  }
  for (const shard of shards) {
    for (const reference of shard.references) {
      if (reference.targetPath !== null) addConsumer(reference.targetPath, reference.path);
    }
  }
  const reverseConsumers = Object.freeze(Object.fromEntries(
    [...consumersByPath]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([repositoryPathValue, consumers]) => [
        repositoryPathValue,
        Object.freeze([...consumers].sort(compareCodeUnits))
      ])
  ));
  const model = bindTypeScriptModelToRepositoryCompilation(
    assembleCanonicalTypeScriptModel(input.sourceRevision, shards),
    repositoryCompilation
  );
  return buildIncrementalState(
    preparedInput,
    model,
    reverseConsumers,
    TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    generation?.moduleGraphDigest ?? sha256(reverseConsumers) as `sha256:${string}`,
    generation === undefined
      ? undefined
      : Object.freeze({
          fileDigests: Object.freeze(Object.fromEntries(
            shards.map((shard) => [shard.path, shard.rawFileDigest])
          )),
          moduleDigests: Object.freeze(Object.fromEntries(
            shards.map((shard) => [shard.path, shard.moduleDigest])
          ))
        })
  );
}

/**
 * Recompile only the exact reverse-consumer closure affected by changed file,
 * import-resolution or module-provider facts. The dependency closure is still
 * supplied to the compiler so named/star re-exports retain full semantics.
 */
function compileTypeScriptModelIncrementalInternal(
  rawInput: TypeScriptModelInternalInput,
  previous: TypeScriptIncrementalState | null
): TypeScriptIncrementalResult {
  const input = prepareTypeScriptSourceProgramInput(rawInput);
  const currentFiles = [...input.sourceFileIdentities.values()]
    .map(({ file }) => file)
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const currentFileByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
  const currentPaths = Object.freeze(currentFiles.map(({ path: repositoryPathValue }) => repositoryPathValue));
  const compilerRevision = TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION;
  const reusableState = previous !== null
    && assertReusableTypeScriptState(previous, compilerRevision)
    ? previous
    : null;
  let changed: readonly string[] | null = null;
  if (reusableState !== null) {
    const allPaths = new Set([...Object.keys(reusableState.fileDigests), ...currentPaths]);
    changed = Object.freeze([...allPaths].filter((repositoryPathValue) => (
      reusableState.fileDigests[repositoryPathValue]
        !== input.sourceFileIdentities.get(repositoryPathValue)?.rawFileDigest
      || reusableState.moduleDigests[repositoryPathValue]
        !== input.sourceFileIdentities.get(repositoryPathValue)?.moduleDigest
    )));
    if (changed.length === 0) {
      if (input.sourceRevision === reusableState.sourceRevision
          && (input.repositoryCompilation === undefined
            || workspaceSnapshotIdentityForTypeScriptModel(reusableState.model)
              === input.repositoryCompilation.identityDigest)) {
        bindCurrentExactReturnProvenances(reusableState.model, input);
        return Object.freeze({
          mode: 'exact',
          invalidatedPaths: Object.freeze([]),
          model: reusableState.model,
          state: reusableState
        });
      }
      const model = bindCurrentExactReturnProvenances(
        bindTypeScriptModelToRepositoryCompilation(
          assembleCanonicalTypeScriptModel(input.sourceRevision, reusableState.factShards),
          input.repositoryCompilation
        ),
        input,
        reusableState.model
      );
      return Object.freeze({
        mode: 'exact',
        invalidatedPaths: Object.freeze([]),
        model,
        state: buildIncrementalState(
          input,
          model,
          reusableState.reverseConsumers,
          compilerRevision,
          input.repositoryCompilation?.moduleGraphDigest
            ?? sha256(reusableState.reverseConsumers) as `sha256:${string}`
        )
      });
    }
  }
  const currentSources = new Map(currentFiles.map(({ path: repositoryPathValue, source }) =>
    [repositoryPathValue, source] as const));
  const graph = input.repositoryCompilation?.moduleGraph ?? compileRepositoryModuleGraph({
    files: currentPaths,
    readSource: (repositoryPathValue) => currentSources.get(repositoryPathValue) ?? null
  });
  const reverseConsumers = Object.freeze(Object.fromEntries(
    [...graph.files]
      .sort(compareCodeUnits)
      .map((repositoryPathValue) => {
        typeScriptSourceProgramPerformance.dependencyAdjacencyLookups += 1;
        return [
        repositoryPathValue,
        Object.freeze([...graph.directConsumers(repositoryPathValue)].sort(compareCodeUnits))
        ] as const;
      })
      .filter(([, consumers]) => consumers.length > 0)
  ));
  const compileFull = (): TypeScriptIncrementalResult => {
    const model = compileTypeScriptModelInternal(input);
    return Object.freeze({
      mode: 'full',
      invalidatedPaths: currentPaths,
      model,
      state: buildIncrementalState(
        input,
        model,
        reverseConsumers,
        compilerRevision,
        input.repositoryCompilation?.moduleGraphDigest
          ?? sha256(reverseConsumers) as `sha256:${string}`
      )
    });
  };
  if (reusableState === null || changed === null) return compileFull();
  const fileSetChanged = Object.keys(reusableState.fileDigests).length !== currentPaths.length
    || currentPaths.some((repositoryPathValue) => reusableState.fileDigests[repositoryPathValue] === undefined);
  const currentModuleGraphDigest = input.repositoryCompilation?.moduleGraphDigest
    ?? sha256(reverseConsumers) as `sha256:${string}`;
  const graphChanged = reusableState.moduleGraphDigest !== currentModuleGraphDigest;
  if (fileSetChanged || graphChanged) return compileFull();
  const currentSemanticDependencyScopes = new Map(changed.map((repositoryPathValue) => {
    const file = currentFileByPath.get(repositoryPathValue);
    return [
      repositoryPathValue,
      file === undefined ? undefined : typeScriptSemanticDependencyScope(file)
    ] as const;
  }));
  const globallyCoupledChange = changed.some((repositoryPathValue) => (
    reusableState.semanticDependencyScopes[repositoryPathValue] !== 'module-scoped'
    || currentSemanticDependencyScopes.get(repositoryPathValue) !== 'module-scoped'
  ));
  if (globallyCoupledChange) return compileFull();

  const invalidated = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const changedPath = queue.shift()!;
    const consumers = new Set([
      ...(reusableState.reverseConsumers[changedPath] ?? []),
      ...(reverseConsumers[changedPath] ?? [])
    ]);
    for (const consumer of consumers) {
      if (invalidated.has(consumer)) continue;
      invalidated.add(consumer);
      queue.push(consumer);
    }
  }
  const invalidatedCurrent = new Set([...invalidated].filter((repositoryPathValue) =>
    currentFileByPath.has(repositoryPathValue)));
  if (invalidatedCurrent.size > Math.max(64, Math.floor(currentPaths.length * 0.6))) return compileFull();

  const compilePaths = new Set(invalidatedCurrent);
  const dependencyQueue = [...invalidatedCurrent];
  while (dependencyQueue.length > 0) {
    const consumer = dependencyQueue.shift()!;
    typeScriptSourceProgramPerformance.dependencyAdjacencyLookups += 1;
    for (const dependency of graph.directDependencies(consumer)) {
      if (!currentFileByPath.has(dependency) || compilePaths.has(dependency)) continue;
      compilePaths.add(dependency);
      dependencyQueue.push(dependency);
    }
  }
  const regeneratedSourceFileIdentities = new Map(
    [...input.sourceFileIdentities].filter(([repositoryPathValue]) => (
      compilePaths.has(repositoryPathValue)
    ))
  );
  const regenerated = compileTypeScriptModelInternal(
    issuePreparedTypeScriptSourceProgramInput({
      sourceRevision: input.sourceRevision,
      files: currentFiles.filter(({ path: repositoryPathValue }) => compilePaths.has(repositoryPathValue)),
      moduleMembership: input.moduleMembership,
      operation: input.operation
    }, regeneratedSourceFileIdentities)
  );
  const reusablePath = (repositoryPathValue: string): boolean =>
    currentFileByPath.has(repositoryPathValue) && !invalidated.has(repositoryPathValue);
  const regeneratedPath = (repositoryPathValue: string): boolean => invalidatedCurrent.has(repositoryPathValue);
  const regeneratedShards = factShardsByModel.get(regenerated);
  if (regeneratedShards === undefined) {
    throw new Error('TypeScript Source Program regeneration did not produce fact shards');
  }
  const model = bindCurrentExactReturnProvenances(
    bindTypeScriptModelToRepositoryCompilation(
      assembleCanonicalTypeScriptModel(
        input.sourceRevision,
        [
          ...reusableState.factShards.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
          ...regeneratedShards.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
        ]
      ),
      input.repositoryCompilation
    ),
    input
  );
  return Object.freeze({
    mode: 'incremental',
    invalidatedPaths: Object.freeze([...invalidatedCurrent].sort(compareCodeUnits)),
    model,
    state: buildIncrementalState(
      input,
      model,
      reverseConsumers,
      compilerRevision,
      input.repositoryCompilation?.moduleGraphDigest
        ?? sha256(reverseConsumers) as `sha256:${string}`
    )
  });
}

export function compileTypeScriptModelIncremental(
  input: TypeScriptModelInput,
  previous: TypeScriptIncrementalState | null
): TypeScriptIncrementalResult {
  return compileTypeScriptModelIncrementalInternal(input, previous);
}

export function compileTypeScriptModelIncrementalWithCompilation(
  input: TypeScriptModelInput,
  previous: TypeScriptIncrementalState | null,
  repositoryCompilation: SourceProgramCompilation
): TypeScriptIncrementalResult {
  return compileTypeScriptModelIncrementalInternal({
    ...input,
    repositoryCompilation
  }, previous);
}

function compileTypeScriptModelInternal(
  rawInput: TypeScriptModelInternalInput
): SourceProgramModel {
  const input = prepareTypeScriptSourceProgramInput(rawInput);
  if (input.sourceRevision.trim().length === 0) {
    throw new Error('Source Program Model requires a non-empty exact source revision');
  }
  const filesByPath = new Map([...input.sourceFileIdentities].map(([repositoryPathValue, identity]) => (
    [repositoryPathValue, identity.file] as const
  )));
  const semanticProgram = compileExactTypeScriptProgram(
    filesByPath,
    input.sourceFileIdentities,
    input.operation
  );
  const typeScriptApiClosure = compileTypeScriptRequiredApiClosure(
    semanticProgram,
    input.sourceRevision,
    input.operation
  );
  const { checker, sourceFiles } = semanticProgram;
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [
    semanticProgram.repositoryPath(sourceFile),
    sourceFile
  ] as const));
  const semanticDependencyScopes = new Map<string, TypeScriptSourceProgramFactShard['semanticDependencyScope']>();
  const files: SourceProgramFile[] = [];
  const declarations: SourceProgramDeclaration[] = [];
  const references: SourceProgramReference[] = [];
  const returnProvenances: SourceProgramReturnProvenance[] = [];
  const literals: SourceProgramLiteral[] = [];
  const entrypoints: SourceProgramEntrypoint[] = [];
  const capabilities: SourceProgramCapabilityInvocation[] = [];
  const unknowns: SourceProgramUnknown[] = [];
  const declarationByNode = new Map<ts.Node, SourceProgramDeclaration>();
  const declarationNodeByObservationId = new Map<string, ts.Node>();

  sourceProgramCompilationCheckpoint(input.operation, 'file-semantics', 'start');
  for (const [repositoryPathValue, file] of filesByPath) {
    sourceProgramCompilationCheckpoint(input.operation, 'file-semantics');
    const sourceFile = sourceFileByPath.get(repositoryPathValue);
    const semantics = sourceFile === undefined
      ? Object.freeze({ kind: 'unknown' as const, observationClass: 'unknown' as const })
      : sourceProgramFileSemantics(sourceFile);
    semanticDependencyScopes.set(
      repositoryPathValue,
      sourceFile === undefined
        ? 'unknown'
        : typeScriptSemanticDependencyScopeFromSourceFile(repositoryPathValue, sourceFile)
    );
    files.push(Object.freeze({
      path: repositoryPathValue,
      contentDigest: file.contentDigest,
      moduleId: input.moduleMembership.moduleForPath(repositoryPathValue)?.moduleId ?? null,
      surface: sourceProgramSurfaceForPath(repositoryPathValue),
      semanticKind: semantics.kind,
      semanticObservationClass: semantics.observationClass
    }));
  }
  sourceProgramCompilationCheckpoint(input.operation, 'file-semantics', 'complete');

  sourceProgramCompilationCheckpoint(input.operation, 'declaration-index', 'start');
  // A semantic reference can resolve only to an addressable declaration in
  // the same source file or through an explicit import/re-export alias. Keep
  // the candidate names scoped to their source file: a common top-level name
  // such as `input` in one module must not force TypeChecker symbol analysis
  // for every unrelated local `input` in the repository.
  const semanticDeclarationCandidateNamesBySourcePath = new Map<string, Set<string>>();
  const globalScriptDeclarationCandidateNames = new Set<string>();
  for (const sourceFile of sourceFiles) {
    sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
    const sourcePath = semanticProgram.repositoryPath(sourceFile);
    const sourceSurface = sourceProgramSurfaceForPath(sourcePath);
    if (sourceSurface !== 'production' && sourceSurface !== 'test') continue;
    const semanticDeclarationCandidateNames = new Set<string>();
    semanticDeclarationCandidateNamesBySourcePath.set(sourcePath, semanticDeclarationCandidateNames);
    let visitedDeclarationNodes = 0;
    const visit = (node: ts.Node): void => {
      if ((visitedDeclarationNodes++ & 1023) === 0) {
        sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
      }
      if (ts.isImportClause(node) && node.name !== undefined) {
        semanticDeclarationCandidateNames.add(node.name.text);
      } else if (ts.isImportSpecifier(node)) {
        semanticDeclarationCandidateNames.add(node.name.text);
        if (node.propertyName !== undefined) {
          semanticDeclarationCandidateNames.add(node.propertyName.text);
        }
      } else if (ts.isNamespaceImport(node)) {
        semanticDeclarationCandidateNames.add(node.name.text);
      } else if (ts.isExportSpecifier(node)) {
        semanticDeclarationCandidateNames.add(node.name.text);
        if (node.propertyName !== undefined) {
          semanticDeclarationCandidateNames.add(node.propertyName.text);
        }
      }
      const declarationSpan = spanFor(sourceFile, node);
      const name = declarationName(node) ?? (
        sourceSurface === 'test' && ts.isFunctionLike(node)
          ? executionScopeName(declarationSpan)
          : null
      );
      if (name !== null) {
        let topLevel: ts.Node | undefined = node;
        while (topLevel && !ts.isSourceFile(topLevel.parent)) topLevel = topLevel.parent;
        const independentlyAddressable = sourceSurface === 'test'
          ? ts.isFunctionLike(node)
            || topLevel === node
            || (ts.isVariableDeclaration(node) && topLevel !== undefined && ts.isVariableStatement(topLevel))
          : topLevel === node
            || (ts.isVariableDeclaration(node) && topLevel !== undefined && ts.isVariableStatement(topLevel));
        if (!independentlyAddressable) {
          ts.forEachChild(node, visit);
          return;
        }
        const span = declarationSpan;
        const declarationDigest = sha256({
          kind: ts.SyntaxKind[node.kind],
          name,
          source: semanticDeclarationText(sourceFile, node)
        });
        const declaration: SourceProgramDeclaration = Object.freeze({
          observationId: sha256({
            declarationDigest,
            path: sourcePath,
            start: span.start
          }),
          declarationDigest,
          path: sourcePath,
          moduleId: input.moduleMembership.moduleForPath(sourcePath)?.moduleId ?? null,
          name,
          kind: ts.SyntaxKind[node.kind],
          exported: independentlyAddressable
              && topLevel !== undefined
              && ts.canHaveModifiers(topLevel)
              && (ts.getModifiers(topLevel)?.some(({ kind }) =>
                kind === ts.SyntaxKind.ExportKeyword || kind === ts.SyntaxKind.DefaultKeyword
              ) ?? false),
          span
        });
        semanticDeclarationCandidateNames.add(name);
        if (!ts.isExternalModule(sourceFile)) globalScriptDeclarationCandidateNames.add(name);
        declarations.push(declaration);
        declarationByNode.set(node, declaration);
        declarationNodeByObservationId.set(declaration.observationId, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)
        || !statement.moduleSpecifier
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.exportClause
        || !ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        if (element.propertyName === undefined || element.propertyName.text === element.name.text) continue;
        const name = element.name.text;
        const span = spanFor(sourceFile, element.name);
        const declarationDigest = sha256({
          kind: ts.SyntaxKind[element.kind],
          name,
          source: semanticDeclarationText(sourceFile, element)
        });
        const declaration: SourceProgramDeclaration = Object.freeze({
          observationId: sha256({
            declarationDigest,
            path: sourcePath,
            start: span.start
          }),
          declarationDigest,
          path: sourcePath,
          moduleId: input.moduleMembership.moduleForPath(sourcePath)?.moduleId ?? null,
          name,
          kind: ts.SyntaxKind[element.kind],
          exported: true,
          span
        });
        semanticDeclarationCandidateNames.add(name);
        if (!ts.isExternalModule(sourceFile)) globalScriptDeclarationCandidateNames.add(name);
        declarations.push(declaration);
        declarationByNode.set(element, declaration);
        declarationNodeByObservationId.set(declaration.observationId, element);
      }
    }
  }
  sourceProgramCompilationCheckpoint(input.operation, 'declaration-index', 'complete');

  const declarationByPathAndName = new Map<
    string,
    Map<string, SourceProgramDeclaration | null>
  >();
  for (const declaration of declarations) {
    let declarationsByName = declarationByPathAndName.get(declaration.path);
    if (declarationsByName === undefined) {
      declarationsByName = new Map();
      declarationByPathAndName.set(declaration.path, declarationsByName);
    }
    if (!declarationsByName.has(declaration.name)) {
      declarationsByName.set(declaration.name, declaration);
    } else if (declarationsByName.get(declaration.name)?.observationId !== declaration.observationId) {
      // Match the TypeChecker path: merged/overloaded symbols whose indexed
      // declarations are not unique are not assigned one arbitrary target.
      declarationsByName.set(declaration.name, null);
    }
  }
  const directDeclarationAt = (
    sourcePath: string | null,
    name: string
  ): SourceProgramDeclaration | null => sourcePath === null
    ? null
    : declarationByPathAndName.get(sourcePath)?.get(name) ?? null;

  const declarationBySymbol = new Map<ts.Symbol, SourceProgramDeclaration | null>();
  const declarationBySemanticNode = new WeakMap<ts.Node, SourceProgramDeclaration | null>();
  const semanticDeclarationAt = (
    node: ts.Node,
    forceLookup = false
  ): SourceProgramDeclaration | null => {
    const nodeCached = declarationBySemanticNode.get(node);
    if (nodeCached !== undefined || declarationBySemanticNode.has(node)) return nodeCached ?? null;
    const nodeSourceFile = node.getSourceFile();
    const localCandidate = ts.isIdentifier(node)
      && (semanticDeclarationCandidateNamesBySourcePath
        .get(semanticProgram.repositoryPath(nodeSourceFile))?.has(node.text) ?? false);
    const globalScriptCandidate = ts.isIdentifier(node)
      && !ts.isExternalModule(nodeSourceFile)
      && globalScriptDeclarationCandidateNames.has(node.text);
    if (ts.isIdentifier(node) && !forceLookup && !localCandidate && !globalScriptCandidate) {
      typeScriptSourceProgramPerformance.semanticSymbolLookupSkippedIdentifiers += 1;
      declarationBySemanticNode.set(node, null);
      return null;
    }
    typeScriptSourceProgramPerformance.semanticSymbolLookupOperations += 1;
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined
      && ts.isIdentifier(node)
      && ts.isPropertyAccessExpression(node.parent)
      && node.parent.name === node) {
      symbol = checker.getTypeAtLocation(node.parent.expression).getProperty(node.text);
    }
    if (symbol === undefined) {
      declarationBySemanticNode.set(node, null);
      return null;
    }
    const cached = declarationBySymbol.get(symbol);
    if (cached !== undefined || declarationBySymbol.has(symbol)) {
      declarationBySemanticNode.set(node, cached ?? null);
      return cached ?? null;
    }
    const unresolvedSymbol = symbol;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const resolvedCached = declarationBySymbol.get(symbol);
    if (resolvedCached !== undefined || declarationBySymbol.has(symbol)) {
      declarationBySymbol.set(unresolvedSymbol, resolvedCached ?? null);
      declarationBySemanticNode.set(node, resolvedCached ?? null);
      return resolvedCached ?? null;
    }
    const candidates = new Map<string, SourceProgramDeclaration>();
    for (const nodeDeclaration of symbol.declarations ?? []) {
      const declaration = declarationByNode.get(nodeDeclaration);
      if (declaration !== undefined) candidates.set(declaration.observationId, declaration);
    }
    const declaration = candidates.size === 1 ? candidates.values().next().value ?? null : null;
    declarationBySymbol.set(symbol, declaration);
    declarationBySymbol.set(unresolvedSymbol, declaration);
    declarationBySemanticNode.set(node, declaration);
    return declaration;
  };

  const referenceKeys = new Set<string>();
  const sourceDeclarationAt = (node: ts.Node): SourceProgramDeclaration | null => {
    let current: ts.Node | undefined = node;
    while (current !== undefined && !ts.isSourceFile(current)) {
      const declaration = declarationByNode.get(current);
      if (declaration !== undefined) return declaration;
      current = current.parent;
    }
    return null;
  };
  const pushReference = (
    sourceFile: ts.SourceFile,
    node: ts.Node,
    name: string,
    kind: SourceProgramReferenceKind,
    target: SourceProgramDeclaration | null,
    targetPathOverride: string | null = null,
    moduleSpecifier: string | null = null
  ): void => {
    const span = spanFor(sourceFile, node);
    const sourceDeclaration = sourceDeclarationAt(node);
    const reference: SourceProgramReference = Object.freeze({
      path: semanticProgram.repositoryPath(sourceFile),
      kind,
      name,
      moduleSpecifier,
      sourceObservationId: sourceDeclaration?.observationId ?? null,
      sourceRelation: sourceDeclaration === null ? 'module-initialization' : 'declaration',
      targetObservationId: target?.observationId ?? null,
      targetPath: target?.path ?? targetPathOverride,
      observationClass: target ? 'derived' : targetPathOverride === null ? 'unknown' : 'observed',
      span
    });
    const key = `${reference.path}\0${span.start}\0${kind}\0${reference.targetObservationId ?? name}`;
    if (!referenceKeys.has(key)) {
      referenceKeys.add(key);
      references.push(reference);
    }
  };

  const resolveModulePath = (sourcePath: string, specifier: string): string | null =>
    specifier.startsWith('.')
      ? resolveRepositoryModuleImportCandidates(sourcePath, specifier)
          .find((candidate) => filesByPath.has(candidate)) ?? null
      : null;
  sourceProgramCompilationCheckpoint(input.operation, 'return-provenance', 'start');
  for (const declaration of declarations) {
    sourceProgramCompilationCheckpoint(input.operation, 'return-provenance');
    const declarationNode = declarationNodeByObservationId.get(declaration.observationId);
    if (declarationNode === undefined) continue;
    const provenance = compileSourceProgramReturnProvenance({
      checker,
      declaration,
      declarationNode,
      semanticDeclarationAt
    });
    if (provenance !== null) returnProvenances.push(provenance);
  }
  sourceProgramCompilationCheckpoint(input.operation, 'return-provenance', 'complete');
  sourceProgramCompilationCheckpoint(input.operation, 'semantic-observations', 'start');
  for (const sourceFile of sourceFiles) {
    sourceProgramCompilationCheckpoint(input.operation, 'semantic-observations');
    const sourcePath = semanticProgram.repositoryPath(sourceFile);
    const sourceSurface = sourceProgramSurfaceForPath(sourcePath);
    if (sourceSurface === 'fixture' || sourceSurface === 'resource' || sourceSurface === 'workflow') continue;
    const importedBindings = new Map<string, Readonly<{
      moduleSpecifier: string;
      targetName: string;
      targetPath: string | null;
    }>>();
    let usesCommander = false;
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.importClause === undefined) continue;
      const targetPath = resolveModulePath(sourcePath, statement.moduleSpecifier.text);
      if (statement.moduleSpecifier.text === 'commander') usesCommander = true;
      if (statement.importClause.name) {
        importedBindings.set(statement.importClause.name.text, {
          moduleSpecifier: statement.moduleSpecifier.text,
          targetName: 'default',
          targetPath
        });
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          importedBindings.set(element.name.text, {
            moduleSpecifier: statement.moduleSpecifier.text,
            targetName: (element.propertyName ?? element.name).text,
            targetPath
          });
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        importedBindings.set(bindings.name.text, {
          moduleSpecifier: statement.moduleSpecifier.text,
          targetName: '*',
          targetPath
        });
      }
    }
    let visitedDynamicImportNodes = 0;
    const collectDynamicImports = (node: ts.Node): void => {
      if ((visitedDynamicImportNodes++ & 1023) === 0) {
        sourceProgramCompilationCheckpoint(input.operation, 'semantic-observations');
      }
      if (ts.isVariableDeclaration(node)) {
        let initializer = node.initializer;
        while (initializer && (ts.isAwaitExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
          initializer = initializer.expression;
        }
        if (initializer
          && ts.isCallExpression(initializer)
          && initializer.expression.kind === ts.SyntaxKind.ImportKeyword
          && ts.isStringLiteralLike(initializer.arguments[0])) {
          const moduleSpecifier = initializer.arguments[0].text;
          const targetPath = resolveModulePath(sourcePath, moduleSpecifier);
          if (ts.isIdentifier(node.name)) {
            importedBindings.set(node.name.text, {
              moduleSpecifier,
              targetName: '*',
              targetPath
            });
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const propertyName = element.propertyName;
              if (propertyName && !ts.isIdentifier(propertyName) && !ts.isStringLiteralLike(propertyName)) continue;
              importedBindings.set(element.name.text, {
                moduleSpecifier,
                targetName: propertyName?.text ?? element.name.text,
                targetPath
              });
            }
          }
        }
      }
      ts.forEachChild(node, collectDynamicImports);
    };
    collectDynamicImports(sourceFile);
    for (const diagnostic of (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []) {
      const start = diagnostic.start ?? 0;
      const length = diagnostic.length ?? 0;
      const synthetic = { getStart: () => start, getEnd: () => start + length } as ts.Node;
      unknowns.push(Object.freeze({
        code: 'syntax-unresolved',
        path: sourcePath,
        detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        span: spanFor(sourceFile, synthetic)
      }));
    }
    let visitedObservationNodes = 0;
    const visit = (node: ts.Node): void => {
      if ((visitedObservationNodes++ & 1023) === 0) {
        sourceProgramCompilationCheckpoint(input.operation, 'semantic-observations');
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : null;
        if (specifier !== null && !specifier.startsWith('.')) {
          unknowns.push(Object.freeze({
            code: 'external-module-opaque',
            path: sourcePath,
            detail: specifier,
            span: spanFor(sourceFile, node.moduleSpecifier!)
          }));
        } else if (specifier !== null && (
          (ts.isImportDeclaration(node) && node.importClause === undefined)
          || (ts.isExportDeclaration(node) && node.exportClause === undefined)
        )) {
          pushReference(
            sourceFile,
            node.moduleSpecifier!,
            '*',
            ts.isImportDeclaration(node) ? 'import' : 'reexport',
            null,
            resolveModulePath(sourcePath, specifier),
            specifier
          );
        }
      }
      if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
        const nameNode = node.propertyName ?? node.name;
        const declaration = ts.isImportSpecifier(node)
          ? importedBindings.get(node.name.text)
          : undefined;
        const exportDeclaration = ts.isExportSpecifier(node)
          && ts.isNamedExports(node.parent)
          && ts.isExportDeclaration(node.parent.parent)
          ? node.parent.parent
          : null;
        const exportTargetPath = exportDeclaration?.moduleSpecifier
          && ts.isStringLiteral(exportDeclaration.moduleSpecifier)
          ? resolveModulePath(sourcePath, exportDeclaration.moduleSpecifier.text)
          : sourcePath;
        pushReference(
          sourceFile,
          node,
          nameNode.text,
          ts.isImportSpecifier(node) ? 'import' : 'reexport',
          semanticDeclarationAt(nameNode),
          ts.isImportSpecifier(node)
            ? declaration?.targetPath ?? null
            : exportTargetPath,
          ts.isImportSpecifier(node)
            ? declaration?.moduleSpecifier ?? null
            : exportDeclaration?.moduleSpecifier && ts.isStringLiteral(exportDeclaration.moduleSpecifier)
              ? exportDeclaration.moduleSpecifier.text
              : null
        );
      } else if (ts.isImportClause(node) && node.name) {
        const binding = importedBindings.get(node.name.text);
        pushReference(
          sourceFile,
          node,
          'default',
          'import',
          semanticDeclarationAt(node.name),
          binding?.targetPath ?? null,
          binding?.moduleSpecifier ?? null
        );
      } else if (ts.isNamespaceImport(node)) {
        const binding = importedBindings.get(node.name.text);
        pushReference(
          sourceFile,
          node,
          '*',
          'import',
          null,
          binding?.targetPath ?? null,
          binding?.moduleSpecifier ?? null
        );
      } else if (ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && ts.isIdentifier(node.name)) {
        const binding = importedBindings.get(node.expression.text);
        if (binding?.targetName === '*') {
          const directTarget = directDeclarationAt(binding.targetPath, node.name.text);
          pushReference(
            sourceFile,
            node.name,
            node.name.text,
            referenceKind(node.name),
            directTarget ?? semanticDeclarationAt(node.name, true),
            binding.targetPath
          );
        }
      } else if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        const target = semanticDeclarationAt(node);
        if (target !== null) {
          const binding = importedBindings.get(node.text);
          pushReference(
            sourceFile,
            node,
            node.text,
            referenceKind(node),
            target,
            binding?.targetPath ?? null,
            binding?.moduleSpecifier ?? null
          );
        }
      }

      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
        const value = node.text;
        if (value.length <= 512) {
          const literalOwner = literalContext(node);
          literals.push(Object.freeze({
            path: sourcePath,
            value,
            context: literalOwner.context,
            contextSpan: literalOwner.owner === null
              ? null
              : spanFor(sourceFile, literalOwner.owner),
            span: spanFor(sourceFile, node)
          }));
        } else {
          unknowns.push(Object.freeze({
            code: 'literal-oversized',
            path: sourcePath,
            detail: `${value.length} characters`,
            span: spanFor(sourceFile, node)
          }));
        }
      }

      if (ts.isNewExpression(node)) {
        const operation = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : null;
        const receiver = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.expression
          : null;
        const binding = ts.isIdentifier(node.expression)
          ? importedBindings.get(node.expression.text)
          : receiver && ts.isIdentifier(receiver)
            ? importedBindings.get(receiver.text)
            : undefined;
        const moduleSpecifier = binding?.moduleSpecifier ?? null;
        const nativeProcess = moduleSpecifier === 'node:worker_threads'
          && operation === 'Worker';
        if (nativeProcess) {
          const moduleId = input.moduleMembership.moduleForPath(sourcePath)?.moduleId ?? null;
          const owningDeclarationObservationId = sourceDeclarationAt(node)?.observationId ?? null;
          const capabilitySpan = spanFor(sourceFile, node);
          capabilities.push(Object.freeze({
            observationId: sha256({
              capability: 'process',
              operation,
              owningDeclarationObservationId,
              path: sourcePath,
              start: capabilitySpan.start
            }),
            path: sourcePath,
            moduleId,
            surface: sourceProgramSurfaceForPath(sourcePath),
            capability: 'process',
            operation,
            subject: null,
            transport: 'native-runtime',
            moduleSpecifier,
            providerCapability: null,
            providerModuleId: null,
            owningDeclarationObservationId,
            observationClass: 'observed',
            span: capabilitySpan
          }));
        }
      }

      if (ts.isCallExpression(node)) {
        const operation = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : null;
        const receiver = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.expression
          : null;
        const binding = ts.isIdentifier(node.expression)
          ? importedBindings.get(node.expression.text)
          : receiver && ts.isIdentifier(receiver)
            ? importedBindings.get(receiver.text)
            : undefined;
        const moduleSpecifier = binding?.moduleSpecifier ?? null;
        const firstArgument = node.arguments[0];
        const subject = firstArgument && ts.isStringLiteralLike(firstArgument)
          ? firstArgument.text
          : null;
        if (usesCommander && operation === 'command' && subject !== null) {
          entrypoints.push(Object.freeze({
            observationId: sha256({
              command: subject,
              path: sourcePath,
              start: node.getStart(sourceFile, false)
            }),
            path: sourcePath,
            kind: 'cli-command',
            name: subject,
            command: subject,
            targetEntrypoints: Object.freeze([]),
            targetPaths: Object.freeze([sourcePath]),
            targetPackages: Object.freeze([]),
            observationClass: 'observed',
            span: spanFor(sourceFile, node)
          }));
        }
        const importedModule = binding?.targetPath === null || binding?.targetPath === undefined
          ? null
          : input.moduleMembership.moduleForPath(binding.targetPath);
        const nativeProcess = moduleSpecifier === 'node:child_process'
          || (receiver && ts.isIdentifier(receiver) && receiver.text === 'Bun'
            && (operation === 'spawn' || operation === 'spawnSync' || operation === 'which'));
        const providerOperation = binding?.targetName === '*' ? operation : binding?.targetName ?? operation;
        const repositoryProvider = importedModule === null || providerOperation === null
          ? null
          : importedModule.capabilityProviders.find(({ operations }) => (
              operations.includes(providerOperation)
            )) ?? null;
        const repositoryProcessProvider = repositoryProvider?.capability === 'process.native';
        const runtimeBuiltinApi = (moduleSpecifier !== null
          && isRuntimeBuiltinModuleSpecifier(moduleSpecifier)
          && !nativeProcess)
          || (moduleSpecifier === null
            && (operation === 'fetch' || operation === 'eval' || operation === 'Function'));
        const capability = nativeProcess || repositoryProcessProvider
          ? 'process'
          : repositoryProvider !== null
            ? 'provider'
          : moduleSpecifier === 'node:fs' || moduleSpecifier === 'node:fs/promises'
            ? 'filesystem'
            : operation === 'fetch'
              ? 'network'
              : operation === 'eval' || operation === 'Function'
                ? 'dynamic-code'
                : null;
        if (capability !== null && operation !== null) {
          const moduleId = input.moduleMembership.moduleForPath(sourcePath)?.moduleId ?? null;
          const owningDeclarationObservationId = sourceDeclarationAt(node)?.observationId ?? null;
          const capabilitySpan = spanFor(sourceFile, node);
          capabilities.push(Object.freeze({
            observationId: sha256({
              capability,
              operation,
              owningDeclarationObservationId,
              path: sourcePath,
              start: capabilitySpan.start
            }),
            path: sourcePath,
            moduleId,
            surface: sourceProgramSurfaceForPath(sourcePath),
            capability,
            operation,
            subject,
            transport: nativeProcess
              ? 'native-runtime'
              : repositoryProvider !== null
                ? 'repository-provider'
                : runtimeBuiltinApi
                  ? 'runtime-built-in-api'
                : moduleSpecifier !== null && !moduleSpecifier.startsWith('.')
                  ? 'package-api'
                  : 'unknown',
            moduleSpecifier,
            providerCapability: repositoryProvider?.capability ?? null,
            providerModuleId: repositoryProvider === null ? null : importedModule!.moduleId,
            owningDeclarationObservationId,
            observationClass: nativeProcess || repositoryProvider !== null || subject !== null
              ? 'observed'
              : 'unknown',
            span: capabilitySpan
          }));
        }
        const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const runtimeDynamic = ts.isIdentifier(node.expression)
          && (node.expression.text === 'eval' || node.expression.text === 'Function');
        if (dynamicImport && ts.isStringLiteralLike(node.arguments[0])) {
          const moduleSpecifier = node.arguments[0].text;
          const targetPath = resolveModulePath(sourcePath, moduleSpecifier);
          pushReference(sourceFile, node.arguments[0], '*', 'import', null, targetPath);
          if (moduleSpecifier.startsWith('.') && targetPath === null) {
            unknowns.push(Object.freeze({
              code: 'dynamic-module-unresolved',
              path: sourcePath,
              detail: moduleSpecifier,
              span: spanFor(sourceFile, node.arguments[0])
            }));
          }
        } else if ((dynamicImport || requireCall) && !ts.isStringLiteralLike(node.arguments[0])) {
          unknowns.push(Object.freeze({
            code: 'dynamic-module-unresolved',
            path: sourcePath,
            detail: node.getText(sourceFile).slice(0, 256),
            span: spanFor(sourceFile, node)
          }));
        } else if (runtimeDynamic) {
          unknowns.push(Object.freeze({
            code: 'dynamic-runtime-opaque',
            path: sourcePath,
            detail: node.expression.text,
            span: spanFor(sourceFile, node)
          }));
        }
      }
      if (ts.isElementAccessExpression(node)
          && node.argumentExpression
          && !ts.isStringLiteralLike(node.argumentExpression)
          && !ts.isNumericLiteral(node.argumentExpression)) {
        unknowns.push(Object.freeze({
          code: 'computed-property-unresolved',
          path: sourcePath,
          detail: semanticDeclarationText(sourceFile, node.argumentExpression).slice(0, 256),
          span: spanFor(sourceFile, node.argumentExpression)
        }));
      }
      if (ts.isComputedPropertyName(node)
          && !ts.isStringLiteralLike(node.expression)
          && !ts.isNumericLiteral(node.expression)) {
        unknowns.push(Object.freeze({
          code: 'computed-property-unresolved',
          path: sourcePath,
          detail: semanticDeclarationText(sourceFile, node.expression).slice(0, 256),
          span: spanFor(sourceFile, node.expression)
        }));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  sourceProgramCompilationCheckpoint(input.operation, 'semantic-observations', 'complete');

  return issueTypeScriptExactFactGeneration(
    bindTypeScriptModelToRepositoryCompilation(
      canonicalTypeScriptModel({
        sourceRevision: input.sourceRevision,
        fileInputs: filesByPath,
        sourceFileIdentities: input.sourceFileIdentities,
        semanticDependencyScopes,
        moduleMembership: input.moduleMembership,
        files,
        declarations,
        references,
        returnProvenances,
        literals,
        entrypoints,
        capabilities,
        unknowns,
        operation: input.operation
      }),
      input.repositoryCompilation
    ),
    input,
    typeScriptApiClosure,
    returnProvenances,
    new Map(sourceFiles.map((sourceFile) => [
      semanticProgram.repositoryPath(sourceFile),
      sourceFile
    ] as const)),
    semanticProgram.checker,
    semanticProgram.renameAt
  );
}

export function compileTypeScriptModel(
  input: TypeScriptModelInput
): SourceProgramModel {
  return compileTypeScriptModelInternal(input);
}

export function compileTypeScriptModelWithCompilation(
  input: TypeScriptModelInput,
  repositoryCompilation: SourceProgramCompilation
): SourceProgramModel {
  return compileTypeScriptModelInternal({ ...input, repositoryCompilation });
}

export function querySourceProgramModel(
  model: SourceProgramModel,
  query: string
): SourceProgramQueryResult {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (normalized.length === 0) throw new Error('Source Program Model query cannot be blank');
  const includes = (value: string): boolean => value.toLocaleLowerCase('en-US').includes(normalized);
  const declarations = model.declarations.filter((entry) => includes(entry.name) || includes(entry.path));
  const declarationIds = new Set(declarations.map(({ observationId }) => observationId));
  return Object.freeze({
    query,
    declarations: Object.freeze(declarations),
    references: Object.freeze(model.references.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || (entry.targetObservationId !== null && declarationIds.has(entry.targetObservationId))
    )),
    literals: Object.freeze(model.literals.filter((entry) => includes(entry.value) || includes(entry.path))),
    entrypoints: Object.freeze(model.entrypoints.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || includes(entry.command ?? '')
      || entry.targetEntrypoints.some(includes)
      || entry.targetPaths.some(includes)
      || entry.targetPackages.some(includes)
    )),
    entrypointClosures: Object.freeze(model.entrypointClosures.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || entry.targetPaths.some(includes)
      || entry.targetPackages.some(includes)
      || entry.reachablePaths.some(includes)
      || entry.capabilityPaths.some(includes)
      || entry.transports.some(includes)
      || entry.providerModuleIds.some(includes)
      || entry.unknownPaths.some(includes)
    )),
    packages: Object.freeze(model.packages.filter((entry) =>
      includes(entry.name) || includes(entry.manifestPath)
    )),
    dependencies: Object.freeze(model.dependencies.filter((entry) =>
      includes(entry.name)
      || includes(entry.manifestPath)
      || entry.consumerPaths.some(includes)
    )),
    capabilities: Object.freeze(model.capabilities.filter((entry) =>
      includes(entry.capability)
      || includes(entry.operation)
      || includes(entry.subject ?? '')
      || includes(entry.path)
    )),
    candidates: Object.freeze(model.candidates.filter((entry) =>
      includes(entry.code)
      || includes(entry.subject)
      || includes(entry.reason)
      || entry.paths.some(includes)
    )),
    files: Object.freeze(model.files.filter((entry) => includes(entry.path) || includes(entry.moduleId ?? ''))),
    unknowns: Object.freeze(model.unknowns.filter((entry) => includes(entry.detail) || includes(entry.path) || includes(entry.code)))
  });
}
