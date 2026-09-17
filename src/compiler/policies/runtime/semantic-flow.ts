import path from 'node:path';

import ts from 'typescript';

import { sha256 } from '../../../contracts/canonical.ts';
import type { PolicySemanticRuleDefinition } from '../contract/rules.ts';

export const POLICY_SEMANTIC_FLOW_PROVIDER_ID = 'sec-policy-typescript-data-flow' as const;
export const POLICY_SEMANTIC_FLOW_PROVIDER_REVISION = sha256({
  algorithm: 'provider-import-taint-to-property-comparison',
  provider: POLICY_SEMANTIC_FLOW_PROVIDER_ID
});

export interface PolicySemanticFlowObservation {
  readonly sourceRevision: string;
  readonly status: 'proven' | 'not-proven';
}

function canonicalPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function importedProviderBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  targetPath: string,
  providerModulePaths: ReadonlySet<string>
): Readonly<{ bindings: ReadonlySet<ts.Symbol>; namespaces: ReadonlySet<ts.Symbol> }> {
  const bindings = new Set<ts.Symbol>();
  const namespaces = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const unresolved = canonicalPath(path.posix.normalize(
      path.posix.join(path.posix.dirname(targetPath), specifier)
    ));
    const candidates = [
      unresolved,
      `${unresolved}.ts`,
      `${unresolved}.tsx`,
      path.posix.join(unresolved, 'index.ts'),
      path.posix.join(unresolved, 'index.tsx')
    ];
    if (!candidates.some((candidate) => providerModulePaths.has(candidate))) continue;

    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      const symbol = checker.getSymbolAtLocation(clause.name);
      if (symbol) bindings.add(symbol);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const symbol = checker.getSymbolAtLocation(element.name);
        if (symbol) bindings.add(symbol);
      }
    } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const symbol = checker.getSymbolAtLocation(clause.namedBindings.name);
      if (symbol) namespaces.add(symbol);
    }
  }
  return { bindings, namespaces };
}

function containsNode(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
  if (predicate(node)) return true;
  let matched = false;
  node.forEachChild((child) => {
    if (!matched && containsNode(child, predicate)) matched = true;
  });
  return matched;
}

function isProviderCall(
  node: ts.Node,
  checker: ts.TypeChecker,
  bindings: ReadonlySet<ts.Symbol>,
  namespaces: ReadonlySet<ts.Symbol>
): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol !== undefined && bindings.has(symbol);
  }
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && (() => {
      const symbol = checker.getSymbolAtLocation(expression.expression);
      return symbol !== undefined && namespaces.has(symbol);
    })();
}

function expressionIsTainted(
  node: ts.Node,
  checker: ts.TypeChecker,
  bindings: ReadonlySet<ts.Symbol>,
  namespaces: ReadonlySet<ts.Symbol>,
  tainted: ReadonlySet<ts.Symbol>
): boolean {
  return containsNode(node, (candidate) =>
    isProviderCall(candidate, checker, bindings, namespaces)
    || (ts.isIdentifier(candidate)
      && (() => {
        const symbol = checker.getSymbolAtLocation(candidate);
        return symbol !== undefined && tainted.has(symbol);
      })())
  );
}

function collectTaintedBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  bindings: ReadonlySet<ts.Symbol>,
  namespaces: ReadonlySet<ts.Symbol>
): ReadonlySet<ts.Symbol> {
  const declarations: Array<readonly [ts.Symbol, ts.Expression]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) declarations.push([symbol, node.initializer]);
    } else if (ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol) declarations.push([symbol, node.right]);
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);

  const tainted = new Set<ts.Symbol>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [symbol, expression] of declarations) {
      if (tainted.has(symbol)
          || !expressionIsTainted(expression, checker, bindings, namespaces, tainted)) continue;
      tainted.add(symbol);
      changed = true;
    }
  }
  return tainted;
}

function containsTargetProperty(node: ts.Node, propertyName: string): boolean {
  return containsNode(node, (candidate) =>
    ts.isPropertyAccessExpression(candidate) && candidate.name.text === propertyName
  );
}

function containsRequiredFlow(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  rule: PolicySemanticRuleDefinition,
  bindings: ReadonlySet<ts.Symbol>,
  namespaces: ReadonlySet<ts.Symbol>,
  tainted: ReadonlySet<ts.Symbol>
): boolean {
  const equalityTokens = new Set([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken
  ]);
  return containsNode(sourceFile, (candidate) => {
    if (!ts.isBinaryExpression(candidate) || !equalityTokens.has(candidate.operatorToken.kind)) {
      return false;
    }
    const leftTainted = expressionIsTainted(candidate.left, checker, bindings, namespaces, tainted);
    const rightTainted = expressionIsTainted(candidate.right, checker, bindings, namespaces, tainted);
    return (leftTainted && containsTargetProperty(candidate.right, rule.targetProperty))
      || (rightTainted && containsTargetProperty(candidate.left, rule.targetProperty));
  });
}

export function observePolicySemanticFlow(input: Readonly<{
  targetPath: string;
  source: string;
  providerModulePaths: ReadonlySet<string>;
  rule: PolicySemanticRuleDefinition;
}>): PolicySemanticFlowObservation {
  const sourceFile = ts.createSourceFile(
    input.targetPath,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    input.targetPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    throw new Error(`Policy semantic flow source is not valid TypeScript: ${input.targetPath}`);
  }
  const options: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest
  };
  const targetPath = canonicalPath(input.targetPath);
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (fileName) => canonicalPath(fileName) === targetPath ? sourceFile : undefined;
  host.fileExists = (fileName) => canonicalPath(fileName) === targetPath;
  host.readFile = (fileName) => canonicalPath(fileName) === targetPath ? input.source : undefined;
  const checker = ts.createProgram([targetPath], options, host).getTypeChecker();
  const providerBindings = importedProviderBindings(
    sourceFile,
    checker,
    input.targetPath,
    input.providerModulePaths
  );
  const tainted = collectTaintedBindings(
    sourceFile,
    checker,
    providerBindings.bindings,
    providerBindings.namespaces
  );
  const proven = (providerBindings.bindings.size > 0 || providerBindings.namespaces.size > 0)
    && containsRequiredFlow(
      sourceFile,
      checker,
      input.rule,
      providerBindings.bindings,
      providerBindings.namespaces,
      tainted
    );
  return {
    sourceRevision: sha256(input.source),
    status: proven ? 'proven' : 'not-proven'
  };
}
