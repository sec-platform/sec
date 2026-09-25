import { sha256, uniqueSorted } from '../../../../../contracts/canonical.ts';
import { IsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';

export type GitChangedRecord = {
  status: 'added' | 'changed' | 'removed' | 'renamed' | 'copied';
  path: string;
  previousPath?: string;
};

type GitPathBlobObservation = Readonly<{
  path: string;
  baseMode: '100644' | '100755';
  baseBlobSha: string;
  headMode: null;
  headBlobSha: null;
}>;

export type GitPathBlobEntry = Readonly<{
  mode: '100644' | '100755';
  blobSha: string;
}>;

export type TestImpactTransitionObservation = Readonly<{
  schema: 'sec-test-impact-transition-observation-v1';
  baseSha: string;
  headSha: string;
  records: readonly GitChangedRecord[];
  removedPathBlobs: readonly GitPathBlobObservation[];
}>;

const GIT_OBJECT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function canonicalChangedRecords(
  records: readonly GitChangedRecord[]
): readonly GitChangedRecord[] {
  if (!Array.isArray(records)) {
    throw new Error('Test-impact transition changed records must be one array.');
  }
  const canonical = records.map((record): GitChangedRecord => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Test-impact transition contains a malformed changed record.');
    }
    const hasPreviousPath = Object.prototype.hasOwnProperty.call(record, 'previousPath');
    const expectedKeys = hasPreviousPath
      ? ['path', 'previousPath', 'status']
      : ['path', 'status'];
    const actualKeys = Object.keys(record).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      throw new Error('Test-impact transition changed-record shape is not exact.');
    }
    if (!['added', 'changed', 'removed', 'renamed', 'copied'].includes(record.status)) {
      throw new Error('Test-impact transition contains a malformed changed record.');
    }
    if (!IsCanonicalRepositoryPath(record.path)) {
      throw new Error(
        'Test-impact transition changed-record path is not canonical repository-relative POSIX.'
      );
    }
    const paired = record.status === 'renamed' || record.status === 'copied';
    if (paired !== hasPreviousPath) {
      throw new Error('Test-impact transition changed-record pairing is invalid.');
    }
    if (paired) {
      const previousPath = record.previousPath;
      if (!IsCanonicalRepositoryPath(previousPath)
          || previousPath === record.path) {
        throw new Error('Test-impact transition changed-record pairing is invalid.');
      }
      return Object.freeze({ status: record.status, path: record.path, previousPath });
    }
    return Object.freeze({ status: record.status, path: record.path });
  }).sort((left, right) => {
    const leftKey = `${left.previousPath ?? ''}\0${left.path}\0${left.status}`;
    const rightKey = `${right.previousPath ?? ''}\0${right.path}\0${right.status}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const identities = canonical.map((record) => `${record.previousPath ?? ''}\0${record.path}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error('Test-impact transition contains duplicate changed-record identities.');
  }
  return Object.freeze(canonical);
}

export function TestImpactTransitionDigest(
  observation: TestImpactTransitionObservation
): `sha256:${string}` {
  if (observation === null || typeof observation !== 'object' || Array.isArray(observation)
      || JSON.stringify(Object.keys(observation).sort()) !== JSON.stringify([
        'baseSha', 'headSha', 'records', 'removedPathBlobs', 'schema'
      ])
      || observation.schema !== 'sec-test-impact-transition-observation-v1'
      || !GIT_OBJECT_SHA.test(observation.baseSha)
      || !GIT_OBJECT_SHA.test(observation.headSha)) {
    throw new Error('Test-impact transition observation identity is invalid.');
  }
  const records = canonicalChangedRecords(observation.records);
  if (records.length > 0 && observation.baseSha === observation.headSha) {
    throw new Error('Test-impact transition cannot bind changed records to one identical revision.');
  }
  if (JSON.stringify(records) !== JSON.stringify(observation.records)) {
    throw new Error('Test-impact transition changed records are not canonical.');
  }
  const removedPaths = records.filter((record) => record.status === 'removed')
    .map((record) => record.path);
  if (!Array.isArray(observation.removedPathBlobs)
      || observation.removedPathBlobs.length !== removedPaths.length) {
    throw new Error('Test-impact transition removed-blob census is incomplete.');
  }
  const observedPaths = observation.removedPathBlobs.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
        || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([
          'baseBlobSha', 'baseMode', 'headBlobSha', 'headMode', 'path'
        ])
        || !IsCanonicalRepositoryPath(entry.path)
        || (entry.baseMode !== '100644' && entry.baseMode !== '100755')
        || !GIT_OBJECT_SHA.test(entry.baseBlobSha)
        || entry.headMode !== null || entry.headBlobSha !== null) {
      throw new Error('Test-impact transition removed-blob identity is invalid.');
    }
    return entry.path;
  });
  if (JSON.stringify(observedPaths) !== JSON.stringify(uniqueSorted(removedPaths))) {
    throw new Error('Test-impact transition removed-blob census is not canonical.');
  }
  return sha256(observation) as `sha256:${string}`;
}

