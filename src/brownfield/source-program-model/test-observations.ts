import path from 'node:path';

import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  compileSecRepositoryModuleGraph,
  type SecRepositoryModuleGraph,
  type SecRepositoryModuleMembership
} from '../../system-architecture/repository-modules/contract.ts';
import {
  sourceProgramSurfaceForPath,
  type SourceProgramCapabilityInvocation,
  type SourceProgramDeclaration,
  type SourceProgramFileInput,
  type SourceProgramLiteral,
  type SourceProgramModel,
  type SourceProgramReference,
  type SourceProgramReferenceKind,
  type SourceProgramSpan,
  type SourceProgramUnknown
} from './contract.ts';
import type { IssuedRepositoryCompilationContext } from './repository-compilation-context.ts';
import {
  isCompiledTypeScriptSourceProgramModel,
  repositoryCompilationDigestForTypeScriptModel
} from './typescript.ts';

export interface CompileSourceProgramTestObservationsInput {
  /** Production-only facts signed by the canonical Source Program compiler. */
  readonly productionModel: SourceProgramModel;
  /** Exact production and test bytes for the candidate revision. */
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: SecRepositoryModuleMembership;
  readonly repositoryRoot?: string;
}

type CompileSourceProgramTestObservationsInternalInput = CompileSourceProgramTestObservationsInput & Readonly<{
  repositoryCompilation?: IssuedRepositoryCompilationContext;
}>;

export type SourceProgramTestSemanticClass =
  | 'behavior'
  | 'durable-state'
  | 'effect'
  | 'failure-boundary'
  | 'algorithm-property'
  | 'external-protocol';

export interface SourceProgramTestAssertionObservation {
  readonly span: SourceProgramSpan;
  readonly matcher: string;
  readonly versionIdentityOnly: boolean;
  readonly importedFunctionArity: boolean;
  readonly productionPathLayoutTarget: string | null;
}

export interface SourceProgramTestRegistrationObservation {
  readonly path: string;
  readonly index: number;
  readonly kind: string;
  readonly title: string | null;
  readonly span: SourceProgramSpan;
  readonly assertions: readonly SourceProgramTestAssertionObservation[];
  readonly semanticClasses: readonly SourceProgramTestSemanticClass[];
  readonly observedProductionPaths: readonly string[];
  readonly capabilityOperations: readonly string[];
  readonly unknowns: readonly string[];
}

export interface SourceProgramTestSourceReadObservation {
  readonly path: string;
  readonly target: string;
  readonly span: SourceProgramSpan;
}

