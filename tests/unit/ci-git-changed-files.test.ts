import { expect, test } from 'bun:test';

import {
  gitChangedFileDiffArgs,
  parseGitChangedFileOutput
} from '../../platform/shared/ci-git-changed-files.ts';

test('Git changed-file diff disables quotePath and binds base to HEAD', () => {
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
