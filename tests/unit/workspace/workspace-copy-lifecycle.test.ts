import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyRecursive } from '../../../src/adapters/filesystem/discovery.ts';

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

// Uses actual ordinary Node/Bun filesystem operations, with controlled
// scheduling or failure only where a test needs to observe in-flight work.
test('one traversal preserves nested bytes and empty directories across a cwd-changing fence', async () => {
  const f = await fixture(), original = process.cwd();
  try {
    await fs.mkdir(path.join(f.source, 'a', 'empty'), { recursive: true });
    await fs.mkdir(path.join(f.source, 'b'));
    await fs.writeFile(path.join(f.source, 'root.bin'), Uint8Array.of(0, 255, 10));
    await fs.writeFile(path.join(f.source, 'a', 'nested.txt'), 'nested');
    process.chdir(f.root);
    await copyRecursive('source', 'target', async () => { process.chdir(tmpdir()); });
    assert.deepEqual(await fs.readFile(path.join(f.target, 'root.bin')), Buffer.from([0, 255, 10]));
    assert.equal(await fs.readFile(path.join(f.target, 'a', 'nested.txt'), 'utf8'), 'nested');
    assert.equal((await fs.lstat(path.join(f.target, 'a', 'empty'))).isDirectory(), true);
    assert.deepEqual(await fs.readdir(path.join(f.target, 'b')), []);
  } finally { process.chdir(original); await fs.rm(f.root, { recursive: true, force: true }); }
});

test('overlap, cancelled admission and an invalid fence perform no copy effects', async () => {
  const f = await fixture(), controller = new AbortController(), reason = new Error('cancel');
  controller.abort(reason);
  try {
    await fs.writeFile(path.join(f.source, 'kept'), 'original');
    await assert.rejects(copyRecursive(f.source, f.target, undefined, controller.signal), error => error === reason);
    assert.equal(await absent(f.target), true);
    await assert.rejects(copyRecursive(f.source, f.target, 7 as never), TypeError);
    assert.equal(await absent(f.target), true);
    for (const target of ['same', 'descendant', 'ancestor']) {
      const destination = target === 'same' ? f.source : target === 'ancestor' ? f.root : path.join(f.source, 'new');
      await assert.rejects(copyRecursive(f.source, destination, async () => assert.fail('effect')), /overlap/);
      assert.equal(await fs.readFile(path.join(f.source, 'kept'), 'utf8'), 'original');
      assert.equal(await absent(path.join(f.source, 'new')), true);
    }
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

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

test('single-file copying detaches destination hardlinks without rewriting a peer or the source', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'file'), peer = path.join(f.root, 'peer');
    await fs.writeFile(source, 'source'); await fs.writeFile(peer, 'old'); await fs.mkdir(f.target);
    await fs.link(peer, path.join(f.target, 'file'));
    await copyRecursive(source, path.join(f.target, 'file'));
    assert.equal(await fs.readFile(peer, 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(f.target, 'file'), 'utf8'), 'source');
    await fs.link(source, path.join(f.target, 'source-link'));
    await copyRecursive(source, path.join(f.target, 'source-link'));
    assert.equal(await fs.readFile(source, 'utf8'), 'source');
    assert.equal(await fs.readFile(path.join(f.target, 'source-link'), 'utf8'), 'source');
  } finally { await fs.rm(f.root, { recursive: true, force: true }); }
});

