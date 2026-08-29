import path from 'node:path';

import ts from 'typescript';

import { compileSecRepositoryModuleGraph, normalizeSecRepositoryPath, resolveSecRepositoryModuleImportCandidates, type SecRepositoryModuleMembership } from '../../system-architecture/repository-modules/contract.ts';
import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramDeclaration,
  SourceProgramCapabilityInvocation,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramFileInput,
  SourceProgramLiteral,
  SourceProgramLiteralContext,
  SourceProgramModel,
  SourceProgramQueryResult,
  SourceProgramReference,
  SourceProgramReferenceKind,
  SourceProgramSpan,
  SourceProgramSurface,
  SourceProgramUnknown
} from './contract.ts';

export interface CompileTypeScriptSourceProgramModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: SecRepositoryModuleMembership;
}

export const SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH =
  'src/brownfield/source-program-model/typescript.ts' as const;

export interface TypeScriptSourceProgramIncrementalState {
  readonly providerRevision: string;
  readonly sourceRevision: string;
  readonly fileDigests: Readonly<Record<string, string>>;
  readonly moduleDigests: Readonly<Record<string, string>>;
  /** Candidate-path reverse edges preserve additions, removals and resolver fallback changes. */
  readonly reverseConsumers: Readonly<Record<string, readonly string[]>>;
  readonly model: SourceProgramModel;
}

export interface TypeScriptSourceProgramIncrementalResult {
  readonly mode: 'exact' | 'incremental' | 'full';
  readonly invalidatedPaths: readonly string[];
  readonly model: SourceProgramModel;
  readonly state: TypeScriptSourceProgramIncrementalState;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/iu;
const FIXTURE_PATH = /(?:^|\/)(?:fixtures?|snapshots?)(?:\/|$)/iu;
const RESOURCE_EXTENSION = /\.(?:json|ya?ml|toml|md|markdown|txt|sql|prisma|ejs|template)$/iu;
const RUNTIME_BUILTIN_MODULE = /^(?:node:|bun(?::|$))/u;
const compiledTypeScriptModels = new WeakSet<object>();

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

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

function compileExactTypeScriptProgram(
  filesByPath: ReadonlyMap<string, SourceProgramFileInput>
): Readonly<{
  checker: ts.TypeChecker;
  program: ts.Program;
  repositoryPath(sourceFile: ts.SourceFile): string;
  sourceFiles: readonly ts.SourceFile[];
}> {
  const repositoryRoot = process.cwd();
  const compilerOptions: ts.CompilerOptions = {
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
  };
  const canonicalByAbsolute = new Map(
    [...filesByPath.keys()].map((repositoryPathValue) => [
      path.resolve(repositoryRoot, repositoryPathValue).replaceAll('\\', '/').toLowerCase(),
      repositoryPathValue
    ] as const)
  );
  const exactRepositoryPath = (fileName: string): string | null =>
    canonicalByAbsolute.get(path.resolve(fileName).replaceAll('\\', '/').toLowerCase()) ?? null;
  const delegate = ts.createCompilerHost(compilerOptions, true);
  const host: ts.CompilerHost = {
    ...delegate,
    fileExists(fileName) {
      return exactRepositoryPath(fileName) !== null || delegate.fileExists(fileName);
    },
    getCurrentDirectory() {
      return repositoryRoot;
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const repositoryPathValue = exactRepositoryPath(fileName);
      if (repositoryPathValue === null) {
        return delegate.getSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile
        );
      }
      const file = filesByPath.get(repositoryPathValue)!;
      return ts.createSourceFile(
        path.resolve(repositoryRoot, repositoryPathValue),
        file.source,
        languageVersion,
        true,
        scriptKindFor(repositoryPathValue)
      );
    },
    readFile(fileName) {
      const repositoryPathValue = exactRepositoryPath(fileName);
      return repositoryPathValue === null
        ? delegate.readFile(fileName)
        : filesByPath.get(repositoryPathValue)!.source;
    },
    resolveModuleNames(moduleNames, containingFile) {
      const containingRepositoryPath = exactRepositoryPath(containingFile);
      return moduleNames.map((moduleName): ts.ResolvedModuleFull | undefined => {
        if (containingRepositoryPath === null || !moduleName.startsWith('.')) return undefined;
        const targetPath = resolveSecRepositoryModuleImportCandidates(
          containingRepositoryPath,
          moduleName
        ).find((candidate) => filesByPath.has(candidate));
        return targetPath === undefined
          ? undefined
          : {
              extension: moduleExtensionFor(targetPath),
              isExternalLibraryImport: false,
              resolvedFileName: path.resolve(repositoryRoot, targetPath)
            };
      });
    },
    writeFile() {
      throw new Error('Source Program TypeScript provider is read-only');
    }
  };
  const rootNames = [...filesByPath.keys()]
    .sort(compareCodeUnits)
    .map((repositoryPathValue) => path.resolve(repositoryRoot, repositoryPathValue));
  const program = ts.createProgram({ host, options: compilerOptions, rootNames });
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
    repositoryPath(sourceFile) {
      const repositoryPathValue = exactRepositoryPath(sourceFile.fileName);
      if (repositoryPathValue === null) {
        throw new Error(`TypeScript Program source escaped exact repository census: ${sourceFile.fileName}`);
      }
      return repositoryPathValue;
    },
    sourceFiles: Object.freeze(sourceFiles)
  });
}

