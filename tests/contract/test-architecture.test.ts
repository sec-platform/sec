import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import { posixPath } from '../../platform/shared/paths.ts';
import { isTestFile } from '../../platform/shared/test-budget-contract.ts';
import {
  isTestImpactSourceFile,
  readRepositoryModuleGraphV1
} from '../../platform/shared/test-impact-contract.ts';
import { gitReadBytes, parseNulUtf8 } from '../../tooling/sec-dev/git/git-read.ts';

const repoRoot = process.cwd();

function callIdentity(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const owner = callIdentity(expression.expression);
  return owner === null ? null : `${owner}.${expression.name.text}`;
}

function callRootIdentifier(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return callRootIdentifier(expression.expression);
  if (ts.isCallExpression(expression)) return callRootIdentifier(expression.expression);
  return null;
}

function rawTextReadPath(node: ts.CallExpression): ts.Expression | null {
  const callee = callIdentity(node.expression);
  if (callee !== null && (
    callee === 'readFile'
    || callee === 'readFileSync'
    || callee === 'readCompilerFile'
    || callee === 'readCompilerTextFile'
    || callee.endsWith('.readFile')
    || callee.endsWith('.readFileSync')
  )) {
    return node.arguments[0] ?? null;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'text'
    && ts.isCallExpression(node.expression.expression)
    && callIdentity(node.expression.expression.expression) === 'Bun.file'
  ) {
    return node.expression.expression.arguments[0] ?? null;
  }
  return null;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
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

function containsEmbeddedExecutableProjection(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAccessExpression(candidate)
      && (candidate.name.text === 'run' || candidate.name.text === 'script')
    ) {
      found = true;
      return;
    }
    if (
      ts.isBindingElement(candidate)
      && ts.isIdentifier(candidate.name)
      && (candidate.name.text === 'run' || candidate.name.text === 'script')
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function containsIdentifier(node: ts.Node, identifier: string): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(candidate) && candidate.text === identifier) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function expressionIsTextProjection(
  expression: ts.Expression,
  taintedIdentifiers: ReadonlySet<string>,
  workflowDocumentRead: boolean,
  governedTextReaders: ReadonlySet<ts.CallExpression>
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return taintedIdentifiers.has(current.text);
  if (ts.isCallExpression(current)) {
    if (governedTextReaders.has(current)) return true;
    const callee = callIdentity(current.expression);
    if (callee === 'String' && current.arguments[0] !== undefined) {
      return expressionIsTextProjection(
        current.arguments[0], taintedIdentifiers, workflowDocumentRead, governedTextReaders
      );
    }
    if (ts.isPropertyAccessExpression(current.expression)) {
      const receiver = current.expression.expression;
      if (expressionIsTextProjection(
        receiver, taintedIdentifiers, workflowDocumentRead, governedTextReaders
      )) return true;
    }
    return workflowDocumentRead && containsEmbeddedExecutableProjection(current);
  }
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (workflowDocumentRead && containsEmbeddedExecutableProjection(current)) return true;
    return expressionIsTextProjection(
      current.expression, taintedIdentifiers, workflowDocumentRead, governedTextReaders
    );
  }
  if (ts.isBinaryExpression(current)) {
    return expressionIsTextProjection(
      current.left, taintedIdentifiers, workflowDocumentRead, governedTextReaders
    ) || expressionIsTextProjection(
      current.right, taintedIdentifiers, workflowDocumentRead, governedTextReaders
    );
  }
  if (ts.isConditionalExpression(current)) {
    return expressionIsTextProjection(
      current.whenTrue, taintedIdentifiers, workflowDocumentRead, governedTextReaders
    ) || expressionIsTextProjection(
      current.whenFalse, taintedIdentifiers, workflowDocumentRead, governedTextReaders
    );
  }
  if (ts.isTemplateExpression(current)) {
    return current.templateSpans.some((span) => (
      expressionIsTextProjection(
        span.expression, taintedIdentifiers, workflowDocumentRead, governedTextReaders
      )
    ));
  }
  return workflowDocumentRead && containsEmbeddedExecutableProjection(current);
}

