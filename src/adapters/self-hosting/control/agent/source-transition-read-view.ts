import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { rawSha256 } from '../../../../contracts/canonical.ts';
import { parseSecOperationReadPlan, type SecOperationReadPlan } from './read-plan.ts';

const applicationPath = 'src/application/source-program-transition.ts';
const assemblyPath = 'src/bootstrap/engineering/source-program-transition-runtime.ts';
const testPath = 'tests/unit/source-program-transition-use-case.test.ts';
const descriptorPath = 'src/adapters/repository/repository-audit/module.json';
const budgetPath = 'src/adapters/repository/repository-audit/cli-contract.ts';

/** A syntax observation for the existing task Read Plan. This does not load
 * candidate code, construct a Program, issue a design binding or restore a result. */
export async function observeSourceTransitionReadView(
  root: string,
  suppliedPlan?: SecOperationReadPlan
): Promise<unknown> {
  const plan = suppliedPlan === undefined ? null : parseSecOperationReadPlan(suppliedPlan);
  const observed = await Promise.all([applicationPath, assemblyPath, testPath, descriptorPath, budgetPath].map(async ref => {
    const bytes = await readFile(path.resolve(root, ref));
    if (bytes.byteLength > 131_072) throw new Error(`Source transition read view input exceeds bound: ${ref}`);
    return { ref, bytes: bytes.toString('utf8'), contentDigest: rawSha256(bytes) };
  }));
  const [application, assembly, tests, descriptor, budget] = observed;
  const parse = (source: typeof application) => ts.createSourceFile(source!.ref, source!.bytes,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const app = parse(application);
  const bound = parse(assembly);
  const cases = parse(tests);
  const budgetSource = parse(budget);
  const position = (node: ts.Node, file: ts.SourceFile) => {
    const start = file.getLineAndCharacterOfPosition(node.getStart(file));
    return Object.freeze({ ref: file.fileName, line: start.line + 1, column: start.character + 1 });
  };
  const findVariable = (file: ts.SourceFile, name: string): ts.VariableDeclaration => {
    let found: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        if (found !== undefined) throw new Error(`Ambiguous source transition declaration: ${name}`);
        found = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (found === undefined) throw new Error(`Missing source transition declaration: ${name}`);
    return found;
  };
  // Only the actual fixed literal used by runtime dispatch is projected. No
  // evaluation, general expression interpreter or caller-authored edge input.
  const literal = (node: ts.Expression): unknown => {
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'Object.freeze' && node.arguments.length === 1) {
      return literal(node.arguments[0]!);
    }
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => literal(value));
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw new Error('Source transition control has an unsupported literal member');
      }
      return [property.name.text, literal(property.initializer)];
    }));
    throw new Error('Source transition control is not a supported fixed literal');
  };
  const controlDeclaration = findVariable(app, 'SOURCE_PROGRAM_TRANSITION_CONTROL');
  if (controlDeclaration.initializer === undefined) throw new Error('Source transition control has no value');
  const control = literal(controlDeclaration.initializer);
  const portsDeclaration = findVariable(bound, 'ports');
  if (portsDeclaration.initializer === undefined || !ts.isObjectLiteralExpression(portsDeclaration.initializer)) {
    throw new Error('Source transition assembly has no explicit port bindings');
  }
  const signatures = new Map<string, Readonly<{ inputs: readonly string[]; output: string }>>();
  for (const statement of app.statements) {
    if (!ts.isInterfaceDeclaration(statement) || !statement.name.text.endsWith('Ports')) continue;
    for (const member of statement.members) {
      if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) signatures.set(member.name.text, {
        inputs: member.parameters.map(parameter => parameter.getText(app)), output: member.type?.getText(app) ?? 'unobserved'
      });
    }
  }
  const imports = new Map<string, string>();
  for (const statement of bound.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      imports.set(item.name.text, `${path.posix.normalize(path.posix.join(path.posix.dirname(assemblyPath), statement.moduleSpecifier.text))}#${item.propertyName?.text ?? item.name.text}`);
    }
  }
  const steps = portsDeclaration.initializer.properties.map(property => {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error('Unsupported source transition port');
    const calls = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.add(node.expression.getText(bound));
      ts.forEachChild(node, visit);
    };
    visit(property.initializer);
    const comments = ts.getLeadingCommentRanges(bound.text, property.pos) ?? [];
    return Object.freeze({ port: property.name.text, ...signatures.get(property.name.text),
      binding: position(property, bound),
      declaredOwnerContract: comments.map(range => bound.text.slice(range.pos, range.end)).join('\n'),
      calls: [...calls].map(call => ({ call, ownerRef: imports.get(call) ?? null })),
      // Syntax can expose the calls and declared responsibilities. It cannot
      // prove admission, write scope, resource settlement or current authority.
      currentPermission: 'unobserved', actualEffects: 'unobserved', currentResult: 'unobserved'
    });
  });
  const testRegistrations: Array<Readonly<{ title: string; source: ReturnType<typeof position>; directCalls: readonly string[] }>> = [];
  const collectTests = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(cases) === 'test' && node.arguments[0] !== undefined
        && ts.isStringLiteral(node.arguments[0])) {
      const directCalls = new Set<string>();
      const visit = (child: ts.Node): void => {
        if (ts.isCallExpression(child)) directCalls.add(child.expression.getText(cases));
        ts.forEachChild(child, visit);
      };
      for (const argument of node.arguments.slice(1)) visit(argument);
      testRegistrations.push({ title: node.arguments[0].text, source: position(node, cases), directCalls: [...directCalls] });
    }
    ts.forEachChild(node, collectTests);
  };
  collectTests(cases);
  const audit = JSON.parse(descriptor!.bytes) as { operationObligations?: readonly unknown[] };
  return Object.freeze({ schema: 'sec-source-transition-read-view-v1', authority: 'none',
    observation: 'current-source-syntax', coherentSnapshot: 'unproven',
    readPlanDigest: plan?.readPlanDigest ?? null,
    sources: observed.map(({ ref, contentDigest }) => {
      const reference = plan?.requiredRefs.find(value => value.ref === ref);
      const receipt = plan?.readReceipts.find(value => value.refId === reference?.id);
      return { ref, contentDigest, readPlanReference: reference?.id ?? null,
        receiptContent: receipt === undefined ? 'unobserved' : receipt.contentDigest === contentDigest ? 'matches-observed-bytes' : 'differs' };
    }),
    control: { value: control, source: position(controlDeclaration, app),
      dependencies: ['sourceTask', 'verificationTask', 'joined'].map(name => {
        const declaration = findVariable(app, name);
        return { name, expression: declaration.initializer?.getText(app) ?? null, source: position(declaration, app) };
      }) }, steps,
    resources: { descriptor: descriptorPath, declaredObligations: audit.operationObligations ?? null,
      activeBudget: 'unobserved', recovery: 'declared-by-bound-owner-contracts',
      deadlineRules: budgetSource.statements.filter(ts.isFunctionDeclaration)
        .filter(declaration => declaration.name?.text.startsWith('repositoryAudit') && declaration.name.text.endsWith('Deadline'))
        .map(declaration => ({ source: position(declaration, budgetSource), contract: declaration.getText(budgetSource) })) },
    tests: { registrations: testRegistrations, relationship: 'direct-syntax-calls; semantic-coverage-and-results-unobserved' },
    unresolvedFrontier: ['Accepted semantic design binding is not issued by this syntax projection',
      'Current input, authority, effects, settlement and execution evidence require their original live owners',
      'Source reads are individually digested; they are not a retained atomic source snapshot']
  });
}
