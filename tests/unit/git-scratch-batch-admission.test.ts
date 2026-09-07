import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { captureGitScratchIndexDelta } from '../../src/external-capabilities/git-read/runtime/scratch-input.ts';

const empty = () => ({ additions: [], removals: [] });
const addition = (path: string, bytes = Uint8Array.of(1)) => ({ path, bytes });

test('noncanonical and administrative index paths are refused for additions and removals', () => {
  for (const path of ['.', 'a/.', 'a/..', 'a//b', 'a/', '.git/config', 'a/.GIT/config',
    'git~1/config', '.git./config', '.git /config', 'C:drive', 'e\u0301.ts']) {
    assert.throws(() => captureGitScratchIndexDelta({ additions: [addition(path)], removals: [] }, 'sha1', 4096), TypeError, path);
    assert.throws(() => captureGitScratchIndexDelta({ additions: [], removals: [path] }, 'sha1', 4096), TypeError, path);
  }
});

test('ordinary dotfiles, Unicode, spaces and NUL-framed tab/newline paths retain exact spelling', () => {
  const paths = ['.gitignore', '.github/workflow.yaml', 'src/.gitkeep', 'git~2/file', '好.ts', 'with space', 'tab\tfile', 'line\nfile'];
  const value = captureGitScratchIndexDelta({ additions: paths.map(path => addition(path)), removals: [] }, 'sha1', 4096);
  assert.deepEqual(value.additions.map(entry => entry.path), paths);
});

test('a huge declared count is refused before reading any caller entries', () => {
  for (const field of ['additions', 'removals'] as const) {
    let reads = 0;
    const entries = new Proxy(new Array(1_000_000_000), {
      getOwnPropertyDescriptor(target, key) {
        if (key !== 'length') { reads++; throw new Error('entry inspected before cardinality admission'); }
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    });
    assert.throws(() => captureGitScratchIndexDelta({ ...empty(), [field]: entries }, 'sha1', 10), RangeError);
    assert.equal(reads, 0);
  }
});

test('metadata minimum includes both arrays and is checked before their data accessors', () => {
  let reads = 0;
  const additions: ReturnType<typeof addition>[] = new Array(1);
  Object.defineProperty(additions, '0', { get() { reads++; return addition('a'); } });
  // One empty SHA1 addition needs at least 50 bytes; one removal needs at least 2.
  assert.throws(() => captureGitScratchIndexDelta({ additions, removals: ['b'] }, 'sha1', 51), RangeError);
  assert.equal(reads, 0);
});

test('file/descendant additions are rejected independently of input order', () => {
  for (const paths of [['a', 'a/b'], ['a/b', 'a'], ['a/b/c', 'a'], ['x/y', 'x/y/z']]) {
    assert.throws(() => captureGitScratchIndexDelta({ additions: paths.map(path => addition(path)), removals: [] }, 'sha1', 4096), /file\/directory conflict/);
  }
});

test('replacing an old parent file with a child and disjoint additions remain admissible', () => {
  const input = { additions: [addition('a/b'), addition('ab')], removals: ['a'] };
  const result = captureGitScratchIndexDelta(input, 'sha1', 4096);
  assert.deepEqual(result.additions.map(value => value.path), ['a/b', 'ab']);
  assert.deepEqual(result.removals, ['a']);
});

test('invalid trailing metadata is rejected before any blob snapshot allocation', () => {
  const original = Buffer.from;
  let copies = 0;
  Buffer.from = ((...args: Parameters<typeof Buffer.from>) => {
    if (ArrayBuffer.isView(args[0])) copies++;
    return Reflect.apply(original, Buffer, args);
  }) as typeof Buffer.from;
  try {
    assert.throws(() => captureGitScratchIndexDelta({ additions: [addition('ok')], removals: ['../bad'] }, 'sha1', 4096));
    assert.throws(() => captureGitScratchIndexDelta({ additions: [addition('a'), addition('a/b')], removals: [] }, 'sha1', 4096));
    assert.equal(copies, 0);
  } finally { Buffer.from = original; }
});

test('exact byte thresholds account for each hash format, path and deletion terminator', () => {
  const input = { additions: [addition('好.ts', Uint8Array.of(1, 2))], removals: ['old'] };
  for (const [format, oid] of [['sha1', 'a'.repeat(40)], ['sha256', 'a'.repeat(64)]] as const) {
    const maximum = 2 + Buffer.byteLength(`100644 ${oid}\t好.ts\0old\0`, 'utf8');
    assert.deepEqual(captureGitScratchIndexDelta(input, format, maximum).removals, ['old']);
    assert.throws(() => captureGitScratchIndexDelta(input, format, maximum - 1), RangeError);
  }
  assert.deepEqual(captureGitScratchIndexDelta(empty(), 'sha1', 0), empty());
});

test('unknown hash formats are rejected before the request is interpreted', () => {
  let reads = 0;
  const request = { get additions() { reads++; return []; }, removals: [] };
  for (const format of ['sha512', '', null, undefined]) {
    assert.throws(() => captureGitScratchIndexDelta(request, format as never, 4096), TypeError);
  }
  assert.equal(reads, 0);
});

test('accepted blob data and lists remain detached without reading custom array iteration', () => {
  const bytes = Uint8Array.of(0, 1, 2).subarray(1), input = { additions: [addition('a', bytes)], removals: ['b'] };
  input.additions[Symbol.iterator] = () => { throw new Error('custom array iterator'); };
  const result = captureGitScratchIndexDelta(input, 'sha1', 4096);
  bytes.fill(9); input.removals[0] = 'changed'; input.additions[0]!.path = 'changed';
  assert.deepEqual([...result.additions[0]!.bytes], [1, 2]);
  assert.equal(result.additions[0]!.path, 'a'); assert.deepEqual(result.removals, ['b']);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.additions));
});

test('shared byte memory, sparse arrays and duplicate cross-list paths remain invalid', () => {
  assert.throws(() => captureGitScratchIndexDelta({ additions: [addition('a', new Uint8Array(new SharedArrayBuffer(1)))], removals: [] }, 'sha1', 4096));
  assert.throws(() => captureGitScratchIndexDelta({ additions: [], removals: new Array(1) }, 'sha1', 4096));
  assert.throws(() => captureGitScratchIndexDelta({ additions: [addition('a')], removals: ['a'] }, 'sha1', 4096));
});
