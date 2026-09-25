import { expect, test } from 'bun:test';

import { AssertTestImpactTransitionSelection, CreateTestImpactTransitionObservation, TestImpactTransitionDigest, decodeGitPathOutput, gitChangedFileDiffArgs, gitIndexChangedFileDiffArgs, gitPathBlobArgs, gitUntrackedFileArgs, gitWorkingTreeStatusArgs, gitWorktreeChangedFileDiffArgs, parseGitChangedFileOutput, parseGitPathBlobOutput, parseGitUntrackedFileOutput } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('Git changed-file commands disable quotePath for tracked and untracked paths', () => {
  expect(gitChangedFileDiffArgs('main')).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    'main',
    'HEAD'
  ]);
  expect(gitChangedFileDiffArgs()).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    'HEAD'
  ]);
  expect(gitIndexChangedFileDiffArgs('main')).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'diff-index',
    '--cached',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    'main'
  ]);
  expect(gitWorktreeChangedFileDiffArgs()).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'diff-files',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB'
  ]);
  expect(gitUntrackedFileArgs()).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z'
  ]);
  expect(gitWorkingTreeStatusArgs()).toEqual([
    '--no-pager',
    '-c',
    'core.quotepath=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);
});

test('Git deletion transition binds exact base blob and target absence', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const blobSha = 'c'.repeat(40);
  const repositoryPath = 'docs/evidence/retired.json';
  expect(gitPathBlobArgs(baseSha, repositoryPath)).toEqual([
    '--no-pager',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    'ls-tree', '-z', '--full-tree', baseSha, '--', repositoryPath
  ]);
  expect(parseGitPathBlobOutput(
    utf8(`100644 blob ${blobSha}\t${repositoryPath}\0`),
    repositoryPath
  )).toEqual({ mode: '100644', blobSha });
  expect(parseGitPathBlobOutput(new Uint8Array(), repositoryPath)).toBeNull();
  const transition = CreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [{ status: 'removed', path: repositoryPath }],
    readPathBlob: (revision) => revision === baseSha ? { mode: '100644', blobSha } : null
  });
  expect(transition.removedPathBlobs).toEqual([{
    path: repositoryPath,
    baseMode: '100644',
    baseBlobSha: blobSha,
    headMode: null,
    headBlobSha: null
  }]);
  expect(() => CreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [{ status: 'removed', path: repositoryPath }],
    readPathBlob: () => ({ mode: '100644', blobSha })
  })).toThrow('exact head absence');
});

test('transition selection binds canonical records, derived files, and exact base/head identity', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const repositoryPath = 'docs/evidence/retired.json';
  const records = [
    { status: 'changed' as const, path: 'src/adapters/verification/platform/ci/verification.ts' },
    { status: 'removed' as const, path: repositoryPath }
  ];
  const transition = CreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [...records].reverse(),
    readPathBlob: (revision) => revision === baseSha
      ? { mode: '100644', blobSha: 'c'.repeat(40) }
      : null
  });
  const digest = TestImpactTransitionDigest(transition);
  expect(AssertTestImpactTransitionSelection({
    baseSha,
    headSha,
    changedPaths: [repositoryPath, 'src/adapters/verification/platform/ci/verification.ts'],
    records,
    observation: transition
  })).toBe(digest);
  for (const input of [
    { baseSha: 'd'.repeat(40), headSha, changedPaths: [repositoryPath, 'src/adapters/verification/platform/ci/verification.ts'] },
    { baseSha, headSha: 'e'.repeat(40), changedPaths: [repositoryPath, 'src/adapters/verification/platform/ci/verification.ts'] },
    { baseSha, headSha, changedPaths: [repositoryPath] }
  ]) {
    expect(() => AssertTestImpactTransitionSelection({
      ...input,
      records,
      observation: transition
    })).toThrow('exact candidate selection input');
  }
  expect(() => AssertTestImpactTransitionSelection({
    baseSha,
    headSha,
    changedPaths: [repositoryPath, 'src/adapters/verification/platform/ci/verification.ts'],
    records: [{ status: 'added', path: repositoryPath }, records[0]!],
    observation: transition
  })).toThrow('exact candidate selection input');
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

test('Git tracked status parsing accepts selected conflict statuses and fails closed on unknown records', () => {
  expect(() => parseGitChangedFileOutput(utf8('M\0missing-terminator'))).toThrow('missing final NUL');
  for (const status of ['U', 'X', 'B']) {
    expect(parseGitChangedFileOutput(utf8(`${status}\0path.ts\0`))).toEqual(['path.ts']);
  }
  for (const status of ['Z', 'Q']) {
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
