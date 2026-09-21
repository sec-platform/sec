import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyRecursive } from '../../src/adapters/filesystem/discovery.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-copy-lifecycle-'));
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  await fs.mkdir(source);
  return { root, source, target };
}
async function absent(p: string) {
  try { await fs.lstat(p); return false; }
  catch (error) { if ((error as {code?: string}).code === 'ENOENT') return true; throw error; }
}

// Uses actual ordinary Node/Bun filesystem operations. The two tests wrapping
// fs.copyFile add controlled scheduling/failure but do not replace other IO.
test('one traversal copies nested files and preserves empty directories', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.source, 'a', 'empty'), { recursive: true });
    await fs.mkdir(path.join(f.source, 'b'));
    await fs.writeFile(path.join(f.source, 'root.bin'), Uint8Array.of(0, 255, 10));
    await fs.writeFile(path.join(f.source, 'a', 'nested.txt'), 'nested');
    await copyRecursive(f.source, f.target);
    assert.deepEqual(await fs.readFile(path.join(f.target, 'root.bin')), Buffer.from([0, 255, 10]));
    assert.equal(await fs.readFile(path.join(f.target, 'a', 'nested.txt'), 'utf8'), 'nested');
    assert.equal((await fs.lstat(path.join(f.target, 'a', 'empty'))).isDirectory(), true);
    assert.deepEqual(await fs.readdir(path.join(f.target, 'b')), []);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('relative source and destination remain bound when the effect fence changes cwd', async () => {
  const f = await fixture(), original = process.cwd();
  try {
    await fs.writeFile(path.join(f.source, 'file'), 'original');
    process.chdir(f.root);
    await copyRecursive('source', 'target', async () => { process.chdir(tmpdir()); });
    assert.equal(await fs.readFile(path.join(f.target, 'file'), 'utf8'), 'original');
  } finally { process.chdir(original); await fs.rm(f.root, { recursive: true, force: true }); }
});

for (const target of ['same', 'descendant', 'ancestor']) {
  test(`${target} overlap is rejected before the first effect`, async () => {
    const f = await fixture();
    try {
      await fs.writeFile(path.join(f.source, 'kept'), 'original');
      const destination = target === 'same' ? f.source : target === 'ancestor' ? f.root : path.join(f.source, 'new');
      await assert.rejects(copyRecursive(f.source, destination, async () => assert.fail('effect')), /overlap/);
      assert.equal(await fs.readFile(path.join(f.source, 'kept'), 'utf8'), 'original');
      assert.equal(await absent(path.join(f.source, 'new')), true);
    } finally { await fs.rm(f.root, { recursive: true, force: true }); }
  });
}

test('a later symbolic-link source refuses the complete plan before destination creation', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.source, 'a-valid'), 'valid');
    const outside = path.join(f.root, 'outside'); await fs.writeFile(outside, 'external');
    await fs.symlink(outside, path.join(f.source, 'z-link'), 'file');
    await assert.rejects(copyRecursive(f.source, f.target), /symbolic-link/);
    assert.equal(await absent(f.target), true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('cancelled admission and an invalid fence perform no destination effects', async () => {
  const f = await fixture(), controller = new AbortController(), reason = new Error('cancel');
  controller.abort(reason);
  try {
    await assert.rejects(copyRecursive(f.source, f.target, undefined, controller.signal), error => error === reason);
    await assert.rejects(copyRecursive(f.source, f.target, 7 as never), TypeError);
    assert.equal(await absent(f.target), true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('parent cancellation in the fence prevents file materialization', async () => {
  const f = await fixture(), controller = new AbortController(), reason = new Error('cancel');
  try {
    const source = path.join(f.source, 'file'); await fs.writeFile(source, 'source');
    await assert.rejects(copyRecursive(source, path.join(f.target, 'file'), async () => { controller.abort(reason); }, controller.signal), error => error === reason);
    assert.equal(await absent(path.join(f.target, 'file')), true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('a changed source at the final fence is not copied as the admitted input', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'file'); await fs.writeFile(source, 'source'); await fs.mkdir(f.target);
    await assert.rejects(copyRecursive(source, path.join(f.target, 'file'), async () => { await fs.writeFile(source, 'changed-size'); }), /identity changed/);
    assert.equal(await absent(path.join(f.target, 'file')), true);
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('destination hardlinks are detached without rewriting the other file', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'file'), peer = path.join(f.root, 'peer');
    await fs.writeFile(source, 'source'); await fs.writeFile(peer, 'old'); await fs.mkdir(f.target);
    await fs.link(peer, path.join(f.target, 'file'));
    await copyRecursive(source, path.join(f.target, 'file'));
    assert.equal(await fs.readFile(peer, 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(f.target, 'file'), 'utf8'), 'source');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('single-file copying to another hardlink of itself retains the source', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'file'); await fs.writeFile(source, 'source'); await fs.mkdir(f.target);
    await fs.link(source, path.join(f.target, 'file'));
    await copyRecursive(source, path.join(f.target, 'file'));
    assert.equal(await fs.readFile(source, 'utf8'), 'source');
    assert.equal(await fs.readFile(path.join(f.target, 'file'), 'utf8'), 'source');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test('one concurrency ceiling covers files across all directory branches', async () => {
  const f = await fixture(), originalCopy = fs.copyFile;
  let active = 0, maximum = 0, copied = 0;
  try {
    for (let d = 0; d < 4; d++) {
      await fs.mkdir(path.join(f.source, `dir${d}`));
      for (let i = 0; i < 8; i++) await fs.writeFile(path.join(f.source, `dir${d}`, `${i}`), String(i));
    }
    fs.copyFile = (async (...args: Parameters<typeof fs.copyFile>) => {
      active++; maximum = Math.max(maximum, active);
      try { await new Promise(resolve => setTimeout(resolve, 5)); await originalCopy(...args); copied++; }
      finally { active--; }
    }) as typeof fs.copyFile;
    await copyRecursive(f.source, f.target);
    assert.equal(copied, 32); assert.ok(maximum > 1); assert.ok(maximum <= 8); assert.equal(active, 0);
  } finally { fs.copyFile = originalCopy; await fs.rm(f.root, { recursive: true, force: true }); }
});

test('a failed copy joins an already-started peer before reporting the error', async () => {
  const f = await fixture(), originalCopy = fs.copyFile;
  const entered = deferred(), release = deferred(), refused = deferred(), primary = new Error('copy failed');
  let returned = false, peerFinished = false;
  let outcome: Promise<unknown> | undefined;
  try {
    await fs.writeFile(path.join(f.source, 'a'), 'a'); await fs.writeFile(path.join(f.source, 'b'), 'b');
    fs.copyFile = (async (...args: Parameters<typeof fs.copyFile>) => {
      if (path.basename(String(args[0])) === 'a') { await entered.promise; refused.resolve(); throw primary; }
      entered.resolve(); await release.promise; await originalCopy(...args); peerFinished = true;
    }) as typeof fs.copyFile;
    outcome = copyRecursive(f.source, f.target).then(() => ({ ok: true }), error => ({ error }))
      .finally(() => { returned = true; });
    await refused.promise; await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(returned, false); assert.equal(peerFinished, false);
    release.resolve();
    const result = await outcome as { error: unknown };
    assert.equal(peerFinished, true);
    assert.ok(result.error === primary || (result.error instanceof AggregateError && result.error.errors.includes(primary)));
  } finally { release.resolve(); await outcome; fs.copyFile = originalCopy; await fs.rm(f.root, { recursive: true, force: true }); }
});