export interface SourceProgramTestObservations {
  readonly sourceRevision: string;
  readonly productionModelDigest: string;
  readonly testPaths: readonly string[];
  readonly references: readonly SourceProgramReference[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly registrations: readonly SourceProgramTestRegistrationObservation[];
  readonly productionSourceReads: readonly SourceProgramTestSourceReadObservation[];
  readonly unknowns: readonly SourceProgramUnknown[];
  readonly observationDigest: string;
}

const observationsByFiles = new WeakMap<
  readonly SourceProgramFileInput[],
  SourceProgramTestObservations
>();
const repositoryCompilationDigestByObservations = new WeakMap<object, `sha256:${string}`>();

export function repositoryCompilationDigestForTestObservations(
  observations: SourceProgramTestObservations
): `sha256:${string}` | null {
  return repositoryCompilationDigestByObservations.get(observations) ?? null;
}

export function sourceProgramTestObservationsForFiles(
  files: readonly SourceProgramFileInput[],
  sourceRevision: string
): SourceProgramTestObservations | null {
  const observations = observationsByFiles.get(files) ?? null;
  return observations?.sourceRevision === sourceRevision ? observations : null;
}

type ImportedBinding = Readonly<{
  moduleSpecifier: string;
  targetPath: string | null;
  targetName: string;
}>;

const TEST_SUPPORT_MODULE = /^(?:bun:test|node:test|node:assert(?:\/strict)?|vitest(?:\/.*)?|@jest\/globals|uvu|tap)$/iu;
const RUNTIME_BUILTIN_MODULE = /^(?:node:|bun:)/u;

function scriptKind(repositoryPath: string): ts.ScriptKind {
  if (/\.tsx$/iu.test(repositoryPath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/iu.test(repositoryPath)) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/iu.test(repositoryPath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

function graphTarget(
  graph: SecRepositoryModuleGraph,
  from: string,
  moduleSpecifier: string,
  kind: 'static' | 'dynamic' | 'require' = 'static'
): string | null {
  return graph.references.find((reference) => reference.from === from
    && reference.kind === kind
    && reference.specifier === moduleSpecifier)?.resolvedTarget ?? null;
}

function importBindings(
  sourceFile: ts.SourceFile,
  graph: SecRepositoryModuleGraph
): ReadonlyMap<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
        || statement.importClause === undefined
        || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const targetPath = graphTarget(graph, sourceFile.fileName, moduleSpecifier);
    const clause = statement.importClause;
    if (clause.name !== undefined) {
      bindings.set(clause.name.text, Object.freeze({
        moduleSpecifier,
        targetPath,
        targetName: 'default'
      }));
    }
    if (clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, Object.freeze({
        moduleSpecifier,
        targetPath,
        targetName: '*'
      }));
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      bindings.set(element.name.text, Object.freeze({
        moduleSpecifier,
        targetPath,
        targetName: (element.propertyName ?? element.name).text
      }));
    }
  }
  return bindings;
}

function declarationIndex(
  model: SourceProgramModel
): ReadonlyMap<string, SourceProgramDeclaration> {
  const declarations = new Map(model.declarations.map((declaration) => [
    `${declaration.path}\0${declaration.name}`,
    declaration
  ] as const));
  const byObservation = new Map(model.declarations.map((declaration) => [
    declaration.observationId,
    declaration
  ] as const));
  for (const reference of model.references) {
    if (reference.kind !== 'reexport' || reference.targetObservationId === null) continue;
    const target = byObservation.get(reference.targetObservationId);
    if (target === undefined) continue;
    declarations.set(`${reference.path}\0${reference.name}`, target);
  }
  return declarations;
}

function resolvedDeclaration(
  binding: ImportedBinding,
  requestedName: string | null,
  declarations: ReadonlyMap<string, SourceProgramDeclaration>
): SourceProgramDeclaration | null {
  if (binding.targetPath === null) return null;
  const name = binding.targetName === '*' ? requestedName : binding.targetName;
  if (name === null) return null;
  return declarations.get(`${binding.targetPath}\0${name}`) ?? null;
}

function reference(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  kind: SourceProgramReferenceKind,
  name: string,
  binding: ImportedBinding,
  declaration: SourceProgramDeclaration | null,
  signedTargetPath: string | null = declaration?.path ?? null
): SourceProgramReference {
  return Object.freeze({
    path: sourceFile.fileName,
    kind,
    name,
    moduleSpecifier: binding.moduleSpecifier,
    targetObservationId: declaration?.observationId ?? null,
    targetPath: signedTargetPath,
    observationClass: declaration === null && signedTargetPath === null ? 'unknown' : 'observed',
    span: spanFor(sourceFile, node)
  });
}

function callBinding(
  expression: ts.LeftHandSideExpression,
  bindings: ReadonlyMap<string, ImportedBinding>
): Readonly<{
  binding: ImportedBinding;
  requestedName: string | null;
  operation: string;
}> | null {
  if (ts.isIdentifier(expression)) {
    const binding = bindings.get(expression.text);
    return binding === undefined ? null : Object.freeze({
      binding,
      requestedName: null,
      operation: binding.targetName === '*' ? expression.text : binding.targetName
    });
  }
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return null;
  }
  const binding = bindings.get(expression.expression.text);
  return binding === undefined ? null : Object.freeze({
    binding,
    requestedName: expression.name.text,
    operation: expression.name.text
  });
}

function isImportBindingDeclaration(node: ts.Identifier): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current)) return true;
    current = current.parent;
  }
  return false;
}

