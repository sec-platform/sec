import path from 'node:path';

import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleGraph, normalizeSecRepositoryPath, resolveSecRepositoryModuleImportCandidates, type SecRepositoryModuleMembership } from '../../system-architecture/repository-modules/contract.ts';
import type {
  SourceProgramCapabilityInvocation,
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
  SourceProgramSpan,
  SourceProgramUnknown
} from './contract.ts';
import { sourceProgramSurfaceForPath } from './contract.ts';
import {
  assembleTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramFactShard,
  SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST,
  type TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import type { WorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

export interface CompileTypeScriptSourceProgramModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: SecRepositoryModuleMembership;
}

type CompileTypeScriptSourceProgramModelInternalInput = CompileTypeScriptSourceProgramModelInput & Readonly<{
  repositoryCompilation?: WorkspaceSourceSnapshot;
}>;

export const SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH =
  'src/brownfield/source-program-model/typescript.ts' as const;

export interface TypeScriptSourceProgramIncrementalState {
  readonly [typeScriptIncrementalStateBrand]: true;
  readonly providerRevision: string;
  readonly sourceRevision: string;
  readonly fileDigests: Readonly<Record<string, string>>;
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

export interface TypeScriptSourceProgramIncrementalResult {
  readonly mode: 'exact' | 'incremental' | 'full';
  readonly invalidatedPaths: readonly string[];
  readonly model: SourceProgramModel;
  readonly state: TypeScriptSourceProgramIncrementalState;
}

export interface SourceProgramTypeScriptDiagnosticEvidence {
  readonly path: string | null;
  readonly code: number;
  readonly category: 'error' | 'warning' | 'suggestion' | 'message';
  readonly message: string;
}

export interface SourceProgramTypeScriptDiagnosticSnapshot {
  readonly sourceRevision: string;
  readonly diagnostics: readonly SourceProgramTypeScriptDiagnosticEvidence[];
  readonly evidenceDigest: string;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;
const RUNTIME_BUILTIN_MODULE = /^(?:node:|bun(?::|$))/u;
const VERSIONED_IDENTIFIER = /(?:_?V[1-9][0-9]*)$/u;
const compiledTypeScriptModels = new WeakSet<object>();
const factShardsByModel = new WeakMap<object, readonly TypeScriptSourceProgramFactShard[]>();
const repositoryCompilationDigestByModel = new WeakMap<object, `sha256:${string}`>();
const typeScriptIncrementalStateBrand: unique symbol = Symbol('typescript-source-program-incremental-state');
const issuedTypeScriptIncrementalStates = new WeakSet<object>();
const typeScriptCompilerIdentityBrand: unique symbol = Symbol('typescript-source-program-compiler-identity');
const issuedTypeScriptCompilerIdentities = new WeakSet<object>();

export function workspaceSourceSnapshotIdentityForTypeScriptModel(
  model: SourceProgramModel
): `sha256:${string}` | null {
  return repositoryCompilationDigestByModel.get(model) ?? null;
}

function bindTypeScriptModelToRepositoryCompilation(
  model: SourceProgramModel,
  context: WorkspaceSourceSnapshot | undefined
): SourceProgramModel {
  if (context !== undefined) {
    repositoryCompilationDigestByModel.set(model, context.identityDigest);
  }
  return model;
}

export function isCompiledTypeScriptSourceProgramModel(
  value: SourceProgramModel
): boolean {
  return compiledTypeScriptModels.has(value);
}

function canonicalPath(value: string): string {
  const normalized = normalizeSecRepositoryPath(value);
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

export interface SourceProgramTypeScriptCompilerIdentity {
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
export function sourceProgramTypeScriptCompilerIdentity(): SourceProgramTypeScriptCompilerIdentity {
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

export function assertSourceProgramTypeScriptCompilerIdentity(
  identity: SourceProgramTypeScriptCompilerIdentity
): void {
  if (!issuedTypeScriptCompilerIdentities.has(identity)) {
    throw new Error('TypeScript Source Program compiler identity is not owner-issued');
  }
}

type ExactTypeScriptProgram = Readonly<{
  checker: ts.TypeChecker;
  program: ts.Program;
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
        const containingRepositoryPath = this.#repositoryPath(containingFile);
        if (containingRepositoryPath !== null && moduleName.startsWith('.')) {
          const targetPath = resolveSecRepositoryModuleImportCandidates(
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
        if (containingRepositoryPath !== null) return undefined;
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

  compile(filesByPath: ReadonlyMap<string, SourceProgramFileInput>): ExactTypeScriptProgram {
    const nextPaths = new Set(filesByPath.keys());
    let changed = false;
    for (const repositoryPathValue of this.#files.keys()) {
      if (nextPaths.has(repositoryPathValue)) continue;
      this.#files.delete(repositoryPathValue);
      changed = true;
    }
    for (const [repositoryPathValue, file] of filesByPath) {
      const current = this.#files.get(repositoryPathValue);
      const identityDigest = sourceProgramFileSnapshotDigest(file);
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
    return Object.freeze({
      checker: program.getTypeChecker(),
      program,
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
}

let activeTypeScriptWorkspace: TypeScriptSourceProgramWorkspace | null = null;
let activeTypeScriptWorkspaceRoot: string | null = null;

/** Release one process-local edit snapshot after its compact evidence is sealed. */
export function releaseTypeScriptSourceProgramWorkspace(): void {
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

function sourceProgramFileSnapshotDigest(file: SourceProgramFileInput): string {
  return sha256({
    declaredContentDigest: file.contentDigest,
    sourceDigest: rawSha256(file.source)
  });
}

function compileExactTypeScriptProgram(
  filesByPath: ReadonlyMap<string, SourceProgramFileInput>
): ExactTypeScriptProgram {
  const repositoryRoot = process.cwd();
  if (activeTypeScriptWorkspace === null || activeTypeScriptWorkspaceRoot !== repositoryRoot) {
    activeTypeScriptWorkspace?.dispose();
    activeTypeScriptWorkspace = new TypeScriptSourceProgramWorkspace(repositoryRoot);
    activeTypeScriptWorkspaceRoot = repositoryRoot;
  }
  return activeTypeScriptWorkspace.compile(filesByPath);
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
export function compileSourceProgramTypeScriptDiagnosticSnapshot(input: Readonly<{
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
}>): SourceProgramTypeScriptDiagnosticSnapshot {
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
  const exact = compileExactTypeScriptProgram(filesByPath);
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
  moduleMembership: SecRepositoryModuleMembership;
  files: readonly SourceProgramFile[];
  declarations: readonly SourceProgramDeclaration[];
  references: readonly SourceProgramReference[];
  literals: readonly SourceProgramLiteral[];
  entrypoints: readonly SourceProgramEntrypoint[];
  capabilities: readonly SourceProgramCapabilityInvocation[];
  unknowns: readonly SourceProgramUnknown[];
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
  const literalsByPath = groupByPath(input.literals);
  const entrypointsByPath = groupByPath(input.entrypoints);
  const capabilitiesByPath = groupByPath(input.capabilities);
  const unknownsByPath = groupByPath(input.unknowns);
  const shards = input.files.map((file) => {
    const fileInput = input.fileInputs.get(file.path);
    if (fileInput === undefined) {
      throw new Error(`TypeScript Source Program fact shard lacks raw source: ${file.path}`);
    }
    return compileTypeScriptSourceProgramFactShard({
      compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
      providerRevision: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER_REVISION,
      rawFileDigest: sourceProgramFileSnapshotDigest(fileInput),
      moduleDigest: sha256(input.moduleMembership.moduleForPath(file.path)),
      semanticDependencyScope: typeScriptSemanticDependencyScope(fileInput),
      facts: Object.freeze({
        path: file.path,
        file,
        declarations: declarationsByPath.get(file.path) ?? Object.freeze([]),
        references: referencesByPath.get(file.path) ?? Object.freeze([]),
        literals: literalsByPath.get(file.path) ?? Object.freeze([]),
        entrypoints: entrypointsByPath.get(file.path) ?? Object.freeze([]),
        capabilities: capabilitiesByPath.get(file.path) ?? Object.freeze([]),
        unknowns: unknownsByPath.get(file.path) ?? Object.freeze([])
      })
    });
  });
  const model = assembleTypeScriptSourceProgramModel({
    sourceRevision: input.sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, Object.freeze(shards));
  return model;
}

function assembleCanonicalTypeScriptModel(
  sourceRevision: string,
  shards: readonly TypeScriptSourceProgramFactShard[]
): SourceProgramModel {
  const model = assembleTypeScriptSourceProgramModel({
    sourceRevision,
    compilerRevision: TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    provider: TYPESCRIPT_SOURCE_PROGRAM_PROVIDER,
    shards
  });
  compiledTypeScriptModels.add(model);
  factShardsByModel.set(model, shards);
  return model;
}

function typeScriptSemanticDependencyScope(
  file: SourceProgramFileInput
): TypeScriptSourceProgramFactShard['semanticDependencyScope'] {
  if (/\.d\.[cm]?ts$/iu.test(file.path)) return 'global-or-ambient';
  const sourceFile = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    sourceProgramScriptKind(file.path)
  );
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

function assertReusableTypeScriptState(
  state: TypeScriptSourceProgramIncrementalState,
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
  input: CompileTypeScriptSourceProgramModelInput,
  model: SourceProgramModel,
  reverseConsumers: Readonly<Record<string, readonly string[]>>,
  compilerRevision: string,
  moduleGraphDigest: `sha256:${string}` = sha256(reverseConsumers) as `sha256:${string}`,
  previousGeneration?: Readonly<{
    fileDigests: Readonly<Record<string, string>>;
    moduleDigests: Readonly<Record<string, string>>;
  }>
): TypeScriptSourceProgramIncrementalState {
  const factShards = factShardsByModel.get(model);
  if (factShards === undefined) {
    throw new Error('TypeScript Source Program incremental state requires canonical fact shards');
  }
  const fileDigests = previousGeneration?.fileDigests ?? Object.freeze(Object.fromEntries(
    input.files
      .filter(({ path: repositoryPathValue }) => (
        SOURCE_EXTENSION.test(repositoryPathValue)
        && sourceProgramSurfaceForPath(repositoryPathValue) === 'production'
      ))
      .sort((left, right) => compareCodeUnits(left.path, right.path))
      .map((file) => [file.path, sourceProgramFileSnapshotDigest(file)])
  ));
  const moduleDigests = previousGeneration?.moduleDigests ?? Object.freeze(Object.fromEntries(
    Object.keys(fileDigests).map((repositoryPathValue) => [
      repositoryPathValue,
      sha256(input.moduleMembership.moduleForPath(repositoryPathValue))
    ])
  ));
  const semanticDependencyScopes = Object.freeze(Object.fromEntries(
    factShards.map((shard) => [shard.path, shard.semanticDependencyScope])
  ));
  const state = Object.freeze({
    [typeScriptIncrementalStateBrand]: true as const,
    providerRevision: compilerRevision,
    sourceRevision: input.sourceRevision,
    fileDigests,
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
export function adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot(
  input: CompileTypeScriptSourceProgramModelInput,
  shards: readonly TypeScriptSourceProgramFactShard[],
  repositoryCompilation: WorkspaceSourceSnapshot,
  generation?: Readonly<{ moduleGraphDigest: `sha256:${string}` }>
): TypeScriptSourceProgramIncrementalState {
  repositoryCompilation.assertMatches(input);
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
  if (generation === undefined) {
    for (const reference of graph.references) {
      for (const candidate of reference.candidateTargets) addConsumer(candidate, reference.from);
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
    input,
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
function compileTypeScriptSourceProgramModelIncrementalInternal(
  input: CompileTypeScriptSourceProgramModelInternalInput,
  previous: TypeScriptSourceProgramIncrementalState | null
): TypeScriptSourceProgramIncrementalResult {
  input.repositoryCompilation?.assertMatches(input);
  const currentFiles = input.files
    .filter(({ path: repositoryPathValue }) => (
      SOURCE_EXTENSION.test(repositoryPathValue)
      && sourceProgramSurfaceForPath(repositoryPathValue) === 'production'
    ))
    .map(canonicalTypeScriptFile)
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
    const currentModuleDigests = new Map(currentPaths.map((repositoryPathValue) => [
      repositoryPathValue,
      sha256(input.moduleMembership.moduleForPath(repositoryPathValue))
    ] as const));
    const allPaths = new Set([...Object.keys(reusableState.fileDigests), ...currentPaths]);
    changed = Object.freeze([...allPaths].filter((repositoryPathValue) => (
      reusableState.fileDigests[repositoryPathValue]
        !== (currentFileByPath.has(repositoryPathValue)
          ? sourceProgramFileSnapshotDigest(currentFileByPath.get(repositoryPathValue)!)
          : undefined)
      || reusableState.moduleDigests[repositoryPathValue] !== currentModuleDigests.get(repositoryPathValue)
    )));
    if (changed.length === 0) {
      if (input.sourceRevision === reusableState.sourceRevision
          && (input.repositoryCompilation === undefined
            || workspaceSourceSnapshotIdentityForTypeScriptModel(reusableState.model)
              === input.repositoryCompilation.identityDigest)) {
        return Object.freeze({
          mode: 'exact',
          invalidatedPaths: Object.freeze([]),
          model: reusableState.model,
          state: reusableState
        });
      }
      const model = bindTypeScriptModelToRepositoryCompilation(
        assembleCanonicalTypeScriptModel(input.sourceRevision, reusableState.factShards),
        input.repositoryCompilation
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
  const graph = input.repositoryCompilation?.moduleGraph ?? compileSecRepositoryModuleGraph({
    files: currentPaths,
    readSource: (repositoryPathValue) => currentSources.get(repositoryPathValue) ?? null
  });
  const reverseConsumerSets = new Map<string, Set<string>>();
  for (const reference of graph.references) {
    for (const candidate of reference.candidateTargets) {
      const consumers = reverseConsumerSets.get(candidate) ?? new Set<string>();
      consumers.add(reference.from);
      reverseConsumerSets.set(candidate, consumers);
    }
  }
  const reverseConsumers = Object.freeze(Object.fromEntries(
    [...reverseConsumerSets]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([repositoryPathValue, consumers]) => [
        repositoryPathValue,
        Object.freeze([...consumers].sort(compareCodeUnits))
      ])
  ));
  const compileFull = (): TypeScriptSourceProgramIncrementalResult => {
    const model = compileTypeScriptSourceProgramModelInternal(input);
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
  const currentSemanticDependencyScopes = new Map(currentFiles.map((file) => [
    file.path,
    typeScriptSemanticDependencyScope(file)
  ] as const));
  const fileSetChanged = Object.keys(reusableState.fileDigests).length !== currentPaths.length
    || currentPaths.some((repositoryPathValue) => reusableState.fileDigests[repositoryPathValue] === undefined);
  const currentModuleGraphDigest = input.repositoryCompilation?.moduleGraphDigest
    ?? sha256(reverseConsumers) as `sha256:${string}`;
  const graphChanged = reusableState.moduleGraphDigest !== currentModuleGraphDigest;
  const globallyCoupledChange = changed.some((repositoryPathValue) => (
    reusableState.semanticDependencyScopes[repositoryPathValue] !== 'module-scoped'
    || currentSemanticDependencyScopes.get(repositoryPathValue) !== 'module-scoped'
  ));
  if (fileSetChanged || graphChanged || globallyCoupledChange) return compileFull();

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
    for (const reference of graph.references) {
      if (reference.from !== consumer) continue;
      for (const candidate of reference.candidateTargets) {
        if (!currentFileByPath.has(candidate) || compilePaths.has(candidate)) continue;
        compilePaths.add(candidate);
        dependencyQueue.push(candidate);
      }
    }
  }
  const regenerated = compileTypeScriptSourceProgramModelInternal({
    sourceRevision: input.sourceRevision,
    files: currentFiles.filter(({ path: repositoryPathValue }) => compilePaths.has(repositoryPathValue)),
    moduleMembership: input.moduleMembership
  });
  const reusablePath = (repositoryPathValue: string): boolean =>
    currentFileByPath.has(repositoryPathValue) && !invalidated.has(repositoryPathValue);
  const regeneratedPath = (repositoryPathValue: string): boolean => invalidatedCurrent.has(repositoryPathValue);
  const regeneratedShards = factShardsByModel.get(regenerated);
  if (regeneratedShards === undefined) {
    throw new Error('TypeScript Source Program regeneration did not produce fact shards');
  }
  const model = bindTypeScriptModelToRepositoryCompilation(
    assembleCanonicalTypeScriptModel(input.sourceRevision, [
      ...reusableState.factShards.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regeneratedShards.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ]),
    input.repositoryCompilation
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

export function compileTypeScriptSourceProgramModelIncremental(
  input: CompileTypeScriptSourceProgramModelInput,
  previous: TypeScriptSourceProgramIncrementalState | null
): TypeScriptSourceProgramIncrementalResult {
  return compileTypeScriptSourceProgramModelIncrementalInternal(input, previous);
}

export function compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
  input: CompileTypeScriptSourceProgramModelInput,
  previous: TypeScriptSourceProgramIncrementalState | null,
  repositoryCompilation: WorkspaceSourceSnapshot
): TypeScriptSourceProgramIncrementalResult {
  repositoryCompilation.assertMatches(input);
  return compileTypeScriptSourceProgramModelIncrementalInternal({
    ...input,
    repositoryCompilation
  }, previous);
}

function compileTypeScriptSourceProgramModelInternal(
  input: CompileTypeScriptSourceProgramModelInternalInput
): SourceProgramModel {
  input.repositoryCompilation?.assertMatches(input);
  if (input.sourceRevision.trim().length === 0) {
    throw new Error('Source Program Model requires a non-empty exact source revision');
  }
  const filesByPath = new Map<string, SourceProgramFileInput>();
  for (const raw of input.files) {
    if (!SOURCE_EXTENSION.test(raw.path)
        || sourceProgramSurfaceForPath(raw.path) !== 'production') continue;
    const file = canonicalTypeScriptFile(raw);
    const repositoryPathValue = file.path;
    if (filesByPath.has(repositoryPathValue)) {
      throw new Error(`Source Program Model snapshot contains duplicate path: ${repositoryPathValue}`);
    }
    filesByPath.set(repositoryPathValue, file);
  }
  const semanticProgram = compileExactTypeScriptProgram(filesByPath);
  const { checker, sourceFiles } = semanticProgram;
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [
    semanticProgram.repositoryPath(sourceFile),
    sourceFile
  ] as const));
  const files: SourceProgramFile[] = [];
  const declarations: SourceProgramDeclaration[] = [];
  const references: SourceProgramReference[] = [];
  const literals: SourceProgramLiteral[] = [];
  const entrypoints: SourceProgramEntrypoint[] = [];
  const capabilities: SourceProgramCapabilityInvocation[] = [];
  const unknowns: SourceProgramUnknown[] = [];
  const declarationByNode = new Map<ts.Node, SourceProgramDeclaration>();

  for (const [repositoryPathValue, file] of filesByPath) {
    const sourceFile = sourceFileByPath.get(repositoryPathValue);
    const semantics = sourceFile === undefined
      ? Object.freeze({ kind: 'unknown' as const, observationClass: 'unknown' as const })
      : sourceProgramFileSemantics(sourceFile);
    files.push(Object.freeze({
      path: repositoryPathValue,
      contentDigest: file.contentDigest,
      moduleId: input.moduleMembership.moduleForPath(repositoryPathValue)?.moduleId ?? null,
      surface: sourceProgramSurfaceForPath(repositoryPathValue),
      semanticKind: semantics.kind,
      semanticObservationClass: semantics.observationClass
    }));
  }

  for (const sourceFile of sourceFiles) {
    const sourcePath = semanticProgram.repositoryPath(sourceFile);
    if (sourceProgramSurfaceForPath(sourcePath) !== 'production') continue;
    const visit = (node: ts.Node): void => {
      const name = declarationName(node);
      if (name !== null) {
        let topLevel: ts.Node | undefined = node;
        while (topLevel && !ts.isSourceFile(topLevel.parent)) topLevel = topLevel.parent;
        const independentlyAddressable = topLevel === node
          || (ts.isVariableDeclaration(node) && topLevel !== undefined && ts.isVariableStatement(topLevel));
        if (!independentlyAddressable) {
          ts.forEachChild(node, visit);
          return;
        }
        const span = spanFor(sourceFile, node);
        const declarationDigest = sha256({
          kind: ts.SyntaxKind[node.kind],
          name,
          source: node.getText(sourceFile)
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
        declarations.push(declaration);
        declarationByNode.set(node, declaration);
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
          source: element.getText(sourceFile)
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
        declarations.push(declaration);
        declarationByNode.set(element, declaration);
      }
    }
  }

  const semanticDeclarationAt = (node: ts.Node): SourceProgramDeclaration | null => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined
      && ts.isIdentifier(node)
      && ts.isPropertyAccessExpression(node.parent)
      && node.parent.name === node) {
      symbol = checker.getTypeAtLocation(node.parent.expression).getProperty(node.text);
    }
    if (symbol === undefined) return null;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const candidates = new Map<string, SourceProgramDeclaration>();
    for (const nodeDeclaration of symbol.declarations ?? []) {
      const declaration = declarationByNode.get(nodeDeclaration);
      if (declaration !== undefined) candidates.set(declaration.observationId, declaration);
    }
    return candidates.size === 1 ? candidates.values().next().value ?? null : null;
  };

  const referenceKeys = new Set<string>();
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
    const reference: SourceProgramReference = Object.freeze({
      path: semanticProgram.repositoryPath(sourceFile),
      kind,
      name,
      moduleSpecifier,
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
      ? resolveSecRepositoryModuleImportCandidates(sourcePath, specifier)
          .find((candidate) => filesByPath.has(candidate)) ?? null
      : null;
  for (const sourceFile of sourceFiles) {
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
    const collectDynamicImports = (node: ts.Node): void => {
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
    const visit = (node: ts.Node): void => {
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
          pushReference(
            sourceFile,
            node.name,
            node.name.text,
            referenceKind(node.name),
            semanticDeclarationAt(node.name),
            binding.targetPath
          );
        }
      } else if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        const target = semanticDeclarationAt(node);
        if (target !== null) {
          pushReference(sourceFile, node, node.text, referenceKind(node), target);
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
        const runtimeBuiltinApi = moduleSpecifier !== null
          && RUNTIME_BUILTIN_MODULE.test(moduleSpecifier)
          && !nativeProcess;
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
          capabilities.push(Object.freeze({
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
            observationClass: nativeProcess || repositoryProvider !== null || subject !== null
              ? 'observed'
              : 'unknown',
            span: spanFor(sourceFile, node)
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
          detail: node.argumentExpression.getText(sourceFile).slice(0, 256),
          span: spanFor(sourceFile, node.argumentExpression)
        }));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return bindTypeScriptModelToRepositoryCompilation(
    canonicalTypeScriptModel({
      sourceRevision: input.sourceRevision,
      fileInputs: filesByPath,
      moduleMembership: input.moduleMembership,
      files,
      declarations,
      references,
      literals,
      entrypoints,
      capabilities,
      unknowns
    }),
    input.repositoryCompilation
  );
}

export function compileTypeScriptSourceProgramModel(
  input: CompileTypeScriptSourceProgramModelInput
): SourceProgramModel {
  return compileTypeScriptSourceProgramModelInternal(input);
}

export function compileTypeScriptSourceProgramModelFromWorkspaceSnapshot(
  input: CompileTypeScriptSourceProgramModelInput,
  repositoryCompilation: WorkspaceSourceSnapshot
): SourceProgramModel {
  repositoryCompilation.assertMatches(input);
  return compileTypeScriptSourceProgramModelInternal({ ...input, repositoryCompilation });
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
