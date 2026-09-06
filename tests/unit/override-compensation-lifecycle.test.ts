import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { applyOverrides } from '../../src/compiler/compose/apply-overrides.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';

// Native integration: use the actual manifest parser, retained file readers and
// conditional publishers. These require the supported repository Bun/host profile.
async function fixture(ids: readonly string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-override-compensation-'));
  const overrides = getWorkspacePaths(root).overridesRoot;
  const target = (id: string) => path.join(root, 'src', `${id}.ts`);
  await mkdir(path.join(overrides, 'patches'), { recursive: true });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(overrides, 'override-manifest.yaml'), [
    'overrides:', ...ids.flatMap(id => [
      `  - id: ${id}`, `    entry: patches/${id}.ts`, `    target: src/${id}.ts`,
      '    reason: compensation regression', '    source: manual', '    conflictsWith: []'
    ]), ''
  ].join('\n'));
  for (const id of ids) {
    await writeFile(path.join(overrides, 'patches', `${id}.ts`), `new-${id}`);
    await writeFile(target(id), `old-${id}`);
  }
  return { root, target };
}

test('failed compensation of a substituted target does not prevent restoring an earlier output', async () => {
  const f = await fixture(['a', 'b', 'c']);
  const primary = new Error('forward refused'); let injected = false;
  try {
    await assert.rejects(applyOverrides(f.root, async () => {
      if (!injected && await readFile(f.target('a'), 'utf8') === 'new-a'
          && await readFile(f.target('b'), 'utf8') === 'new-b') {
        injected = true;
        await writeFile(f.target('b'), 'user-change');
        throw primary;
      }
    }), error => {
      assert.ok(error instanceof Error && error.cause instanceof AggregateError);
      assert.equal(error.cause.cause, primary); assert.equal(error.cause.errors[0], primary);
      assert.equal(error.cause.errors.length, 2); return true;
    });
    assert.equal(await readFile(f.target('a'), 'utf8'), 'old-a');
    assert.equal(await readFile(f.target('b'), 'utf8'), 'user-change');
    assert.equal(await readFile(f.target('c'), 'utf8'), 'old-c');
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('an equal-byte exclusive adoption never authorizes deleting another writer file', async () => {
  const f = await fixture(['a', 'b']), primary = new Error('later refusal'); let fences = 0;
  try {
    await rm(f.target('a'));
    await assert.rejects(applyOverrides(f.root, async () => {
      fences++;
      // Initial batch validation precedes the two exclusive-publication fences.
      if (fences === 2) await writeFile(f.target('a'), 'new-a');
      if (fences === 4) throw primary;
    }), error => error === primary);
    assert.equal(await readFile(f.target('a'), 'utf8'), 'new-a');
    assert.equal(await readFile(f.target('b'), 'utf8'), 'old-b');
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('a no-op target changed during its publication fence is refused without overwriting it', async () => {
  const f = await fixture(['a']); let fences = 0;
  try {
    await writeFile(f.target('a'), 'new-a');
    await assert.rejects(applyOverrides(f.root, async () => {
      if (++fences === 2) await writeFile(f.target('a'), 'user-change');
    }), /no-op completion/);
    assert.equal(await readFile(f.target('a'), 'utf8'), 'user-change');
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('successful compensation preserves a non-Error forward failure exactly', async () => {
  const f = await fixture(['a', 'b']); const primary = Object.freeze({ failed: 'forward' });
  try {
    await assert.rejects(applyOverrides(f.root, async () => {
      if (await readFile(f.target('a'), 'utf8') === 'new-a') throw primary;
    }), error => error === primary);
    assert.equal(await readFile(f.target('a'), 'utf8'), 'old-a');
    assert.equal(await readFile(f.target('b'), 'utf8'), 'old-b');
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);
