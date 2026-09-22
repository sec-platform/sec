import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatOutputFiles } from '../../src/adapters/compilation/compose/format-output-files.ts';
import { generateRuntimeLibraryScaffold } from '../../src/adapters/compilation/compose/generate-runtime-library.ts';
import type { LockFile } from '../../src/compiler/contract.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

// Native integration: these tests deliberately retain actual Prettier, retained
// readers and physical publishers. They require the repository Bun/host profile.
test('formatter joins every started publication before reporting a peer failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-join-'));
  const release = deferred(), second = deferred();
  const failure = new Error('publication fence failed');
  let calls = 0, settled = false;
  writeFileSync(path.join(root, 'a.json'), '{"a":1}');
  writeFileSync(path.join(root, 'b.json'), '{"b":2}');
  const outcome = formatOutputFiles(root, ['a.json', 'b.json'], async () => {
    if (++calls === 1) await release.promise;
    else { second.resolve(); throw failure; }
  }).then(() => ({ succeeded: true as const }), reason => ({ succeeded: false as const, reason }))
    .finally(() => { settled = true; });
  try {
    await second.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, false);
    release.resolve();
    const result = await outcome;
    assert.equal(result.succeeded, false);
    assert.equal(readFileSync(path.join(root, 'a.json'), 'utf8'), '{"a":1}');
    assert.equal(readFileSync(path.join(root, 'b.json'), 'utf8'), '{"b":2}');
  } finally { release.resolve(); await outcome; rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('formatter refuses to overwrite a changed preimage at its publication fence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-preimage-'));
  const file = path.join(root, 'a.json');
  writeFileSync(file, '{"a":1}');
  try {
    await assert.rejects(formatOutputFiles(root, ['a.json'], async () => { writeFileSync(file, '{"user":true}'); }), /preimage/);
    assert.equal(readFileSync(file, 'utf8'), '{"user":true}');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('real parent cancellation at the formatter fence prevents publication', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-abort-'));
  const file = path.join(root, 'a.json'), controller = new AbortController();
  const reason = new Error('cancelled');
  writeFileSync(file, '{"a":1}');
  try {
    await assert.rejects(formatOutputFiles(root, ['a.json'], async () => controller.abort(reason), controller.signal), error => error === reason);
    assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('cancelled scaffold admission performs neither source rendering nor writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-scaffold-abort-'));
  const controller = new AbortController(), reason = new Error('cancelled'); controller.abort(reason);
  const lock = { get resolvedBlocks() { assert.fail('features read after cancellation'); throw new Error('unreachable'); } } as unknown as LockFile;
  try { await assert.rejects(generateRuntimeLibraryScaffold(root, lock, undefined, controller.signal), error => error === reason); }
  finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
