import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseWorktreePorcelainZ, parseWorktreeStatusPorcelainZ } from '../../../src/adapters/runtime-state/physical/contract/git-worktree-observation.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../../testkit/git-protocol.ts';

test('a backslash filename is refused rather than retargeted to a different directory path', () => {
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('?? a\\b\0')));
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('R  new\0a\\b\0')));
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('?? a/b\0'))[0]!.path, 'a/b');
});

test('only untracked and ignored directories may use the one directory terminator', () => {
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('?? dir/\0'))[0]!.path, 'dir');
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('!! ignored/\0'))[0]!.path, 'ignored');
  for (const record of [' M tracked/\0', 'R  target/\0source\0', 'R  target\0source/\0', '?? dir//\0']) {
    assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(record)));
  }
});

test('the full-file inventory profile rejects directory summaries instead of inventing a file observation', () => {
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('?? dir/\0'), { allowDirectoryEntries: false }));
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('?? dir/file\0'), { allowDirectoryEntries: false })[0]!.path, 'dir/file');
  for (const value of [null, 'false', 1]) {
    assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.alloc(0), { allowDirectoryEntries: value as never }), TypeError);
  }
});

test('duplicate records are refused while distinct renamed identities survive', () => {
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(' M file\0 M file\0')));
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('R  a\0b\0R  b\0a\0')).length, 2);
});

test('BOM, malformed UTF-8 and incomplete framing cannot be repaired into a trusted status', () => {
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('\ufeff?? file\0')));
  assert.throws(() => parseWorktreeStatusPorcelainZ(Uint8Array.of(63, 63, 32, 255, 0)), /invalid UTF-8/);
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('?? file')), /must end with NUL/);
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('R  target\0')));
  assert.throws(() => parseWorktreePorcelainZ(Buffer.from(`\ufeffworktree /x\0HEAD ${'a'.repeat(40)}\0branch refs/heads/main\0\0`)));
});

test('status byte views ignore custom iteration and reject shared memory', () => {
  const bytes = Uint8Array.from(Buffer.from('?? file\0'));
  Object.defineProperty(bytes, 'length', { value: 0 });
  Object.defineProperty(bytes, Symbol.iterator, { get() { assert.fail('caller iterator read'); } });
  assert.equal(parseWorktreeStatusPorcelainZ(bytes)[0]!.path, 'file');
  assert.throws(() => parseWorktreeStatusPorcelainZ(new Uint8Array(new SharedArrayBuffer(8))), TypeError);
});

test('portable status paths are rejected rather than silently normalized into a selector', () => {
  for (const path of ['x/../y', 'x//y', '../outside', './file', 'x:y', 'e\u0301']) {
    assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(`?? ${path}\0`)));
  }
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('?? é\0'))[0]!.path, 'é');
});

test('real Git inventory preserves renames and staged deletion alongside the same untracked path', () => inGitProtocolRepository(async (root, git) => {
  writeFileSync(path.join(root, 'rename-old'), 'stable');
  writeFileSync(path.join(root, 'space file'), 'before');
  writeFileSync(path.join(root, 'kept'), 'still in the worktree');
  gitProtocolSuccess(git(['add', '--', 'rename-old', 'space file', 'kept']));
  gitProtocolSuccess(git(['commit', '-qm', 'fixture']));
  gitProtocolSuccess(git(['mv', '--', 'rename-old', 'rename-new']));
  gitProtocolSuccess(git(['rm', '--cached', '--', 'kept']));
  writeFileSync(path.join(root, 'space file'), 'after');
  writeFileSync(path.join(root, 'extra file'), 'untracked');
  const result = parseWorktreeStatusPorcelainZ(Buffer.from(gitProtocolSuccess(git([
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ]))), { allowDirectoryEntries: false });
  assert.deepEqual(result.map(row => [row.index + row.worktree, row.path, row.originalPath]).sort(), [
    [' M', 'space file', null], ['??', 'extra file', null], ['R ', 'rename-new', 'rename-old'],
    ['D ', 'kept', null], ['??', 'kept', null]
  ].sort());
}));