test.serial('directory regrouping does not multiply concurrent file copies', async () => {
  const f = await fixture();
  const original = { copyFile: fs.copyFile, lstat: fs.lstat, mkdir: fs.mkdir, readdir: fs.readdir };
  const files = Array.from({ length: 32 }, (_, index) => ({ name: String(index), bytes: String(index) }));
  try {
    for (const file of files) await fs.writeFile(path.join(f.source, file.name), file.bytes);
    // Keep real metadata and directory effects, but resolve them without native
    // IO scheduling. A setImmediate turn then drains every runnable promise
    // chain to a held copy or completion; no elapsed delay means "saturated".
    fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => Reflect.apply(lstatSync, undefined, args)) as typeof fs.lstat;
    fs.mkdir = (async (...args: Parameters<typeof fs.mkdir>) => Reflect.apply(mkdirSync, undefined, args)) as typeof fs.mkdir;
    fs.readdir = (async (...args: Parameters<typeof fs.readdir>) => Reflect.apply(readdirSync, undefined, args)) as typeof fs.readdir;
    async function peakFor(target: string): Promise<number> {
      let active = 0, peak = 0, copied = 0, settled = false, draining = false;
      let failure: { error: unknown } | undefined;
      const releases: Array<() => void> = [];
      fs.copyFile = (async (...args: Parameters<typeof fs.copyFile>) => {
        const gate = deferred();
        peak = Math.max(peak, ++active);
        if (draining) gate.resolve(); else releases.push(gate.resolve);
        try { await gate.promise; copyFileSync(...args); copied++; }
        finally { active--; }
      }) as typeof fs.copyFile;
      const outcome = copyRecursive(f.source, target)
        .catch(error => { failure = { error }; })
        .finally(() => { settled = true; });
      try {
        while (!settled) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (settled) break;
          const release = releases.shift();
          assert.ok(release, 'unfinished copy must be waiting at a controlled completion gate');
          release();
        }
        await outcome;
        if (failure) throw failure.error;
        assert.equal(copied, files.length); assert.equal(active, 0);
        for (const file of files) assert.equal(await fs.readFile(path.join(target, file.name), 'utf8'), file.bytes);
        return peak;
      } finally {
        draining = true;
        for (const release of releases.splice(0)) release();
        await outcome;
        // Also drain the released callbacks if a faulty copy returned early.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
    const flatPeak = await peakFor(path.join(f.root, 'flat-target'));
    for (let directory = 0; directory < 4; directory++) await fs.mkdir(path.join(f.source, `dir${directory}`));
    for (const [index, file] of files.entries()) {
      const nested = path.join(`dir${index % 4}`, file.name);
      await fs.rename(path.join(f.source, file.name), path.join(f.source, nested));
      file.name = nested;
    }
    const branchedPeak = await peakFor(f.target);
    // Compare directory layouts under the same operation policy. This finite
    // observation neither fixes its capacity nor proves a general resource bound.
    assert.ok(branchedPeak <= flatPeak, 'directory branches must not multiply one copy operation\'s capacity');
  } finally { Object.assign(fs, original); await fs.rm(f.root, { recursive: true, force: true }); }
});

test.serial('a failed copy drains started peers without requiring parallel admission', async () => {
  const f = await fixture();
  const original = { copyFile: fs.copyFile, lstat: fs.lstat, mkdir: fs.mkdir, readdir: fs.readdir };
  const refuse = deferred(), release = deferred(), primary = new Error('copy failed');
  const started: string[] = [];
  let returned = false, peerFinished = false;
  let outcome: Promise<unknown> | undefined;
  try {
    await fs.writeFile(path.join(f.source, 'a'), 'a'); await fs.writeFile(path.join(f.source, 'b'), 'b');
    fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => Reflect.apply(lstatSync, undefined, args)) as typeof fs.lstat;
    fs.mkdir = (async (...args: Parameters<typeof fs.mkdir>) => Reflect.apply(mkdirSync, undefined, args)) as typeof fs.mkdir;
    fs.readdir = (async (...args: Parameters<typeof fs.readdir>) => Reflect.apply(readdirSync, undefined, args)) as typeof fs.readdir;
    fs.copyFile = (async (...args: Parameters<typeof fs.copyFile>) => {
      started.push(path.basename(String(args[0])));
      if (started.length === 1) { await refuse.promise; throw primary; }
      await release.promise; copyFileSync(...args); peerFinished = true;
    }) as typeof fs.copyFile;
    outcome = copyRecursive(f.source, f.target).then(() => ({ ok: true }), error => ({ error }))
      .finally(() => { returned = true; });
    // With metadata IO already resolved, this turn reaches every currently
    // admissible copy gate without assuming a worker count or directory order.
    await new Promise<void>(resolve => setImmediate(resolve));
    const admitted = [...started];
    assert.ok(admitted.length === 1 || admitted.length === 2);
    assert.equal(new Set(admitted).size, admitted.length);
    for (const name of admitted) assert.ok(name === 'a' || name === 'b');
    refuse.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    if (admitted.length === 2) {
      assert.equal(returned, false); assert.equal(peerFinished, false);
    }
    release.resolve();
    const result = await outcome as { error: unknown };
    assert.deepEqual(started, admitted, 'failure must not admit a previously queued copy');
    assert.equal(peerFinished, admitted.length === 2);
    assert.equal(await absent(path.join(f.target, admitted[0]!)), true);
    if (admitted.length === 2) assert.equal(await fs.readFile(path.join(f.target, admitted[1]!), 'utf8'), admitted[1]);
    assert.ok(result.error === primary || (result.error instanceof AggregateError && result.error.errors.includes(primary)));
  } finally {
    refuse.resolve(); release.resolve(); await outcome;
    await new Promise<void>(resolve => setImmediate(resolve));
    Object.assign(fs, original); await fs.rm(f.root, { recursive: true, force: true });
  }
});
