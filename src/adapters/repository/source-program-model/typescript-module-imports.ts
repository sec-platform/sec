import ts from 'typescript';

import { compareCodeUnits } from '../../../contracts/canonical.ts';
import type {
  ModuleImportKind,
  RepositoryModuleGraphImportObservation
} from '../architecture/contract.ts';

type ModuleLoaderOrigin = 'commonjs' | 'factory' | 'namespace' | 'module' | 'unresolved' | null;

type TypeScriptModuleProgram = Readonly<{
  program: ts.Program;
  sourceFiles: readonly ts.SourceFile[];
  repositoryPath(sourceFile: ts.SourceFile): string;
}>;

/** Observations are not a claim that arbitrary JavaScript effects are pure.
 * Computed imports and recognized loaders with unknown resolution roots remain
 * unresolved; callers must not interpret their absent edges as a closed graph.
 */
export type TypeScriptModuleImportFacts = Readonly<{
  imports: readonly RepositoryModuleGraphImportObservation[];
  unresolvedFiles: readonly string[];
}>;

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
      || ts.isSatisfiesExpression(expression)) expression = expression.expression;
  return expression;
}

function propertyName(node: ts.PropertyName | ts.Expression): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null;
}

function importDeclaration(node: ts.Node): ts.ImportDeclaration | null {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (ts.isImportDeclaration(current)) return current;
    if (ts.isSourceFile(current)) break;
  }
  return null;
}

function isNodeModuleSpecifier(expression: ts.Expression | undefined): boolean {
  return expression !== undefined && ts.isStringLiteralLike(expression)
    && (expression.text === 'node:module' || expression.text === 'module');
}

function isConstBinding(declaration: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function hasAmbientDeclaration(symbol: ts.Symbol): boolean {
  return symbol.declarations?.some((declaration) => {
    if (declaration.getSourceFile().isDeclarationFile) return true;
    let node: ts.Node | undefined = declaration;
    while (node !== undefined && !ts.isSourceFile(node)) {
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
      )) return true;
      node = node.parent;
    }
    return false;
  }) ?? false;
}

/** One compiler symbol space distinguishes intrinsic require from an ordinary
 * same-named parameter/function. Only immutable local aliases preserve its
 * known root. createRequire and indirect invocation remain explicitly unknown.
 */
function requireResolver(checker: ts.TypeChecker) {
  const visiting = new Set<ts.Symbol>();
  const memo = new Map<ts.Symbol, ModuleLoaderOrigin>();
  const memberOrigin = (base: ModuleLoaderOrigin, name: string | null): ModuleLoaderOrigin => {
    if (base === 'namespace') return name === 'createRequire' ? 'factory' : null;
    if (base === 'module') return name === 'require' ? 'commonjs' : name === null ? 'unresolved' : null;
    if (base === 'commonjs') return name === 'resolve' ? 'commonjs' : 'unresolved';
    return base === 'unresolved' ? 'unresolved' : null;
  };
  const resolve = (expression: ts.Expression): ModuleLoaderOrigin => {
    const value = unwrap(expression);
    if (ts.isCallExpression(value)) {
      const callee = resolve(value.expression);
      if (callee === 'factory' || callee === 'unresolved') return 'unresolved';
      return callee === 'commonjs' && isNodeModuleSpecifier(value.arguments[0]) ? 'namespace' : null;
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const member = ts.isPropertyAccessExpression(value) ? value.name : value.argumentExpression;
      return memberOrigin(resolve(value.expression), propertyName(member));
    }
    if (ts.isConditionalExpression(value)) {
      return resolve(value.whenTrue) !== null || resolve(value.whenFalse) !== null ? 'unresolved' : null;
    }
    if (ts.isBinaryExpression(value) && [ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind)) {
      return resolve(value.left) !== null || resolve(value.right) !== null ? 'unresolved' : null;
    }
    if (!ts.isIdentifier(value)) return null;
    const symbol = checker.getSymbolAtLocation(value);
    if (symbol === undefined || hasAmbientDeclaration(symbol)) {
      return value.text === 'require' ? 'commonjs' : value.text === 'module' ? 'module' : null;
    }
    if (memo.has(symbol)) return memo.get(symbol)!;
    if (visiting.has(symbol)) return null;
    visiting.add(symbol);
    try {
      const origins: ModuleLoaderOrigin[] = (symbol.declarations ?? []).map((declaration) => {
        const imported = importDeclaration(declaration);
        if (imported !== null && isNodeModuleSpecifier(imported.moduleSpecifier)) {
          if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) return 'namespace';
          if (ts.isImportSpecifier(declaration)
              && (declaration.propertyName ?? declaration.name).text === 'createRequire') return 'factory';
          return null;
        }
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          const origin = resolve(declaration.initializer);
          return origin === null || isConstBinding(declaration) ? origin : 'unresolved';
        }
        if (ts.isBindingElement(declaration) && ts.isIdentifier(declaration.name)
            && ts.isObjectBindingPattern(declaration.parent)
            && ts.isVariableDeclaration(declaration.parent.parent)) {
          const variable = declaration.parent.parent;
          if (variable.initializer === undefined) return null;
          const origin = memberOrigin(resolve(variable.initializer), propertyName(
            declaration.propertyName ?? declaration.name
          ));
          return origin === null || isConstBinding(variable) ? origin : 'unresolved';
        }
        return null;
      });
      const candidates = new Set(origins.filter((origin) => origin !== null));
      const origin = candidates.size > 1 || candidates.has('unresolved') ? 'unresolved'
        : candidates.values().next().value ?? null;
      memo.set(symbol, origin);
      return origin;
    } finally {
      visiting.delete(symbol);
    }
  };
  return resolve;
}

