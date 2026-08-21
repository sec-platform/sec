import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  normalizeTestResponsibilityDeclarations,
  type TestResponsibilityDeclaration,
  type TestResponsibilityMetadata
} from '../../platform/shared/test-responsibility-contract.ts';
import {
  decodeExactUtf8,
  gitReadBytes,
  parseNulUtf8
} from './git/git-read.ts';

export const TEST_CASE_CENSUS_FORMAT = 'sec-test-case-census-v1' as const;

export type TestCaseCensusReasonCode =
  | 'raw-bun-test-without-responsibility'
  | 'dynamic-test-title'
  | 'dynamic-suite-family'
  | 'parameterized-family-unresolved'
  | 'dynamic-responsibility-metadata'
  | 'physical-locator-in-responsibility'
  | 'unsupported-sec-test-modifier'
  | 'duplicate-test-locator'
  | 'duplicate-test-id';

export type TestCaseRegistration = 'sec-test' | 'bun-test' | 'bun-it';

export interface TestCaseObservationV1 {
  readonly sourcePath: string;
  readonly suitePath: readonly string[];
  readonly title: string | null;
  readonly line: number;
  readonly registration: TestCaseRegistration;
  readonly qualifiers: readonly string[];
  readonly resolution: 'resolved' | 'observed-but-unresolved';
  readonly reasonCodes: readonly TestCaseCensusReasonCode[];
  readonly responsibility?: TestResponsibilityMetadata;
}

export interface TestCaseCensusV1 {
  readonly formatVersion: typeof TEST_CASE_CENSUS_FORMAT;
  readonly caseCount: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly duplicateLocatorCount: number;
  readonly duplicateTestIdCount: number;
  readonly observations: readonly TestCaseObservationV1[];
  readonly resolvedResponsibilities: readonly TestResponsibilityDeclaration[];
  readonly unresolved: readonly TestCaseObservationV1[];
}

const TEST_SOURCE_PATH = /^tests\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const RESPONSIBILITY_WRAPPER_PATH = 'tests/testkit/responsibility.ts';
const UNSUPPORTED = Symbol('unsupported-static-value');

type StaticValue =
  | null
  | boolean
  | number
  | string
  | readonly StaticValue[]
  | Readonly<Record<string, StaticValue>>;

type RegistrationKind = 'test' | 'it' | 'describe' | 'secTest';

type RegistrationBinding = Readonly<{
  kind: RegistrationKind;
  qualifiers: readonly string[];
}>;

type RegistrationBindings = Readonly<{
  named: ReadonlyMap<string, RegistrationKind>;
  bunNamespaces: ReadonlySet<string>;
  responsibilityNamespaces: ReadonlySet<string>;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function staticString(expression: ts.Expression | undefined): string | null {
  if (expression === undefined) return null;
  const current = unwrapExpression(expression);
  return ts.isStringLiteralLike(current) ? current.text : null;
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function staticValue(expression: ts.Expression): StaticValue | typeof UNSUPPORTED {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand)) {
    const value = Number(current.operand.text);
    if (current.operator === ts.SyntaxKind.MinusToken) return -value;
    if (current.operator === ts.SyntaxKind.PlusToken) return value;
  }
  if (ts.isArrayLiteralExpression(current)) {
    const values: StaticValue[] = [];
    for (const element of current.elements) {
      if (ts.isSpreadElement(element)) return UNSUPPORTED;
      const value = staticValue(element);
      if (value === UNSUPPORTED) return UNSUPPORTED;
      values.push(value);
    }
    return Object.freeze(values);
  }
  if (ts.isObjectLiteralExpression(current)) {
    const value: Record<string, StaticValue> = Object.create(null) as Record<string, StaticValue>;
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property)) return UNSUPPORTED;
      const key = staticPropertyName(property.name);
      if (key === null || Object.hasOwn(value, key)) return UNSUPPORTED;
      const propertyValue = staticValue(property.initializer);
      if (propertyValue === UNSUPPORTED) return UNSUPPORTED;
      value[key] = propertyValue;
    }
    return Object.freeze(value);
  }
  return UNSUPPORTED;
}

