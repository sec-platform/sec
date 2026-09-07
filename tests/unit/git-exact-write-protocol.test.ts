import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'bun:test';
import { canonicalCommitTreeInput, gitCommitEnvironment } from '../../src/external-capabilities/git-read/runtime/commit-contract.ts';
import { captureGitScratchIndexDelta, formatGitScratchIndexRecord } from '../../src/external-capabilities/git-read/runtime/scratch-input.ts';
import { inGitProtocolRepository, gitProtocolSuccess } from '../testkit/git-protocol.ts';

// Real installed-Git tests, not a SEC physical provider. Expected object bytes
// and final index paths below are independent of the production serializers.
for (const format of ['sha1', 'sha256'] as const) {
  test(`real ${format} commit stores epoch and early dates exactly through the transport`, () => inGitProtocolRepository(async (_root, git, base) => {
    const tree = gitProtocolSuccess(git(['mktree'], undefined, '')).trim();
    const parent = gitProtocolSuccess(git(['commit-tree', tree], undefined, 'fixture\n')).trim();
    for (const date of ['0 +0000', '1 -0530', '20000101 +0800', '99999999 +1400', '1700000000 +0000', '9007199254740993 +0000', '18446744073709551614 +0000']) {
      const input = canonicalCommitTreeInput({ tree, parents: [parent], message: 'Exact message\n',
        author: { name: 'Maintainer', email: 'maintainer@example.test', date },
        committer: { name: 'Reviewer', email: 'reviewer@example.test', date } });
      assert.ok(input);
      const environment = gitCommitEnvironment(input, base as Record<string, string>);
      const object = gitProtocolSuccess(git(['commit-tree', input.tree, '-p', parent], environment, input.message)).trim();
      const expected = `tree ${tree}\nparent ${parent}\nauthor Maintainer <maintainer@example.test> ${date}\ncommitter Reviewer <reviewer@example.test> ${date}\n\nExact message\n`;
      assert.equal(gitProtocolSuccess(git(['cat-file', 'commit', object])), expected);
      const bytes = Buffer.from(expected);
      assert.equal(object, createHash(format).update(`commit ${bytes.length}\0`).update(bytes).digest('hex'));
    }
  }, format));

  test(`real ${format} index-info deletion removes a present tracked file without reading its contents`, () => inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'old'), 'tracked'); gitProtocolSuccess(git(['add', '--', 'old']));
    writeFileSync(path.join(root, 'old'), 'working content must remain');
    const delta = captureGitScratchIndexDelta({ additions: [], removals: ['old'] }, format, 1024);
    const record = formatGitScratchIndexRecord('0', '0'.repeat(format === 'sha1' ? 40 : 64), delta.removals[0]!);
    gitProtocolSuccess(git(['update-index', '-z', '--index-info'], undefined, record));
    assert.equal(gitProtocolSuccess(git(['ls-files', '-z'])), '');
    assert.equal(readFileSync(path.join(root, 'old'), 'utf8'), 'working content must remain');
  }, format));

  test(`real ${format} mixed delta handles both file-to-directory and directory-to-file replacements`, () => inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'a'), 'old file');
    mkdirSync(path.join(root, 'b')); writeFileSync(path.join(root, 'b/child'), 'old child');
    gitProtocolSuccess(git(['add', '--', 'a', 'b/child']));
    const delta = captureGitScratchIndexDelta({ additions: [
      { path: 'a/child', bytes: Buffer.from('new child') }, { path: 'b', bytes: Buffer.from('new file') }
    ], removals: ['a', 'b/child'] }, format, 4096);
    const zero = '0'.repeat(format === 'sha1' ? 40 : 64);
    const records = delta.removals.map(value => formatGitScratchIndexRecord('0', zero, value));
    for (const addition of delta.additions) {
      const oid = gitProtocolSuccess(git(['hash-object', '-w', '--stdin'], undefined, addition.bytes)).trim();
      records.push(formatGitScratchIndexRecord('100644', oid, addition.path));
    }
    gitProtocolSuccess(git(['update-index', '-z', '--index-info'], undefined, records.join('')));
    assert.equal(gitProtocolSuccess(git(['ls-files', '-z'])), 'a/child\0b\0');
    const tree = gitProtocolSuccess(git(['write-tree'])).trim();
    assert.equal(gitProtocolSuccess(git(['show', `${tree}:a/child`])), 'new child');
    assert.equal(gitProtocolSuccess(git(['show', `${tree}:b`])), 'new file');
    assert.equal(readFileSync(path.join(root, 'a'), 'utf8'), 'old file');
    assert.equal(readFileSync(path.join(root, 'b/child'), 'utf8'), 'old child');
  }, format));
}

test('real Git identity sanitation and admission agree without trimming legitimate Unicode', () => inGitProtocolRepository(async (_root, git, base) => {
  const tree = gitProtocolSuccess(git(['mktree'], undefined, '')).trim();
  const parent = gitProtocolSuccess(git(['commit-tree', tree], undefined, 'fixture\n')).trim();
  const fixed = { tree, parents: [parent], message: 'identity\n',
    author: { name: 'Maintainer', email: 'name@example.test', date: '1700000000 +0000' },
    committer: { name: 'Reviewer', email: 'reviewer@example.test', date: '1700000000 +0000' } };
  for (const name of [' name ', ',name', 'name;', 'name:', '\tname', '\\name', 'name"']) {
    const input = { ...fixed, author: { ...fixed.author, name } };
    assert.equal(canonicalCommitTreeInput(input), null);
    // Establish independently that native Git would change the supplied identity.
    const oid = gitProtocolSuccess(git(['commit-tree', tree, '-p', parent], { ...base, GIT_AUTHOR_NAME: name }, 'identity\n')).trim();
    assert.ok(!gitProtocolSuccess(git(['cat-file', 'commit', oid])).includes(`author ${name} <`));
  }
  for (const name of ['.Name.', 'Name, Other', '名🙂', '\u00a0Name\u00a0']) {
    const input = canonicalCommitTreeInput({ ...fixed, author: { ...fixed.author, name } }); assert.ok(input);
    const oid = gitProtocolSuccess(git(['commit-tree', tree, '-p', parent], gitCommitEnvironment(input, base as Record<string, string>), input.message)).trim();
    assert.ok(gitProtocolSuccess(git(['cat-file', 'commit', oid])).includes(`author ${name} <name@example.test> 1700000000 +0000\n`));
  }
}));
