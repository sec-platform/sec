import type {
  SourceProgramDeclaration,
  SourceProgramReturnProvenance,
  SourceProgramReturnValueProvenance
} from './contract.ts';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import ts from 'typescript';

/** Bounded return-value provenance interpretation; no model or workspace state. */
type ReturnProvenanceValues = readonly SourceProgramReturnValueProvenance[];

const OPAQUE_RETURN_PROVENANCE = Object.freeze({ kind: 'opaque' as const });

const LITERAL_RETURN_PROVENANCE = Object.freeze({ kind: 'literal' as const });

const MAX_RETURN_PROVENANCE_VALUES = 32;

const MAX_RETURN_PROVENANCE_ARGUMENTS = 32;

const MAX_RETURN_PROVENANCE_ARGUMENT_VALUES = 8;

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

export function compileSourceProgramReturnProvenance(input: Readonly<{
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
