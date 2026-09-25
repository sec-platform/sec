import path from 'node:path';

import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  type RepositoryModuleGraph,
  type RepositoryModuleMembership
} from '../architecture/contract.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  sourceProgramSurfaceForPath,
  type SourceProgramCapabilityInvocation,
  type SourceProgramDeclaration,
  type SourceProgramFileInput,
  type SourceProgramLiteral,
  type SourceProgramModel,
  type SourceProgramOperationRoleProvenance,
  type SourceProgramReference,
  type SourceProgramReferenceKind,
  type SourceProgramSpan,
  type SourceProgramUnknown
} from './contract.ts';
import { resolveRepositoryModuleImportCandidates } from './module-graph.ts';
import {
  compileRepositoryModuleGraph,
  isCompiledTypeScriptModel,
  identifierInitializer,
  identifierIsAmbientGlobal,
  identifierResolvesToImport,
  typeScriptSourceFile,
  workspaceSnapshotIdentityForTypeScriptModel
} from './typescript.ts';
import type { WorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

export interface TestObservationsInput {
  /** Production-only facts signed by the canonical Source Program compiler. */
  readonly productionModel: SourceProgramModel;
  /** Exact production and test bytes for the candidate revision. */
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: RepositoryModuleMembership;
  readonly repositoryRoot?: string;
  /** Reuse the enclosing compilation operation; this module never issues one. */
  readonly operation?: SourceProgramCompilationOperation;
}

type TestObservationsInternalInput = Omit<
  TestObservationsInput,
  'operation'
> & Readonly<{
  operation: SourceProgramCompilationOperation;
  repositoryCompilation?: WorkspaceSourceSnapshot;
}>;

export type TestSemanticClass =
  | 'behavior'
  | 'durable-state'
  | 'effect'
  | 'failure-boundary'
  | 'algorithm-property'
  | 'external-protocol';

interface SourceProgramTestAssertionObservation {
  readonly span: SourceProgramSpan;
  readonly matcher: string;
  readonly negated: boolean;
  readonly actualFromProductionSubject: boolean;
  readonly expectedFromProductionSubject: boolean;
  readonly expectedSharesActualProductionRoute: boolean;
  readonly versionIdentityOnly: boolean;
  readonly importedFunctionArity: boolean;
  readonly productionPathLayoutTarget: string | null;
}

interface SourceProgramTestRegistrationObservation {
  readonly path: string;
  readonly index: number;
  readonly kind: string;
  readonly title: string | null;
  readonly span: SourceProgramSpan;
  readonly assertions: readonly SourceProgramTestAssertionObservation[];
  readonly semanticClasses: readonly TestSemanticClass[];
  readonly observedProductionPaths: readonly string[];
  readonly capabilityOperations: readonly string[];
  readonly capabilityObservationIds: readonly string[];
  readonly registrationProvenance: readonly SourceProgramOperationRoleProvenance[];
  readonly supervisorPolicyProvenance: readonly SourceProgramOperationRoleProvenance[];
  readonly terminalProvenance: readonly SourceProgramOperationRoleProvenance[];
  readonly readbackProvenance: readonly SourceProgramOperationRoleProvenance[];
  readonly unknownEdges: readonly string[];
  readonly unknowns: readonly string[];
}

interface SourceProgramTestSourceReadObservation {
  readonly path: string;
  readonly target: string;
  readonly span: SourceProgramSpan;
}

interface SourceProgramTestLocalProgramInvocationObservation {
  readonly path: string;
  readonly target: string;
  readonly span: SourceProgramSpan;
}

export interface TestObservations {
  readonly sourceRevision: string;
  readonly productionModelDigest: string;
  readonly testPaths: readonly string[];
  readonly references: readonly SourceProgramReference[];
  readonly literals: readonly SourceProgramLiteral[];
  readonly capabilities: readonly SourceProgramCapabilityInvocation[];
  readonly registrations: readonly SourceProgramTestRegistrationObservation[];
  readonly productionSourceReads: readonly SourceProgramTestSourceReadObservation[];
  readonly resourceReads: readonly SourceProgramTestSourceReadObservation[];
  /** Static local TypeScript argv targets invoked through the current Bun process. */
  readonly localProgramInvocations: readonly SourceProgramTestLocalProgramInvocationObservation[];
  readonly unknowns: readonly SourceProgramUnknown[];
  readonly observationDigest: string;
}

export const TEST_CONTRACT_CENSUS_UNRESOLVED_REASONS = Object.freeze([
  'baseline-exact-generation-unavailable',
  'baseline-test-source-unavailable',
  'baseline-test-source-unresolved',
  'candidate-exact-generation-unavailable'
] as const);

export type TestContractCensusUnresolvedReason =
  typeof TEST_CONTRACT_CENSUS_UNRESOLVED_REASONS[number];

export type TestContractCensusObservation = Readonly<{
  status: 'resolved';
  census: Readonly<{
    producerCount: number;
    consumerCount: number;
    externalContractCount: number;
  }>;
  observationDigest: `sha256:${string}`;
}> | Readonly<{
  status: 'unresolved';
  reason: TestContractCensusUnresolvedReason;
  observationDigest: `sha256:${string}`;
}>;

const observationsByFiles = new WeakMap<
  readonly SourceProgramFileInput[],
  TestObservations
>();
const repositoryCompilationDigestByObservations = new WeakMap<object, `sha256:${string}`>();

export function snapshotIdentityForTestObservations(
  observations: TestObservations
): `sha256:${string}` | null {
  return repositoryCompilationDigestByObservations.get(observations) ?? null;
}

export function testObservationsForFiles(
  files: readonly SourceProgramFileInput[],
  sourceRevision: string
): TestObservations | null {
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
  targets: ReadonlyMap<string, string | null>,
  from: string,
  moduleSpecifier: string,
  kind: 'static' | 'dynamic' | 'require' = 'static'
): string | null {
  return targets.get(`${from}\0${kind}\0${moduleSpecifier}`) ?? null;
}

function graphTargetIndex(
  graph: RepositoryModuleGraph,
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, string | null> {
  const targets = new Map<string, string | null>();
  for (const reference of graph.references) {
    checkpoint(operation);
    const key = `${reference.from}\0${reference.kind}\0${reference.specifier}`;
    // Preserve the former Array.find semantics if an unresolved graph ever
    // contains more than one candidate for the same import edge.
    if (!targets.has(key)) targets.set(key, reference.resolvedTarget);
  }
  return targets;
}

function importBindings(
  sourceFile: ts.SourceFile,
  graphTargets: ReadonlyMap<string, string | null>
): ReadonlyMap<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
        || statement.importClause === undefined
        || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const targetPath = graphTarget(graphTargets, sourceFile.fileName, moduleSpecifier);
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
  model: SourceProgramModel,
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, SourceProgramDeclaration> {
  const declarations = new Map<string, SourceProgramDeclaration>();
  const byObservation = new Map<string, SourceProgramDeclaration>();
  for (const declaration of model.declarations) {
    checkpoint(operation);
    declarations.set(`${declaration.path}\0${declaration.name}`, declaration);
    byObservation.set(declaration.observationId, declaration);
  }
  for (const reference of model.references) {
    checkpoint(operation);
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

function operationRoleProvenance(
  declaration: SourceProgramDeclaration,
  moduleMembership: RepositoryModuleMembership
): readonly SourceProgramOperationRoleProvenance[] {
  const module = moduleMembership.moduleForPath(declaration.path);
  if (module === null) return Object.freeze([]);
  return Object.freeze(module.capabilityProviders.flatMap((provider) => (
    provider.operationRoles
      .filter(({ operation }) => operation === declaration.name)
      .map((binding) => Object.freeze({
        declarationObservationId: declaration.observationId,
        moduleId: module.moduleId,
        capability: provider.capability,
        operation: binding.operation,
        role: binding.role,
        semanticOperation: binding.semanticOperation,
        requirementId: binding.requirementId
      }))
  )));
}

function callReferenceForExpression(
  sourceFile: ts.SourceFile,
  repositoryPath: string,
  expression: ts.LeftHandSideExpression,
  callReferencesByPath: ReadonlyMap<string, readonly SourceProgramReference[]>
): SourceProgramReference | null {
  const start = expression.getStart(sourceFile, false);
  const end = expression.getEnd();
  const references = callReferencesByPath.get(repositoryPath) ?? [];
  let lower = 0;
  let upper = references.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (references[middle]!.span.start < start) lower = middle + 1;
    else upper = middle;
  }
  let candidate: SourceProgramReference | null = null;
  for (let index = lower; index < references.length; index += 1) {
    const reference = references[index]!;
    if (reference.span.start > end) break;
    if (reference.span.end > end) continue;
    if (candidate !== null) return null;
    candidate = reference;
  }
  return candidate;
}

function recordsByPath<T extends Readonly<{ readonly path: string }>>(
  records: readonly T[],
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    checkpoint(operation);
    const pathRecords = grouped.get(record.path) ?? [];
    pathRecords.push(record);
    grouped.set(record.path, pathRecords);
  }
  return new Map([...grouped].map(([repositoryPath, pathRecords]) => [
    repositoryPath,
    Object.freeze(pathRecords)
  ] as const));
}

function callReferenceIndex(
  references: readonly SourceProgramReference[],
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, readonly SourceProgramReference[]> {
  const calls: SourceProgramReference[] = [];
  for (const reference of references) {
    checkpoint(operation);
    if (reference.kind === 'call') calls.push(reference);
  }
  const grouped = recordsByPath(calls, operation);
  return new Map([...grouped].map(([repositoryPath, pathReferences]) => [
    repositoryPath,
    Object.freeze([...pathReferences].sort((left, right) => (
      left.span.start - right.span.start
      || left.span.end - right.span.end
      || compareCodeUnits(left.name, right.name)
      || compareCodeUnits(left.targetObservationId ?? '', right.targetObservationId ?? '')
    )))
  ] as const));
}

function compilerRegistrationKind(
  sourceFile: ts.SourceFile,
  repositoryPath: string,
  node: ts.CallExpression,
  callReferencesByPath: ReadonlyMap<string, readonly SourceProgramReference[]>,
  declarationsByObservation: ReadonlyMap<string, SourceProgramDeclaration>,
  moduleMembership: RepositoryModuleMembership
): string | null {
  const direct = testRegistrationKind(node.expression);
  if (direct !== null) return direct;
  return compilerRegistrationProvenance(
    sourceFile,
    repositoryPath,
    node,
    callReferencesByPath,
    declarationsByObservation,
    moduleMembership
  )[0]?.operation ?? null;
}

function compilerRegistrationProvenance(
  sourceFile: ts.SourceFile,
  repositoryPath: string,
  node: ts.CallExpression,
  callReferencesByPath: ReadonlyMap<string, readonly SourceProgramReference[]>,
  declarationsByObservation: ReadonlyMap<string, SourceProgramDeclaration>,
  moduleMembership: RepositoryModuleMembership
): readonly SourceProgramOperationRoleProvenance[] {
  if (testRegistrationKind(node.expression) !== null) return Object.freeze([]);
  const call = callReferenceForExpression(
    sourceFile,
    repositoryPath,
    node.expression,
    callReferencesByPath
  );
  if (call?.targetObservationId === null || call === null) return Object.freeze([]);
  const declaration = declarationsByObservation.get(call.targetObservationId);
  if (declaration === undefined) return Object.freeze([]);
  return Object.freeze(operationRoleProvenance(declaration, moduleMembership)
    .filter(({ role }) => role === 'registration-issuer'));
}

function reachableDeclarationIds(
  registrationSpan: SourceProgramSpan,
  path: string,
  callReferencesByPath: ReadonlyMap<string, readonly SourceProgramReference[]>,
  declarationsByObservation: ReadonlyMap<string, SourceProgramDeclaration>,
  containedDeclarationIdsByObservation: ReadonlyMap<string, readonly string[]>,
  callTargetIdsBySourceObservation: ReadonlyMap<string, readonly string[]>,
  operation: SourceProgramCompilationOperation
): ReadonlySet<string> {
  const reachable = new Set(recordsWithinSpan(
    callReferencesByPath.get(path) ?? [],
    registrationSpan.start,
    registrationSpan.end
  ).filter((reference) => reference.targetObservationId !== null)
    .map((reference) => reference.targetObservationId!));
  const queue = [...reachable];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    checkpoint(operation);
    const sourceObservationId = queue[queueIndex]!;
    if (!declarationsByObservation.has(sourceObservationId)) continue;
    for (const targetObservationId of [
      ...(containedDeclarationIdsByObservation.get(sourceObservationId) ?? []),
      ...(callTargetIdsBySourceObservation.get(sourceObservationId) ?? [])
    ]) {
      if (reachable.has(targetObservationId)) continue;
      reachable.add(targetObservationId);
      queue.push(targetObservationId);
    }
  }
  return reachable;
}

function declarationReachabilityIndexes(
  declarations: readonly SourceProgramDeclaration[],
  references: readonly SourceProgramReference[],
  operation: SourceProgramCompilationOperation
): Readonly<{
  declarationsByObservation: ReadonlyMap<string, SourceProgramDeclaration>;
  containedDeclarationIdsByObservation: ReadonlyMap<string, readonly string[]>;
  callTargetIdsBySourceObservation: ReadonlyMap<string, readonly string[]>;
}> {
  const declarationsByObservation = new Map<string, SourceProgramDeclaration>();
  for (const declaration of declarations) {
    checkpoint(operation);
    declarationsByObservation.set(declaration.observationId, declaration);
  }
  const declarationsByPath = recordsByPath(declarations, operation);
  const containedDeclarationIdsByObservation = new Map<string, readonly string[]>();
  for (const pathDeclarations of declarationsByPath.values()) {
    checkpoint(operation);
    const ordered = [...pathDeclarations].sort((left, right) => (
      left.span.start - right.span.start
      || right.span.end - left.span.end
      || compareCodeUnits(left.observationId, right.observationId)
    ));
    for (const declaration of ordered) {
      checkpoint(operation);
      let lower = 0;
      let upper = ordered.length;
      while (lower < upper) {
        const middle = (lower + upper) >>> 1;
        if (ordered[middle]!.span.start < declaration.span.start) lower = middle + 1;
        else upper = middle;
      }
      const contained: string[] = [];
      for (let index = lower; index < ordered.length; index += 1) {
        const nested = ordered[index]!;
        if (nested.span.start > declaration.span.end) break;
        if (nested.observationId !== declaration.observationId
            && nested.span.end <= declaration.span.end) {
          contained.push(nested.observationId);
        }
      }
      containedDeclarationIdsByObservation.set(
        declaration.observationId,
        Object.freeze(contained)
      );
    }
  }
  const callTargets = new Map<string, Set<string>>();
  for (const reference of references) {
    checkpoint(operation);
    if (reference.kind !== 'call'
        || reference.sourceObservationId === null
        || reference.targetObservationId === null) continue;
    const targets = callTargets.get(reference.sourceObservationId) ?? new Set<string>();
    targets.add(reference.targetObservationId);
    callTargets.set(reference.sourceObservationId, targets);
  }
  return Object.freeze({
    declarationsByObservation,
    containedDeclarationIdsByObservation,
    callTargetIdsBySourceObservation: new Map([...callTargets].map(([observationId, targets]) => [
      observationId,
      Object.freeze([...targets].sort(compareCodeUnits))
    ] as const))
  });
}

function checkpoint(operation: SourceProgramCompilationOperation): void {
  sourceProgramCompilationCheckpoint(operation, 'test-observations');
}

function spannedRecordsByPath<T extends Readonly<{
  readonly path: string;
  readonly span: SourceProgramSpan;
}>>(
  records: readonly T[],
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, readonly T[]> {
  return new Map([...recordsByPath(records, operation)].map(([repositoryPath, pathRecords]) => [
    repositoryPath,
    Object.freeze([...pathRecords].sort((left, right) => (
      left.span.start - right.span.start || left.span.end - right.span.end
    )))
  ] as const));
}

function recordsWithinSpan<T extends Readonly<{ readonly span: SourceProgramSpan }>>(
  records: readonly T[],
  start: number,
  end: number
): readonly T[] {
  let lower = 0;
  let upper = records.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (records[middle]!.span.start < start) lower = middle + 1;
    else upper = middle;
  }
  const contained: T[] = [];
  for (let index = lower; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.span.start > end) break;
    if (record.span.end <= end) contained.push(record);
  }
  return contained;
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
    sourceObservationId: null,
    sourceRelation: 'module-initialization',
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
  if (root !== 'test' && root !== 'it') return null;
  // Bun/Jest/Vitest conditional, table and fixture APIs return a registrar;
  // their factory invocation is not a case. The outer call supplies the case.
  // Vitest scoped/override configure fixtures and never register a case.
  const member = ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
  if (member === 'scoped' || member === 'override') return null;
  if (member !== null && [
    'if', 'skipIf', 'todoIf', 'runIf', 'each', 'for', 'extend'
  ].includes(member)) return null;
  return identity;
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

function constantInitializers(
  sourceFile: ts.SourceFile,
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    checkpoint(operation);
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

function rawTextReadPath(
  node: ts.CallExpression,
  bindings: ReadonlyMap<string, ImportedBinding>,
  model: SourceProgramModel,
  repositoryPath: string
): ts.Expression | null {
  const bound = callBinding(node.expression, bindings);
  const callee = ts.isIdentifier(node.expression) ? node.expression
    : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      ? node.expression.expression : null;
  if (bound !== null && callee !== null
      && ((['node:fs', 'fs'].includes(bound.binding.moduleSpecifier)
          && (bound.operation === 'readFile' || bound.operation === 'readFileSync'))
        || (['node:fs/promises', 'fs/promises'].includes(bound.binding.moduleSpecifier)
          && bound.operation === 'readFile'))
      && identifierResolvesToImport(
        model, repositoryPath, callee, bound.binding.moduleSpecifier, bound.binding.targetName
      )) return node.arguments[0] ?? null;
  if (ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'text'
      && ts.isCallExpression(node.expression.expression)) {
    const fileCall = node.expression.expression;
    if (ts.isPropertyAccessExpression(fileCall.expression)
        && fileCall.expression.name.text === 'file'
        && ts.isIdentifier(fileCall.expression.expression)
        && (identifierIsAmbientGlobal(
          model, repositoryPath, fileCall.expression.expression, 'Bun'
        ) || identifierResolvesToImport(
          model, repositoryPath, fileCall.expression.expression, 'bun', '*'
        ))) return fileCall.arguments[0] ?? null;
  }
  return null;
}

function isCurrentProcessExecutable(
  expression: ts.Expression,
  model: SourceProgramModel,
  repositoryPath: string
): boolean {
  const current = unwrap(expression);
  return ts.isPropertyAccessExpression(current)
    && ts.isIdentifier(current.expression)
    && current.expression.text === 'process'
    && current.name.text === 'execPath'
    && (identifierIsAmbientGlobal(
        model,
        repositoryPath,
        current.expression,
        'process'
      ) || identifierResolvesToImport(
        model,
        repositoryPath,
        current.expression,
        'node:process',
        'default'
      ));
}

function localProgramInvocationArgument(
  node: ts.CallExpression,
  bindings: ReadonlyMap<string, ImportedBinding>,
  model: SourceProgramModel,
  repositoryPath: string
): readonly ts.Expression[] | null | undefined {
  const bound = callBinding(node.expression, bindings);
  if (bound !== null
      && ['node:child_process', 'child_process'].includes(bound.binding.moduleSpecifier)
      && (bound.operation === 'spawn' || bound.operation === 'spawnSync')) {
    const calleeIdentifier = ts.isIdentifier(node.expression)
      ? node.expression
      : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        ? node.expression.expression
        : null;
    if (calleeIdentifier === null
        || !identifierResolvesToImport(
          model,
          repositoryPath,
          calleeIdentifier,
          bound.binding.moduleSpecifier,
          bound.binding.targetName
        )) return undefined;
    const [executable, argv] = node.arguments;
    if (executable === undefined
        || !isCurrentProcessExecutable(executable, model, repositoryPath)) {
      return undefined;
    }
    const argumentList = argv === undefined ? null : unwrap(argv);
    if (argumentList === null || !ts.isArrayLiteralExpression(argumentList)) return null;
    const program = argumentList.elements[0];
    return program === undefined ? null : Object.freeze([program]);
  }

  if (!ts.isPropertyAccessExpression(node.expression)
      || !ts.isIdentifier(node.expression.expression)
      || node.expression.expression.text !== 'Bun'
      || (node.expression.name.text !== 'spawn' && node.expression.name.text !== 'spawnSync')
      || !(identifierIsAmbientGlobal(
          model,
          repositoryPath,
          node.expression.expression,
          'Bun'
        ) || identifierResolvesToImport(
          model,
          repositoryPath,
          node.expression.expression,
          'bun',
          '*'
        ))) return undefined;
  const input = node.arguments[0] === undefined ? null : unwrap(node.arguments[0]);
  const safeProperty = (property: ts.ObjectLiteralElementLike): property is ts.PropertyAssignment & {
    name: ts.Identifier | ts.StringLiteralLike;
  } => (
    ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
  );
  let commandList: ts.Expression | null = input !== null && ts.isArrayLiteralExpression(input)
    ? input
    : null;
  if (input !== null && ts.isObjectLiteralExpression(input)) {
    const properties = input.properties.filter(safeProperty);
    if (properties.length !== input.properties.length) return null;
    const commandProperties = properties.filter((property) => property.name.text === 'cmd');
    if (commandProperties.length === 1) commandList = unwrap(commandProperties[0]!.initializer);
  }
  if (commandList === null || !ts.isArrayLiteralExpression(commandList)) return null;
  const [executable, firstArgument, secondArgument] = commandList.elements;
  if (executable === undefined
      || !isCurrentProcessExecutable(executable, model, repositoryPath)) return null;
  if (firstArgument === undefined) return null;
  if (ts.isStringLiteralLike(firstArgument) && firstArgument.text === '--no-env-file') {
    return secondArgument === undefined ? null : Object.freeze([secondArgument]);
  }
  return Object.freeze([firstArgument]);
}

function assertionMatcher(node: ts.CallExpression): Readonly<{
  actual: ts.Expression;
  matcher: string;
  negated: boolean;
}> | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  let target: ts.Expression = node.expression.expression;
  let negated = false;
  while (ts.isPropertyAccessExpression(target)) {
    if (target.name.text === 'not') negated = true;
    target = target.expression;
  }
  if (!ts.isCallExpression(target) || callIdentity(target.expression) !== 'expect') return null;
  const actual = target.arguments[0];
  return actual === undefined ? null : Object.freeze({
    actual,
    matcher: node.expression.name.text,
    negated
  });
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

type CandidateTestContractIndex = Readonly<{
  candidatePaths: ReadonlySet<string>;
  candidateExports: ReadonlySet<string>;
}>;

const candidateTestContractIndexes = new WeakMap<object, CandidateTestContractIndex>();

function candidateTestContractIndex(
  model: SourceProgramModel,
  operation: SourceProgramCompilationOperation
): CandidateTestContractIndex {
  const cached = candidateTestContractIndexes.get(model);
  if (cached !== undefined) return cached;
  const candidatePaths = new Set<string>();
  for (const file of model.files) {
    sourceProgramCompilationCheckpoint(operation, 'baseline-test-evidence');
    candidatePaths.add(file.path);
  }
  const candidateExports = new Set<string>();
  for (const declaration of model.declarations) {
    sourceProgramCompilationCheckpoint(operation, 'baseline-test-evidence');
    if (declaration.exported) candidateExports.add(declaration.name);
  }
  const index = Object.freeze({
    candidatePaths,
    candidateExports
  });
  candidateTestContractIndexes.set(model, index);
  return index;
}

/**
 * Observe one baseline test contract from the exact baseline Program against
 * one exact candidate Program.  The two generations remain distinct; this
 * projection never reparses either snapshot and never turns an unresolved
 * compiler origin into consumer-zero evidence.
 */
export function observeTestContractCensus(
  baselineModel: SourceProgramModel,
  candidateModel: SourceProgramModel,
  repositoryPath: string,
  operation?: SourceProgramCompilationOperation
): TestContractCensusObservation {
  const censusOperation = resolveSourceProgramCompilationOperation(operation);
  sourceProgramCompilationCheckpoint(censusOperation, 'baseline-test-evidence');
  const unresolved = (
    reason: TestContractCensusUnresolvedReason
  ): TestContractCensusObservation => Object.freeze({
    status: 'unresolved' as const,
    reason,
    observationDigest: sha256({
      status: 'unresolved',
      reason,
      repositoryPath,
      baselineSourceRevision: baselineModel.sourceRevision,
      candidateSourceRevision: candidateModel.sourceRevision
    }) as `sha256:${string}`
  });
  if (!isCompiledTypeScriptModel(baselineModel)) {
    return unresolved('baseline-exact-generation-unavailable');
  }
  if (!isCompiledTypeScriptModel(candidateModel)) {
    return unresolved('candidate-exact-generation-unavailable');
  }
  const sourceFile = typeScriptSourceFile(baselineModel, repositoryPath);
  if (sourceFile === null) return unresolved('baseline-test-source-unavailable');
  const diagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) return unresolved('baseline-test-source-unresolved');

  const { candidatePaths, candidateExports } = candidateTestContractIndex(
    candidateModel,
    censusOperation
  );
  const relativeSpecifier = (value: string): boolean =>
    value.startsWith('./') || value.startsWith('../');
  const liveRelativeConsumer = (specifier: string): boolean => (
    resolveRepositoryModuleImportCandidates(repositoryPath, specifier)
      .some((candidate) => candidatePaths.has(candidate))
  );
  const importedNames = (statement: ts.ImportDeclaration): readonly string[] => {
    const clause = statement.importClause;
    if (clause === undefined) return Object.freeze([]);
    const names: string[] = [];
    if (clause.name !== undefined) names.push('default');
    if (clause.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) names.push('*');
      else for (const element of clause.namedBindings.elements) {
        names.push((element.propertyName ?? element.name).text);
      }
    }
    return Object.freeze(names);
  };
  const relocatedImportConsumer = (statement: ts.ImportDeclaration): boolean => {
    const names = importedNames(statement);
    return names.includes('*') || names.some((name) => candidateExports.has(name));
  };

  let producerCount = 0;
  let consumerCount = 0;
  let externalContractCount = 0;
  for (const statement of sourceFile.statements) {
    sourceProgramCompilationCheckpoint(censusOperation, 'baseline-test-evidence');
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (TEST_SUPPORT_MODULE.test(specifier)) continue;
      if (relativeSpecifier(specifier)) {
        if (liveRelativeConsumer(specifier) || relocatedImportConsumer(statement)) consumerCount += 1;
      } else externalContractCount += 1;
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      externalContractCount += 1;
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      producerCount += 1;
      if (statement.moduleSpecifier !== undefined
          && ts.isStringLiteralLike(statement.moduleSpecifier)
          && relativeSpecifier(statement.moduleSpecifier.text)
          && liveRelativeConsumer(statement.moduleSpecifier.text)) consumerCount += 1;
      continue;
    }
    if (ts.isExportAssignment(statement)) producerCount += 1;
    if (ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      producerCount += 1;
    }
  }
  const visit = (node: ts.Node): void => {
    sourceProgramCompilationCheckpoint(censusOperation, 'baseline-test-evidence');
    if (ts.isCallExpression(node)) {
      const identity = callIdentity(node.expression);
      if (identity === 'require') {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          if (relativeSpecifier(argument.text)) {
            if (liveRelativeConsumer(argument.text)) consumerCount += 1;
          } else if (!TEST_SUPPORT_MODULE.test(argument.text)) externalContractCount += 1;
        } else externalContractCount += 1;
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          if (relativeSpecifier(argument.text)) {
            if (liveRelativeConsumer(argument.text)) consumerCount += 1;
          } else if (!TEST_SUPPORT_MODULE.test(argument.text)) externalContractCount += 1;
        } else externalContractCount += 1;
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const identity = expressionIdentityName(node.expression);
      if ((identity === 'process' && node.name.text === 'env')
          || (identity === 'Bun' && /^(?:file|spawn|spawnSync)$/u.test(node.name.text))) {
        externalContractCount += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const census = Object.freeze({ producerCount, consumerCount, externalContractCount });
  return Object.freeze({
    status: 'resolved' as const,
    census,
    observationDigest: sha256({
      status: 'resolved',
      repositoryPath,
      baselineSourceRevision: baselineModel.sourceRevision,
      candidateSourceRevision: candidateModel.sourceRevision,
      census
    }) as `sha256:${string}`
  });
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

function expressionReferenceTargets(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  references: readonly SourceProgramReference[],
  model: SourceProgramModel,
  repositoryPath: string,
  resolving: ReadonlySet<number> = new Set()
): ReadonlySet<string> {
  const current = unwrap(expression);
  const start = current.getStart(sourceFile, false);
  const end = current.getEnd();
  const targets = new Set(recordsWithinSpan(references, start, end)
    .map(({ targetObservationId }) => targetObservationId)
    .filter((targetObservationId): targetObservationId is string => targetObservationId !== null));
  if (ts.isIdentifier(current)) {
    const initializer = identifierInitializer(
      model,
      repositoryPath,
      current
    );
    const initializerStart = initializer?.getStart(sourceFile, false) ?? null;
    if (initializer !== null
        && initializerStart !== null
        && !resolving.has(initializerStart)) {
      for (const target of expressionReferenceTargets(
        sourceFile,
        initializer,
        references,
        model,
        repositoryPath,
        new Set([...resolving, initializerStart])
      )) targets.add(target);
    }
  }
  ts.forEachChild(current, (child) => {
    if (!ts.isExpression(child)) return;
    for (const target of expressionReferenceTargets(
      sourceFile,
      child,
      references,
      model,
      repositoryPath,
      resolving
    )) targets.add(target);
  });
  return targets;
}

function reachableReferenceTargets(
  seeds: ReadonlySet<string>,
  containedDeclarationIdsByObservation: ReadonlyMap<string, readonly string[]>,
  callTargetIdsBySourceObservation: ReadonlyMap<string, readonly string[]>,
  operation: SourceProgramCompilationOperation
): ReadonlySet<string> {
  const reachable = new Set(seeds);
  const queue = [...seeds];
  for (let index = 0; index < queue.length; index += 1) {
    checkpoint(operation);
    for (const target of [
      ...(containedDeclarationIdsByObservation.get(queue[index]!) ?? []),
      ...(callTargetIdsBySourceObservation.get(queue[index]!) ?? [])
    ]) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
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
  registration: ts.CallExpression,
  operation: SourceProgramCompilationOperation
): readonly TestSemanticClass[] {
  const classes = new Set<TestSemanticClass>();
  if (references.some(({ kind, targetPath }) =>
    (kind === 'call' || kind === 'construct')
    && targetPath !== null
    && sourceProgramSurfaceForPath(targetPath) !== 'test')) classes.add('behavior');
  const registrationCapabilities = capabilities;
  if (registrationCapabilities.length > 0) classes.add('effect');
  const operations = new Set(registrationCapabilities.map(({ operation }) => operation.toLowerCase()));
  const hasRead = [...operations].some((operation) => /read|stat|scan|inspect|open/u.test(operation));
  const hasWrite = [...operations].some((operation) => /write|rename|remove|unlink|delete|mkdir|spawn|run/u.test(operation));
  if (hasRead && hasWrite) classes.add('durable-state');
  let hasFailureBoundary = false;
  let hasPropertyIteration = false;
  const visit = (node: ts.Node): void => {
    checkpoint(operation);
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
  input: TestObservationsInternalInput
): TestObservations {
  checkpoint(input.operation);
  input.repositoryCompilation?.assertMatches(input);
  if (!isCompiledTypeScriptModel(input.productionModel)
      || input.productionModel.files.some(({ surface }) => (
        surface !== 'production' && surface !== 'test'
      ))) {
    throw new Error('test observations require one exact production-and-test Source Program model');
  }
  if (input.repositoryCompilation !== undefined
      && workspaceSnapshotIdentityForTypeScriptModel(input.productionModel)
        !== input.repositoryCompilation.identityDigest) {
    throw new Error('test observations cannot mix a production model from another repository compilation');
  }
  const files = [...input.files].sort((left, right) => compareCodeUnits(left.path, right.path));
  if (new Set(files.map(({ path }) => path)).size !== files.length
      || files.some((file) => rawSha256(file.source) !== file.contentDigest)) {
    throw new Error('test observations require canonical exact source bytes');
  }
  const filesByPath = new Map(files.map((file) => [file.path, file] as const));
  const compiledFiles = new Map(input.productionModel.files.map((file) => [file.path, file] as const));
  if ([...compiledFiles].some(([repositoryPath, observed]) =>
    filesByPath.get(repositoryPath)?.contentDigest !== observed.contentDigest)) {
    throw new Error('test observations do not bind the compiler model bytes');
  }
  const productionFiles = new Map([...compiledFiles].filter(([, file]) => file.surface === 'production'));
  const sourceByPath = new Map(files.map((file) => [file.path, file.source] as const));
  const graph = input.repositoryCompilation?.moduleGraph ?? compileRepositoryModuleGraph({
    files: files.map(({ path }) => path),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath) ?? null
  });
  const graphTargets = graphTargetIndex(graph, input.operation);
  const declarations = declarationIndex(input.productionModel, input.operation);
  const compilerReferences = input.productionModel.references.filter(({ path: observationPath }) => (
    sourceProgramSurfaceForPath(observationPath) === 'test'
  ));
  const compilerLiterals = input.productionModel.literals.filter(({ path: observationPath }) => (
    sourceProgramSurfaceForPath(observationPath) === 'test'
  ));
  const compilerCapabilities = input.productionModel.capabilities.filter(({ path: observationPath }) => (
    sourceProgramSurfaceForPath(observationPath) === 'test'
  ));
  const compilerUnknowns = input.productionModel.unknowns.filter(({ path: observationPath }) => (
    sourceProgramSurfaceForPath(observationPath) === 'test'
  ));
  const callReferencesByPath = callReferenceIndex(compilerReferences, input.operation);
  const reachability = declarationReachabilityIndexes(
    input.productionModel.declarations,
    compilerReferences,
    input.operation
  );
  const declarationsByObservation = reachability.declarationsByObservation;
  const compilerReferencesByPath = spannedRecordsByPath(compilerReferences, input.operation);
  const compilerCapabilitiesByPath = spannedRecordsByPath(compilerCapabilities, input.operation);
  const compilerUnknownsByPath = spannedRecordsByPath(compilerUnknowns.filter((unknown): unknown is SourceProgramUnknown & Readonly<{
    span: SourceProgramSpan;
  }> => unknown.span !== null), input.operation);
  const references: SourceProgramReference[] = [];
  const literals: SourceProgramLiteral[] = [];
  const capabilities: SourceProgramCapabilityInvocation[] = [];
  const registrations: SourceProgramTestRegistrationObservation[] = [];
  const productionSourceReads: SourceProgramTestSourceReadObservation[] = [];
  const resourceReads: SourceProgramTestSourceReadObservation[] = [];
  const localProgramInvocations: SourceProgramTestLocalProgramInvocationObservation[] = [];
  const unknowns: SourceProgramUnknown[] = [];
  const testFiles = files.filter(({ path }) => sourceProgramSurfaceForPath(path) === 'test');
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  const productionPaths = new Set(productionFiles.keys());

  for (const file of testFiles) {
    checkpoint(input.operation);
    const sourceFile = typeScriptSourceFile(input.productionModel, file.path);
    if (sourceFile === null) {
      unknowns.push(Object.freeze({
        code: 'test-compiler-syntax-unresolved',
        path: file.path,
        detail: 'exact compiler syntax is not bound to the Source Program receipt',
        span: null
      }));
      continue;
    }
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
    const bindings = importBindings(sourceFile, graphTargets);
    const constants = constantInitializers(sourceFile, input.operation);
    const importedNames = importedBindingNames(sourceFile);
    const registrationNodes: ts.CallExpression[] = [];
    const unresolvedBindings = new Set<string>();
    const visit = (node: ts.Node): void => {
      checkpoint(input.operation);
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
        if (ts.isCallExpression(node) && compilerRegistrationKind(
          sourceFile,
          file.path,
          node,
          callReferencesByPath,
          declarationsByObservation,
          input.moduleMembership
        ) !== null) {
          registrationNodes.push(node);
        }
        if (ts.isCallExpression(node)) {
          const sourcePathExpression = rawTextReadPath(node, bindings, input.productionModel, file.path);
          if (sourcePathExpression !== null) {
            const value = staticString(sourcePathExpression, file.path, repositoryRoot, constants);
            const target = value === null ? null : repositoryPath(repositoryRoot, value);
            if (target !== null && productionPaths.has(target)) {
              productionSourceReads.push(Object.freeze({
                path: file.path,
                target,
                span: spanFor(sourceFile, node)
              }));
            } else if (target !== null && filesByPath.has(target)
                && sourceProgramSurfaceForPath(target) === 'resource') {
              resourceReads.push(Object.freeze({
                path: file.path,
                target,
                span: spanFor(sourceFile, node)
              }));
            }
          }
          const programArgument = localProgramInvocationArgument(
            node,
            bindings,
            input.productionModel,
            file.path
          );
          if (programArgument !== undefined) {
            const value = programArgument === null || programArgument.length !== 1
              ? null
              : staticString(programArgument[0]!, file.path, repositoryRoot, constants);
            const target = value === null ? null : repositoryPath(repositoryRoot, value);
            if (target !== null && compiledFiles.has(target) && /\.tsx?$/u.test(target)) {
              localProgramInvocations.push(Object.freeze({
                path: file.path,
                target,
                span: spanFor(sourceFile, node)
              }));
            } else {
              unknowns.push(Object.freeze({
                code: 'test-local-program-invocation-unresolved',
                path: file.path,
                detail: 'current Bun program argv[0] is dynamic or outside the compiled snapshot',
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
            const capabilitySpan = spanFor(sourceFile, node);
            capabilities.push(Object.freeze({
              observationId: sha256({
                capability,
                operation: bound.operation,
                owningDeclarationObservationId: null,
                path: file.path,
                start: capabilitySpan.start
              }),
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
              owningDeclarationObservationId: null,
              observationClass: provider !== null || nativeProcess || runtimeBuiltin
                ? 'observed'
                : 'unknown',
              span: capabilitySpan
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
            const capabilitySpan = spanFor(sourceFile, node);
            capabilities.push(Object.freeze({
              observationId: sha256({
                capability,
                operation,
                owningDeclarationObservationId: null,
                path: file.path,
                start: capabilitySpan.start
              }),
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
              owningDeclarationObservationId: null,
              observationClass: 'observed',
              span: capabilitySpan
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
            const targetPath = graphTarget(graphTargets, file.path, argument.text, 'dynamic');
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
      const targetPath = graphTarget(graphTargets, file.path, specifier);
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
    const fileReferences = compilerReferencesByPath.get(file.path) ?? [];
    const fileCapabilities = compilerCapabilitiesByPath.get(file.path) ?? [];
    const fileUnknowns = compilerUnknownsByPath.get(file.path) ?? [];
    registrationNodes.forEach((registration, index) => {
      checkpoint(input.operation);
      const kind = compilerRegistrationKind(
        sourceFile,
        file.path,
        registration,
        callReferencesByPath,
        declarationsByObservation,
        input.moduleMembership
      )!;
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
        const actualTargets = expressionReferenceTargets(
          sourceFile,
          shape.actual,
          fileReferences,
          input.productionModel,
          file.path
        );
        const expectedTargets = new Set(assertion.arguments.flatMap((argument) =>
          [...expressionReferenceTargets(
            sourceFile,
            argument,
            fileReferences,
            input.productionModel,
            file.path
          )]));
        const productionTargets = (targets: ReadonlySet<string>): Set<string> => new Set(
          [...targets].filter((target) => {
            const declaration = declarationsByObservation.get(target);
            return declaration !== undefined && productionPaths.has(declaration.path);
          })
        );
        const actualProductionTargets = productionTargets(actualTargets);
        const expectedProductionTargets = productionTargets(expectedTargets);
        const actualRouteProductionTargets = productionTargets(reachableReferenceTargets(
          actualTargets,
          reachability.containedDeclarationIdsByObservation,
          reachability.callTargetIdsBySourceObservation,
          input.operation
        ));
        return Object.freeze({
          span: spanFor(sourceFile, assertion),
          matcher: shape.matcher,
          negated: shape.negated,
          actualFromProductionSubject: actualProductionTargets.size > 0,
          expectedFromProductionSubject: expectedProductionTargets.size > 0,
          expectedSharesActualProductionRoute: [...expectedProductionTargets].some((target) =>
            actualRouteProductionTargets.has(target)),
          versionIdentityOnly: versionIdentityAssertion(assertion),
          importedFunctionArity: importedFunctionArityAssertion(assertion, importedNames),
          productionPathLayoutTarget
        });
      }));
      const registrationStart = registration.getStart(sourceFile);
      const registrationEnd = registration.getEnd();
      const registrationSpan = spanFor(sourceFile, registration);
      const reachableDeclarations = reachableDeclarationIds(
        registrationSpan,
        file.path,
        callReferencesByPath,
        reachability.declarationsByObservation,
        reachability.containedDeclarationIdsByObservation,
        reachability.callTargetIdsBySourceObservation,
        input.operation
      );
      const reachableCapabilities = [...new Map([
        ...recordsWithinSpan(fileCapabilities, registrationStart, registrationEnd),
        ...fileCapabilities.filter(({ owningDeclarationObservationId }) => (
          owningDeclarationObservationId !== null
          && reachableDeclarations.has(owningDeclarationObservationId)))
      ].map((capability) => [capability.observationId, capability] as const)).values()];
      const reachableRoles = Object.freeze([...reachableDeclarations]
        .flatMap((observationId) => {
          const declaration = declarationsByObservation.get(observationId);
          return declaration === undefined
            ? []
            : operationRoleProvenance(declaration, input.moduleMembership);
        })
        .sort((left, right) => compareCodeUnits(left.declarationObservationId, right.declarationObservationId)
          || compareCodeUnits(left.role, right.role)
          || compareCodeUnits(left.operation, right.operation)));
      const registrationReferences = recordsWithinSpan(
        fileReferences,
        registrationStart,
        registrationEnd
      );
      const observedProductionPaths = Object.freeze([...new Set(registrationReferences
        .filter(({ targetPath }) => targetPath !== null
          && productionPaths.has(targetPath))
        .map(({ targetPath }) => targetPath!))].sort(compareCodeUnits));
      const capabilityOperations = Object.freeze([...new Set(reachableCapabilities
        .map(({ operation }) => operation))].sort(compareCodeUnits));
      const capabilityObservationIds = Object.freeze(reachableCapabilities
        .map(({ observationId }) => observationId)
        .sort(compareCodeUnits));
      const registrationProvenance = compilerRegistrationProvenance(
        sourceFile,
        file.path,
        registration,
        callReferencesByPath,
        declarationsByObservation,
        input.moduleMembership
      );
      const registrationSemanticOperations = new Set(registrationProvenance.map(({ semanticOperation }) => (
        semanticOperation
      )));
      const supervisorPolicyProvenance = Object.freeze(reachableRoles.filter(({ role, semanticOperation }) => (
        role === 'domain-owner' && registrationSemanticOperations.has(semanticOperation)
      )));
      const terminalProvenance = Object.freeze(reachableRoles.filter(({ role, semanticOperation }) => (
        role === 'terminal-issuer' && registrationSemanticOperations.has(semanticOperation)
      )));
      const readbackProvenance = Object.freeze(reachableRoles.filter(({ role, semanticOperation }) => (
        role === 'readback-issuer' && registrationSemanticOperations.has(semanticOperation)
      )));
      const unknownEdges = Object.freeze(recordsWithinSpan(
        fileUnknowns,
        registrationStart,
        registrationEnd
      ).map(({ code, detail }) => `${code}:${detail}`).sort(compareCodeUnits));
      const semanticClasses = semanticClassesForRegistration(
        registrationReferences,
        reachableCapabilities,
        registration,
        input.operation
      );
      const provenanceUnknowns = registrationProvenance.length === 0
        ? []
        : [
            ...(supervisorPolicyProvenance.length === 0
              ? ['test-supervisor-policy-provenance-unresolved']
              : []),
            ...(terminalProvenance.length === 0
              ? ['test-terminal-provenance-unresolved']
              : []),
            ...(readbackProvenance.length === 0
              ? ['test-readback-provenance-unresolved']
              : [])
          ];
      registrations.push(Object.freeze({
        path: file.path,
        index,
        kind,
        title,
        span: registrationSpan,
        assertions: assertionObservations,
        semanticClasses,
        observedProductionPaths,
        capabilityOperations,
        capabilityObservationIds,
        registrationProvenance,
        supervisorPolicyProvenance,
        terminalProvenance,
        readbackProvenance,
        unknownEdges,
        unknowns: Object.freeze([
          ...(semanticClasses.length === 0 ? ['test-semantic-class-unresolved'] : []),
          ...provenanceUnknowns
        ].sort(compareCodeUnits))
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
  resourceReads.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span)
    || compareCodeUnits(left.target, right.target));
  localProgramInvocations.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareSpans(left.span, right.span)
    || compareCodeUnits(left.target, right.target));
  unknowns.sort((left, right) => compareCodeUnits(left.path, right.path)
    || (left.span?.start ?? -1) - (right.span?.start ?? -1)
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.detail, right.detail));
  checkpoint(input.operation);
  const canonical = Object.freeze({
    // The revision names the repository snapshot shared with the production
    // model. Exact test bytes are independently bound by observationDigest;
    // replacing this with a second derived revision would create two owners
    // for the same repository epoch.
    sourceRevision: input.productionModel.sourceRevision,
    productionModelDigest: input.productionModel.modelDigest,
    testPaths: Object.freeze(testFiles.map(({ path }) => path)),
    references: Object.freeze(compilerReferences),
    literals: Object.freeze(compilerLiterals),
    capabilities: Object.freeze(compilerCapabilities),
    registrations: Object.freeze(registrations),
    productionSourceReads: Object.freeze(productionSourceReads),
    resourceReads: Object.freeze(resourceReads),
    localProgramInvocations: Object.freeze(localProgramInvocations),
    unknowns: Object.freeze([...compilerUnknowns, ...unknowns])
  });
  const observations = Object.freeze({
    ...canonical,
    observationDigest: sha256(canonical)
  });
  if (input.repositoryCompilation !== undefined) {
    repositoryCompilationDigestByObservations.set(
      observations,
      input.repositoryCompilation.identityDigest
    );
  }
  observationsByFiles.set(input.files, observations);
  return observations;
}

export function compileTestObservations(
  input: TestObservationsInput
): TestObservations {
  return compileSourceProgramTestObservationsInternal({
    ...input,
    operation: resolveSourceProgramCompilationOperation(input.operation)
  });
}

export function compileTestObservationsFromSnapshot(
  input: TestObservationsInput,
  repositoryCompilation: WorkspaceSourceSnapshot
): TestObservations {
  repositoryCompilation.assertMatches(input);
  return compileSourceProgramTestObservationsInternal({
    ...input,
    operation: resolveSourceProgramCompilationOperation(input.operation),
    repositoryCompilation
  });
}
