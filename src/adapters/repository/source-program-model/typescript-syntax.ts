import ts from 'typescript';
import type {
  SourceProgramFileInput,
  SourceProgramFileSemanticKind,
  SourceProgramLiteralContext,
  SourceProgramReferenceKind,
  SourceProgramSpan
} from './contract.ts';
import type {
  TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import {
  recordTypeScriptPerformance
} from './typescript-performance.ts';

/** Stateless syntax classification and source-level semantic observations. */
const RUNTIME_BUILTIN_MODULE = /^(?:node:|bun(?::|$))/u;

/** Canonical compiler classification for host runtime built-ins. */
export function isRuntimeBuiltinModuleSpecifier(specifier: string): boolean {
  return RUNTIME_BUILTIN_MODULE.test(specifier);
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

export function spanFor(sourceFile: ts.SourceFile, node: ts.Node): SourceProgramSpan {
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

export function semanticSourceText(source: string): string {
  return source.replace(/\r\n?/gu, '\n');
}

export function semanticDeclarationText(sourceFile: ts.SourceFile, node: ts.Node): string {
  return semanticSourceText(node.getText(sourceFile));
}

export function executionScopeName(span: SourceProgramSpan): string {
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

export function declarationName(node: ts.Node): string | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const name = declarationNameNode(node);
  return name?.text ?? null;
}

export function isDeclarationName(node: ts.Identifier): boolean {
  return declarationNameNode(node.parent) === node
    || ts.isImportClause(node.parent)
    || ts.isImportSpecifier(node.parent)
    || ts.isNamespaceImport(node.parent)
    || ts.isExportSpecifier(node.parent);
}

export function referenceKind(node: ts.Identifier): SourceProgramReferenceKind {
  const parent = node.parent;
  const expression = ts.isPropertyAccessExpression(parent) ? parent : node;
  const invocation = expression.parent;
  if (ts.isNewExpression(invocation) && invocation.expression === expression) return 'construct';
  if (ts.isCallExpression(invocation) && invocation.expression === expression) return 'call';
  return 'reference';
}

export function literalContext(node: ts.Node): Readonly<{
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

export function sourceProgramFileSemantics(sourceFile: ts.SourceFile): Readonly<{
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

export function typeScriptSemanticDependencyScopeFromSourceFile(
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

export function typeScriptSemanticDependencyScope(
  file: SourceProgramFileInput
): TypeScriptSourceProgramFactShard['semanticDependencyScope'] {
  if (/\.d\.[cm]?ts$/iu.test(file.path)) return 'global-or-ambient';
  recordTypeScriptPerformance('semanticScopeParseOperations', 1);
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