function surfaceFor(repositoryPathValue: string): SourceProgramSurface {
  if (FIXTURE_PATH.test(repositoryPathValue)) return 'fixture';
  if (TEST_PATH.test(repositoryPathValue)) return 'test';
  if (/^platform\/registry\/[^/]+\/.+\/files\//iu.test(repositoryPathValue)) return 'resource';
  if (repositoryPathValue.startsWith('.github/workflows/')) return 'workflow';
  if (RESOURCE_EXTENSION.test(repositoryPathValue)) return 'resource';
  return 'production';
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

function sortByPathAndSpan<
  Value extends { readonly path: string; readonly span?: SourceProgramSpan | null }
>(left: Value, right: Value): number {
  return compareCodeUnits(left.path, right.path)
    || (left.span?.start ?? -1) - (right.span?.start ?? -1)
    || (left.span?.end ?? -1) - (right.span?.end ?? -1);
}

function canonicalTypeScriptModel(input: Readonly<{
  sourceRevision: string;
  files: readonly SourceProgramFile[];
  declarations: readonly SourceProgramDeclaration[];
  references: readonly SourceProgramReference[];
  literals: readonly SourceProgramLiteral[];
  entrypoints: readonly SourceProgramEntrypoint[];
  capabilities: readonly SourceProgramCapabilityInvocation[];
  unknowns: readonly SourceProgramUnknown[];
}>): SourceProgramModel {
  const providers = Object.freeze([
    Object.freeze({ id: 'typescript-compiler-api', revision: ts.version })
  ]);
  const canonicalModel = {
    sourceRevision: input.sourceRevision,
    providers,
    files: Object.freeze([...input.files].sort((left, right) => compareCodeUnits(left.path, right.path))),
    declarations: Object.freeze([...input.declarations].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.name, right.name)
    )),
    references: Object.freeze([...input.references].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.kind, right.kind)
    )),
    literals: Object.freeze([...input.literals].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.value, right.value)
    )),
    entrypoints: Object.freeze([...input.entrypoints].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.name, right.name)
    )),
    entrypointClosures: Object.freeze([]),
    packages: Object.freeze([]),
    dependencies: Object.freeze([]),
    capabilities: Object.freeze([...input.capabilities].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.operation, right.operation)
    )),
    candidates: Object.freeze([]),
    unknowns: Object.freeze([...input.unknowns].sort((left, right) =>
      sortByPathAndSpan(left, right) || compareCodeUnits(left.code, right.code)
    ))
  };
  const model: SourceProgramModel = Object.freeze({
    ...canonicalModel,
    modelDigest: sha256(canonicalModel)
  });
  compiledTypeScriptModels.add(model);
  return model;
}

function assertReusableTypeScriptState(
  state: TypeScriptSourceProgramIncrementalState,
  compilerRevision: string
): boolean {
  if (state.providerRevision !== compilerRevision
      || state.model.sourceRevision !== state.sourceRevision) return false;
  return /^sha256:[0-9a-f]{64}$/u.test(state.model.modelDigest);
}