function isCallTarget(node: ts.Identifier): boolean {
  if ((ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
      && node.parent.expression === node) return true;
  return ts.isPropertyAccessExpression(node.parent)
    && node.parent.expression === node
    && (ts.isCallExpression(node.parent.parent) || ts.isNewExpression(node.parent.parent))
    && node.parent.parent.expression === node.parent;
}

function literalObservationContext(node: ts.StringLiteralLike): Readonly<{
  context: SourceProgramLiteral['context'];
  owner: ts.Node | null;
}> {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isCallExpression(current)) {
      if (ts.isPropertyAccessExpression(current.expression)
          && /^(?:to|not)/u.test(current.expression.name.text)) {
        return Object.freeze({ context: 'assertion', owner: current });
      }
      return Object.freeze({ context: 'argument', owner: current });
    }
    if (ts.isSourceFile(current)) break;
    current = current.parent;
  }
  return Object.freeze({ context: 'literal', owner: node.parent ?? null });
}

function compareSpans(left: SourceProgramSpan, right: SourceProgramSpan): number {
  return left.start - right.start || left.end - right.end;
}

function callIdentity(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = callIdentity(expression.expression);
    return owner === null ? null : `${owner}.${expression.name.text}`;
  }
  if (ts.isCallExpression(expression)) return callIdentity(expression.expression);
  return null;
}

function testRegistrationKind(expression: ts.LeftHandSideExpression): string | null {
  const identity = callIdentity(expression);
  if (identity === null) return null;
  const root = identity.split('.')[0];
  return root === 'test' || root === 'it' ? identity : null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function constantInitializers(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      values.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function staticString(
  expression: ts.Expression,
  testPath: string,
  repositoryRoot: string,
  constants: ReadonlyMap<string, ts.Expression>,
  resolving: ReadonlySet<string> = new Set()
): string | null {
  const current = unwrap(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isIdentifier(current)) {
    const initializer = constants.get(current.text);
    if (initializer === undefined || resolving.has(current.text)) return null;
    return staticString(initializer, testPath, repositoryRoot, constants, new Set([...resolving, current.text]));
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const part of current.templateSpans) {
      const replacement = staticString(part.expression, testPath, repositoryRoot, constants, resolving);
      if (replacement === null) return null;
      value += replacement + part.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(current.left, testPath, repositoryRoot, constants, resolving);
    const right = staticString(current.right, testPath, repositoryRoot, constants, resolving);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isCallExpression(current)) {
    const callee = callIdentity(current.expression);
    if (callee === 'process.cwd' && current.arguments.length === 0) return repositoryRoot;
    if ((callee === 'path.join' || callee === 'path.resolve') && current.arguments.length > 0) {
      const values = current.arguments.map((argument) =>
        staticString(argument, testPath, repositoryRoot, constants, resolving));
      if (values.some((value) => value === null)) return null;
      return callee === 'path.resolve'
        ? path.resolve(...values as string[])
        : path.join(...values as string[]);
    }
  }
  if (ts.isPropertyAccessExpression(current)
      && ts.isMetaProperty(current.expression)
      && current.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
    const absoluteTestPath = path.join(repositoryRoot, testPath);
    if (current.name.text === 'dir') return path.dirname(absoluteTestPath);
    if (current.name.text === 'url') {
      return new URL(`file:///${absoluteTestPath.replaceAll('\\', '/')}`).href;
    }
  }
  if (ts.isNewExpression(current) && callIdentity(current.expression) === 'URL') {
    const [relativeExpression, baseExpression] = current.arguments ?? [];
    if (relativeExpression === undefined || baseExpression === undefined) return null;
    const relative = staticString(relativeExpression, testPath, repositoryRoot, constants, resolving);
    const base = staticString(baseExpression, testPath, repositoryRoot, constants, resolving);
    if (relative === null || base === null) return null;
    try {
      const resolved = new URL(relative, base);
      return resolved.protocol === 'file:' ? decodeURIComponent(resolved.pathname) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function repositoryPath(repositoryRoot: string, value: string): string | null {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repositoryRoot, value);
  const relative = path.relative(repositoryRoot, absolute).replaceAll('\\', '/');
  return relative === '..' || relative.startsWith('../') ? null : relative;
}

function rawTextReadPath(node: ts.CallExpression): ts.Expression | null {
  const identity = callIdentity(node.expression);
  if (identity !== null && (
    identity === 'readFile'
    || identity === 'readFileSync'
    || identity.endsWith('.readFile')
    || identity.endsWith('.readFileSync')
  )) return node.arguments[0] ?? null;
  if (ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'text'
      && ts.isCallExpression(node.expression.expression)
      && callIdentity(node.expression.expression.expression) === 'Bun.file') {
    return node.expression.expression.arguments[0] ?? null;
  }
  return null;
}

function assertionMatcher(node: ts.CallExpression): Readonly<{
  actual: ts.Expression;
  matcher: string;
}> | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  let target: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(target)) target = target.expression;
  if (!ts.isCallExpression(target) || callIdentity(target.expression) !== 'expect') return null;
  const actual = target.arguments[0];
  return actual === undefined ? null : Object.freeze({ actual, matcher: node.expression.name.text });
}

function expressionIdentityName(expression: ts.Expression): string | null {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current) && current.argumentExpression !== undefined) {
    return ts.isStringLiteralLike(current.argumentExpression) ? current.argumentExpression.text : null;
  }
  return null;
}

