import { uniqueSorted } from './collections.ts';
import { posixPath } from './paths.ts';

export function gitChangedFileDiffArgs(baseRef?: string): string[] {
  return [
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
    ...(baseRef ? [baseRef, 'HEAD'] : ['HEAD'])
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
  if (stdout.length === 0) return [];
  const records = stdout.split('\0');
  if (records.pop() !== '') {
    throw new Error('Malformed Git changed-path output: missing final NUL terminator.');
  }

  const paths: string[] = [];
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
    paths.push(posixPath(firstPath));
    if (pairedPaths) {
      const secondPath = records[index++];
      if (!secondPath) {
        throw new Error(`Malformed Git changed-path output: ${status} is missing its second path.`);
      }
      paths.push(posixPath(secondPath));
    }
  }
  return uniqueSorted(paths);
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
