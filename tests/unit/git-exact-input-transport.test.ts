import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { canonicalCommitTreeInput, captureGitDevelopmentCommitContract, gitCommitEnvironment } from '../../src/adapters/providers/git-read/runtime/commit-contract.ts';
import { captureGitReadArguments } from '../../src/adapters/providers/git-read/runtime/read-command.ts';
import { captureGitScratchIndexDelta, formatGitScratchIndexRecord } from '../../src/adapters/providers/git-read/runtime/scratch-input.ts';
import { IsCanonicalRepositoryPath } from '../../src/contracts/repository-path.ts';

const person = () => ({ name: 'Maintainer', email: 'maintainer@example.test', date: '0 +0000' });
const commit = (width = 40) => ({ tree: 'a'.repeat(width), parents: ['b'.repeat(width)], message: 'Message',
  author: person(), committer: person(), repositoryRoot: path.resolve('repo'), worktreeRoot: path.resolve('repo'),
  ref: 'refs/heads/test', expectedOld: 'b'.repeat(width), target: 'c'.repeat(width), signing: 'disabled' as const,
  hooks: 'disabled' as const, preflightReceiptDigest: `sha256:${'d'.repeat(64)}` as const });

test('commit identities that Git would trim are rejected rather than silently renamed', () => {
  for (const edge of [' ', '\t', '\x01', ',', ':', ';', '"', "'", '\\']) {
    for (const field of ['name', 'email'] as const) for (const text of [edge + person()[field], person()[field] + edge]) {
      for (const role of ['author', 'committer'] as const) {
        assert.equal(canonicalCommitTreeInput({ ...commit(), [role]: { ...person(), [field]: text } }), null, JSON.stringify({ role, field, text }));
      }
    }
  }
});

test('interior punctuation, exact non-ASCII spacing and well-formed Unicode identities are preserved', () => {
  for (const name of ['A, B', 'A:B', "O'Name", 'A\\B', '.Name.', '名🙂', '\u00a0Name\u00a0', 'e\u0301']) {
    const result = canonicalCommitTreeInput({ ...commit(), author: { ...person(), name } });
    assert.equal(result?.author.name, name);
  }
});

test('one commit cannot combine different Git object formats', () => {
  for (const width of [40, 64]) {
    const input = commit(width), otherWidth = width === 40 ? 64 : 40;
    assert.ok(captureGitDevelopmentCommitContract(input));
    assert.equal(canonicalCommitTreeInput({ ...input, parents: ['b'.repeat(otherWidth)] }), null);
    assert.equal(captureGitDevelopmentCommitContract({ ...input, target: 'c'.repeat(otherWidth) }), null);
  }
});

test('lossy UTF-16 is refused in identity, commit message and physical roots', () => {
  for (const invalid of ['\ud800', '\udfff', 'a\ud800b']) {
    assert.equal(canonicalCommitTreeInput({ ...commit(), message: invalid }), null);
    for (const field of ['name', 'email'] as const) {
      assert.equal(canonicalCommitTreeInput({ ...commit(), author: { ...person(), [field]: `a${invalid}z` } }), null);
    }
    for (const field of ['repositoryRoot', 'worktreeRoot'] as const) {
      assert.equal(captureGitDevelopmentCommitContract({ ...commit(), [field]: `${path.resolve('repo')}${path.sep}${invalid}` }), null);
    }
  }
  const valid = '界🙂e\u0301 �';
  assert.equal(canonicalCommitTreeInput({ ...commit(), message: valid })?.message, valid);
});

test('Git environment dates use raw-second transport without mutating the contract or dropping scratch selectors', () => {
  const input = commit(), base = { GIT_INDEX_FILE: '/retained/index', GIT_OBJECT_DIRECTORY: '/retained/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/retained/shared', LANG: 'C' };
  const environment = gitCommitEnvironment(input, base);
  assert.equal(environment.GIT_AUTHOR_DATE, '@0 +0000'); assert.equal(environment.GIT_COMMITTER_DATE, '@0 +0000');
  assert.equal(input.author.date, '0 +0000'); assert.equal('GIT_AUTHOR_DATE' in base, false);
  for (const key of Object.keys(base)) assert.equal(environment[key], base[key as keyof typeof base]);
  assert.ok(Object.isFrozen(environment));
});

test('impossible argv counts are rejected before any element is inspected', () => {
  let reads = 0;
  const input = new Proxy(new Array(1_000_000_000), { getOwnPropertyDescriptor(target, key) {
    if (key !== 'length') { reads++; throw new Error('element inspected'); }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.equal(captureGitReadArguments(input, 1024).status, 'exhausted'); assert.equal(reads, 0);
  assert.equal(captureGitReadArguments(['', ''], 2).status, 'ready');
});

test('argv and repository selectors reject strings that cannot reach Git unchanged', () => {
  for (const text of ['\ud800', 'a\udc00', '\ud800\ud800']) {
    assert.equal(captureGitReadArguments(['ls-files', '--', text], 4096).status, 'invalid');
    assert.equal(IsCanonicalRepositoryPath(text), false);
    assert.throws(() => captureGitScratchIndexDelta({ additions: [], removals: [text] }, 'sha1', 1000));
  }
  for (const text of ['🙂', '界/文件', 'replacement-�']) {
    assert.equal(captureGitReadArguments(['ls-files', '--', text], 4096).status, 'ready');
    assert.equal(IsCanonicalRepositoryPath(text), true);
  }
});

test('exact index deletion records have a charged NUL envelope even with an empty blob batch', () => {
  for (const width of [40, 64]) {
    const zero = '0'.repeat(width), record = `0 ${zero}\told\0`;
    assert.equal(formatGitScratchIndexRecord('0', zero, 'old'), record);
    const format = width === 40 ? 'sha1' : 'sha256';
    const budget = Buffer.byteLength(record);
    assert.deepEqual(captureGitScratchIndexDelta({ additions: [], removals: ['old'] }, format, budget).removals, ['old']);
    assert.throws(() => captureGitScratchIndexDelta({ additions: [], removals: ['old'] }, format, budget - 1), RangeError);
  }
});


test('non-roundtrippable negative-zero timezone and native timestamp overflow are rejected exactly', () => {
  for (const date of ['0 -0000', '1 -0000', '18446744073709551615 +0000', '18446744073709551616 +0000', `${'9'.repeat(1000)} +0000`]) {
    assert.equal(canonicalCommitTreeInput({ ...commit(), author: { ...person(), date } }), null);
  }
  for (const date of ['0 +0000', '18446744073709551614 +0000', '9007199254740993 +0000']) {
    assert.equal(canonicalCommitTreeInput({ ...commit(), author: { ...person(), date } })?.author.date, date);
  }
});