export function AssertTestImpactTransitionSelection(input: {
  baseSha: string;
  headSha: string;
  changedPaths: readonly string[];
  records?: readonly GitChangedRecord[];
  observation: TestImpactTransitionObservation;
}): `sha256:${string}` {
  const digest = TestImpactTransitionDigest(input.observation);
  const changedPaths = uniqueSorted(input.changedPaths);
  const transitionPaths = uniqueSorted(input.observation.records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
  if (input.observation.baseSha !== input.baseSha
      || input.observation.headSha !== input.headSha
      || JSON.stringify(changedPaths) !== JSON.stringify(input.changedPaths)
      || JSON.stringify(transitionPaths) !== JSON.stringify(changedPaths)
      || (input.records !== undefined
        && JSON.stringify(input.observation.records) !== JSON.stringify(canonicalChangedRecords(input.records)))) {
    throw new Error('Test-impact transition differs from the exact candidate selection input.');
  }
  return digest;
}

export function gitPathBlobArgs(revision: string, repositoryPath: string): string[] {
  if (!GIT_OBJECT_SHA.test(revision)) throw new Error('Git path blob revision must be one exact object SHA.');
  if (!IsCanonicalRepositoryPath(repositoryPath)) {
    throw new Error('Git path blob path must be canonical repository-relative POSIX.');
  }
  return [
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'ls-tree', '-z', '--full-tree', revision, '--', repositoryPath
  ];
}

/** One bounded ls-tree process for a whole removed-path batch. */
export function gitPathBlobBatchArgs(
  revision: string,
  repositoryPaths: readonly string[]
): string[] {
  if (!GIT_OBJECT_SHA.test(revision)) throw new Error('Git path blob revision must be one exact object SHA.');
  const paths = uniqueSorted([...repositoryPaths]);
  if (paths.length === 0 || paths.some((repositoryPath) => (
    !IsCanonicalRepositoryPath(repositoryPath)
  ))) {
    throw new Error('Git path blob batch paths must be non-empty canonical repository-relative POSIX paths.');
  }
  return [
    '--no-pager',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    'ls-tree', '-z', '--full-tree', revision, '--', ...paths
  ];
}

export function parseGitPathBlobOutput(
  stdout: Uint8Array,
  repositoryPath: string
): GitPathBlobEntry | null {
  const output = decodeGitPathOutput(stdout, 'path-blob');
  if (output.length === 0) return null;
  if (!output.endsWith('\0')) throw new Error('Malformed Git path-blob output: missing final NUL terminator.');
  const records = output.slice(0, -1).split('\0');
  if (records.length !== 1) throw new Error('Malformed Git path-blob output: path is not one exact entry.');
  const match = /^([0-7]{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(records[0]!);
  if (!match || (match[1] !== '100644' && match[1] !== '100755')
      || match[3] !== repositoryPath) {
    throw new Error('Malformed Git path-blob output: entry is not the requested ordinary blob.');
  }
  return Object.freeze({ mode: match[1] as '100644' | '100755', blobSha: match[2]! });
}

export function parseGitPathBlobBatchOutput(
  stdout: Uint8Array,
  repositoryPaths: readonly string[]
): Map<string, GitPathBlobEntry> {
  const output = decodeGitPathOutput(stdout, 'path-blob-batch');
  if (output.length === 0) return new Map();
  if (!output.endsWith('\0')) throw new Error('Malformed Git path-blob batch output: missing final NUL terminator.');
  const expected = new Set(repositoryPaths);
  const result = new Map<string, GitPathBlobEntry>();
  for (const record of output.slice(0, -1).split('\0')) {
    const match = /^([0-7]{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
    if (!match || (match[1] !== '100644' && match[1] !== '100755') || !expected.has(match[3]!)) {
      throw new Error('Malformed Git path-blob batch output: entry is not one requested ordinary blob.');
    }
    if (result.has(match[3]!)) throw new Error('Malformed Git path-blob batch output: duplicate path entry.');
    result.set(match[3]!, Object.freeze({
      mode: match[1] as '100644' | '100755',
      blobSha: match[2]!
    }));
  }
  return result;
}

export function CreateTestImpactTransitionObservation(input: {
  baseSha: string;
  headSha: string;
  records: readonly GitChangedRecord[];
  readPathBlob: (revision: string, repositoryPath: string) => GitPathBlobEntry | null;
}): TestImpactTransitionObservation {
  if (!GIT_OBJECT_SHA.test(input.baseSha) || !GIT_OBJECT_SHA.test(input.headSha)
      || (input.baseSha === input.headSha && input.records.length > 0)) {
    throw new Error('Test-impact transition requires exact base/head SHAs consistent with its records.');
  }
  const records = canonicalChangedRecords(input.records);
  const removedPaths = records
    .filter((record) => record.status === 'removed')
    .map((record) => record.path);
  if (new Set(removedPaths).size !== removedPaths.length) {
    throw new Error('Test-impact transition contains duplicate removed paths.');
  }
  const removedPathBlobs = uniqueSorted(removedPaths).map((repositoryPath) => {
    if (!IsCanonicalRepositoryPath(repositoryPath)) {
      throw new Error('Test-impact transition removed path is not canonical.');
    }
    const baseBlob = input.readPathBlob(input.baseSha, repositoryPath);
    const headBlob = input.readPathBlob(input.headSha, repositoryPath);
    if (baseBlob === null || !GIT_OBJECT_SHA.test(baseBlob.blobSha) || headBlob !== null) {
      throw new Error('Test-impact removed path does not bind one base blob and exact head absence.');
    }
    return Object.freeze({
      path: repositoryPath,
      baseMode: baseBlob.mode,
      baseBlobSha: baseBlob.blobSha,
      headMode: null,
      headBlobSha: null
    });
  });
  const observation = Object.freeze({
    schema: 'sec-test-impact-transition-observation-v1',
    baseSha: input.baseSha,
    headSha: input.headSha,
    records,
    removedPathBlobs: Object.freeze(removedPathBlobs)
  });
  TestImpactTransitionDigest(observation);
  return observation;
}

export function decodeGitPathOutput(stdout: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch {
    throw new Error(`Malformed Git ${label} output: invalid UTF-8.`);
  }
}

export function gitChangedFileDiffArgs(
  baseRef?: string,
  currentRef = 'HEAD'
): string[] {
  return [
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
    ...(baseRef ? [baseRef, currentRef] : [currentRef])
  ];
}

/** Read-only staged/index delta. Unlike `git diff HEAD`, this never refreshes the index. */
export function gitIndexChangedFileDiffArgs(baseRef = 'HEAD'): string[] {
  return [
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
    baseRef
  ];
}

/** Read-only working-tree/index delta. This plumbing command does not refresh the index. */
export function gitWorktreeChangedFileDiffArgs(): string[] {
  return [
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
  ];
}

export function gitWorkingTreeStatusArgs(): string[] {
  return [
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
  ];
}

export function gitUntrackedFileArgs(): string[] {
  return [
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
  ];
}

export function parseGitChangedFileOutput(stdout: Uint8Array): string[] {
  return uniqueSorted(parseGitChangedRecordsOutput(stdout).flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function parseGitChangedRecordsOutput(stdout: Uint8Array): GitChangedRecord[] {
  // Git path records are identities; domain validators, not this reader, decide canonical syntax.
  const output = decodeGitPathOutput(stdout, 'changed-path');
  if (output.length === 0) return [];
  const records = output.split('\0');
  if (records.pop() !== '') {
    throw new Error('Malformed Git changed-path output: missing final NUL terminator.');
  }

  const changedRecords: GitChangedRecord[] = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    const singlePath = /^[ADMTUXB]$/u.test(status ?? '');
    const pairedPaths = /^[CR]\d{1,3}$/u.test(status ?? '');
    if (!singlePath && !pairedPaths) {
      throw new Error(`Malformed Git changed-path output: unknown status "${status ?? ''}".`);
    }
    const firstPath = records[index++];
    if (!firstPath) {
      throw new Error(`Malformed Git changed-path output: ${status} is missing its first path.`);
    }
    if (pairedPaths) {
      const secondPath = records[index++];
      if (!secondPath) {
        throw new Error(`Malformed Git changed-path output: ${status} is missing its second path.`);
      }
      changedRecords.push({
        status: status!.startsWith('R') ? 'renamed' : 'copied',
        previousPath: firstPath,
        path: secondPath
      });
    } else {
      changedRecords.push({
        status: status === 'A' ? 'added' : status === 'D' ? 'removed' : 'changed',
        path: firstPath
      });
    }
  }
  return changedRecords;
}

export function parseGitUntrackedFileOutput(stdout: Uint8Array): string[] {
  const output = decodeGitPathOutput(stdout, 'untracked-path');
  if (output.length === 0) return [];
  const records = output.split('\0');
  if (records.pop() !== '') {
    throw new Error('Malformed Git untracked-path output: missing final NUL terminator.');
  }
  if (records.some((entry) => entry.length === 0)) {
    throw new Error('Malformed Git untracked-path output: empty path record.');
  }
  return uniqueSorted(records);
}