const IDENTITY_NAME = /^(?:format)?(?:schema|version)$|(?:Schema|Version)$/u;

function versionIdentityAssertion(node: ts.CallExpression): boolean {
  const assertion = assertionMatcher(node);
  if (assertion === null || !['toBe', 'toEqual'].includes(assertion.matcher)) return false;
  const name = expressionIdentityName(assertion.actual);
  return name !== null && IDENTITY_NAME.test(name);
}

function importedBindingNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined
        || !ts.isStringLiteralLike(statement.moduleSpecifier)
        || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (clause.name !== undefined) names.add(clause.name.text);
    if (clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
      continue;
    }
    for (const element of clause.namedBindings.elements) names.add(element.name.text);
  }
  return names;
}

function importedFunctionArityAssertion(
  node: ts.CallExpression,
  importedNames: ReadonlySet<string>
): boolean {
  const assertion = assertionMatcher(node);
  if (assertion === null || !['toBe', 'toEqual'].includes(assertion.matcher)) return false;
  const actual = unwrap(assertion.actual);
  const expected = node.arguments[0] === undefined ? null : unwrap(node.arguments[0]);
  return ts.isPropertyAccessExpression(actual)
    && actual.name.text === 'length'
    && ts.isIdentifier(actual.expression)
    && importedNames.has(actual.expression.text)
    && expected !== null
    && (ts.isNumericLiteral(expected)
      || (ts.isPrefixUnaryExpression(expected) && ts.isNumericLiteral(expected.operand)));
}

function registrationCallback(node: ts.CallExpression): ts.FunctionLikeDeclaration | null {
  for (const argument of node.arguments) {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
  }
  return null;
}

function semanticClassesForRegistration(
  references: readonly SourceProgramReference[],
  capabilities: readonly SourceProgramCapabilityInvocation[],
  registration: ts.CallExpression
): readonly SourceProgramTestSemanticClass[] {
  const classes = new Set<SourceProgramTestSemanticClass>();
  const start = registration.getStart();
  const end = registration.getEnd();
  const registrationReferences = references.filter(({ span }) => span.start >= start && span.end <= end);
  if (registrationReferences.some(({ kind, targetPath }) =>
    (kind === 'call' || kind === 'construct')
    && targetPath !== null
    && sourceProgramSurfaceForPath(targetPath) !== 'test')) classes.add('behavior');
  const registrationCapabilities = capabilities.filter(({ span }) => span.start >= start && span.end <= end);
  if (registrationCapabilities.length > 0) classes.add('effect');
  const operations = new Set(registrationCapabilities.map(({ operation }) => operation.toLowerCase()));
  const hasRead = [...operations].some((operation) => /read|stat|scan|inspect|open/u.test(operation));
  const hasWrite = [...operations].some((operation) => /write|rename|remove|unlink|delete|mkdir|spawn|run/u.test(operation));
  if (hasRead && hasWrite) classes.add('durable-state');
  let hasFailureBoundary = false;
  let hasPropertyIteration = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const matcher = assertionMatcher(node)?.matcher;
      if (matcher !== undefined && /throw|reject|fail/iu.test(matcher)) hasFailureBoundary = true;
    }
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      hasPropertyIteration = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(registration);
  if (hasFailureBoundary) classes.add('failure-boundary');
  if (hasPropertyIteration) classes.add('algorithm-property');
  return Object.freeze([...classes].sort(compareCodeUnits));
}

