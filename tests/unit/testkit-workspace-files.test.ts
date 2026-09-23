import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';
import { copyWorkspaceFixture } from '../testkit/workspace-files.ts';

// Expected files and state are declared independently of the copy filter. This
// fixture uses real filesystem operations, not a second implementation of cp.
async function using(run: (root: string, source: string, target: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-fixture-copy-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  return settleWorkspaceCallback(async () => {
    await fs.mkdir(source);
    await fs.mkdir(target);
    await run(root, source, target);
  }, () => fs.rm(root, { recursive: true, force: true }));
}

async function write(root: string, relative: string, text: string) {
  const destination = path.join(root, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, text);
}

const absent = (file: string) => assert.rejects(fs.lstat(file), error => (error as { code?: string }).code === 'ENOENT');

test('independent copies preserve file bytes and empty directories without mutable sibling sharing', () => using(async (root, source, target) => {
  await write(source, 'src/main.ts', 'original'); await fs.mkdir(path.join(source, 'empty'));
  const sibling = path.join(root, 'sibling');
  await copyWorkspaceFixture(source, target); await copyWorkspaceFixture(source, sibling);
  await fs.writeFile(path.join(target, 'src/main.ts'), 'target-only');
  assert.equal(await fs.readFile(path.join(source, 'src/main.ts'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(sibling, 'src/main.ts'), 'utf8'), 'original');
  const a = await fs.stat(path.join(source, 'src/main.ts'), { bigint: true });
  const b = await fs.stat(path.join(target, 'src/main.ts'), { bigint: true });
  assert.ok(a.dev !== b.dev || a.ino !== b.ino); assert.equal(b.nlink, 1n);
  assert.deepEqual(await fs.readdir(path.join(target, 'empty')), []);
}));

test('local-state projection keeps only the declared snapshots and excludes transient state', () => using(async (_root, source, target) => {
  for (const file of ['.sec/pipeline-journal.json', '.sec/artifacts/report.json',
    '.sec/cache/composition-baseline.json', '.sec/cache/project-baseline.json']) await write(source, file, file);
  for (const file of ['.sec/cache/foreign-state.json', '.sec/locks/live.json', 'node_modules/x.js',
    'nested/node_modules/y.js', '.template-ready', 'nested/.template-ready']) await write(source, file, 'excluded');
  await copyWorkspaceFixture(source, target);
  assert.equal(await fs.readFile(path.join(target, '.sec/pipeline-journal.json'), 'utf8'), '.sec/pipeline-journal.json');
  assert.deepEqual((await fs.readdir(path.join(target, '.sec/cache'))).sort(), ['composition-baseline.json', 'project-baseline.json']);
  assert.equal(await fs.readFile(path.join(target, '.sec/artifacts/report.json'), 'utf8'), '.sec/artifacts/report.json');
  for (const file of ['.sec/locks', 'node_modules', 'nested/node_modules', '.template-ready', 'nested/.template-ready']) await absent(path.join(target, file));
}));

test('ordinary symlinks keep their textual target instead of copying the referred external content', () => using(async (root, source, target) => {
  await fs.writeFile(path.join(root, 'outside'), 'external');
  await fs.symlink('../outside', path.join(source, 'link'), 'file');
  const originalTarget = await fs.readlink(path.join(source, 'link'));
  await copyWorkspaceFixture(source, target);
  assert.equal((await fs.lstat(path.join(target, 'link'))).isSymbolicLink(), true);
  assert.equal(await fs.readlink(path.join(target, 'link')), originalTarget);
  assert.equal(await fs.readFile(path.join(root, 'outside'), 'utf8'), 'external');
}));

test('a protected snapshot symlink fails before ordinary destination writes', () => using(async (root, source, target) => {
  await write(source, 'src/main.ts', 'new'); await write(root, 'outside.json', '{}');
  await fs.mkdir(path.join(source, '.sec'));
  await fs.symlink(path.join(root, 'outside.json'), path.join(source, '.sec/pipeline-journal.json'), 'file');
  await assert.rejects(copyWorkspaceFixture(source, target), /physical regular file/);
  assert.deepEqual(await fs.readdir(target), []);
}));

test('an existing case-equivalent state destination is preserved rather than overwritten', () => using(async (_root, source, target) => {
  await write(source, '.sec/pipeline-journal.json', 'new');
  await write(target, '.SEC/keep', 'owned-by-another-operation');
  await assert.rejects(copyWorkspaceFixture(source, target), /case-equivalent/);
  assert.equal(await fs.readFile(path.join(target, '.SEC/keep'), 'utf8'), 'owned-by-another-operation');
}));

test('root bindings survive a caller cwd change during ordinary IO', () => using(async (root, source, target) => {
  await write(source, 'value', 'captured'); const cwd = process.cwd();
  try {
    process.chdir(root); const pending = copyWorkspaceFixture('source', 'target'); process.chdir(tmpdir());
    await pending; assert.equal(await fs.readFile(path.join(target, 'value'), 'utf8'), 'captured');
  } finally { process.chdir(cwd); }
}));

test('a source root symlink is rejected instead of turning a mutable fixture into a directory alias', () => using(async (root, source, target) => {
  const alias = path.join(root, 'alias'); await fs.symlink(source, alias, 'dir');
  await assert.rejects(copyWorkspaceFixture(alias, target), /ordinary directory/);
  assert.deepEqual(await fs.readdir(target), []);
}));

test('native overlapping-copy rejection preserves the source files', () => using(async (_root, source) => {
  await write(source, 'value', 'original');
  await assert.rejects(copyWorkspaceFixture(source, path.join(source, 'recursive-target')));
  assert.equal(await fs.readFile(path.join(source, 'value'), 'utf8'), 'original');
}));