export function typeScriptModuleImportFacts(exact: TypeScriptModuleProgram): TypeScriptModuleImportFacts {
  if (exact.program.getCompilerOptions().verbatimModuleSyntax !== true) {
    throw new Error('Module import observations require the canonical verbatimModuleSyntax compiler profile.');
  }
  const observations: RepositoryModuleGraphImportObservation[] = [];
  const unresolvedFiles = new Set<string>();
  const requireOrigin = requireResolver(exact.program.getTypeChecker());
  const add = (from: string, kind: ModuleImportKind, specifier: string, typeOnly = false): void => {
    observations.push(Object.freeze({ from, kind, specifier, typeOnly }));
  };
  for (const sourceFile of exact.sourceFiles) {
    const from = exact.repositoryPath(sourceFile);
    if (exact.program.getSyntacticDiagnostics(sourceFile).length > 0) unresolvedFiles.add(from);
    for (const reference of [
      ...sourceFile.referencedFiles, ...sourceFile.typeReferenceDirectives, ...sourceFile.libReferenceDirectives
    ]) add(from, 'static', reference.fileName, true);
    const pending: ts.Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
        if (!ts.isStringLiteralLike(node.moduleSpecifier)) unresolvedFiles.add(from);
        else {
          // Inline type specifiers erase bindings, not module evaluation:
          // verbatimModuleSyntax emits import {} / export {} from the target.
          // Only a statement-level type modifier erases that runtime edge.
          const typeOnly = sourceFile.isDeclarationFile || (ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly === true : node.isTypeOnly);
          add(from, 'static', node.moduleSpecifier.text, typeOnly);
        }
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (expression !== undefined && ts.isStringLiteralLike(expression)) {
          add(from, 'require', expression.text, sourceFile.isDeclarationFile || node.isTypeOnly);
        } else unresolvedFiles.add(from);
      } else if (ts.isImportTypeNode(node)) {
        if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
          add(from, 'static', node.argument.literal.text, true);
        } else unresolvedFiles.add(from);
      } else if (ts.isCallExpression(node)) {
        const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const origin = dynamic ? null : requireOrigin(node.expression);
        if (dynamic || origin === 'commonjs' || origin === 'unresolved') {
          const argument = node.arguments[0] === undefined ? undefined : unwrap(node.arguments[0]);
          if (origin === 'unresolved' || argument === undefined || !ts.isStringLiteralLike(argument)) {
            unresolvedFiles.add(from);
          } else add(from, dynamic ? 'dynamic' : 'require', argument.text);
        }
      }
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
  }
  const unique = new Map<string, RepositoryModuleGraphImportObservation>();
  for (const observation of observations) {
    const key = `${observation.from}\0${observation.kind}\0${observation.specifier}`;
    const existing = unique.get(key);
    if (existing === undefined || (existing.typeOnly && !observation.typeOnly)) unique.set(key, observation);
  }
  return Object.freeze({
    imports: Object.freeze([...unique.values()].sort((left, right) => compareCodeUnits(left.from, right.from)
      || compareCodeUnits(left.specifier, right.specifier) || compareCodeUnits(left.kind, right.kind))),
    unresolvedFiles: Object.freeze([...unresolvedFiles].sort(compareCodeUnits))
  });
}