/**
 * Compile test-only observations without constructing a second Program or
 * TypeChecker.  Import routing comes from the canonical repository graph and
 * every production symbol identity comes from the already-signed production
 * model.  Anything else remains a typed unknown.
 */
function compileSourceProgramTestObservationsInternal(
  input: CompileSourceProgramTestObservationsInternalInput
): SourceProgramTestObservations {
  input.repositoryCompilation?.assertMatches(input);
  if (!isCompiledTypeScriptSourceProgramModel(input.productionModel)
      || input.productionModel.files.some(({ surface }) => surface !== 'production')) {
    throw new Error('test observations require an exact production-only Source Program model');
  }
  if (input.repositoryCompilation !== undefined
      && repositoryCompilationDigestForTypeScriptModel(input.productionModel)
        !== input.repositoryCompilation.contextDigest) {
    throw new Error('test observations cannot mix a production model from another repository compilation');
  }
  const files = [...input.files].sort((left, right) => compareCodeUnits(left.path, right.path));
  if (new Set(files.map(({ path }) => path)).size !== files.length
      || files.some((file) => rawSha256(file.source) !== file.contentDigest)) {
    throw new Error('test observations require canonical exact source bytes');
  }
  const productionFiles = new Map(input.productionModel.files.map((file) => [file.path, file] as const));
  if ([...productionFiles].some(([repositoryPath, observed]) =>
    files.find(({ path }) => path === repositoryPath)?.contentDigest !== observed.contentDigest)) {
    throw new Error('test observations do not bind the production model bytes');
  }
  const sourceByPath = new Map(files.map((file) => [file.path, file.source] as const));
  const graph = input.repositoryCompilation?.moduleGraphFor('test-observations') ?? compileSecRepositoryModuleGraph({
    files: files.map(({ path }) => path),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath) ?? null
  });
  const declarations = declarationIndex(input.productionModel);
  const references: SourceProgramReference[] = [];
  const literals: SourceProgramLiteral[] = [];
  const capabilities: SourceProgramCapabilityInvocation[] = [];
  const registrations: SourceProgramTestRegistrationObservation[] = [];
  const productionSourceReads: SourceProgramTestSourceReadObservation[] = [];
  const unknowns: SourceProgramUnknown[] = [];
  const testFiles = files.filter(({ path }) => sourceProgramSurfaceForPath(path) === 'test');
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  const productionPaths = new Set(productionFiles.keys());

  for (const file of testFiles) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.path)
    );
    const parseDiagnostics = (sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      unknowns.push(Object.freeze({
        code: 'test-source-parse-unresolved',
        path: file.path,
        detail: parseDiagnostics.map(({ code }) => String(code)).join(','),
        span: null
      }));
      continue;
    }
    if (graph.unresolvedFiles.includes(file.path)) {
      unknowns.push(Object.freeze({
        code: 'test-module-import-unresolved',
        path: file.path,
        detail: 'canonical repository graph contains an unresolved local import',
        span: null
      }));
    }
    const bindings = importBindings(sourceFile, graph);
    const constants = constantInitializers(sourceFile);
    const importedNames = importedBindingNames(sourceFile);
    const registrationNodes: ts.CallExpression[] = [];
    const unresolvedBindings = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)
          && !isImportBindingDeclaration(node)
          && !isCallTarget(node)) {
        const binding = bindings.get(node.text);
        if (binding !== undefined) {
          const requestedName = ts.isPropertyAccessExpression(node.parent)
              && node.parent.expression === node
            ? node.parent.name.text
            : null;
          const observedNode = requestedName === null ? node : node.parent;
          const declaration = resolvedDeclaration(binding, requestedName, declarations);
          references.push(reference(
            sourceFile,
            observedNode,
            'reference',
            requestedName ?? binding.targetName,
            binding,
            declaration
          ));
          if (declaration === null
              && binding.targetPath !== null
              && productionFiles.has(binding.targetPath)) {
            unresolvedBindings.add(`${binding.moduleSpecifier}:${requestedName ?? binding.targetName}`);
          }
        }
      }
      if (ts.isStringLiteralLike(node) && node.text.length <= 4096) {
        const literalOwner = literalObservationContext(node);
        literals.push(Object.freeze({
          path: file.path,
          value: node.text,
          context: literalOwner.context,
          contextSpan: literalOwner.owner === null ? null : spanFor(sourceFile, literalOwner.owner),
          span: spanFor(sourceFile, node)
        }));
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (ts.isCallExpression(node) && testRegistrationKind(node.expression) !== null) {
          registrationNodes.push(node);
        }
        if (ts.isCallExpression(node)) {
          const sourcePathExpression = rawTextReadPath(node);
          if (sourcePathExpression !== null) {
            const value = staticString(sourcePathExpression, file.path, repositoryRoot, constants);
            const target = value === null ? null : repositoryPath(repositoryRoot, value);
            if (target !== null && productionPaths.has(target)) {
              productionSourceReads.push(Object.freeze({
                path: file.path,
                target,
                span: spanFor(sourceFile, node)
              }));
            }
          }
        }
        const bound = callBinding(node.expression, bindings);
        const kind: SourceProgramReferenceKind = ts.isNewExpression(node) ? 'construct' : 'call';
        if (bound !== null) {
          const declaration = resolvedDeclaration(bound.binding, bound.requestedName, declarations);
          references.push(reference(
            sourceFile,
            node.expression,
            kind,
            bound.operation,
            bound.binding,
            declaration
          ));
          if (declaration === null
              && bound.binding.targetPath !== null
              && productionFiles.has(bound.binding.targetPath)) {
            unresolvedBindings.add(`${bound.binding.moduleSpecifier}:${bound.operation}`);
          }
          const importedModule = bound.binding.targetPath === null
            ? null
            : input.moduleMembership.moduleForPath(bound.binding.targetPath);
          const provider = importedModule?.capabilityProviders.find(({ operations }) =>
            operations.includes(bound.operation)) ?? null;
          const nativeProcess = bound.binding.moduleSpecifier === 'node:child_process'
            || (bound.binding.moduleSpecifier === 'bun' && /^(?:spawn|spawnSync|which)$/u.test(bound.operation));
          const runtimeBuiltin = RUNTIME_BUILTIN_MODULE.test(bound.binding.moduleSpecifier)
            && !nativeProcess;
          const capability = nativeProcess
            ? 'process'
            : provider !== null
              ? 'provider'
              : /^(?:node:fs|node:fs\/promises)$/u.test(bound.binding.moduleSpecifier)
                ? 'filesystem'
                : null;
          if (capability !== null) {
            const firstArgument = node.arguments?.[0];
            capabilities.push(Object.freeze({
              path: file.path,
              moduleId: input.moduleMembership.moduleForPath(file.path)?.moduleId ?? null,
              surface: 'test',
              capability,
              operation: bound.operation,
              subject: firstArgument !== undefined && ts.isStringLiteralLike(firstArgument)
                ? firstArgument.text
                : null,
              transport: nativeProcess
                ? 'native-runtime'
                : provider !== null
                  ? 'repository-provider'
                  : runtimeBuiltin
                    ? 'runtime-built-in-api'
                    : 'package-api',
              moduleSpecifier: bound.binding.moduleSpecifier,
              providerCapability: provider?.capability ?? null,
              providerModuleId: provider === null ? null : importedModule!.moduleId,
              observationClass: provider !== null || nativeProcess || runtimeBuiltin
                ? 'observed'
                : 'unknown',
              span: spanFor(sourceFile, node)
            }));
          }
        }
        if (bound === null && ts.isCallExpression(node)) {
          const operation = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
                && ts.isIdentifier(node.expression.expression)
                && node.expression.expression.text === 'Bun'
              ? node.expression.name.text
              : null;
          const capability = operation === 'fetch'
            ? 'network'
            : operation === 'eval' || operation === 'Function'
              ? 'dynamic-code'
              : /^(?:spawn|spawnSync|which)$/u.test(operation ?? '')
                  && ts.isPropertyAccessExpression(node.expression)
                  && ts.isIdentifier(node.expression.expression)
                  && node.expression.expression.text === 'Bun'
                ? 'process'
                : null;
          if (capability !== null && operation !== null) {
            const firstArgument = node.arguments[0];
            capabilities.push(Object.freeze({
              path: file.path,
              moduleId: input.moduleMembership.moduleForPath(file.path)?.moduleId ?? null,
              surface: 'test',
              capability,
              operation,
              subject: firstArgument !== undefined && ts.isStringLiteralLike(firstArgument)
                ? firstArgument.text
                : null,
              transport: capability === 'process' ? 'native-runtime' : 'runtime-built-in-api',
              moduleSpecifier: capability === 'process' ? 'bun' : null,
              providerCapability: null,
              providerModuleId: null,
              observationClass: 'observed',
              span: spanFor(sourceFile, node)
            }));
          }
        }
        const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        if (dynamicImport) {
          const argument = node.arguments?.[0];
          if (argument === undefined || !ts.isStringLiteralLike(argument)) {
            unknowns.push(Object.freeze({
              code: 'test-dynamic-module-unresolved',
              path: file.path,
              detail: 'dynamic import specifier is not a static string',
              span: spanFor(sourceFile, node)
            }));
          } else {
            const targetPath = graphTarget(graph, file.path, argument.text, 'dynamic');
            const dynamicBinding = Object.freeze({
              moduleSpecifier: argument.text,
              targetPath,
              targetName: '*'
            });
            references.push(reference(
              sourceFile,
              argument,
              'import',
              '*',
              dynamicBinding,
              null,
              targetPath !== null && productionFiles.has(targetPath) ? targetPath : null
            ));
            if (argument.text.startsWith('.') && targetPath === null) {
              unknowns.push(Object.freeze({
                code: 'test-dynamic-module-unresolved',
                path: file.path,
                detail: `canonical repository graph cannot resolve ${argument.text}`,
                span: spanFor(sourceFile, argument)
              }));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    for (const detail of [...unresolvedBindings].sort(compareCodeUnits)) {
      unknowns.push(Object.freeze({
        code: 'test-production-binding-unresolved',
        path: file.path,
        detail,
        span: null
      }));
    }
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const targetPath = graphTarget(graph, file.path, specifier);
      const exportedNames = statement.exportClause !== undefined
          && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((element) => (element.propertyName ?? element.name).text)
        : ['*'];
      for (const exportedName of exportedNames) {
        const binding = Object.freeze({ moduleSpecifier: specifier, targetPath, targetName: exportedName });
        const declaration = exportedName === '*' ? null : resolvedDeclaration(binding, null, declarations);
        references.push(reference(
          sourceFile,
          statement,
          'reexport',
          exportedName,
          binding,
          declaration,
          targetPath !== null && productionFiles.has(targetPath) ? targetPath : null
        ));
      }
    }
    const fileReferences = references.filter(({ path: observationPath }) => observationPath === file.path);
    const fileCapabilities = capabilities.filter(({ path: observationPath }) => observationPath === file.path);
    registrationNodes.forEach((registration, index) => {
      const kind = testRegistrationKind(registration.expression)!;
      const titleExpression = registration.arguments[0];
      const title = titleExpression === undefined
        ? null
        : staticString(titleExpression, file.path, repositoryRoot, constants);
      const callback = registrationCallback(registration);
      const assertionNodes: ts.CallExpression[] = [];
      if (callback !== null) {
        const visitRegistration = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && assertionMatcher(node) !== null) assertionNodes.push(node);
          ts.forEachChild(node, visitRegistration);
        };
        visitRegistration(callback);
      }
      const assertionObservations = Object.freeze(assertionNodes.map((assertion) => {
        const shape = assertionMatcher(assertion)!;
        const expressions = [shape.actual, assertion.arguments[0]]
          .filter((expression): expression is ts.Expression => expression !== undefined);
        let productionPathLayoutTarget: string | null = null;
        for (const expression of expressions) {
          const current = unwrap(expression);
          const isPathLayoutExpression = ts.isStringLiteralLike(current)
            || (ts.isCallExpression(current)
              && (callIdentity(current.expression) === 'path.join'
                || callIdentity(current.expression) === 'path.resolve'));
          if (!isPathLayoutExpression) continue;
          const value = staticString(expression, file.path, repositoryRoot, constants);
          const target = value === null ? null : repositoryPath(repositoryRoot, value);
          if (target !== null && productionPaths.has(target)) {
            productionPathLayoutTarget = target;
            break;
          }
        }
        return Object.freeze({
          span: spanFor(sourceFile, assertion),
          matcher: shape.matcher,
          versionIdentityOnly: versionIdentityAssertion(assertion),
          importedFunctionArity: importedFunctionArityAssertion(assertion, importedNames),
          productionPathLayoutTarget
        });
      }));
      const registrationStart = registration.getStart(sourceFile);
      const registrationEnd = registration.getEnd();
      const observedProductionPaths = Object.freeze([...new Set(fileReferences
        .filter(({ targetPath, span }) => targetPath !== null
          && productionPaths.has(targetPath)
          && span.start >= registrationStart
          && span.end <= registrationEnd)
        .map(({ targetPath }) => targetPath!))].sort(compareCodeUnits));
      const capabilityOperations = Object.freeze([...new Set(fileCapabilities
        .filter(({ span }) => span.start >= registrationStart && span.end <= registrationEnd)
        .map(({ operation }) => operation))].sort(compareCodeUnits));
      const semanticClasses = semanticClassesForRegistration(fileReferences, fileCapabilities, registration);
      registrations.push(Object.freeze({
        path: file.path,
        index,
        kind,
        title,
        span: spanFor(sourceFile, registration),
        assertions: assertionObservations,
        semanticClasses,
        observedProductionPaths,
        capabilityOperations,
        unknowns: semanticClasses.length === 0
          ? Object.freeze(['test-semantic-class-unresolved'])
          : Object.freeze([])
      }));
    });
  }

  references.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.name, right.name));
  literals.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span));
  capabilities.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span)
    || compareCodeUnits(left.operation, right.operation));
  registrations.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span));
  productionSourceReads.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span)
    || compareCodeUnits(left.target, right.target));
  unknowns.sort((left, right) => compareCodeUnits(left.path, right.path)
    || (left.span?.start ?? -1) - (right.span?.start ?? -1)
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.detail, right.detail));
  const canonical = Object.freeze({
    // The revision names the repository snapshot shared with the production
    // model. Exact test bytes are independently bound by observationDigest;
    // replacing this with a second derived revision would create two owners
    // for the same repository epoch.
    sourceRevision: input.productionModel.sourceRevision,
    productionModelDigest: input.productionModel.modelDigest,
    testPaths: Object.freeze(testFiles.map(({ path }) => path)),
    references: Object.freeze(references),
    literals: Object.freeze(literals),
    capabilities: Object.freeze(capabilities),
    registrations: Object.freeze(registrations),
    productionSourceReads: Object.freeze(productionSourceReads),
    unknowns: Object.freeze(unknowns)
  });
  const observations = Object.freeze({
    ...canonical,
    observationDigest: sha256(canonical)
  });
  if (input.repositoryCompilation !== undefined) {
    repositoryCompilationDigestByObservations.set(
      observations,
      input.repositoryCompilation.contextDigest
    );
  }
  observationsByFiles.set(input.files, observations);
  return observations;
}

export function compileSourceProgramTestObservations(
  input: CompileSourceProgramTestObservationsInput
): SourceProgramTestObservations {
  return compileSourceProgramTestObservationsInternal(input);
}

export function compileSourceProgramTestObservationsFromRepositoryCompilation(
  input: CompileSourceProgramTestObservationsInput,
  repositoryCompilation: IssuedRepositoryCompilationContext
): SourceProgramTestObservations {
  repositoryCompilation.assertMatches(input);
  return compileSourceProgramTestObservationsInternal({ ...input, repositoryCompilation });
}
