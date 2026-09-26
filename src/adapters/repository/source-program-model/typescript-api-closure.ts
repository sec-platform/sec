import ts from 'typescript';
import type {
  SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import {
  sourceProgramSurfaceForPath
} from './contract.ts';
import type {
  ExactTypeScriptProgram
} from './typescript-workspace.ts';
import {
  TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
} from './typescript-profile.ts';

/** Programmatic TypeScript API requirements and their process-issued closure authority. */
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

export function compileTypeScriptRequiredApiClosure(
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
