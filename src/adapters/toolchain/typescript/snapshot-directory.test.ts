import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import { createTypeScriptSnapshotDirectoryReader } from './snapshot-directory.ts';

const files = [
  'root.ts', 'src/a.ts', 'src/a1.ts', 'src/value.tsx', 'src/a.d.ts', 'src/helper.js',
  'src/skip/b.ts', 'src/deep/nested/c.ts', 'src/.hidden.ts', '.hidden/private.ts',
  'other/a.ts', 'node_modules/pkg/index.ts', 'packages/pkg/src/index.ts',
  'packages/pkg/test/check.ts', 'dist/output.ts', 'README.md'
];

test('snapshot directory selection matches TypeScript on the same physical file inventory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'typescript-directory-contract-'));
  try {
    for (const file of files) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'export {};\n');
    }
    const read = createTypeScriptSnapshotDirectoryReader(files, root);
    const includeCases = [undefined, [], ['src'], ['src/'], ['src/**/*'], ['**/*'],
      ['src/*'], ['src', 'other'], ['**/a?.ts'], ['packages/*/src']];
    const excludeCases = [undefined, [], ['src/skip'], ['**/skip'], ['**/*.d.ts'], ['node_modules']];
    const extensionCases = [undefined, ['.ts'], ['.ts', '.tsx', '.js']];
    const roots = ['', 'src', 'packages/pkg'];
    for (const includes of includeCases) for (const excludes of excludeCases) {
      for (const extensions of extensionCases) for (const child of roots) {
        for (const depth of [undefined, 1, 2]) {
          const directory = path.join(root, child);
          const expected = ts.sys.readDirectory(directory, extensions, excludes, includes, depth).sort();
          assert.deepEqual(read(directory, extensions, excludes, includes, depth), expected,
            JSON.stringify({ child, includes, excludes, extensions, depth }));
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('directory patterns include descendants and directory excludes remove their whole subtree', () => {
  const root = path.resolve('virtual-snapshot');
  const read = createTypeScriptSnapshotDirectoryReader(files, root);
  const selected = read(root, ['.ts'], ['src/skip'], ['src']).map(file => path.relative(root, file));
  assert.deepEqual(selected, ['src/a.d.ts', 'src/a.ts', 'src/a1.ts', 'src/deep/nested/c.ts'].map(file => file.split('/').join(path.sep)));
});

test('snapshot directory has no ambient filesystem or parent-snapshot escape', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'typescript-directory-isolation-'));
  try {
    writeFileSync(path.join(root, 'ambient.ts'), 'export {};\n');
    const read = createTypeScriptSnapshotDirectoryReader(['owned/value.ts'], root);
    assert.deepEqual(read(root, ['.ts'], [], ['**/*']), [path.join(root, 'owned/value.ts').replaceAll('\\', '/')]);
    assert.deepEqual(read(path.dirname(root), ['.ts'], [], ['**/*']), []);
    assert.deepEqual(read(root, ['.ts'], [], ['../**/*']), [path.join(root, 'owned/value.ts').replaceAll('\\', '/')]);
    assert.deepEqual(read(path.join(root, 'missing'), ['.ts'], [], ['**/*']), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sealed directory inventory is insensitive to input order, duplicates and later array mutation', () => {
  const root = path.resolve('virtual-snapshot');
  const mutable = ['src/b.ts', 'src/a.ts', 'src/a.ts'];
  const read = createTypeScriptSnapshotDirectoryReader(mutable, root);
  const expected = createTypeScriptSnapshotDirectoryReader(['src/a.ts', 'src/b.ts'], root)(root, ['.ts'], [], ['src']);
  mutable.push('src/foreign.ts');
  const first = read(root, ['.ts'], [], ['src']);
  assert.deepEqual(first, expected);
  first.length = 0;
  assert.deepEqual(read(root, ['.ts'], [], ['src']), expected);
});

test('noncanonical inventories and file-directory collisions fail before interpretation', () => {
  const root = path.resolve('virtual-snapshot');
  for (const invalid of ['', '/abs.ts', '../x.ts', './x.ts', 'a//b.ts', 'a/../b.ts', 'a\\b.ts', 'a\0b.ts', 'C:relative.ts', 'C:/absolute.ts']) {
    assert.throws(() => createTypeScriptSnapshotDirectoryReader([invalid], root), /not canonical/);
  }
  for (const collision of [['a', 'a/b.ts'], ['a/b.ts', 'a']]) {
    assert.throws(() => createTypeScriptSnapshotDirectoryReader(collision, root), /collision/);
  }
});

test('directory lookup preserves sealed prefix existence and immediate-child inventory order', () => {
  const root = path.resolve('virtual-snapshot');
  const read = createTypeScriptSnapshotDirectoryReader([
    'other/z.ts', 'src/deep/nested/value.ts', 'src/zeta/file.ts',
    'src/deep/sibling.ts', 'src/direct.ts', 'src/.hidden/item.ts',
    '..cache/entry.ts', 'src/Case/value.ts'
  ], root);
  assert.deepEqual(read.getDirectories(root), ['other', 'src', '..cache'].map((entry) => path.join(root, entry)));
  assert.deepEqual(read.getDirectories(path.join(root, 'src')), ['deep', 'zeta', '.hidden', 'Case'].map((entry) => path.join(root, 'src', entry)));
  assert.deepEqual(read.getDirectories(path.join(root, 'src', 'deep')), [path.join(root, 'src', 'deep', 'nested')]);
  for (const directory of [root, `${root}${path.sep}`, path.join(root, 'src'), path.join(root, 'src', 'deep', '..'), path.join(root, '..cache')]) {
    assert.equal(read.directoryExists(directory), true, directory);
  }
  const relativeDirectory = path.relative(process.cwd(), path.join(root, 'src'));
  assert.equal(read.directoryExists(relativeDirectory), true);
  assert.deepEqual(read.getDirectories(relativeDirectory), read.getDirectories(path.join(root, 'src')));
  for (const absent of [path.dirname(root), `${root}-sibling`, path.join(root, 'src', 'missing'), path.join(root, 'src', 'direct.ts'), path.join(root, 'src', 'case')]) {
    assert.equal(read.directoryExists(absent), false, absent);
    assert.deepEqual(read.getDirectories(absent), [], absent);
  }
});

test('directory lookup cannot acquire uncaptured or caller-mutated directory entries', () => {
  const root = path.resolve('virtual-snapshot');
  const inventory = ['src/owned/value.ts'];
  const read = createTypeScriptSnapshotDirectoryReader(inventory, root);
  inventory.push('src/foreign/value.ts');
  const observed = read.getDirectories(path.join(root, 'src'));
  observed.push(path.join(root, 'src', 'injected'));
  assert.deepEqual(read.getDirectories(path.join(root, 'src')), [path.join(root, 'src', 'owned')]);
  assert.equal(read.directoryExists(path.join(root, 'src', 'foreign')), false);
  assert.equal(read.directoryExists(path.join(root, 'src', 'injected')), false);
  const empty = createTypeScriptSnapshotDirectoryReader([], root);
  assert.equal(empty.directoryExists(root), false);
  assert.deepEqual(empty.getDirectories(root), []);
});
