import { uniqueSortedLines } from './collections.ts';
import { posixPath } from './paths.ts';

export function gitChangedFileDiffArgs(baseRef?: string): string[] {
  return [
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    ...(baseRef ? [baseRef, 'HEAD'] : ['HEAD'])
  ];
}

export function parseGitChangedFileOutput(stdout: string): string[] {
  return uniqueSortedLines(stdout)
    .map(posixPath);
}
