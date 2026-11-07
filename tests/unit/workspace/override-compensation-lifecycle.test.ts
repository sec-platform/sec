import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyOverrides } from '../../../src/adapters/compilation/compose/apply-overrides.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";

// Native integration: use the actual manifest parser, retained file readers and
// conditional publishers. These require the supported repository Bun/host profile.
async function fixture(run: (f: { root: string; target(id: string): string }) => Promise<void>,
  ids: readonly string[], conflicts: Readonly<Record<string, readonly string[]>> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-override-compensation-'));
  await settleWorkspaceCallback(async () => {
    const overrides = getWorkspacePaths(root).overridesRoot;
    const target = (id: string) => path.join(root, 'src', `${id}.ts`);
    await mkdir(path.join(overrides, 'patches'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(overrides, 'override-manifest.yaml'), [
      'overrides:', ...ids.flatMap(id => [
        `  - id: ${id}`, `    entry: patches/${id}.ts`, `    target: src/${id}.ts`,
        '    reason: compensation regression', '    source: manual', `    conflictsWith: ${JSON.stringify(conflicts[id] ?? [])}`
      ]), ''
    ].join('\n'));
    for (const id of ids) {
      await writeFile(path.join(overrides, 'patches', `${id}.ts`), `new-${id}`);
      await writeFile(target(id), `old-${id}`);
    }
    await run({ root, target });
  }, async () => { await rm(root, { recursive: true, force: true }); });
}

test('one local conflict edge in either direction refuses the entire Override batch before effects', async () => {
  for (const [owner, target] of [['a', 'b'], ['b', 'a']] as const) {
    await fixture(async f => {
      let fences = 0;
      await assert.rejects(applyOverrides(f.root, async () => { fences++; }),
        error => error instanceof CodedFailure && error.code === 'OVERRIDE-CONFLICT-001');
      assert.equal(fences, 0);
      assert.equal(await readFile(f.target('a'), 'utf8'), 'old-a');
      assert.equal(await readFile(f.target('b'), 'utf8'), 'old-b');
    }, ['a', 'b'], { [owner]: [target] });
  }
});

test('failed compensation of a substituted target does not prevent restoring an earlier output', async () => {
  await fixture(async f => {
    const primary = new Error('forward refused'); let injected = false;
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
  }, ['a', 'b', 'c']);
}, 30_000);

test('an equal-byte exclusive adoption never authorizes deleting another writer file', async () => {
  await fixture(async f => {
    const primary = new Error('later refusal'); let fences = 0;
    await rm(f.target('a'));
    await assert.rejects(applyOverrides(f.root, async () => {
      fences++;
      // Initial batch validation precedes the two exclusive-publication fences.
      if (fences === 2) await writeFile(f.target('a'), 'new-a');
      if (fences === 4) throw primary;
    }), error => error === primary);
    assert.equal(await readFile(f.target('a'), 'utf8'), 'new-a');
    assert.equal(await readFile(f.target('b'), 'utf8'), 'old-b');
  }, ['a', 'b']);
}, 30_000);

test('a no-op target changed during its publication fence is refused without overwriting it', async () => {
  await fixture(async f => {
    let fences = 0;
    await writeFile(f.target('a'), 'new-a');
    await assert.rejects(applyOverrides(f.root, async () => {
      if (++fences === 2) await writeFile(f.target('a'), 'user-change');
    }), error => error instanceof CodedFailure && error.code === 'OVERRIDE-APPLY-001');
    assert.equal(await readFile(f.target('a'), 'utf8'), 'user-change');
  }, ['a']);
}, 30_000);

test('successful compensation preserves a non-Error forward failure exactly', async () => {
  await fixture(async f => {
    const primary = Object.freeze({ failed: 'forward' });
    await assert.rejects(applyOverrides(f.root, async () => {
      if (await readFile(f.target('a'), 'utf8') === 'new-a') throw primary;
    }), error => error === primary);
    assert.equal(await readFile(f.target('a'), 'utf8'), 'old-a');
    assert.equal(await readFile(f.target('b'), 'utf8'), 'old-b');
  }, ['a', 'b']);
}, 30_000);
