import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'bun:test';
import { parseWorktreeStatusPorcelainZ, parseWorktreePorcelainZ }
  from '../../src/runtime-state/physical/contract/git-worktree-observation.ts';
import { inGitProtocolRepository, gitProtocolSuccess } from '../testkit/git-protocol.ts';

// These vectors are machine records with independently declared path/status
// identities. The expected records do not call the production path decoder.
test('ordinary tracked, untracked and renamed records retain exact selected identities', () => {
  assert.deepEqual(parseWorktreeStatusPorcelainZ(Buffer.from(' M path with spaces\0?? new-file\0R  destination\0original\0')), [
    { index: ' ', worktree: 'M', path: 'path with spaces', originalPath: null },
    { index: '?', worktree: '?', path: 'new-file', originalPath: null },
    { index: 'R', worktree: ' ', path: 'destination', originalPath: 'original' }
  ]);
});

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

test('record identity preserves distinct index and untracked facts for the same path', () => {
  assert.deepEqual(parseWorktreeStatusPorcelainZ(Buffer.from('D  file\0?? file\0')), [
    { index: 'D', worktree: ' ', path: 'file', originalPath: null },
    { index: '?', worktree: '?', path: 'file', originalPath: null }
  ]);
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(' M file\0 M file\0')));
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('R  a\0b\0R  b\0a\0')).length, 2);
});

test('BOM, malformed UTF-8 and incomplete framing cannot be repaired into a trusted status', () => {
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('\ufeff?? file\0')));
  assert.throws(() => parseWorktreeStatusPorcelainZ(Uint8Array.of(63, 63, 32, 255, 0)));
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('?? file')));
  assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from('R  target\0')));
  assert.throws(() => parseWorktreePorcelainZ(Buffer.from(`\ufeffworktree /x\0HEAD ${'a'.repeat(40)}\0branch refs/heads/main\0\0`)));
});

test('status byte views ignore custom iteration and reject shared memory', () => {
  const bytes = Uint8Array.from(Buffer.from('?? file\0'));
  Object.defineProperty(bytes, 'length', { value: 0 });
  assert.equal(parseWorktreeStatusPorcelainZ(bytes)[0]!.path, 'file');
  assert.throws(() => parseWorktreeStatusPorcelainZ(new Uint8Array(new SharedArrayBuffer(8))), TypeError);
});

test('portable status paths are rejected rather than silently normalized into a selector', () => {
  for (const path of ['x/../y', 'x//y', '../outside', './file', 'x:y', 'e\u0301']) {
    assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(`?? ${path}\0`)));
  }
  assert.equal(parseWorktreeStatusPorcelainZ(Buffer.from('?? é\0'))[0]!.path, 'é');
});

test('real Git rename and modified/untracked inventory uses the same status owner', () => inGitProtocolRepository(async (root, git) => {
  writeFileSync(path.join(root, 'rename-old'), 'stable');
  writeFileSync(path.join(root, 'space file'), 'before');
  gitProtocolSuccess(git(['add', '--', 'rename-old', 'space file']));
  gitProtocolSuccess(git(['commit', '-qm', 'fixture']));
  gitProtocolSuccess(git(['mv', '--', 'rename-old', 'rename-new']));
  writeFileSync(path.join(root, 'space file'), 'after');
  writeFileSync(path.join(root, 'extra file'), 'untracked');
  const result = parseWorktreeStatusPorcelainZ(Buffer.from(gitProtocolSuccess(git([
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ]))), { allowDirectoryEntries: false });
  assert.deepEqual(result.map(row => [row.index + row.worktree, row.path, row.originalPath]).sort(), [
    [' M', 'space file', null], ['??', 'extra file', null], ['R ', 'rename-new', 'rename-old']
  ].sort());
}));

test('real Git may report staged deletion and the same untracked pathname together', () => inGitProtocolRepository(async (root, git) => {
  writeFileSync(path.join(root, 'kept'), 'still in the worktree');
  gitProtocolSuccess(git(['add', '--', 'kept']));
  gitProtocolSuccess(git(['commit', '-qm', 'fixture']));
  gitProtocolSuccess(git(['rm', '--cached', '--', 'kept']));
  const bytes = Buffer.from(gitProtocolSuccess(git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])));
  assert.deepEqual(parseWorktreeStatusPorcelainZ(bytes, { allowDirectoryEntries: false }), [
    { index: 'D', worktree: ' ', path: 'kept', originalPath: null },
    { index: '?', worktree: '?', path: 'kept', originalPath: null }
  ]);
}));
