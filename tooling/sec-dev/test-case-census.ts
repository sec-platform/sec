import { readFileSync } from 'node:fs';

import ts from 'typescript';

import {
  normalizeTestResponsibilityDeclarations,
  type TestResponsibilityDeclaration
} from '../../platform/shared/test-responsibility-contract.ts';
import {
  decodeExactUtf8,
  gitReadBytes,
  parseNulUtf8
} from './git/git-read.ts';

type TestResponsibilityMetadata = Omit<
  TestResponsibilityDeclaration,
  'sourcePath' | 'case'
>;

export const TEST_CASE_CENSUS_FORMAT = 'sec-test-case-census-v1' as const;

export type TestCaseCensusReasonCode =
  | 'raw-bun-test-without-responsibility'
  | 'dynamic-test-title'
  | 'dynamic-suite-family'
  | 'parameterized-family-unresolved'
  | 'dynamic-responsibility-metadata'
  | 'physical-locator-in-responsibility'
  | 'unsupported-sec-test-modifier';

export type TestCaseRegistration = 'sec-test' | 'bun-test' | 'bun-it';

export interface TestCaseObservationV1 {
  readonly sourcePath: string;
  readonly suitePath: readonly string[];
  readonly title: string | null;
  readonly line: number;
  readonly registration: TestCaseRegistration;
  readonly qualifiers: readonly string[];
  readonly resolution: 'resolved' | 'observed-but-unresolved';
  readonly reasonCode?: TestCaseCensusReasonCode;
  readonly responsibility?: TestResponsibilityMetadata;
}

export interface TestCaseCensusV1 {
  readonly formatVersion: typeof TEST_CASE_CENSUS_FORMAT;
  readonly caseCount: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly observations: readonly TestCaseObservationV1[];
  readonly resolvedResponsibilities: readonly TestResponsibilityDeclaration[];
  readonly unresolved: readonly TestCaseObservationV1[];
}

const TEST_SOURCE_PATH = /^tests\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const UNSUPPORTED = Symbol('unsupported-static-value');

type StaticValue =
  | null
  | boolean
  | number
  | string
  | readonly StaticValue[]
  | Readonly<Record<string, StaticValue>>;

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

function callRootIdentifier(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return callRootIdentifier(expression.expression);
  if (ts.isCallExpression(expression)) return callRootIdentifier(expression.expression);
  return null;
}

function collectCallQualifiers(expression: ts.LeftHandSideExpression, output: string[]): void {
  if (ts.isPropertyAccessExpression(expression)) {
    collectCallQualifiers(expression.expression, output);
    output.push(expression.name.text);
    return;
  }
  if (ts.isCallExpression(expression)) {
    collectCallQualifiers(expression.expression, output);
  }
}

function callQualifiers(expression: ts.LeftHandSideExpression): readonly string[] {
  const qualifiers: string[] = [];
  collectCallQualifiers(expression, qualifiers);
  return Object.freeze(qualifiers);
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

function responsibilityMetadata(value: StaticValue): TestResponsibilityMetadata | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'sourcePath') || Object.hasOwn(value, 'case')) return null;
  return value as unknown as TestResponsibilityMetadata;
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
    sourcePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const observations: TestCaseObservationV1[] = [];

  const visit = (
    node: ts.Node,
    suitePath: readonly string[],
    dynamicSuite: boolean
  ): void => {
    if (ts.isCallExpression(node)) {
      const root = callRootIdentifier(node.expression);
      if (root === 'describe') {
        const title = staticString(node.arguments[0]);
        const qualifiers = callQualifiers(node.expression);
        const line = sourceLine(source, node);
        const nextSuite = Object.freeze([
          ...suitePath,
          title ?? `<dynamic-suite:${line}>`
        ]);
        const nextDynamicSuite = dynamicSuite || title === null || qualifiers.includes('each');
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

      if (root === 'secTest' || root === 'test' || root === 'it') {
        const registration: TestCaseRegistration = root === 'secTest'
          ? 'sec-test'
          : root === 'test'
            ? 'bun-test'
            : 'bun-it';
        const qualifiers = callQualifiers(node.expression);
        const line = sourceLine(source, node);
        const titleIndex = root === 'secTest' ? 1 : 0;
        const title = staticString(node.arguments[titleIndex]);

        let resolution: TestCaseObservationV1['resolution'] = 'observed-but-unresolved';
        let reasonCode: TestCaseCensusReasonCode | undefined;
        let responsibility: TestResponsibilityMetadata | undefined;

        if (dynamicSuite) {
          reasonCode = 'dynamic-suite-family';
        } else if (qualifiers.includes('each')) {
          reasonCode = 'parameterized-family-unresolved';
        } else if (title === null) {
          reasonCode = 'dynamic-test-title';
        } else if (root !== 'secTest') {
          reasonCode = 'raw-bun-test-without-responsibility';
        } else if (qualifiers.length > 0) {
          reasonCode = 'unsupported-sec-test-modifier';
        } else {
          const metadataExpression = node.arguments[0];
          const metadataValue = metadataExpression === undefined
            ? UNSUPPORTED
            : staticValue(metadataExpression);
          if (metadataValue === UNSUPPORTED) {
            reasonCode = 'dynamic-responsibility-metadata';
          } else if (
            metadataValue !== null
            && !Array.isArray(metadataValue)
            && typeof metadataValue === 'object'
            && (Object.hasOwn(metadataValue, 'sourcePath') || Object.hasOwn(metadataValue, 'case'))
          ) {
            reasonCode = 'physical-locator-in-responsibility';
          } else {
            const parsed = responsibilityMetadata(metadataValue);
            if (parsed === null) {
              reasonCode = 'dynamic-responsibility-metadata';
            } else {
              resolution = 'resolved';
              responsibility = parsed;
            }
          }
        }

        observations.push(Object.freeze({
          sourcePath,
          suitePath: Object.freeze([...suitePath]),
          title,
          line,
          registration,
          qualifiers,
          resolution,
          ...(reasonCode === undefined ? {} : { reasonCode }),
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

export function compileTestCaseCensusV1(
  sources: readonly Readonly<{ sourcePath: string; sourceText: string }>[]
): TestCaseCensusV1 {
  const observations = sources
    .flatMap(({ sourcePath, sourceText }) => observeTestCasesInSourceV1(sourcePath, sourceText))
    .sort((left, right) => compareText(observationSortKey(left), observationSortKey(right)));

  const locatorOwners = new Map<string, TestCaseObservationV1>();
  for (const observation of observations) {
    const key = physicalLocatorKey(observation);
    if (key === null) continue;
    const previous = locatorOwners.get(key);
    if (previous !== undefined) {
      throw new Error(
        `Duplicate executable test case locator: ${observation.sourcePath}:${observation.suitePath.join(' > ')}:${observation.title}`
      );
    }
    locatorOwners.set(key, observation);
  }

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
    observations: Object.freeze(observations),
    resolvedResponsibilities,
    unresolved
  });
}

export function censusRepositoryTestCasesV1(repositoryRoot: string): TestCaseCensusV1 {
  const inventory = parseNulUtf8(
    gitReadBytes(
      repositoryRoot,
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'tests'],
      { label: 'test case census inventory' }
    ),
    'test case census inventory'
  )
    .filter((repositoryPath) => TEST_SOURCE_PATH.test(repositoryPath))
    .sort(compareText);

  const sources: Array<{ sourcePath: string; sourceText: string }> = [];
  for (const sourcePath of inventory) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(`${repositoryRoot}/${sourcePath}`);
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
