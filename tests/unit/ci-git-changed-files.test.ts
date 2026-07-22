import { expect, test } from 'bun:test';

import {
  decodeGitPathOutput,
  gitChangedFileDiffArgs,
  gitUntrackedFileArgs,
  parseGitChangedFileOutput,
  parseGitUntrackedFileOutput
} from '../../platform/shared/ci-git-changed-files.ts';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

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
  expect(parseGitChangedFileOutput(utf8([
    'D', 'docs/deleted.md',
    'T', 'platform/shared/type-changed.ts',
    'R100', 'docs/old-name.md', 'docs/new-name.md',
    'C75', 'tests/source.test.ts', 'tests/copied.test.ts',
    ''
  ].join('\0')))).toEqual([
    'docs/deleted.md',
    'docs/new-name.md',
    'docs/old-name.md',
    'platform/shared/type-changed.ts',
    'tests/copied.test.ts',
    'tests/source.test.ts'
  ]);
});

test('Git changed-file output preserves decoded raw path identity without separator normalization', () => {
  expect(parseGitUntrackedFileOutput(utf8([
    'docs/03-MVP实施计划与路线图.md',
    'platform\\shared\\ci-contract.ts',
    'docs/03-MVP实施计划与路线图.md',
    ''
  ].join('\0')))).toEqual([
    'docs/03-MVP实施计划与路线图.md',
    'platform\\shared\\ci-contract.ts'
  ]);
  expect(parseGitChangedFileOutput(utf8([
    'M', 'docs\\work\\current-state.yaml',
    'R100', 'docs\\old.md', 'docs\\new.md',
    ''
  ].join('\0')))).toEqual([
    'docs\\new.md',
    'docs\\old.md',
    'docs\\work\\current-state.yaml'
  ]);
});

test('Git untracked parsing preserves newline path bytes instead of splitting ownership records', () => {
  expect(parseGitUntrackedFileOutput(utf8('docs/hostile\nname.md\0'))).toEqual(['docs/hostile\nname.md']);
  expect(() => parseGitUntrackedFileOutput(utf8('docs/missing-nul.md'))).toThrow('missing final NUL');
});

test('Git tracked status parsing fails closed on malformed or unknown records', () => {
  expect(() => parseGitChangedFileOutput(utf8('M\0missing-terminator'))).toThrow('missing final NUL');
  for (const status of ['U', 'X', 'B']) {
    expect(() => parseGitChangedFileOutput(utf8(`${status}\0path.ts\0`))).toThrow('unknown status');
  }
  expect(() => parseGitChangedFileOutput(utf8('R100\0old.ts\0'))).toThrow('missing its second path');
});

test('Git path decoding fails closed on invalid UTF-8 for every path record shape', () => {
  expect(() => parseGitChangedFileOutput(new Uint8Array([
    ...utf8('M\0docs/'),
    0xff,
    0
  ]))).toThrow('Malformed Git changed-path output: invalid UTF-8.');

  for (const status of ['R100', 'C100']) {
    expect(() => parseGitChangedFileOutput(new Uint8Array([
      ...utf8(`${status}\0docs/`),
      0xff,
      ...utf8('\0docs/new.md\0')
    ]))).toThrow('Malformed Git changed-path output: invalid UTF-8.');
    expect(() => parseGitChangedFileOutput(new Uint8Array([
      ...utf8(`${status}\0docs/old.md\0docs/`),
      0xff,
      0
    ]))).toThrow('Malformed Git changed-path output: invalid UTF-8.');
  }

  expect(() => parseGitUntrackedFileOutput(new Uint8Array([
    ...utf8('docs/'),
    0xff,
    0
  ]))).toThrow('Malformed Git untracked-path output: invalid UTF-8.');
});

test('Git path decoding preserves literal replacement and BOM code points', () => {
  expect(parseGitUntrackedFileOutput(utf8('docs/literal-�.md\0'))).toEqual([
    'docs/literal-�.md'
  ]);
  expect(parseGitUntrackedFileOutput(new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...utf8('docs/bom-prefixed.md\0')
  ]))).toEqual(['\uFEFFdocs/bom-prefixed.md']);
});

test('strict Git tree-path decoding preserves legal multibyte names and rejects invalid bytes', () => {
  const treeRecord = `100644 blob ${'a'.repeat(40)}\tdocs/多字节.md\0`;
  expect(decodeGitPathOutput(utf8(treeRecord), 'tree-path')).toBe(treeRecord);
  expect(() => decodeGitPathOutput(new Uint8Array([
    ...utf8(`100644 blob ${'a'.repeat(40)}\tdocs/`),
    0xff,
    0
  ]), 'tree-path')).toThrow('Malformed Git tree-path output: invalid UTF-8.');
});