function buildIncrementalState(
  input: CompileTypeScriptSourceProgramModelInput,
  model: SourceProgramModel,
  reverseConsumers: Readonly<Record<string, readonly string[]>>,
  compilerRevision: string
): TypeScriptSourceProgramIncrementalState {
  const fileDigests = Object.freeze(Object.fromEntries(
    input.files
      .filter(({ path: repositoryPathValue }) => SOURCE_EXTENSION.test(repositoryPathValue))
      .sort((left, right) => compareCodeUnits(left.path, right.path))
      .map((file) => [file.path, file.contentDigest])
  ));
  const moduleDigests = Object.freeze(Object.fromEntries(
    Object.keys(fileDigests).map((repositoryPathValue) => [
      repositoryPathValue,
      sha256(input.moduleMembership.moduleForPath(repositoryPathValue))
    ])
  ));
  return Object.freeze({
    providerRevision: compilerRevision,
    sourceRevision: input.sourceRevision,
    fileDigests,
    moduleDigests,
    reverseConsumers,
    model
  });
}

/**
 * Recompile only the exact reverse-consumer closure affected by changed file,
 * import-resolution or module-provider facts. The dependency closure is still
 * supplied to the compiler so named/star re-exports retain full semantics.
 */
export function compileTypeScriptSourceProgramModelIncremental(
  input: CompileTypeScriptSourceProgramModelInput,
  previous: TypeScriptSourceProgramIncrementalState | null
): TypeScriptSourceProgramIncrementalResult {
  const currentFiles = input.files
    .filter(({ path: repositoryPathValue }) => SOURCE_EXTENSION.test(repositoryPathValue))
    .map((file) => Object.freeze({ ...file, path: canonicalPath(file.path) }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const currentFileByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
  const currentPaths = Object.freeze(currentFiles.map(({ path: repositoryPathValue }) => repositoryPathValue));
  const currentSources = new Map(currentFiles.map(({ path: repositoryPathValue, source }) =>
    [repositoryPathValue, source] as const));
  const graph = compileSecRepositoryModuleGraph({
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
  const compilerClosure = new Set<string>();
  const compilerQueue: string[] = [SOURCE_PROGRAM_TYPESCRIPT_COMPILER_PATH];
  while (compilerQueue.length > 0) {
    const current = compilerQueue.shift()!;
    if (compilerClosure.has(current) || !currentFileByPath.has(current)) continue;
    compilerClosure.add(current);
    for (const dependency of graph.directDependencies(current)) compilerQueue.push(dependency);
  }
  const compilerRevision = sha256({
    provider: 'typescript-compiler-api',
    typescriptRevision: ts.version,
    implementation: compilerClosure.size === 0
      ? Object.freeze([
          compileTypeScriptSourceProgramModel.toString(),
          compileTypeScriptSourceProgramModelIncremental.toString()
        ])
      : Object.freeze([...compilerClosure].sort(compareCodeUnits).map((repositoryPathValue) => ({
          path: repositoryPathValue,
          contentDigest: currentFileByPath.get(repositoryPathValue)!.contentDigest
        })))
  });
  const compileFull = (): TypeScriptSourceProgramIncrementalResult => {
    const model = compileTypeScriptSourceProgramModel(input);
    return Object.freeze({
      mode: 'full',
      invalidatedPaths: currentPaths,
      model,
      state: buildIncrementalState(input, model, reverseConsumers, compilerRevision)
    });
  };
  if (previous === null || !assertReusableTypeScriptState(previous, compilerRevision)) return compileFull();

  const currentModuleDigests = new Map(currentPaths.map((repositoryPathValue) => [
    repositoryPathValue,
    sha256(input.moduleMembership.moduleForPath(repositoryPathValue))
  ] as const));
  const allPaths = new Set([...Object.keys(previous.fileDigests), ...currentPaths]);
  const changed = [...allPaths].filter((repositoryPathValue) => (
    previous.fileDigests[repositoryPathValue] !== currentFileByPath.get(repositoryPathValue)?.contentDigest
    || previous.moduleDigests[repositoryPathValue] !== currentModuleDigests.get(repositoryPathValue)
  ));
  if (changed.length === 0) {
    const model = canonicalTypeScriptModel({
      sourceRevision: input.sourceRevision,
      files: previous.model.files,
      declarations: previous.model.declarations,
      references: previous.model.references,
      literals: previous.model.literals,
      entrypoints: previous.model.entrypoints,
      capabilities: previous.model.capabilities,
      unknowns: previous.model.unknowns
    });
    return Object.freeze({
      mode: 'exact',
      invalidatedPaths: Object.freeze([]),
      model,
      state: buildIncrementalState(input, model, reverseConsumers, compilerRevision)
    });
  }

  const invalidated = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const changedPath = queue.shift()!;
    const consumers = new Set([
      ...(previous.reverseConsumers[changedPath] ?? []),
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
  const regenerated = compileTypeScriptSourceProgramModel({
    ...input,
    files: currentFiles.filter(({ path: repositoryPathValue }) => compilePaths.has(repositoryPathValue))
  });
  const reusablePath = (repositoryPathValue: string): boolean =>
    currentFileByPath.has(repositoryPathValue) && !invalidated.has(repositoryPathValue);
  const regeneratedPath = (repositoryPathValue: string): boolean => invalidatedCurrent.has(repositoryPathValue);
  const model = canonicalTypeScriptModel({
    sourceRevision: input.sourceRevision,
    files: currentFiles.map((file) => Object.freeze({
      path: file.path,
      contentDigest: file.contentDigest,
      moduleId: input.moduleMembership.moduleForPath(file.path)?.moduleId ?? null,
      surface: surfaceFor(file.path)
    })),
    declarations: [
      ...previous.model.declarations.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.declarations.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ],
    references: [
      ...previous.model.references.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.references.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ],
    literals: [
      ...previous.model.literals.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.literals.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ],
    entrypoints: [
      ...previous.model.entrypoints.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.entrypoints.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ],
    capabilities: [
      ...previous.model.capabilities.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.capabilities.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ],
    unknowns: [
      ...previous.model.unknowns.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
      ...regenerated.unknowns.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
    ]
  });
  return Object.freeze({
    mode: 'incremental',
    invalidatedPaths: Object.freeze([...invalidatedCurrent].sort(compareCodeUnits)),
    model,
    state: buildIncrementalState(input, model, reverseConsumers, compilerRevision)
  });
}

export function compileTypeScriptSourceProgramModel(
  input: CompileTypeScriptSourceProgramModelInput
): SourceProgramModel {
  if (input.sourceRevision.trim().length === 0) {
    throw new Error('Source Program Model requires a non-empty exact source revision');
  }
  const filesByPath = new Map<string, SourceProgramFileInput>();
  for (const raw of input.files) {
    const repositoryPathValue = canonicalPath(raw.path);
    if (!SOURCE_EXTENSION.test(repositoryPathValue)) continue;
    if (!/^sha256:[0-9a-f]{64}$/u.test(raw.contentDigest)) {
      throw new Error(`Source Program Model file has invalid content digest: ${repositoryPathValue}`);
    }
    if (filesByPath.has(repositoryPathValue)) {
      throw new Error(`Source Program Model snapshot contains duplicate path: ${repositoryPathValue}`);
    }
    filesByPath.set(repositoryPathValue, Object.freeze({ ...raw, path: repositoryPathValue }));
  }
  const semanticProgram = compileExactTypeScriptProgram(filesByPath);
  const { checker, sourceFiles } = semanticProgram;
  const files: SourceProgramFile[] = [];
  const declarations: SourceProgramDeclaration[] = [];
  const references: SourceProgramReference[] = [];
  const literals: SourceProgramLiteral[] = [];
  const entrypoints: SourceProgramEntrypoint[] = [];
  const capabilities: SourceProgramCapabilityInvocation[] = [];
  const unknowns: SourceProgramUnknown[] = [];
  const declarationByNode = new Map<ts.Node, SourceProgramDeclaration>();

  for (const [repositoryPathValue, file] of filesByPath) {
    files.push(Object.freeze({
      path: repositoryPathValue,
      contentDigest: file.contentDigest,
      moduleId: input.moduleMembership.moduleForPath(repositoryPathValue)?.moduleId ?? null,
      surface: surfaceFor(repositoryPathValue)
    }));
  }

  for (const sourceFile of sourceFiles) {
    const sourcePath = semanticProgram.repositoryPath(sourceFile);
    const visit = (node: ts.Node): void => {
      const name = declarationName(node);
      if (name !== null) {
        let topLevel: ts.Node | undefined = node;
        while (topLevel && !ts.isSourceFile(topLevel.parent)) topLevel = topLevel.parent;
        const independentlyAddressable = topLevel === node
          || (ts.isVariableDeclaration(node) && topLevel !== undefined && ts.isVariableStatement(topLevel));
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
            surface: surfaceFor(sourcePath),
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

  return canonicalTypeScriptModel({
    sourceRevision: input.sourceRevision,
    files,
    declarations,
    references,
    literals,
    entrypoints,
    capabilities,
    unknowns
  });
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
