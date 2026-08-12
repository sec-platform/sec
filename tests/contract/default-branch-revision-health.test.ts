import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { resolveDefaultBranchRevisionHealthV1 } from '../../platform/shared/default-branch-revision-health.ts';
import {
  createMainHealthLedgerV1,
  createMainHealthRepairWorkPackagePathV1
} from '../../platform/shared/main-health-contract.ts';

const SHA = '1'.repeat(40);
const TREE = '2'.repeat(40);
const DIGEST = `sha256:${'a'.repeat(64)}` as const;

function productionTypeScriptFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...productionTypeScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(absolute);
  }
  return result;
}

function healthy() {
  return createMainHealthLedgerV1({
    repository: 'sec-platform/sec', defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE,
    status: 'healthy', failureFingerprints: [], owner: null, repairWorkPackage: null,
    observedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['ordinary'], trustRevision: SHA,
    producer: { identity: 'main-health-runtime', trustRevision: SHA, sourceTransport: 'github-api',
      sourceRunId: 'run-1', sourceRef: 'refs/heads/main', sourceDigest: DIGEST }
  });
}

function degraded() {
  const owner = 'default-branch-health-maintainer';
  return createMainHealthLedgerV1({
    repository: 'sec-platform/sec', defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE,
    status: 'degraded', failureFingerprints: [DIGEST], owner,
    repairWorkPackage: createMainHealthRepairWorkPackagePathV1({ repository: 'sec-platform/sec',
      defaultBranch: 'main', mainSha: SHA, mainTreeSha: TREE, owner, failureFingerprints: [DIGEST] }),
    observedAt: '2026-08-09T00:00:00.000Z', expiresAt: '2026-08-09T01:00:00.000Z',
    allowedLanes: ['repair'], trustRevision: SHA,
    producer: { identity: 'main-health-runtime', trustRevision: SHA, sourceTransport: 'github-api',
      sourceRunId: 'run-1', sourceRef: 'refs/heads/main', sourceDigest: DIGEST }
  });
}

test('live exact-main health selects ordinary routing eligibility', () => {
  const result = resolveDefaultBranchRevisionHealthV1({ ledger: healthy(),
    now: '2026-08-09T00:30:00.000Z', repository: 'sec-platform/sec', defaultBranch: 'main',
    mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA });
  expect(result.allowed).toBe(true);
  expect(result.status).toBe('healthy');
});

test('ordinary default-branch projection cannot consume the separately owned repair lane', () => {
  const result = resolveDefaultBranchRevisionHealthV1({
    ledger: degraded(), lane: 'repair',
    now: '2026-08-09T00:30:00.000Z', repository: 'sec-platform/sec', defaultBranch: 'main',
    mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA
  } as unknown as Parameters<typeof resolveDefaultBranchRevisionHealthV1>[0]);
  expect(result).toMatchObject({ allowed: false, status: 'locked' });
  expect(result.reason).toContain('ordinary lane is not eligible');
});

test('every production MainHealth lane consumer is AST-bound to its sole ordinary or repair owner', () => {
  const violations: string[] = [];
  const repairConsumers: string[] = [];
  const repositoryRoot = process.cwd();
  for (const absolutePath of [
    ...productionTypeScriptFiles(path.join(repositoryRoot, 'platform', 'shared')),
    ...productionTypeScriptFiles(path.join(repositoryRoot, 'scripts', 'codex'))
  ]) {
    const relativePath = path.relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
    const sourceFile = ts.createSourceFile(
      relativePath,
      readFileSync(absolutePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const resolverNames = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.endsWith('main-health-contract.ts') ||
          statement.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === 'resolveMainHealthLaneV1') resolverNames.add(element.name.text);
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && resolverNames.has(node.expression.text)) {
        const argument = node.arguments[0];
        const lane = argument !== undefined && ts.isObjectLiteralExpression(argument)
          ? argument.properties.find((property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'lane')
          : undefined;
        const literal = lane !== undefined && ts.isStringLiteral(lane.initializer)
          ? lane.initializer.text : null;
        if (literal === 'repair'
            && relativePath === 'platform/shared/main-health-repair-contract.ts') {
          repairConsumers.push(relativePath);
        } else if (literal !== 'ordinary') {
          violations.push(`${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  expect(violations).toEqual([]);
  expect(repairConsumers).toEqual(['platform/shared/main-health-repair-contract.ts']);
});

test('missing, malformed, expired, or revision-drifted health locks fail closed', () => {
  for (const [ledger, now, mainSha] of [
    [null, '2026-08-09T00:30:00.000Z', SHA],
    [{ schema: 'unknown' }, '2026-08-09T00:30:00.000Z', SHA],
    [healthy(), '2026-08-09T02:00:00.000Z', SHA],
    [healthy(), '2026-08-09T00:30:00.000Z', '3'.repeat(40)]
  ] as const) {
    const result = resolveDefaultBranchRevisionHealthV1({ ledger, now,
      repository: 'sec-platform/sec', defaultBranch: 'main',
      mainSha, mainTreeSha: TREE, trustRevision: SHA });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('locked');
  }
});

test('cross-repository or cross-branch MainHealth is locked', () => {
  for (const identity of [
    { repository: 'attacker/fork', defaultBranch: 'main' },
    { repository: 'sec-platform/sec', defaultBranch: 'release' }
  ]) {
    const result = resolveDefaultBranchRevisionHealthV1({ ledger: healthy(),
      now: '2026-08-09T00:30:00.000Z', ...identity,
      mainSha: SHA, mainTreeSha: TREE, trustRevision: SHA });
    expect(result).toMatchObject({ allowed: false, status: 'locked' });
  }
});