function scriptKindForPath(sourcePath: string): ts.ScriptKind {
  if (sourcePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (sourcePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:cjs|mjs|js)$/u.test(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function resolvesToResponsibilityWrapper(sourcePath: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
  return resolved === RESPONSIBILITY_WRAPPER_PATH
    || `${resolved}.ts` === RESPONSIBILITY_WRAPPER_PATH;
}

function addNamedBinding(
  bindings: Map<string, RegistrationKind>,
  localName: string,
  kind: RegistrationKind
): void {
  const existing = bindings.get(localName);
  if (existing !== undefined && existing !== kind) {
    throw new Error(`Conflicting test registration import binding: ${localName}`);
  }
  bindings.set(localName, kind);
}

function collectRegistrationBindings(
  sourcePath: string,
  source: ts.SourceFile
): RegistrationBindings {
  const named = new Map<string, RegistrationKind>();
  const bunNamespaces = new Set<string>();
  const responsibilityNamespaces = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    if (statement.importClause.isTypeOnly) continue;
    const specifier = staticString(statement.moduleSpecifier);
    if (specifier === null) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined) continue;

    const isBunTest = specifier === 'bun:test';
    const isResponsibility = resolvesToResponsibilityWrapper(sourcePath, specifier);
    if (!isBunTest && !isResponsibility) continue;

    if (ts.isNamespaceImport(bindings)) {
      if (isBunTest) bunNamespaces.add(bindings.name.text);
      if (isResponsibility) responsibilityNamespaces.add(bindings.name.text);
      continue;
    }

    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = (element.propertyName ?? element.name).text;
      const localName = element.name.text;
      if (isBunTest && (importedName === 'test' || importedName === 'it' || importedName === 'describe')) {
        addNamedBinding(named, localName, importedName);
      }
      if (isResponsibility && importedName === 'secTest') {
        addNamedBinding(named, localName, 'secTest');
      }
    }
  }

  return Object.freeze({ named, bunNamespaces, responsibilityNamespaces });
}

function callParts(expression: ts.Expression): readonly string[] | null {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return Object.freeze([current.text]);
  if (ts.isPropertyAccessExpression(current)) {
    const parent = callParts(current.expression);
    return parent === null ? null : Object.freeze([...parent, current.name.text]);
  }
  if (ts.isElementAccessExpression(current)) {
    const parent = callParts(current.expression);
    const property = staticString(current.argumentExpression);
    return parent === null || property === null ? null : Object.freeze([...parent, property]);
  }
  if (ts.isCallExpression(current)) return callParts(current.expression);
  return null;
}

function resolveRegistrationBinding(
  expression: ts.LeftHandSideExpression,
  bindings: RegistrationBindings
): RegistrationBinding | null {
  const parts = callParts(expression);
  if (parts === null || parts.length === 0) return null;

  const named = bindings.named.get(parts[0]!);
  if (named !== undefined) {
    return Object.freeze({ kind: named, qualifiers: Object.freeze(parts.slice(1)) });
  }

  if (bindings.bunNamespaces.has(parts[0]!) && parts.length >= 2) {
    const member = parts[1];
    if (member === 'test' || member === 'it' || member === 'describe') {
      return Object.freeze({ kind: member, qualifiers: Object.freeze(parts.slice(2)) });
    }
  }

  if (
    bindings.responsibilityNamespaces.has(parts[0]!)
    && parts[1] === 'secTest'
  ) {
    return Object.freeze({ kind: 'secTest', qualifiers: Object.freeze(parts.slice(2)) });
  }

  return null;
}

function callbackBody(expression: ts.Expression | undefined): ts.ConciseBody | null {
  if (expression === undefined) return null;
  const current = unwrapExpression(expression);
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current)
    ? current.body
    : null;
}

function sourceLine(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function sortedReasonCodes(
  reasonCodes: Iterable<TestCaseCensusReasonCode>
): readonly TestCaseCensusReasonCode[] {
  return Object.freeze([...new Set(reasonCodes)].sort(compareText));
}

function observationSortKey(observation: TestCaseObservationV1): string {
  return [
    observation.sourcePath,
    ...observation.suitePath,
    observation.title ?? `~dynamic:${String(observation.line).padStart(8, '0')}`,
    observation.registration,
    String(observation.line).padStart(8, '0')
  ].join('\u0000');
}

function physicalLocatorKey(observation: TestCaseObservationV1): string | null {
  if (observation.title === null) return null;
  return [observation.sourcePath, ...observation.suitePath, observation.title].join('\u0000');
}

function responsibilityTestId(observation: TestCaseObservationV1): string | null {
  const testId = observation.responsibility?.testId;
  return typeof testId === 'string' ? testId : null;
}

function responsibilityMetadata(value: StaticValue): TestResponsibilityMetadata | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'sourcePath') || Object.hasOwn(value, 'case')) return null;
  return value as unknown as TestResponsibilityMetadata;
}

