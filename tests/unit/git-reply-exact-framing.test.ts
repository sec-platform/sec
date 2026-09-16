import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseGitAbsolutePathReply, parseGitLineReply, parseGitObjectIdReply } from '../../src/runtime-state/physical/contract/git-worktree-observation.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

test('Git path reply preserves spaces, tabs and CR data instead of applying trim', () => {
  for (const suffix of [' trailing ', 'tail\t', 'tail\r', '名🙂']) {
    const expected = path.resolve('git-reply', suffix);
    assert.equal(parseGitAbsolutePathReply(Buffer.from(`${expected}\n`)), expected);
  }
});

test('an absolute path reply cannot be substituted by a relative path or a second record', () => {
  for (const input of ['relative\n', '../other\n', '/one\n/two\n', '/one\n\n', '/one', '\n', '/one\0\n']) {
    assert.equal(parseGitAbsolutePathReply(Buffer.from(input)), null, JSON.stringify(input));
  }
});

test('object-id reply uses one exact LF record and the selected object format', () => {
  for (const [format, length] of [['sha1', 40], ['sha256', 64]] as const) {
    const id = 'a'.repeat(length);
    assert.equal(parseGitObjectIdReply(Buffer.from(`${id}\n`), format), id);
    assert.equal(parseGitObjectIdReply(Buffer.from(`${id}\n`)), id);
    assert.equal(parseGitObjectIdReply(Buffer.from(`${id}\n`), format === 'sha1' ? 'sha256' : 'sha1'), null);
    for (const text of [id, ` ${id}\n`, `${id} \n`, `${id}\r\n`, `\ufeff${id}\n`, `${id}\n\n`, `${id}\n${id}\n`, `${id}\0\n`]) {
      assert.equal(parseGitObjectIdReply(Buffer.from(text), format), null, JSON.stringify(text));
    }
  }
});

test('line decoding rejects invalid UTF-8, shared bytes and incomplete or surplus records', () => {
  assert.equal(parseGitLineReply(Uint8Array.of(0xff, 10)), null);
  assert.equal(parseGitLineReply(new Uint8Array(new SharedArrayBuffer(10))), null);
  assert.equal(parseGitLineReply(Buffer.from('one\ntwo\n'), 1), null);
  assert.equal(parseGitLineReply(Buffer.from('one\n'), 2), null);
  assert.deepEqual(parseGitLineReply(Buffer.from(' first \nsecond\t\n'), 2), [' first ', 'second\t']);
  for (const value of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => parseGitLineReply(Buffer.from('x\n'), value), TypeError);
});

test('a BOM stays data, rather than being dropped to manufacture an object or absolute path', () => {
  const absolute = path.resolve('path');
  assert.deepEqual(parseGitLineReply(Buffer.from('\ufeffrecord\n')), ['\ufeffrecord']);
  assert.equal(parseGitAbsolutePathReply(Buffer.from(`\ufeff${absolute}\n`)), null);
  assert.equal(parseGitObjectIdReply(Buffer.from(`\ufeff${'a'.repeat(40)}\n`)), null);
});

test('byte decoding uses the actual typed-array view, not caller getters or iterators', () => {
  const bytes = Buffer.from(`${'a'.repeat(40)}\n`);
  Object.defineProperties(bytes, {
    byteLength: { get() { assert.fail('byteLength override'); } },
    [Symbol.iterator]: { value() { assert.fail('custom iterator'); } }
  });
  assert.equal(parseGitObjectIdReply(bytes, 'sha1'), 'a'.repeat(40));
});

test('real Git absolute index replies preserve a whitespace-bearing explicit locator', () => inGitProtocolRepository(async (root, git, env) => {
  const expected = path.join(root, 'index with trailing space ');
  const output = gitProtocolSuccess(git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
    ...env, GIT_INDEX_FILE: expected
  }));
  assert.equal(parseGitAbsolutePathReply(Buffer.from(output)), expected);
}));

for (const format of ['sha1', 'sha256'] as const) {
  test(`real ${format} object and four-field repository discovery match exact framing`, () => inGitProtocolRepository(async (root, git) => {
    const rawTree = gitProtocolSuccess(git(['mktree'], undefined, ''));
    const tree = parseGitObjectIdReply(Buffer.from(rawTree), format);
    assert.equal(tree?.length, format === 'sha1' ? 40 : 64);
    assert.equal(gitProtocolSuccess(git(['cat-file', '-t', tree!])), 'tree\n');
    const discovery = gitProtocolSuccess(git(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-path', 'objects', '--git-path', 'index', '--show-object-format']));
    const lines = parseGitLineReply(Buffer.from(discovery), 4)!;
    assert.equal(path.resolve(lines[0]!), root);
    assert.equal(path.resolve(lines[1]!), path.join(root, '.git', 'objects'));
    assert.equal(path.resolve(lines[2]!), path.join(root, '.git', 'index'));
    assert.equal(lines[3], format);
  }, format));
}
