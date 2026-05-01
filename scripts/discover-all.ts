#!/usr/bin/env bun
import { globby } from 'globby';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PLATFORM_ROOT = join(ROOT, 'platform');
const MIN_TOKENS = 60;

type FuncSig = {
  hash: string;
  file: string;
  name: string;
  line: number;
  kind: 'function' | 'method' | 'arrow';
};

type CallRelation = {
  callerFile: string;
  callerLine: number;
  calleeName: string;
};

type DiscoveryReport = {
  duplicates: Array<{ hash: string; count: number; functions: FuncSig[] }>;
  calls: CallRelation[];
  filesScanned: number;
  timestamp: string;
};

function normalizeBody(sourceText: string): string {
  return sourceText
    .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, '_')
    .replace(/"[^"]*"/g, '"_"')
    .replace(/'[^']*'/g, "'_'")
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

async function discover(): Promise<DiscoveryReport> {
  const filePaths = await globby('**/*.ts', {
    cwd: PLATFORM_ROOT,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/*.test.ts', '**/*.d.ts'],
    absolute: true,
    onlyFiles: true
  });

  const project = new Project({ tsConfigFilePath: join(ROOT, 'tsconfig.json'), skipAddingFilesFromTsConfig: true });
  for (const fp of filePaths) project.addSourceFileAtPath(fp);

  const signatures: FuncSig[] = [];
  const calls: CallRelation[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = relative(PLATFORM_ROOT, sourceFile.getFilePath());

    for (const func of sourceFile.getFunctions()) {
      const body = func.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      if (bodyText.split(/\s+/).filter(Boolean).length < MIN_TOKENS) continue;
      const structure = normalizeBody(bodyText);
      const hash = createHash('md5').update(structure).digest('hex');
      signatures.push({ hash, file: relPath, name: func.getName() ?? '<anon>', line: func.getStartLineNumber(), kind: 'function' });
    }

    for (const cls of sourceFile.getClasses()) {
      for (const method of cls.getMethods()) {
        const body = method.getBody();
        if (!body) continue;
        const bodyText = body.getText();
        if (bodyText.split(/\s+/).filter(Boolean).length < MIN_TOKENS) continue;
        const structure = normalizeBody(bodyText);
        const hash = createHash('md5').update(structure).digest('hex');
        signatures.push({ hash, file: relPath, name: `${cls.getName() ?? '<class>'}.${method.getName()}`, line: method.getStartLineNumber(), kind: 'method' });
      }
    }

    for (const arrow of sourceFile.getVariableDeclarations().filter((v) => v.getInitializer()?.getKind() === SyntaxKind.ArrowFunction)) {
      const init = arrow.getInitializer()!;
      const body = init.getChildAtIndex(init.getChildCount() - 1);
      if (!body) continue;
      const bodyText = body.getText();
      if (bodyText.split(/\s+/).filter(Boolean).length < MIN_TOKENS) continue;
      const structure = normalizeBody(bodyText);
      const hash = createHash('md5').update(structure).digest('hex');
      signatures.push({ hash, file: relPath, name: arrow.getName() ?? '<arrow>', line: arrow.getStartLineNumber(), kind: 'arrow' });
    }

    for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = callExpr.getExpression();
      const calleeName = expr.getKind() === SyntaxKind.Identifier
        ? expr.getText()
        : expr.getKind() === SyntaxKind.PropertyAccessExpression
          ? (expr as any).getName?.() ?? expr.getText()
          : undefined;
      if (calleeName) {
        calls.push({ callerFile: relPath, callerLine: callExpr.getStartLineNumber(), calleeName });
      }
    }
  }

  const groups = new Map<string, FuncSig[]>();
  for (const sig of signatures) {
    if (!groups.has(sig.hash)) groups.set(sig.hash, []);
    groups.get(sig.hash)!.push(sig);
  }

  const duplicates = Array.from(groups.entries())
    .filter(([, entries]) => entries.length >= 2)
    .map(([hash, entries]) => ({
      hash,
      count: entries.length,
      functions: entries.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    }))
    .sort((a, b) => b.count - a.count);

  return {
    duplicates,
    calls: calls.slice(0, 500),
    filesScanned: filePaths.length,
    timestamp: new Date().toISOString()
  };
}

const report = await discover();
const args = process.argv.slice(2);
const asJson = args.includes('--json');

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  if (args.includes('--output')) {
    const outFile = args[args.indexOf('--output') + 1];
    if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
  }
} else {
  console.log(`Scanned ${report.filesScanned} files`);
  console.log(`Duplicate groups: ${report.duplicates.length}`);
  for (const g of report.duplicates.slice(0, 10)) {
    console.log(`  - ${g.hash.slice(0, 8)} : ${g.count} occurrences (first: ${g.functions[0].file}:${g.functions[0].line})`);
  }
  console.log(`Call relations captured: ${report.calls.length}`);
}
