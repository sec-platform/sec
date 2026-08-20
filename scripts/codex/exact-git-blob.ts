import { spawnSync } from 'node:child_process';
import path from 'node:path';

import type {
  CodexDevelopmentExactGitBlobBytesV1,
  CodexDevelopmentExactGitBlobV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import { isolatedGitReadEnvironment } from '../../platform/shared/git-read-environment.ts';

export const CodexDevelopmentExactGitBlobMaxBytesV1 = 16 * 1024 * 1024;

export type CodexDevelopmentExactGitBlobCommandResultV1 = Readonly<{
  error?: Error;
  status: number | null;
  stderr: Buffer;
  stdout: Buffer;
}>;

export type CodexDevelopmentExactGitBlobCommandV1 = (
  repositoryRoot: string,
  args: readonly string[],
  maxBuffer: number
) => CodexDevelopmentExactGitBlobCommandResultV1;

export type CodexDevelopmentExactGitBlobReadOptionsV1 = Readonly<{
  commitSha: string;
  maxBytes?: number;
  repositoryPath: string;
  repositoryRoot: string;
  runGit?: CodexDevelopmentExactGitBlobCommandV1;
}>;

export type CodexDevelopmentExactGitBlobEntryV1 =
  CodexDevelopmentExactGitBlobV1 & Readonly<{ size: number }>;

const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GIT_OBJECT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_TREE_OUTPUT_BYTES = 1024 * 1024;
const MAX_REPOSITORY_PATH_BYTES = 4096;

function runGit(
  repositoryRoot: string,
  args: readonly string[],
  maxBuffer: number
): CodexDevelopmentExactGitBlobCommandResultV1 {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: isolatedGitReadEnvironment(),
    maxBuffer,
    windowsHide: true
  });
  return {
    error: result.error,
    status: result.status,
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(String(result.stderr ?? '')),
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? ''))
  };
}

function assertRepositoryRoot(repositoryRoot: string): void {
  if (!path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot) {
    throw new Error('Exact Git blob repositoryRoot must be one absolute normalized path.');
  }
}

function assertCommitSha(commitSha: string): void {
  if (!FULL_COMMIT_SHA.test(commitSha)) {
    throw new Error('Exact Git blob commitSha must be one full lowercase Git commit SHA.');
  }
}

function assertCanonicalRepositoryPath(repositoryPath: string): void {
  if (
    repositoryPath.length === 0
    || repositoryPath.includes('\0')
    || repositoryPath.includes('\\')
    || repositoryPath.startsWith('/')
    || path.posix.isAbsolute(repositoryPath)
    || path.posix.normalize(repositoryPath) !== repositoryPath
    || repositoryPath === '.'
    || repositoryPath.startsWith('../')
    || repositoryPath.includes('/../')
    || repositoryPath.includes('/./')
    || Buffer.byteLength(repositoryPath, 'utf8') > MAX_REPOSITORY_PATH_BYTES
  ) {
    throw new Error('Exact Git blob repositoryPath must be one canonical repository-relative path.');
  }
}

function executeGit(
  options: CodexDevelopmentExactGitBlobReadOptionsV1,
  args: readonly string[],
  maxBuffer: number
): Buffer {
  const result = (options.runGit ?? runGit)(options.repositoryRoot, args, maxBuffer);
  if (result.error) {
    throw new Error(`Exact Git blob command failed: git ${args.join(' ')}.`, {
      cause: result.error
    });
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(
      `Exact Git blob command failed: git ${args.join(' ')}`
      + `${stderr ? `: ${stderr}` : '.'}`
    );
  }
  return result.stdout;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Exact Git blob ${label} is not strict UTF-8.`, { cause: error });
  }
}

export function CodexDevelopmentReadExactGitBlobEntryV1(
  options: CodexDevelopmentExactGitBlobReadOptionsV1
): CodexDevelopmentExactGitBlobEntryV1 {
  assertRepositoryRoot(options.repositoryRoot);
  assertCommitSha(options.commitSha);
  assertCanonicalRepositoryPath(options.repositoryPath);
  const maxBytes = options.maxBytes ?? CodexDevelopmentExactGitBlobMaxBytesV1;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Exact Git blob maxBytes must be one non-negative safe integer.');
  }

  const treeBytes = executeGit(options, [
    'ls-tree',
    '-z',
    '--full-tree',
    options.commitSha,
    '--',
    options.repositoryPath
  ], MAX_TREE_OUTPUT_BYTES);
  if (treeBytes.length === 0) {
    throw new Error(`Exact Git blob path is missing at ${options.commitSha}: ${options.repositoryPath}.`);
  }
  if (treeBytes[treeBytes.length - 1] !== 0) {
    throw new Error('Exact Git blob tree output is not NUL terminated.');
  }
  const records = treeBytes.subarray(0, treeBytes.length - 1).toString('binary').split('\0');
  if (records.length !== 1) {
    throw new Error(`Exact Git blob path resolved to ${records.length} tree entries.`);
  }
  const recordBytes = Buffer.from(records[0]!, 'binary');
  const separator = recordBytes.indexOf(0x09);
  if (separator < 0) throw new Error('Exact Git blob tree entry is malformed.');
  const metadata = decodeUtf8(recordBytes.subarray(0, separator), 'tree metadata');
  const resolvedPath = decodeUtf8(recordBytes.subarray(separator + 1), 'tree path');
  if (resolvedPath !== options.repositoryPath) {
    throw new Error(
      `Exact Git blob tree path mismatch: expected=${options.repositoryPath} actual=${resolvedPath}.`
    );
  }
  const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(metadata);
  if (!match || !GIT_OBJECT_SHA.test(match[3]!)) {
    throw new Error(`Exact Git blob tree metadata is malformed: ${metadata}.`);
  }
  if ((match[1] !== '100644' && match[1] !== '100755') || match[2] !== 'blob') {
    throw new Error(
      `Exact Git blob path is not an ordinary blob: mode=${match[1]} type=${match[2]}.`
    );
  }

  const sizeSource = decodeUtf8(
    executeGit(options, ['cat-file', '-s', match[3]!], 1024),
    'size output'
  ).trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(sizeSource)) {
    throw new Error(`Exact Git blob size is invalid: ${sizeSource || '<empty>'}.`);
  }
  const size = Number.parseInt(sizeSource, 10);
  if (!Number.isSafeInteger(size)) throw new Error('Exact Git blob size exceeds safe integer range.');
  if (size > maxBytes) {
    throw new Error(`Exact Git blob size ${size} exceeds maxBytes ${maxBytes}.`);
  }
  return Object.freeze({
    blobSha: match[3]!,
    mode: match[1] as '100644' | '100755',
    size,
    type: 'blob'
  });
}

export function CodexDevelopmentReadExactGitBlobV1(
  options: CodexDevelopmentExactGitBlobReadOptionsV1
): CodexDevelopmentExactGitBlobBytesV1 {
  const entry = CodexDevelopmentReadExactGitBlobEntryV1(options);
  const bytes = executeGit(
    options,
    ['cat-file', 'blob', entry.blobSha],
    Math.max(64 * 1024, entry.size + 64 * 1024)
  );
  if (bytes.length !== entry.size) {
    throw new Error(
      `Exact Git blob size mismatch for ${options.repositoryPath}: `
      + `expected=${entry.size} actual=${bytes.length}.`
    );
  }
  return Object.freeze({
    blobSha: entry.blobSha,
    bytes: new Uint8Array(bytes),
    mode: entry.mode,
    type: 'blob'
  });
}