function arrayProjectionInitializers(expression: ts.Expression): readonly ts.Expression[] | null {
  const current = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(current)) return current.elements;
  if (
    ts.isCallExpression(current)
    && callIdentity(current.expression) === 'Promise.all'
    && current.arguments[0] !== undefined
  ) {
    const argument = unwrapExpression(current.arguments[0]);
    if (ts.isArrayLiteralExpression(argument)) return argument.elements;
  }
  return null;
}

function expectAssertionActual(node: ts.CallExpression): ts.Expression | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.expression.name.text !== 'toContain' && node.expression.name.text !== 'toMatch') return null;
  let target: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(target)) target = target.expression;
  if (!ts.isCallExpression(target) || callIdentity(target.expression) !== 'expect') return null;
  return target.arguments[0] ?? null;
}

function constantInitializers(parsed: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      values.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return values;
}

function staticString(
  expression: ts.Expression,
  testFile: string,
  constants: ReadonlyMap<string, ts.Expression>,
  resolving: ReadonlySet<string> = new Set()
): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isIdentifier(expression)) {
    const initializer = constants.get(expression.text);
    if (initializer === undefined || resolving.has(expression.text)) return null;
    return staticString(initializer, testFile, constants, new Set([...resolving, expression.text]));
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const replacement = staticString(span.expression, testFile, constants, resolving);
      if (replacement === null) return null;
      value += replacement + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(expression.left, testFile, constants, resolving);
    const right = staticString(expression.right, testFile, constants, resolving);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isCallExpression(expression)) {
    const callee = callIdentity(expression.expression);
    if (callee === 'process.cwd' && expression.arguments.length === 0) return repoRoot;
    if ((callee === 'path.join' || callee === 'path.resolve') && expression.arguments.length > 0) {
      const values = expression.arguments.map((argument) => staticString(argument, testFile, constants, resolving));
      if (values.some((value) => value === null)) return null;
      const concrete = values as string[];
      return callee === 'path.resolve' ? path.resolve(...concrete) : path.join(...concrete);
    }
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isMetaProperty(expression.expression)
    && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  ) {
    const absoluteTestFile = path.join(repoRoot, testFile);
    if (expression.name.text === 'dir') return path.dirname(absoluteTestFile);
    if (expression.name.text === 'url') return pathToFileURL(absoluteTestFile).href;
  }
  if (ts.isNewExpression(expression) && callIdentity(expression.expression) === 'URL') {
    const [relativeExpression, baseExpression] = expression.arguments ?? [];
    if (relativeExpression === undefined || baseExpression === undefined) return null;
    const relative = staticString(relativeExpression, testFile, constants, resolving);
    const base = staticString(baseExpression, testFile, constants, resolving);
    if (relative === null || base === null) return null;
    try {
      const resolved = new URL(relative, base);
      return resolved.protocol === 'file:' ? fileURLToPath(resolved) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function repositoryPath(value: string): string | null {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  const relative = posixPath(path.relative(repoRoot, absolute));
  return relative === '..' || relative.startsWith('../') ? null : relative;
}

function trackedPaths(): readonly string[] {
  return parseNulUtf8(
    gitReadBytes(repoRoot, ['ls-files', '-z', '--'], {
      maxBuffer: 64 * 1024 * 1024,
      label: 'test architecture tracked-path inventory'
    }),
    'test architecture tracked-path inventory'
  );
}

async function readCandidateTestSource(repositoryPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(repoRoot, repositoryPath), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // git ls-files describes the index while the candidate worktree may
      // intentionally delete a tracked test before staging. There are no
      // candidate bytes to inspect in that state.
      return null;
    }
    throw error;
  }
}

