import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '../..');
const bootstrapEntry = path.join(repoRoot, 'platform', 'dev-runner.ts');

function moduleSpecifiers(source: string): readonly string[] {
  const runtimeStaticImport = /(?:^|\n)\s*import\s+(?!type\b)(?:[^;]*?\sfrom\s*)?(['"])([^'"]+)\1\s*;/gu;
  const runtimeStaticExport = /(?:^|\n)\s*export\s+(?!type\b)[^;]*?\sfrom\s*(['"])([^'"]+)\1\s*;/gu;
  return Object.freeze([
    ...source.matchAll(runtimeStaticImport),
    ...source.matchAll(runtimeStaticExport)
  ]
    .map((match) => match[2] as string));
}

test('worktree dependency bootstrap entry has no preinstalled package dependency', async () => {
  const pending = [bootstrapEntry];
  const visited = new Set<string>();
  const externalImports: string[] = [];

  while (pending.length > 0) {
    const filePath = path.resolve(pending.pop() as string);
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const source = await readFile(filePath, 'utf8');
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith('node:') || specifier.startsWith('bun:')) continue;
      if (!specifier.startsWith('.')) {
        externalImports.push(`${path.relative(repoRoot, filePath)} -> ${specifier}`);
        continue;
      }
      pending.push(path.resolve(path.dirname(filePath), specifier));
    }
  }

  expect(externalImports).toEqual([]);
  expect([...visited].map((filePath) => path.relative(repoRoot, filePath))).toContain(
    path.join('platform', 'shared', 'project-runtime.ts')
  );
});