function observeTestCasesInParsedSource(
  sourcePath: string,
  source: ts.SourceFile
): readonly TestCaseObservationV1[] {
  const bindings = collectRegistrationBindings(sourcePath, source);
  const observations: TestCaseObservationV1[] = [];

  const visit = (
    node: ts.Node,
    suitePath: readonly string[],
    dynamicSuite: boolean
  ): void => {
    if (ts.isCallExpression(node)) {
      const registration = resolveRegistrationBinding(node.expression, bindings);
      if (registration?.kind === 'describe') {
        const title = staticString(node.arguments[0]);
        const line = sourceLine(source, node);
        const nextSuite = Object.freeze([
          ...suitePath,
          title ?? `<dynamic-suite:${line}>`
        ]);
        const nextDynamicSuite = dynamicSuite
          || title === null
          || registration.qualifiers.includes('each');
        const body = callbackBody(node.arguments[node.arguments.length - 1]);
        if (body !== null) {
          if (ts.isBlock(body)) {
            for (const statement of body.statements) visit(statement, nextSuite, nextDynamicSuite);
          } else {
            visit(body, nextSuite, nextDynamicSuite);
          }
        }
        return;
      }

      if (registration?.kind === 'secTest' || registration?.kind === 'test' || registration?.kind === 'it') {
        const observedRegistration: TestCaseRegistration = registration.kind === 'secTest'
          ? 'sec-test'
          : registration.kind === 'test'
            ? 'bun-test'
            : 'bun-it';
        const line = sourceLine(source, node);
        const titleIndex = registration.kind === 'secTest' ? 1 : 0;
        const title = staticString(node.arguments[titleIndex]);
        const reasonCodes: TestCaseCensusReasonCode[] = [];
        let responsibility: TestResponsibilityMetadata | undefined;

        if (dynamicSuite) reasonCodes.push('dynamic-suite-family');
        if (registration.qualifiers.includes('each')) {
          reasonCodes.push('parameterized-family-unresolved');
        }
        if (title === null) reasonCodes.push('dynamic-test-title');

        if (registration.kind !== 'secTest') {
          reasonCodes.push('raw-bun-test-without-responsibility');
        } else {
          if (registration.qualifiers.length > 0) {
            reasonCodes.push('unsupported-sec-test-modifier');
          }
          const metadataExpression = node.arguments[0];
          const metadataValue = metadataExpression === undefined
            ? UNSUPPORTED
            : staticValue(metadataExpression);
          if (metadataValue === UNSUPPORTED) {
            reasonCodes.push('dynamic-responsibility-metadata');
          } else if (
            metadataValue !== null
            && !Array.isArray(metadataValue)
            && typeof metadataValue === 'object'
            && (Object.hasOwn(metadataValue, 'sourcePath') || Object.hasOwn(metadataValue, 'case'))
          ) {
            reasonCodes.push('physical-locator-in-responsibility');
          } else {
            const parsed = responsibilityMetadata(metadataValue);
            if (parsed === null) {
              reasonCodes.push('dynamic-responsibility-metadata');
            } else {
              responsibility = parsed;
            }
          }
        }

        const normalizedReasons = sortedReasonCodes(reasonCodes);
        observations.push(Object.freeze({
          sourcePath,
          suitePath: Object.freeze([...suitePath]),
          title,
          line,
          registration: observedRegistration,
          qualifiers: registration.qualifiers,
          resolution: normalizedReasons.length === 0 && responsibility !== undefined
            ? 'resolved'
            : 'observed-but-unresolved',
          reasonCodes: normalizedReasons,
          ...(responsibility === undefined ? {} : { responsibility })
        }));
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, suitePath, dynamicSuite));
  };

  visit(source, Object.freeze([]), false);
  return Object.freeze(observations.sort((left, right) => (
    compareText(observationSortKey(left), observationSortKey(right))
  )));
}

