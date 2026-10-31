import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { copyWorkspaceFixture } from '../../testkit/workspace-files.ts';

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

test('captured-root copies preserve ordinary files, symlink text and independent sibling bytes', () => using(async (root, source, target) => {
  await write(source, 'src/main.ts', 'original'); await fs.mkdir(path.join(source, 'empty'));
  await fs.writeFile(path.join(root, 'outside'), 'external');
  await fs.symlink('../outside', path.join(source, 'link'), 'file');
  const originalTarget = await fs.readlink(path.join(source, 'link'));
  const sibling = path.join(root, 'sibling');
  const cwd = process.cwd();
  try {
    process.chdir(root);
    const pending = copyWorkspaceFixture('source', 'target');
    process.chdir(tmpdir());
    await pending;
  } finally { process.chdir(cwd); }
  await copyWorkspaceFixture(source, sibling);
  assert.equal(await fs.readFile(path.join(target, 'src/main.ts'), 'utf8'), 'original');
  // Mutate the existing file, so a hard-linked copy would also change its peers.
  await fs.writeFile(path.join(target, 'src/main.ts'), 'target-only', { flag: 'r+' });
  assert.equal(await fs.readFile(path.join(target, 'src/main.ts'), 'utf8'), 'target-only');
  assert.equal(await fs.readFile(path.join(source, 'src/main.ts'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(sibling, 'src/main.ts'), 'utf8'), 'original');
  await fs.writeFile(path.join(sibling, 'src/main.ts'), 'sibling-only', { flag: 'r+' });
  assert.equal(await fs.readFile(path.join(source, 'src/main.ts'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(target, 'src/main.ts'), 'utf8'), 'target-only');
  assert.equal(await fs.readFile(path.join(sibling, 'src/main.ts'), 'utf8'), 'sibling-only');
  assert.deepEqual(await fs.readdir(path.join(target, 'empty')), []);
  assert.equal((await fs.lstat(path.join(target, 'link'))).isSymbolicLink(), true);
  assert.equal(await fs.readlink(path.join(target, 'link')), originalTarget);
  assert.equal(await fs.readFile(path.join(root, 'outside'), 'utf8'), 'external');
}));

test('local-state projection case-folds declared snapshots and excludes transient state', () => using(async (_root, source, target) => {
  for (const [file, bytes] of [
    ['.SEC/pipeline-journal.json', '{"kind":"pipeline"}\n'],
    ['.SEC/artifacts/report.json', '{"kind":"report"}\n'],
    ['.SEC/artifacts/state/graph.lock.json', '{"kind":"lock"}\n'],
    ['.SEC/CACHE/composition-baseline.json', '{"kind":"composition"}\n'],
    ['.SEC/CACHE/project-baseline.json', '{"kind":"project"}\n']
  ] as const) await write(source, file, bytes);
  for (const file of ['.SEC/CACHE/foreign-state.json', '.SEC/locks/live.json',
    '.SEC/workspace-write-lease/protocol.json', '.SEC/semantic-mutation/v1/state.json',
    '.SEC/future-state/state.json', 'node_modules/x.js', 'nested/node_modules/y.js',
    '.template-ready', 'nested/.template-ready']) await write(source, file, 'excluded');
  await copyWorkspaceFixture(source, target);
  assert.equal(await fs.readFile(path.join(target, '.sec/pipeline-journal.json'), 'utf8'), '{"kind":"pipeline"}\n');
  assert.deepEqual((await fs.readdir(path.join(target, '.sec/cache'))).sort(), ['composition-baseline.json', 'project-baseline.json']);
  assert.equal(await fs.readFile(path.join(target, '.sec/cache/composition-baseline.json'), 'utf8'), '{"kind":"composition"}\n');
  assert.equal(await fs.readFile(path.join(target, '.sec/cache/project-baseline.json'), 'utf8'), '{"kind":"project"}\n');
  assert.equal(await fs.readFile(path.join(target, '.sec/artifacts/report.json'), 'utf8'), '{"kind":"report"}\n');
  assert.equal(await fs.readFile(path.join(target, '.sec/artifacts/state/graph.lock.json'), 'utf8'), '{"kind":"lock"}\n');
  for (const file of ['.sec/locks', '.sec/workspace-write-lease', '.sec/semantic-mutation', '.sec/future-state',
    'node_modules', 'nested/node_modules', '.template-ready', 'nested/.template-ready']) await absent(path.join(target, file));
}));

test('protected snapshot aliases fail before ordinary destination writes', () => using(async (root, source, target) => {
  for (const [index, snapshot] of ['pipeline-journal.json', 'cache/project-baseline.json'].entries()) {
    const caseSource = path.join(source, `case-${index}`);
    const caseTarget = path.join(target, `case-${index}`);
    await fs.mkdir(caseSource);
    await fs.mkdir(caseTarget);
    await write(caseSource, 'src/main.ts', 'new');
    const directoryLink = snapshot.startsWith('cache/') && process.platform === 'win32';
    const external = path.join(root, directoryLink ? 'outside-directory' : 'outside.json');
    if (directoryLink) await fs.mkdir(external);
    else await fs.writeFile(external, '{"external":true}\n');
    const alias = path.join(caseSource, '.sec', snapshot);
    await fs.mkdir(path.dirname(alias), { recursive: true });
    await fs.symlink(external, alias, directoryLink ? 'junction' : 'file');
    await assert.rejects(copyWorkspaceFixture(caseSource, caseTarget), error => error instanceof Error
      && error.message === `Workspace fixture .sec/${snapshot} must be a physical regular file`);
    assert.deepEqual(await fs.readdir(caseTarget), []);
  }
}));

test('an existing case-equivalent state destination is preserved without writes', () => using(async (root, source, target) => {
  for (const alias of [false, true]) {
    const caseName = alias ? 'alias' : 'physical';
    const caseSource = path.join(source, caseName);
    const caseTarget = path.join(target, caseName);
    await fs.mkdir(caseSource);
    await fs.mkdir(caseTarget);
    await write(caseSource, '.sec/pipeline-journal.json', 'new');
    await write(caseSource, 'src/main.ts', 'new source');
    const existing = alias ? path.join(root, 'external-state') : path.join(caseTarget, '.SEC');
    await write(existing, 'keep', 'owned-by-another-operation');
    if (alias) await fs.symlink(existing, path.join(caseTarget, '.SEC'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(copyWorkspaceFixture(caseSource, caseTarget), /destination must not contain a case-equivalent local-state path/);
    assert.equal(await fs.readFile(path.join(existing, 'keep'), 'utf8'), 'owned-by-another-operation');
    assert.deepEqual(await fs.readdir(caseTarget), ['.SEC']);
    await absent(path.join(existing, 'pipeline-journal.json'));
    await absent(path.join(caseTarget, 'src'));
  }
}));

test.skipIf(process.platform === 'win32' && process.env.SEC_CASE_SENSITIVE_FIXTURE_TEST !== '1')(
  'workspace fixture copies reject case-colliding local-state paths',
  () => using(async (_root, source, target) => {
    await fs.mkdir(path.join(source, '.sec', 'cache'), { recursive: true });
    await fs.mkdir(path.join(source, '.SEC', 'CACHE'), { recursive: true });
    await assert.rejects(copyWorkspaceFixture(source, target), /case-colliding local-state paths/);
  })
);

test('workspace fixture copies reject a local-state root alias', () => using(async (root, source, target) => {
  const external = path.join(root, 'external-state');
  await fs.mkdir(path.join(external, 'workspace-write-lease'), { recursive: true });
  await fs.symlink(external, path.join(source, '.sec'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(copyWorkspaceFixture(source, target), /Workspace fixture \.sec must be a physical directory/);
}));

test('workspace fixture copies reject a local-state cache alias', () => using(async (root, source, target) => {
  const external = path.join(root, 'external-cache');
  await fs.mkdir(path.join(source, '.sec'));
  await fs.mkdir(external);
  await fs.symlink(external, path.join(source, '.sec', 'cache'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(copyWorkspaceFixture(source, target), /Workspace fixture \.sec\/cache must be a physical directory/);
}));

test('a source root symlink is rejected instead of turning a mutable fixture into a directory alias', () => using(async (root, source, target) => {
  const alias = path.join(root, 'alias'); await fs.symlink(source, alias, 'dir');
  await assert.rejects(copyWorkspaceFixture(alias, target), /ordinary directory/);
  assert.deepEqual(await fs.readdir(target), []);
}));
