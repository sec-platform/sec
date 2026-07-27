#!/usr/bin/env bun
import { globby } from 'globby';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node, Project, SyntaxKind } from 'ts-morph';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DISCOVERY_PATTERNS = ['platform/**/*.ts', 'scripts/**/*.ts'] as const;
const MIN_TOKENS = 60;

interface FuncSig {
  file: string;
  hash: string;
  kind: 'arrow' | 'function' | 'method';
  line: number;
  name: string;
}

interface CallRelation {
  calleeName: string;
  callerFile: string;
  callerLine: number;
}

interface DiscoveryReport {
  calls: CallRelation[];
  duplicates: Array<{ count: number; functions: FuncSig[]; hash: string }>;
  filesScanned: number;
  scope: {
    excluded: string[];
    patterns: readonly string[];
  };
  timestamp: string;
}

function normalizeBody(sourceText: string): string {
  return sourceText
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, '_')
    .replace(/"[^"]*"/g, '"_"')
    .replace(/'[^']*'/g, "'_'")
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

function structuralHash(sourceText: string): string {
  return createHash('sha256').update(normalizeBody(sourceText)).digest('hex');
}

function enoughTokens(sourceText: string): boolean {
  return sourceText.split(/\s+/u).filter(Boolean).length >= MIN_TOKENS;
}

function calleeName(expression: Node): string | null {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return null;
}

async function discover(): Promise<DiscoveryReport> {
  const excluded = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/*.test.ts',
    '**/*.d.ts',
    'platform/registry/**/files/**'
  ];
  const filePaths = await globby([...DISCOVERY_PATTERNS], {
    absolute: true,
    cwd: ROOT,
    ignore: excluded,
    onlyFiles: true
  });

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: resolve(ROOT, 'tsconfig.json')
  });
  for (const filePath of filePaths.sort()) project.addSourceFileAtPath(filePath);

  const signatures: FuncSig[] = [];
  const calls: CallRelation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const repositoryPath = relative(ROOT, sourceFile.getFilePath()).replaceAll('\\', '/');

    for (const func of sourceFile.getFunctions()) {
      const body = func.getBody();
      if (!body || !enoughTokens(body.getText())) continue;
      signatures.push({
        file: repositoryPath,
        hash: structuralHash(body.getText()),
        kind: 'function',
        line: func.getStartLineNumber(),
        name: func.getName() ?? '<anon>'
      });
    }

    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const body = method.getBody();
        if (!body || !enoughTokens(body.getText())) continue;
        signatures.push({
          file: repositoryPath,
          hash: structuralHash(body.getText()),
          kind: 'method',
          line: method.getStartLineNumber(),
          name: `${cls.getName() ?? '<class>'}.${method.getName()}`
        });
      }
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || initializer.getKind() !== SyntaxKind.ArrowFunction) continue;
      const arrow = initializer.asKindOrThrow(SyntaxKind.ArrowFunction);
      const bodyText = arrow.getBody().getText();
      if (!enoughTokens(bodyText)) continue;
      signatures.push({
        file: repositoryPath,
        hash: structuralHash(bodyText),
        kind: 'arrow',
        line: declaration.getStartLineNumber(),
        name: declaration.getName()
      });
    }

    for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = calleeName(callExpression.getExpression());
      if (!name) continue;
      calls.push({
        calleeName: name,
        callerFile: repositoryPath,
        callerLine: callExpression.getStartLineNumber()
      });
    }
  }

  const groups = new Map<string, FuncSig[]>();
  for (const signature of signatures) {
    const group = groups.get(signature.hash) ?? [];
    group.push(signature);
    groups.set(signature.hash, group);
  }

  const duplicates = Array.from(groups.entries())
    .filter(([, entries]) => entries.length >= 2)
    .map(([hash, entries]) => ({
      count: entries.length,
      functions: entries.sort((left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line),
      hash
    }))
    .sort((left, right) => right.count - left.count || left.hash.localeCompare(right.hash));

  calls.sort((left, right) =>
    left.callerFile.localeCompare(right.callerFile)
    || left.callerLine - right.callerLine
    || left.calleeName.localeCompare(right.calleeName));

  return {
    calls,
    duplicates,
    filesScanned: filePaths.length,
    scope: {
      excluded,
      patterns: DISCOVERY_PATTERNS
    },
    timestamp: new Date().toISOString()
  };
}

const report = await discover();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outputIndex = args.indexOf('--output');
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : undefined;

if (outputFile) {
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(report, null, 2));
}

if (asJson && !outputFile) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Scanned ${report.filesScanned} files in ${report.scope.patterns.join(', ')}`);
  console.log(`Duplicate groups: ${report.duplicates.length}`);
  for (const group of report.duplicates.slice(0, 10)) {
    const first = group.functions[0]!;
    console.log(`  - ${group.hash.slice(0, 12)} : ${group.count} occurrences (first: ${first.file}:${first.line})`);
  }
  console.log(`Call relations captured without truncation: ${report.calls.length}`);
  if (outputFile) console.log(`Report written: ${outputFile}`);
}
