import ts from 'typescript';
import {
  sha256
} from '../../../contracts/canonical.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramCompilation,
  SourceProgramDeclaration,
  SourceProgramEntrypoint,
  SourceProgramFile,
  SourceProgramLiteral,
  SourceProgramModel,
  SourceProgramReference,
  SourceProgramReferenceKind,
  SourceProgramReturnProvenance,
  SourceProgramUnknown
} from './contract.ts';
import {
  sourceProgramSurfaceForPath
} from './contract.ts';
import {
  compileTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
import {
  issueTypeScriptExactFactGeneration
} from './typescript-exact-facts.ts';
import type {
  TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import type {
  TypeScriptModelInput,
  TypeScriptModelInternalInput
} from './typescript-input.ts';
import {
  prepareTypeScriptSourceProgramInput
} from './typescript-input.ts';
import {
  bindTypeScriptModelToRepositoryCompilation,
  canonicalTypeScriptModel
} from './typescript-model-assembly.ts';
import { createTypeScriptModuleLoadObserver } from './typescript-module-loader.ts';
import {
  recordTypeScriptPerformance
} from './typescript-performance.ts';
import {
  compileSourceProgramReturnProvenance
} from './typescript-return-provenance.ts';
import {
  declarationName,
  executionScopeName,
  isDeclarationName,
  isRuntimeBuiltinModuleSpecifier,
  literalContext,
  referenceKind,
  semanticDeclarationText,
  sourceProgramFileSemantics,
  spanFor,
  typeScriptSemanticDependencyScopeFromSourceFile
} from './typescript-syntax.ts';
import {
  compileExactTypeScriptProgram
} from './typescript-workspace.ts';

/** Full semantic model lowering from one exact compiler program; other operations use their owning modules. */
export function compileTypeScriptModelInternal(
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
    input.operation,
    input.resolutionInput
  );
  const typeScriptApiClosure = compileTypeScriptRequiredApiClosure(
    semanticProgram,
    input.sourceRevision,
    input.operation
  );
  const { checker, sourceFiles } = semanticProgram;
  const observeModuleLoad = createTypeScriptModuleLoadObserver(checker);
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
      const explicitName = declarationName(node);
      const isTestExecutionScope = sourceSurface === 'test' && ts.isFunctionLike(node);
      if (explicitName !== null || isTestExecutionScope) {
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
        const span = spanFor(sourceFile, node);
        const name = explicitName ?? executionScopeName(span);
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

  function starRoutesAreModules(sourcePath: string): boolean {
    const pending = [sourcePath];
    const visited = new Set<string>();
    while (pending.length > 0) {
      sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
      const currentPath = pending.pop()!;
      if (visited.has(currentPath)) continue;
      visited.add(currentPath);
      const current = sourceFileByPath.get(currentPath);
      if (current === undefined) return false;
      for (const statement of current.statements) {
        if (!ts.isExportDeclaration(statement) || statement.exportClause !== undefined
            || statement.isTypeOnly) continue;
        if (statement.moduleSpecifier === undefined || !ts.isStringLiteralLike(statement.moduleSpecifier)) return false;
        const runtime = semanticProgram.moduleResolutionAt(current, statement.moduleSpecifier).runtime;
        if (runtime.kind !== 'module') return false;
        pending.push(runtime.target);
      }
    }
    return true;
  }

  function moduleValueAllowed(literal: ts.StringLiteralLike, selectedMember?: ts.Symbol): boolean {
    const runtime = semanticProgram.moduleResolutionAt(literal.getSourceFile(), literal).runtime;
    if (runtime.kind === 'external') return true;
    if (runtime.kind !== 'module') return false;
    const carrier = sourceFileByPath.get(runtime.target);
    const selectedDeclarations = selectedMember?.declarations;
    // An immediate compiler alias/member declared in this carrier has no
    // erased star hop. A namespace SourceFile alone does not identify a member.
    if (carrier !== undefined && selectedDeclarations !== undefined && selectedDeclarations.length > 0
        && selectedDeclarations.every(declaration => !ts.isSourceFile(declaration)
          && declaration.getSourceFile() === carrier)) return true;
    return starRoutesAreModules(runtime.target);
  }

  function aliasBoundary(declaration: ts.Declaration): ts.StringLiteralLike | null {
    for (let owner: ts.Node | undefined = declaration; owner !== undefined && !ts.isSourceFile(owner); owner = owner.parent) {
      if (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner)) {
        const literal = owner.moduleSpecifier;
        return literal !== undefined && ts.isStringLiteralLike(literal) ? literal : null;
      }
      if (ts.isImportEqualsDeclaration(owner) && ts.isExternalModuleReference(owner.moduleReference)) {
        const literal = owner.moduleReference.expression;
        return literal !== undefined && ts.isStringLiteralLike(literal) ? literal : null;
      }
    }
    return null;
  }

  function boundInitializer(declaration: ts.Declaration): ts.Expression | null {
    if (ts.isVariableDeclaration(declaration)) return declaration.initializer ?? null;
    if (!ts.isBindingElement(declaration)) return null;
    for (let owner: ts.Node | undefined = declaration.parent; owner !== undefined && !ts.isSourceFile(owner); owner = owner.parent) {
      if (ts.isVariableDeclaration(owner)) return owner.initializer ?? null;
    }
    return null;
  }

  function valueRouteAllowed(raw: ts.Expression, active: ReadonlySet<ts.Symbol>, selectedMember?: ts.Symbol): boolean {
    sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
    let expression = raw;
    while (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression)
        || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
        || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    if (ts.isConditionalExpression(expression)) {
      return valueRouteAllowed(expression.whenTrue, active, selectedMember)
        && valueRouteAllowed(expression.whenFalse, active, selectedMember);
    }
    if (ts.isCallExpression(expression)) {
      const load = observeModuleLoad(expression);
      if (load.status === 'unresolved') return false;
      return load.status !== 'resolved' || moduleValueAllowed(load.argument, selectedMember);
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      if (!valueRouteAllowed(expression.expression, active, selectedMember)) return false;
    }
    const symbol = checker.getSymbolAtLocation(expression);
    if (symbol === undefined) return true;
    return runtimeAliasTarget(symbol, active, selectedMember) !== null;
  }

  function runtimeAliasTarget(original: ts.Symbol, active: ReadonlySet<ts.Symbol>, selectedMember?: ts.Symbol): ts.Symbol | null {
    let symbol = original;
    const visited = new Set(active);
    while (true) {
      sourceProgramCompilationCheckpoint(input.operation, 'declaration-index');
      if (visited.has(symbol)) return null;
      visited.add(symbol);
      const next = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? undefined : checker.getImmediateAliasedSymbol(symbol);
      for (const declaration of symbol.declarations ?? []) {
        for (let owner: ts.Node | undefined = declaration; owner !== undefined && !ts.isSourceFile(owner); owner = owner.parent) {
          if ((ts.isImportSpecifier(owner) || ts.isExportSpecifier(owner) || ts.isImportClause(owner)
              || ts.isImportEqualsDeclaration(owner) || ts.isExportDeclaration(owner)) && owner.isTypeOnly) return null;
        }
        const boundary = aliasBoundary(declaration);
        if (boundary !== null && !moduleValueAllowed(boundary, selectedMember ?? next)) return null;
        const initializer = boundInitializer(declaration);
        if (initializer !== null && !valueRouteAllowed(initializer, visited, selectedMember)) return null;
      }
      if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
      if (next === undefined) return null;
      symbol = next;
    }
  }

  const declarationBySymbol = new Map<ts.Symbol, SourceProgramDeclaration | null>();
  const declarationBySemanticNode = new WeakMap<ts.Node, SourceProgramDeclaration | null>();
  const semanticDeclarationAt = (
    node: ts.Node,
    forceLookup = false
  ): SourceProgramDeclaration | null => {
    const nodeCached = declarationBySemanticNode.get(node);
    if ((nodeCached !== undefined || declarationBySemanticNode.has(node))
        && (nodeCached !== null || !forceLookup)) return nodeCached ?? null;
    const nodeSourceFile = node.getSourceFile();
    const localCandidate = ts.isIdentifier(node)
      && (semanticDeclarationCandidateNamesBySourcePath
        .get(semanticProgram.repositoryPath(nodeSourceFile))?.has(node.text) ?? false);
    const globalScriptCandidate = ts.isIdentifier(node)
      && !ts.isExternalModule(nodeSourceFile)
      && globalScriptDeclarationCandidateNames.has(node.text);
    if (ts.isIdentifier(node) && !forceLookup && !localCandidate && !globalScriptCandidate) {
      recordTypeScriptPerformance('semanticSymbolLookupSkippedIdentifiers', 1);
      declarationBySemanticNode.set(node, null);
      return null;
    }
    recordTypeScriptPerformance('semanticSymbolLookupOperations', 1);
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
    const receiver = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? node.expression
      : ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
        ? node.parent.expression : null;
    if (receiver !== null && !valueRouteAllowed(receiver, new Set(), symbol)) {
      declarationBySemanticNode.set(node, null);
      return null;
    }
    const runtimeSymbol = runtimeAliasTarget(symbol, new Set());
    if (runtimeSymbol === null) {
      // This failure belongs to the occurrence/alias route. The terminal
      // symbol may still be legitimately imported through another module edge.
      declarationBySemanticNode.set(node, null);
      return null;
    }
    symbol = runtimeSymbol;
    const resolvedCached = declarationBySymbol.get(symbol);
    if (resolvedCached !== undefined || declarationBySymbol.has(symbol)) {
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

  const resolveModulePath = (sourceFile: ts.SourceFile, literal: ts.StringLiteralLike): string | null =>
    semanticProgram.moduleResolutionAt(sourceFile, literal).resolvedTarget;
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
      const runtime = semanticProgram.moduleResolutionAt(sourceFile, statement.moduleSpecifier).runtime;
      if (runtime.kind === 'asset' || runtime.kind === 'unresolved') continue;
      const targetPath = resolveModulePath(sourceFile, statement.moduleSpecifier);
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
          && initializer.arguments[0] !== undefined
          && ts.isStringLiteralLike(initializer.arguments[0])) {
          const moduleSpecifier = initializer.arguments[0].text;
          const runtime = semanticProgram.moduleResolutionAt(sourceFile, initializer.arguments[0]).runtime;
          if (runtime.kind === 'asset' || runtime.kind === 'unresolved') {
            ts.forEachChild(node, collectDynamicImports);
            return;
          }
          const targetPath = resolveModulePath(sourceFile, initializer.arguments[0]);
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
        const literal = node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier : null;
        const resolution = literal === null ? null : semanticProgram.moduleResolutionAt(sourceFile, literal);
        const typeOnly = sourceFile.isDeclarationFile || (ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly === true : node.isTypeOnly);
        if (resolution?.status === 'unresolved'
            || (!typeOnly && resolution?.runtime.kind === 'unresolved')) {
          unknowns.push(Object.freeze({
            code: 'module-resolution-unresolved', path: sourcePath, detail: specifier!,
            span: spanFor(sourceFile, literal!)
          }));
        }
        if (specifier !== null && resolution?.status === 'external') {
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
            resolveModulePath(sourceFile, literal!),
            specifier
          );
        }
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const literal = node.moduleReference.expression;
        if (literal !== undefined && ts.isStringLiteralLike(literal)) {
          const resolution = semanticProgram.moduleResolutionAt(sourceFile, literal);
          if (resolution.status === 'unresolved' || (!sourceFile.isDeclarationFile && !node.isTypeOnly
              && resolution.runtime.kind === 'unresolved')) {
            unknowns.push(Object.freeze({
              code: 'module-resolution-unresolved', path: sourcePath, detail: literal.text,
              span: spanFor(sourceFile, literal)
            }));
          }
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
          ? resolveModulePath(sourceFile, exportDeclaration.moduleSpecifier)
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
            semanticDeclarationAt(node.name, true),
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
        const moduleLoad = observeModuleLoad(node);
        const runtimeDynamic = ts.isIdentifier(node.expression)
          && (node.expression.text === 'eval' || node.expression.text === 'Function');
        if (moduleLoad.status === 'resolved') {
          const moduleSpecifier = moduleLoad.specifier;
          const resolution = semanticProgram.moduleResolutionAt(sourceFile, moduleLoad.argument);
          const targetPath = sourceFile.isDeclarationFile ? resolution.resolvedTarget
            : resolution.runtime.kind === 'module' ? resolution.runtime.target : null;
          pushReference(sourceFile, moduleLoad.argument, '*', 'import', null, targetPath, moduleSpecifier);
          if (resolution.status === 'unresolved'
              || resolution.runtime.kind === 'unresolved') {
            unknowns.push(Object.freeze({
              code: 'dynamic-module-unresolved',
              path: sourcePath,
              detail: moduleSpecifier,
              span: spanFor(sourceFile, moduleLoad.argument)
            }));
          }
        } else if (moduleLoad.status === 'unresolved') {
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
