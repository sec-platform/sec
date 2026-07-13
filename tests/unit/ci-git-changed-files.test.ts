import { expect, test } from 'bun:test';

import {
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedFileOutput,
  parseGitUntrackedFileOutput
} from '../../platform/shared/ci-git-changed-files.ts';

test('Git changed-file commands disable quotePath for tracked and untracked paths', () => {
  expect(gitChangedFileDiffArgs('main')).toEqual([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    'main',
    'HEAD'
  ]);
  expect(gitChangedFileDiffArgs()).toEqual([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    'HEAD'
  ]);
  expect(gitUntrackedFileArgs()).toEqual([
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z'
  ]);
});

test('Git status output includes deletes, type changes, and both rename endpoints', () => {
  expect(parseGitChangedFileOutput([
    'D', 'docs/deleted.md',
    'T', 'platform/shared/type-changed.ts',
    'R100', 'docs/old-name.md', 'docs/new-name.md',
    'C75', 'tests/source.test.ts', 'tests/copied.test.ts',
    ''
  ].join('\0'))).toEqual([
    'docs/deleted.md',
    'docs/new-name.md',
    'docs/old-name.md',
    'platform/shared/type-changed.ts',
    'tests/copied.test.ts',
    'tests/source.test.ts'
  ]);
});

test('Git changed-file output preserves Unicode authority paths and normalizes separators', () => {
  expect(parseGitUntrackedFileOutput([
    'docs/03-MVP实施计划与路线图.md',
    'platform\\shared\\ci-contract.ts',
    'docs/03-MVP实施计划与路线图.md',
    ''
  ].join('\0'))).toEqual([
    'docs/03-MVP实施计划与路线图.md',
    'platform/shared/ci-contract.ts'
  ]);
});

test('Git untracked parsing preserves newline path bytes instead of splitting ownership records', () => {
  expect(parseGitUntrackedFileOutput('docs/hostile\nname.md\0')).toEqual(['docs/hostile\nname.md']);
  expect(() => parseGitUntrackedFileOutput('docs/missing-nul.md')).toThrow('missing final NUL');
});

test('Git tracked status parsing fails closed on malformed or unknown records', () => {
  expect(() => parseGitChangedFileOutput('M\0missing-terminator')).toThrow('missing final NUL');
  for (const status of ['U', 'X', 'B']) {
    expect(() => parseGitChangedFileOutput(`${status}\0path.ts\0`)).toThrow('unknown status');
  }
  expect(() => parseGitChangedFileOutput('R100\0old.ts\0')).toThrow('missing its second path');
});
