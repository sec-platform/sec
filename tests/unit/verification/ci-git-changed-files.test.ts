import { expect, test } from 'bun:test';
import { CodexDevelopmentChangedFilesFromRecords } from '../../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';

import { CodexDevelopmentAssertTestImpactTransitionSelection, CodexDevelopmentCreateTestImpactTransitionObservation, CodexDevelopmentTestImpactTransitionDigest, gitChangedFileDiffArgs, gitIndexChangedFileDiffArgs, gitPathBlobBatchArgs, gitUntrackedFileArgs, gitWorkingTreeStatusArgs, gitWorktreeChangedFileDiffArgs, parseGitChangedFileOutput, parseGitChangedRecordsOutput, parseGitPathBlobBatchOutput, parseGitUntrackedFileOutput } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('Git changed-file commands disable quotePath for tracked and untracked paths', () => {
  const readOnlyPathArguments = [
    '--no-pager', '-c', 'core.quotepath=false',
    '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'
  ];
  expect(gitChangedFileDiffArgs('main')).toEqual([
    ...readOnlyPathArguments,
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
    ...readOnlyPathArguments,
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
    ...readOnlyPathArguments,
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
    ...readOnlyPathArguments,
    'diff-files',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB'
  ]);
  expect(gitUntrackedFileArgs()).toEqual([
    ...readOnlyPathArguments,
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z'
  ]);
  expect(gitWorkingTreeStatusArgs()).toEqual([
    ...readOnlyPathArguments,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all'
  ]);
});

test('transition selection binds exact removed blobs, canonical records, and base/head identity', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const blobSha = 'c'.repeat(40);
  const repositoryPath = 'docs/evidence/多字节.json';
  expect(gitPathBlobBatchArgs(baseSha, [repositoryPath])).toEqual([
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'ls-tree', '-z', '--full-tree', baseSha, '--', repositoryPath
  ]);
  const baseBlobs = parseGitPathBlobBatchOutput(
    utf8(`100644 blob ${blobSha}\t${repositoryPath}\0`), [repositoryPath]
  );
  expect(baseBlobs).toEqual(new Map([[repositoryPath, { mode: '100644', blobSha }]]));
  expect(parseGitPathBlobBatchOutput(new Uint8Array(), [repositoryPath])).toEqual(new Map());
  expect(() => parseGitPathBlobBatchOutput(new Uint8Array([
    ...utf8(`100644 blob ${blobSha}\tdocs/`), 0xff, 0
  ]), [repositoryPath])).toThrow('Malformed Git path-blob-batch output: invalid UTF-8.');

  const records = [
    { status: 'changed' as const, path: 'src/adapters/verification/platform/ci/verification.ts' },
    { status: 'removed' as const, path: repositoryPath }
  ];
  const transition = CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [...records].reverse(),
    readPathBlob: (revision, file) => revision === baseSha ? baseBlobs.get(file) ?? null : null
  });
  expect(transition.removedPathBlobs).toEqual([{
    path: repositoryPath,
    baseMode: '100644',
    baseBlobSha: blobSha,
    headMode: null,
    headBlobSha: null
  }]);
  expect(() => CodexDevelopmentCreateTestImpactTransitionObservation({
    baseSha,
    headSha,
    records: [{ status: 'removed', path: repositoryPath }],
    readPathBlob: () => ({ mode: '100644', blobSha })
  })).toThrow('exact head absence');

  const digest = CodexDevelopmentTestImpactTransitionDigest(transition);
  expect(CodexDevelopmentAssertTestImpactTransitionSelection({
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
    expect(() => CodexDevelopmentAssertTestImpactTransitionSelection({
      ...input,
      records,
      observation: transition
    })).toThrow('exact candidate selection input');
  }
  expect(() => CodexDevelopmentAssertTestImpactTransitionSelection({
    baseSha,
    headSha,
    changedPaths: [repositoryPath, 'src/adapters/verification/platform/ci/verification.ts'],
    records: [{ status: 'added', path: repositoryPath }, records[0]!],
    observation: transition
  })).toThrow('exact candidate selection input');
});

test('tracked Git records preserve both endpoints and raw identity while rejecting malformed transport', () => {
  const transport = utf8([
    'D', 'docs/deleted.md',
    'T', 'platform/shared/type-changed.ts',
    'R100', 'docs/old-name.md', 'docs/new-name.md',
    'M', 'docs/new-name.md',
    'A', 'tests/copied.test.ts',
    'C75', 'tests/source.test.ts', 'tests/copied.test.ts',
    'M', 'docs\\work\\current-state.yaml',
    'R100', 'docs\\old.md', 'docs\\new.md',
    'U', 'path-u.ts', 'X', 'path-x.ts', 'B', 'path-b.ts',
    ''
  ].join('\0'));
  const expectedPaths = [
    'docs/deleted.md',
    'docs/new-name.md',
    'docs/old-name.md',
    'docs\\new.md',
    'docs\\old.md',
    'docs\\work\\current-state.yaml',
    'path-b.ts',
    'path-u.ts',
    'path-x.ts',
    'platform/shared/type-changed.ts',
    'tests/copied.test.ts',
    'tests/source.test.ts'
  ];
  expect(parseGitChangedFileOutput(transport)).toEqual(expectedPaths);
  expect(CodexDevelopmentChangedFilesFromRecords(parseGitChangedRecordsOutput(transport))).toEqual(expectedPaths);
  expect(() => parseGitChangedFileOutput(utf8('M\0missing-terminator'))).toThrow('missing final NUL');
  expect(() => parseGitChangedFileOutput(utf8('Z\0path.ts\0'))).toThrow('unknown status');
  expect(() => parseGitChangedFileOutput(utf8('R100\0old.ts\0'))).toThrow('missing its second path');
  expect(() => parseGitChangedFileOutput(new Uint8Array([
    ...utf8('R100\0docs/old.md\0docs/'), 0xff, 0
  ]))).toThrow('Malformed Git changed-path output: invalid UTF-8.');
});

test('untracked Git records preserve Unicode, separators and newline bytes without laundering malformed transport', () => {
  expect(parseGitUntrackedFileOutput(new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...utf8([
      'docs/bom-prefixed.md',
      'docs/03-MVP实施计划与路线图.md',
      'platform\\shared\\ci-contract.ts',
      'docs/03-MVP实施计划与路线图.md',
      'docs/hostile\nname.md',
      'docs/literal-�.md',
      ''
    ].join('\0'))
  ]))).toEqual([
    'docs/03-MVP实施计划与路线图.md',
    'docs/hostile\nname.md',
    'docs/literal-�.md',
    'platform\\shared\\ci-contract.ts',
    '\uFEFFdocs/bom-prefixed.md'
  ]);
  expect(() => parseGitUntrackedFileOutput(utf8('docs/missing-nul.md'))).toThrow('missing final NUL');
  expect(() => parseGitUntrackedFileOutput(new Uint8Array([
    ...utf8('docs/'), 0xff, 0
  ]))).toThrow('Malformed Git untracked-path output: invalid UTF-8.');
});
