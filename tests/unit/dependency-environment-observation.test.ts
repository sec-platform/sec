import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyDependencyEnvironment, observeDependencyEntry, sameObservedDependencyDirectory } from '../../src/adapters/toolchain/dependencies/runtime/environment-observation.ts';

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-environment-observation-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const stamps = { manifestHash: 'current', projectStampHash: 'current' };

// Actual ordinary filesystem observations; no retained-IO, content validation or
// installation authorization is inferred from a healthy diagnostic.
test('absent entries retain the public missing shape and no directory identity', async () => fixture(async root => {
  const result = await observeDependencyEntry(path.join(root, 'missing'));
  assert.deepEqual(result.entry, { path: path.join(root, 'missing'), exists: false, kind: 'missing', sizeBytes: 0 });
  assert.equal(result.directory, null);
}));

test('regular files are present but never qualify as dependency directories', async () => fixture(async root => {
  const file = path.join(root, 'node_modules'); await fs.writeFile(file, 'not a directory');
  const result = await observeDependencyEntry(file);
  assert.equal(result.entry.kind, 'physical'); assert.equal(result.entry.exists, true);
  assert.equal(result.entry.sizeBytes, 15); assert.equal(result.directory, null);
  assert.equal(classifyDependencyEnvironment(stamps, result, result), 'cold');
}));

test('directory counts stream names and close the actual directory handle', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'one'), '1'); await fs.mkdir(path.join(root, 'two'));
  const originalOpen = fs.opendir, originalRead = fs.readdir; let opened: Awaited<ReturnType<typeof fs.opendir>> | undefined;
  try {
    fs.readdir = (() => assert.fail('whole directory materialization')) as typeof fs.readdir;
    fs.opendir = (async (...args: Parameters<typeof fs.opendir>) => { opened = await originalOpen(...args); return opened; }) as typeof fs.opendir;
    const result = await observeDependencyEntry(root);
    assert.equal(result.entry.entryCount, 2); assert.ok(result.directory);
    assert.ok(opened); await assert.rejects(async () => opened!.read(), { code: 'ERR_DIR_CLOSED' });
  } finally { fs.opendir = originalOpen; fs.readdir = originalRead; }
}));

test('same target directory is recognized through a link without recounting it', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), project = path.join(root, 'project');
  await fs.mkdir(compiler); await fs.writeFile(path.join(compiler, 'package'), '1'); await fs.symlink(compiler, project, 'dir');
  const [a, b] = await Promise.all([observeDependencyEntry(compiler), observeDependencyEntry(project)]);
  assert.equal(b.entry.kind, 'link'); assert.equal(b.entry.entryCount, undefined);
  assert.equal(b.entry.target, a.entry.target); assert.equal(sameObservedDependencyDirectory(a, b), true);
  assert.equal(classifyDependencyEnvironment(stamps, a, b), 'warm-project');
}));

test('matching stamps cannot make a link to another directory healthy', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), foreign = path.join(root, 'foreign'), project = path.join(root, 'project');
  await fs.mkdir(compiler); await fs.mkdir(foreign); await fs.symlink(foreign, project, 'dir');
  const [a, b] = await Promise.all([observeDependencyEntry(compiler), observeDependencyEntry(project)]);
  assert.equal(sameObservedDependencyDirectory(a, b), false);
  assert.equal(classifyDependencyEnvironment(stamps, a, b), 'dirty');
}));

test('matching stamps cannot make a broken project link healthy', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), project = path.join(root, 'project');
  await fs.mkdir(compiler); await fs.symlink(path.join(root, 'absent'), project, 'dir');
  const [a, b] = await Promise.all([observeDependencyEntry(compiler), observeDependencyEntry(project)]);
  assert.equal(b.entry.exists, true); assert.equal(b.entry.kind, 'link'); assert.equal(b.directory, null);
  assert.equal(b.entry.target, undefined); assert.equal(classifyDependencyEnvironment(stamps, a, b), 'dirty');
}));

