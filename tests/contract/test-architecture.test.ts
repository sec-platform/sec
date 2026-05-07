import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { posixPath } from '../../platform/shared/paths.ts';

const repoRoot = process.cwd();
const canonicalTestkitFiles = [
  'tests/testkit/cli.ts',
  'tests/testkit/contracts.ts',
  'tests/testkit/workspace.ts'
];
const legacyAliasFiles = [
  'tests/helpers/cli-helpers.ts',
  'tests/helpers/workspace-fixtures.ts'
];
const legacyImportSpecifiers = [
  ['..', 'helpers', 'cli-helpers.ts'].join('/'),
  ['..', 'helpers', 'workspace-fixtures.ts'].join('/'),
  ['.', 'workspace-fixtures.ts'].join('/')
];

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function listTypeScriptFiles(relativeRoot: string): Promise<string[]> {
  const root = path.join(repoRoot, relativeRoot);
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name.endsWith('.ts')) {
        files.push(posixPath(path.relative(repoRoot, entryPath)));
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

test('test architecture exposes only canonical testkit primitives', async () => {
  await expect(Promise.all(canonicalTestkitFiles.map(pathExists))).resolves.toEqual([true, true, true]);
  await expect(Promise.all(legacyAliasFiles.map(pathExists))).resolves.toEqual([false, false]);
});

test('test sources do not import legacy test helper aliases', async () => {
  const offenders: string[] = [];

  for (const file of await listTypeScriptFiles('tests')) {
    if (file === 'tests/contract/test-architecture.test.ts') {
      continue;
    }
    const source = await fs.readFile(path.join(repoRoot, file), 'utf8');
    for (const specifier of legacyImportSpecifiers) {
      if (source.includes(`'${specifier}'`) || source.includes(`"${specifier}"`)) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
