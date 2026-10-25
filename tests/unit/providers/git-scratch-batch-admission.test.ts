import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureGitScratchIndexDelta } from '../../../src/adapters/providers/git-read/runtime/scratch-input.ts';

const empty = () => ({ additions: [], removals: [] });
const addition = (path: string, bytes: Uint8Array<ArrayBufferLike> = Uint8Array.of(1)) => ({ path, bytes });

test('noncanonical and administrative index paths are refused for additions and removals', () => {
  for (const path of ['.', 'a/.', 'a/..', 'a//b', 'a/', '.git/config', 'a/.GIT/config',
    'git~1/config', '.git./config', '.git /config', 'C:drive', 'e\u0301.ts']) {
    assert.throws(() => captureGitScratchIndexDelta({ additions: [addition(path)], removals: [] }, 'sha1', 4096), TypeError, path);
  }
  assert.throws(() => captureGitScratchIndexDelta({ additions: [], removals: ['.git/config'] }, 'sha1', 4096), TypeError);
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
  // One empty SHA1 addition needs at least 50 bytes; one mode-zero SHA1 removal needs at least 45.
  assert.throws(() => captureGitScratchIndexDelta({ additions, removals: ['b'] }, 'sha1', 94), RangeError);
  assert.equal(reads, 0);
});

test('replacing an old parent file with a child and disjoint additions remain admissible', () => {
  const input = { additions: [addition('a/b'), addition('ab')], removals: ['a'] };
  const result = captureGitScratchIndexDelta(input, 'sha1', 4096);
  assert.deepEqual(result.additions.map(value => value.path), ['a/b', 'ab']);
  assert.deepEqual(result.removals, ['a']);
});

test('invalid trailing metadata is rejected before reading blob bytes', () => {
  let reads = 0;
  const unreadBlob = (path: string) => ({
    path,
    get bytes(): Uint8Array {
      reads++;
      throw new Error('blob bytes read before metadata admission');
    }
  });
  assert.throws(() => captureGitScratchIndexDelta({ additions: [unreadBlob('ok')], removals: ['../bad'] }, 'sha1', 4096), TypeError);
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
