import { expect, test } from 'bun:test';

import { parseFormatterConfig } from '../../platform/dev-runner/formatter.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

function formatterConfig(extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    $schema: 'https://json.schemastore.org/prettierrc',
    arrowParens: 'always',
    bracketSpacing: true,
    endOfLine: 'lf',
    printWidth: 140,
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'none',
    useTabs: false,
    ...extra
  }));
}

test('formatter keeps one changed-scope, index and worktree safety contract', async () => {
  const source = await readCompilerFile('platform/dev-runner/formatter.ts');

  for (const fragment of [
    'workingTreeFormattingTargets',
    'stagedFormattingTargets',
    'candidateFormattingTargets',
    "gitBytes(projectRoot, ['ls-tree', '-r', '-z', 'HEAD'])",
    "['update-index', '-z', '--index-info']",
    'GIT_INDEX_FILE: alternateIndexPath',
    'resolveRepositoryFileBinding',
    'resolveRepositoryRoot',
    'fs.realpath(absolutePath)',
    'ancestor.isSymbolicLink()',
    'named.nlink !== 1',
    'opened.nlink !== 1',
    'assertPathStillNamesHandle',
    'plugins: []',
    'contains unsupported or missing formatter options',
    "'docs/archive/'",
    "'docs/evidence/'",
    "'tests/fixtures/'"
  ]) expect(source).toContain(fragment);

  for (const forbidden of [
    'git add',
    'prettier --write .',
    'const { $schema: _schema, ...config }'
  ]) expect(source).not.toContain(forbidden);
});

test('formatter config is an exact scalar allowlist without plugin or parser authority', () => {
  expect(parseFormatterConfig(formatterConfig(), 'fixture')).toMatchObject({
    arrowParens: 'always',
    endOfLine: 'lf',
    printWidth: 140,
    trailingComma: 'none'
  });

  for (const extra of [
    { plugins: ['./candidate-plugin.mjs'] },
    { parser: 'typescript' },
    { filepath: 'other.ts' },
    { overrides: [] },
    { requirePragma: true },
    { insertPragma: true }
  ]) {
    expect(() => parseFormatterConfig(formatterConfig(extra), 'fixture')).toThrow(
      'unsupported or missing formatter options'
    );
  }
});
