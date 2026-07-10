import { expect, test } from 'bun:test';

import {
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedFileOutput
} from '../../platform/shared/ci-git-changed-files.ts';

test('Git changed-file commands disable quotePath for tracked and untracked paths', () => {
  expect(gitChangedFileDiffArgs('main')).toEqual([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    'main',
    'HEAD'
  ]);
  expect(gitChangedFileDiffArgs()).toEqual([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    'HEAD'
  ]);
  expect(gitUntrackedFileArgs()).toEqual([
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--exclude-standard'
  ]);
});

test('Git changed-file output preserves Unicode authority paths and normalizes separators', () => {
  expect(parseGitChangedFileOutput([
    'docs/03-MVP实施计划与路线图.md',
    'platform\\shared\\ci-contract.ts',
    'docs/03-MVP实施计划与路线图.md',
    ''
  ].join('\n'))).toEqual([
    'docs/03-MVP实施计划与路线图.md',
    'platform/shared/ci-contract.ts'
  ]);
});
