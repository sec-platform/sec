import ts from 'typescript';

/** The interpretation contract is part of compiler identity. Persisted fact
 * generations from the prior name-only interpretation must not be reused. */
export const TYPESCRIPT_MODULE_LOAD_SEMANTICS = Object.freeze({
  identity: 'checker-bound-module-load-observation',
  commonjs: 'ambient-binding-or-immutable-alias',
  operand: 'unwrapped-string-literal',
  unresolved: 'missing-computed-or-root-unresolved',
  ordinary: 'no-module-load-fact'
});


type ModuleLoaderOrigin = 'commonjs' | 'factory' | 'namespace' | 'module' | 'unresolved' | null;


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

export type TypeScriptModuleLoadObservation =
  | Readonly<{ status: 'ordinary' }>
  | Readonly<{ status: 'unresolved' }>
  | Readonly<{
      status: 'resolved';
      kind: 'dynamic' | 'require';
      specifier: string;
      argument: ts.StringLiteralLike;
    }>;

/** Shared by graph and semantic-fact lowering. No source reparsing, I/O or
 * path-root inference; the caller retains one exact Program's checker. */
export function createTypeScriptModuleLoadObserver(
  checker: ts.TypeChecker
): (call: ts.CallExpression) => TypeScriptModuleLoadObservation {
  const requireOrigin = requireResolver(checker);
  const ordinary = Object.freeze({ status: 'ordinary' as const });
  const unresolved = Object.freeze({ status: 'unresolved' as const });
  return (call) => {
    const dynamic = call.expression.kind === ts.SyntaxKind.ImportKeyword;
    const origin = dynamic ? null : requireOrigin(call.expression);
    if (!dynamic && origin !== 'commonjs' && origin !== 'unresolved') return ordinary;
    const argument = call.arguments[0] === undefined ? undefined : unwrap(call.arguments[0]);
    if (origin === 'unresolved' || argument === undefined || !ts.isStringLiteralLike(argument)) return unresolved;
    return Object.freeze({
      status: 'resolved' as const,
      kind: dynamic ? 'dynamic' as const : 'require' as const,
      specifier: argument.text,
      argument
    });
  };
}