export function observeTestCasesInSourceV1(
  sourcePath: string,
  sourceText: string
): readonly TestCaseObservationV1[] {
  if (!TEST_SOURCE_PATH.test(sourcePath)) {
    throw new Error(`Test case census source path is not executable test source: ${sourcePath}`);
  }

  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath)
  );
  return observeTestCasesInParsedSource(sourcePath, source);
}

function projectIdentityConflicts(
  observations: readonly TestCaseObservationV1[]
): Readonly<{
  observations: readonly TestCaseObservationV1[];
  duplicateLocatorCount: number;
  duplicateTestIdCount: number;
}> {
  const locatorCounts = new Map<string, number>();
  const testIdCounts = new Map<string, number>();

  for (const observation of observations) {
    const locator = physicalLocatorKey(observation);
    if (locator !== null) locatorCounts.set(locator, (locatorCounts.get(locator) ?? 0) + 1);
    const testId = responsibilityTestId(observation);
    if (testId !== null) testIdCounts.set(testId, (testIdCounts.get(testId) ?? 0) + 1);
  }

  const duplicateLocators = new Set([...locatorCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key));
  const duplicateTestIds = new Set([...testIdCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key));

  const projected = observations.map((observation) => {
    const reasons = [...observation.reasonCodes];
    const locator = physicalLocatorKey(observation);
    if (locator !== null && duplicateLocators.has(locator)) {
      reasons.push('duplicate-test-locator');
    }
    const testId = responsibilityTestId(observation);
    if (testId !== null && duplicateTestIds.has(testId)) {
      reasons.push('duplicate-test-id');
    }
    const reasonCodes = sortedReasonCodes(reasons);
    return Object.freeze({
      ...observation,
      reasonCodes,
      resolution: reasonCodes.length === 0 && observation.responsibility !== undefined
        ? 'resolved' as const
        : 'observed-but-unresolved' as const
    });
  });

  return Object.freeze({
    observations: Object.freeze(projected),
    duplicateLocatorCount: duplicateLocators.size,
    duplicateTestIdCount: duplicateTestIds.size
  });
}

export function compileTestCaseCensusV1(
  sources: readonly Readonly<{ sourcePath: string; sourceText: string }>[]
): TestCaseCensusV1 {
  const rawObservations = sources
    .flatMap(({ sourcePath, sourceText }) => observeTestCasesInSourceV1(sourcePath, sourceText))
    .sort((left, right) => compareText(observationSortKey(left), observationSortKey(right)));
  const conflictProjection = projectIdentityConflicts(rawObservations);
  const observations = conflictProjection.observations;

  const declarations: TestResponsibilityDeclaration[] = [];
  for (const observation of observations) {
    if (observation.resolution !== 'resolved' || observation.responsibility === undefined) continue;
    if (observation.title === null) {
      throw new Error('Resolved test responsibility cannot have a dynamic title');
    }
    declarations.push({
      ...observation.responsibility,
      sourcePath: observation.sourcePath,
      case: {
        suitePath: observation.suitePath,
        title: observation.title
      }
    });
  }

  const resolvedResponsibilities = normalizeTestResponsibilityDeclarations(declarations);
  const unresolved = Object.freeze(observations.filter((observation) => (
    observation.resolution === 'observed-but-unresolved'
  )));

  return Object.freeze({
    formatVersion: TEST_CASE_CENSUS_FORMAT,
    caseCount: observations.length,
    resolvedCount: resolvedResponsibilities.length,
    unresolvedCount: unresolved.length,
    duplicateLocatorCount: conflictProjection.duplicateLocatorCount,
    duplicateTestIdCount: conflictProjection.duplicateTestIdCount,
    observations,
    resolvedResponsibilities,
    unresolved
  });
}

export function censusRepositoryTestCasesV1(repositoryRoot: string): TestCaseCensusV1 {
  const inventory = [...new Set(parseNulUtf8(
    gitReadBytes(
      repositoryRoot,
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'tests'],
      { label: 'test case census inventory' }
    ),
    'test case census inventory'
  ))]
    .filter((repositoryPath) => TEST_SOURCE_PATH.test(repositoryPath))
    .sort(compareText);

  const sources: Array<{ sourcePath: string; sourceText: string }> = [];
  for (const sourcePath of inventory) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(repositoryRoot, ...sourcePath.split('/')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    sources.push({
      sourcePath,
      sourceText: decodeExactUtf8(bytes, `test case source ${sourcePath}`)
    });
  }

  return compileTestCaseCensusV1(sources);
}