test('test modules contain scenarios and do not inspect tracked module source text', async () => {
  const tracked = new Set(trackedPaths());
  const moduleFiles = new Set(readRepositoryModuleGraphV1().files.filter((file) => (
    tracked.has(file)
    && !file.startsWith('tests/')
    && isTestImpactSourceFile(file)
  )));
  const emptyModules: string[] = [];
  const implementationReaders: string[] = [];
  const textualSourceAssertions: string[] = [];

  for (const file of [...tracked].filter(isTestFile).sort((left, right) => left.localeCompare(right))) {
    const source = await readCandidateTestSource(file);
    if (source === null) continue;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const constants = constantInitializers(parsed);
    const declarations: ts.VariableDeclaration[] = [];
    const governedTextReaders = new Set<ts.CallExpression>();
    let workflowDocumentRead = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) declarations.push(node);
      if (ts.isCallExpression(node)) {
        const pathExpression = rawTextReadPath(node);
        if (pathExpression !== null) {
          const staticValue = staticString(pathExpression, file, constants);
          const target = staticValue === null ? null : repositoryPath(staticValue);
          if (target !== null && /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(target)) {
            workflowDocumentRead = true;
          }
          if (
            (target !== null && /^(?:AGENTS\.md|\.agents\/skills\/.+\/SKILL\.md|\.github\/workflows\/[^/]+\.ya?ml)$/u.test(target))
            || (target === null && containsIdentifier(pathExpression, 'SKILLS_ROOT'))
          ) governedTextReaders.add(node);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(parsed);
    const taintedIdentifiers = new Set<string>();
    for (let pass = 0; pass <= declarations.length; pass += 1) {
      let changed = false;
      for (const declaration of declarations) {
        if (declaration.initializer === undefined) continue;
        if (ts.isIdentifier(declaration.name)) {
          if (
            !taintedIdentifiers.has(declaration.name.text)
            && expressionIsTextProjection(
              declaration.initializer,
              taintedIdentifiers,
              workflowDocumentRead,
              governedTextReaders
            )
          ) {
            taintedIdentifiers.add(declaration.name.text);
            changed = true;
          }
          continue;
        }
        if (!ts.isArrayBindingPattern(declaration.name)) continue;
        const initializers = arrayProjectionInitializers(declaration.initializer);
        if (initializers === null) continue;
        declaration.name.elements.forEach((element, index) => {
          if (
            !ts.isOmittedExpression(element)
            && ts.isIdentifier(element.name)
            && initializers[index] !== undefined
            && !taintedIdentifiers.has(element.name.text)
            && expressionIsTextProjection(
              initializers[index]!,
              taintedIdentifiers,
              workflowDocumentRead,
              governedTextReaders
            )
          ) {
            taintedIdentifiers.add(element.name.text);
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    let scenarioCount = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const root = callRootIdentifier(node.expression);
        if (root === 'test' || root === 'it') scenarioCount += 1;
        const pathExpression = rawTextReadPath(node);
        if (pathExpression !== null) {
          const staticValue = staticString(pathExpression, file, constants);
          const target = staticValue === null ? null : repositoryPath(staticValue);
          if (target !== null && moduleFiles.has(target)) {
            const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
            implementationReaders.push(`${file}:${line}->${target}`);
          }
        }
        const assertionActual = expectAssertionActual(node);
        const textualMethodReceiver = ts.isPropertyAccessExpression(node.expression)
          && ['includes', 'indexOf', 'match', 'matchAll', 'search'].includes(node.expression.name.text)
          ? node.expression.expression
          : null;
        const regexTestArgument = ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'test'
          ? node.arguments[0] ?? null
          : null;
        if (
          (assertionActual !== null && expressionIsTextProjection(
            assertionActual, taintedIdentifiers, workflowDocumentRead, governedTextReaders
          ))
          || (textualMethodReceiver !== null && expressionIsTextProjection(
            textualMethodReceiver, taintedIdentifiers, workflowDocumentRead, governedTextReaders
          ))
          || (regexTestArgument !== null && expressionIsTextProjection(
            regexTestArgument, taintedIdentifiers, workflowDocumentRead, governedTextReaders
          ))
        ) {
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
          textualSourceAssertions.push(`${file}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    if (scenarioCount === 0) emptyModules.push(file);
  }

  expect(emptyModules).toEqual([]);
  expect(implementationReaders).toEqual([]);
  expect(textualSourceAssertions).toEqual([]);
});
