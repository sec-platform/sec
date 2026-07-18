import { uniqueSorted } from './collections.ts';
import { posixPath } from './paths.ts';

export type CodexDevelopmentGitChangedRecordV1 = {
  status: 'added' | 'changed' | 'removed' | 'renamed' | 'copied';
  path: string;
  previousPath?: string;
};

export function gitChangedFileDiffArgs(baseRef?: string, currentRef = 'HEAD'): string[] {
  return [
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    ...(baseRef ? [baseRef, currentRef] : [currentRef])
  ];
}

export function gitUntrackedFileArgs(): string[] {
  return [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z'
  ];
}

export function parseGitChangedFileOutput(stdout: string): string[] {
  return uniqueSorted(parseGitChangedRecordsOutput(stdout).flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function parseGitChangedRecordsOutput(stdout: string): CodexDevelopmentGitChangedRecordV1[] {
  if (stdout.length === 0) return [];
  const records = stdout.split('\0');
  if (records.pop() !== '') {
    throw new Error('Malformed Git changed-path output: missing final NUL terminator.');
  }

  const changedRecords: CodexDevelopmentGitChangedRecordV1[] = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++];
    const singlePath = /^[ADMT]$/u.test(status ?? '');
    const pairedPaths = /^[CR]\d{1,3}$/u.test(status ?? '');
    if (!singlePath && !pairedPaths) {
      throw new Error(`Malformed Git changed-path output: unknown status "${status ?? ''}".`);
    }
    const firstPath = records[index++];
    if (!firstPath) {
      throw new Error(`Malformed Git changed-path output: ${status} is missing its first path.`);
    }
    const first = posixPath(firstPath);
    if (pairedPaths) {
      const secondPath = records[index++];
      if (!secondPath) {
        throw new Error(`Malformed Git changed-path output: ${status} is missing its second path.`);
      }
      changedRecords.push({
        status: status!.startsWith('R') ? 'renamed' : 'copied',
        previousPath: first,
        path: posixPath(secondPath)
      });
    } else {
      changedRecords.push({
        status: status === 'A' ? 'added' : status === 'D' ? 'removed' : 'changed',
        path: first
      });
    }
  }
  return changedRecords;
}

export function parseGitUntrackedFileOutput(stdout: string): string[] {
  if (stdout.length === 0) return [];
  const records = stdout.split('\0');
  if (records.pop() !== '') {
    throw new Error('Malformed Git untracked-path output: missing final NUL terminator.');
  }
  if (records.some((entry) => entry.length === 0)) {
    throw new Error('Malformed Git untracked-path output: empty path record.');
  }
  return uniqueSorted(records.map(posixPath));
}