test('a link to a regular file cannot be a valid project dependency projection', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), project = path.join(root, 'project'), file = path.join(root, 'file');
  await fs.mkdir(compiler); await fs.writeFile(file, '1'); await fs.symlink(file, project, 'file');
  assert.equal(classifyDependencyEnvironment(stamps, await observeDependencyEntry(compiler), await observeDependencyEntry(project)), 'dirty');
}));

test('ordinary project directories remain dirty even when stamps match', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), project = path.join(root, 'project');
  await fs.mkdir(compiler); await fs.mkdir(project);
  assert.equal(classifyDependencyEnvironment(stamps, await observeDependencyEntry(compiler), await observeDependencyEntry(project)), 'dirty');
}));

test('a missing projection remains warm-compiler when the compiler generation is available', async () => fixture(async root => {
  assert.equal(classifyDependencyEnvironment(stamps, await observeDependencyEntry(root), await observeDependencyEntry(path.join(root, 'missing'))), 'warm-compiler');
}));

test('a missing or unusable compiler generation remains cold despite stamps', async () => fixture(async root => {
  const missing = await observeDependencyEntry(path.join(root, 'missing'));
  assert.equal(classifyDependencyEnvironment(stamps, missing, await observeDependencyEntry(root)), 'cold');
}));

test('stale stamp decisions and absent project stamps retain existing precedence', async () => fixture(async root => {
  const compiler = path.join(root, 'compiler'), project = path.join(root, 'project');
  await fs.mkdir(compiler); await fs.symlink(compiler, project, 'dir');
  const [a, b] = await Promise.all([observeDependencyEntry(compiler), observeDependencyEntry(project)]);
  assert.equal(classifyDependencyEnvironment({ ...stamps, projectStampHash: 'old' }, a, b), 'stale');
  assert.equal(classifyDependencyEnvironment({ ...stamps, projectStampHash: undefined }, a, b), 'warm-compiler');
}));

test('retargeting a link during observation is an error, not a mixed healthy result', async () => fixture(async root => {
  const one = path.join(root, 'one'), two = path.join(root, 'two'), link = path.join(root, 'link');
  await fs.mkdir(one); await fs.mkdir(two); await fs.symlink(one, link, 'dir');
  const original = fs.realpath; let changed = false;
  try {
    fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
      const result = await original(...args);
      if (args[0] === link && !changed) { changed = true; await fs.unlink(link); await fs.symlink(two, link, 'dir'); }
      return result;
    }) as typeof fs.realpath;
    await assert.rejects(observeDependencyEntry(link), /changed during observation/);
  } finally { fs.realpath = original; }
}));

test('directory mutation during enumeration is detected after the iterator closes', async () => fixture(async root => {
  await fs.writeFile(path.join(root, 'before'), '1'); const original = fs.opendir;
  try {
    fs.opendir = (async (...args: Parameters<typeof fs.opendir>) => {
      const dir = await original(...args); await fs.writeFile(path.join(root, 'after'), '2');
      await fs.utimes(root, new Date(1000), new Date(1000)); return dir;
    }) as typeof fs.opendir;
    await assert.rejects(observeDependencyEntry(root), /changed during observation/);
  } finally { fs.opendir = original; }
}));

test('observation root stays absolute across suspension and cwd changes', async () => fixture(async root => {
  const cwd = process.cwd(); await fs.mkdir(path.join(root, 'entry'));
  try {
    process.chdir(root); const pending = observeDependencyEntry('entry'); process.chdir(tmpdir());
    assert.equal((await pending).entry.path, path.join(root, 'entry'));
  } finally { process.chdir(cwd); }
}));

test('non-absence filesystem errors propagate without becoming a cold success', async () => fixture(async root => {
  const original = fs.lstat, failure = Object.freeze({ code: 'EACCES', owner: 'filesystem' });
  try {
    fs.lstat = (async () => { throw failure; }) as typeof fs.lstat;
    await assert.rejects(observeDependencyEntry(root), error => error === failure);
  } finally { fs.lstat = original; }
}));
