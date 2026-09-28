import type {
  SourceProgramDeclaration,
  SourceProgramModel,
  SourceProgramReturnProvenance
} from './contract.ts';
import {
  sourceProgramSurfaceForPath
} from './contract.ts';
import ts from 'typescript';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import type {
  TypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
import {
  assertTypeScriptRequiredApiClosure,
  compileTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
import type {
  ExactTypeScriptProgram,
  TypeScriptRenameObservation
} from './typescript-workspace.ts';
import {
  compileExactTypeScriptProgram
} from './typescript-workspace.ts';
import type {
  PreparedTypeScriptModelInput
} from './typescript-input.ts';
import {
  TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION
} from './typescript-profile.ts';
import {
  declarationName,
  executionScopeName,
  semanticDeclarationText,
  spanFor
} from './typescript-syntax.ts';
import {
  compileSourceProgramReturnProvenance
} from './typescript-return-provenance.ts';

/** Exact-program facts and capability observations bound to model identity; private generation registry. */
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

export function issueTypeScriptExactFactGeneration(
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

export function bindCurrentExactReturnProvenances(
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
