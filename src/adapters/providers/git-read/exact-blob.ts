import path from 'node:path';

import type {
  GitBlobBytes,
  GitBlobIdentity,
  GitReadSession
} from './runtime/session.ts';
import { assertProductionGitReadSession } from './runtime/session.ts';

const ExactGitBlobMaxBytes = 16 * 1024 * 1024;

export type ExactGitBlobReadOptions = Readonly<{
  commitSha: string;
  maxBytes?: number;
  repositoryPath: string;
}>;

type ExactGitBlobEntry =
  GitBlobIdentity & Readonly<{ size: number }>;

export type ExactGitTreeEntry = Readonly<{
  blobSha: string;
  mode: string;
  repositoryPath: string;
  type: string;
}>;

export type ExactGitTextBlob = Readonly<{
  blobSha: string;
  repositoryPath: string;
  byteLength: number;
  source: string;
}>;

export type ExactGitBlobBytes = Readonly<{
  blobSha: string;
  repositoryPath: string;
  byteLength: number;
  bytes: Uint8Array;
}>;

const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GIT_OBJECT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_TREE_OUTPUT_BYTES = 1024 * 1024;
const MAX_REPOSITORY_PATH_BYTES = 4096;
const MAX_TREE_ENTRIES = 100_000;
const MAX_REPOSITORY_TREE_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_TEXT_BYTES = 128 * 1024 * 1024;

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

async function executeSessionGit(
  session: GitReadSession,
  args: readonly string[],
  options: Readonly<{ input?: Buffer }> = {}
): Promise<Buffer> {
  assertProductionGitReadSession(session);
  const command = await session.run(args, options.input === undefined
    ? undefined
    : { input: options.input });
  if (command.kind !== 'completed') {
    throw new Error(`Exact Git object observation did not complete: ${command.reason}.`);
  }
  if (command.result.code !== 0) {
    throw new Error(
      `Exact Git object observation failed: git ${args.join(' ')}`
      + `${command.result.stderr.trim() ? `: ${command.result.stderr.trim()}` : '.'}`
    );
  }
  return Buffer.from(command.result.stdout);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Exact Git blob ${label} is not strict UTF-8.`, { cause: error });
  }
}

async function ReadExactGitBlobEntryFromSession(
  session: GitReadSession,
  options: ExactGitBlobReadOptions
): Promise<ExactGitBlobEntry> {
  assertProductionGitReadSession(session);
  assertCommitSha(options.commitSha);
  assertCanonicalRepositoryPath(options.repositoryPath);
  const maxBytes = options.maxBytes ?? ExactGitBlobMaxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Exact Git blob maxBytes must be one non-negative safe integer.');
  }

  const treeBytes = await executeSessionGit(session, [
    'ls-tree',
    '-z',
    '--full-tree',
    options.commitSha,
    '--',
    options.repositoryPath
  ]);
  if (treeBytes.length > MAX_TREE_OUTPUT_BYTES) {
    throw new Error(`Exact Git blob tree output exceeds ${MAX_TREE_OUTPUT_BYTES} bytes.`);
  }
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

  const sizeBytes = await executeSessionGit(session, ['cat-file', '-s', match[3]!]);
  if (sizeBytes.length > 1024) throw new Error('Exact Git blob size output is too large.');
  const sizeSource = decodeUtf8(sizeBytes, 'size output').trim();
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

export async function ReadExactGitBlobFromSession(
  session: GitReadSession,
  options: ExactGitBlobReadOptions
): Promise<GitBlobBytes> {
  const entry = await ReadExactGitBlobEntryFromSession(session, options);
  const bytes = await executeSessionGit(session, ['cat-file', 'blob', entry.blobSha]);
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

export function parseExactGitTreeEntries(bytes: Buffer): readonly ExactGitTreeEntry[] {
  if (bytes.length === 0) return Object.freeze([]);
  if (bytes[bytes.length - 1] !== 0) {
    throw new Error('Exact Git tree output is not NUL terminated.');
  }
  const records = bytes.subarray(0, bytes.length - 1).toString('binary').split('\0');
  if (records.length > MAX_TREE_ENTRIES) {
    throw new Error(`Exact Git tree exceeds entry limit ${MAX_TREE_ENTRIES}.`);
  }
  const paths = new Set<string>();
  const entries = records.map((record) => {
    const recordBytes = Buffer.from(record, 'binary');
    const separator = recordBytes.indexOf(0x09);
    if (separator < 0) throw new Error('Exact Git tree entry is malformed.');
    const metadata = decodeUtf8(recordBytes.subarray(0, separator), 'tree metadata');
    const repositoryPath = decodeUtf8(recordBytes.subarray(separator + 1), 'tree path');
    assertCanonicalRepositoryPath(repositoryPath);
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(metadata);
    if (!match || !GIT_OBJECT_SHA.test(match[3]!)) {
      throw new Error(`Exact Git tree metadata is malformed: ${metadata}.`);
    }
    if (paths.has(repositoryPath)) {
      throw new Error(`Exact Git tree contains duplicate path: ${repositoryPath}.`);
    }
    paths.add(repositoryPath);
    return Object.freeze({
      blobSha: match[3]!,
      mode: match[1]!,
      repositoryPath,
      type: match[2]!
    });
  });
  return Object.freeze(entries);
}

export async function ListExactGitTreeEntriesFromSession(
  session: GitReadSession,
  commitSha: string
): Promise<readonly ExactGitTreeEntry[]> {
  assertCommitSha(commitSha);
  const bytes = await executeSessionGit(session, [
    'ls-tree', '-r', '-z', '--full-tree', commitSha
  ]);
  if (bytes.length > MAX_REPOSITORY_TREE_OUTPUT_BYTES) {
    throw new Error(`Exact Git tree output exceeds ${MAX_REPOSITORY_TREE_OUTPUT_BYTES} bytes.`);
  }
  const entries = parseExactGitTreeEntries(bytes);
  const failure = session.consumeRecords(entries.length);
  if (failure !== null) {
    throw new Error(`Exact Git tree record budget is exhausted: ${failure.reason}.`);
  }
  return entries;
}

type ExactGitBlobRequest = Pick<ExactGitTreeEntry, 'blobSha' | 'repositoryPath'>;

function parseExactGitBlobHeader(entry: ExactGitBlobRequest, bytes: Buffer): number {
  const header = decodeUtf8(bytes, 'batch header');
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9]\d*)$/u.exec(header);
  if (!match || match[1] !== entry.blobSha) {
    throw new Error(`Exact Git text batch header does not match ${entry.repositoryPath}.`);
  }
  const size = Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(size)) throw new Error('Exact Git text batch size exceeds safe integer range.');
  return size;
}

/** Decode native batch metadata without reading or granting access to blob bytes. */
export function parseExactGitBlobInfoBatch(
  entries: readonly ExactGitBlobRequest[], output: Buffer
): readonly (ExactGitBlobRequest & Readonly<{ byteLength: number }>)[] {
  if (entries.length > MAX_TREE_ENTRIES) {
    throw new Error(`Exact Git text batch exceeds entry limit ${MAX_TREE_ENTRIES}.`);
  }
  let offset = 0;
  const decoded = entries.map(entry => {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error('Exact Git text batch header is incomplete.');
    const byteLength = parseExactGitBlobHeader(entry, output.subarray(offset, newline));
    offset = newline + 1;
    return Object.freeze({ blobSha: entry.blobSha, repositoryPath: entry.repositoryPath, byteLength });
  });
  if (offset !== output.length) throw new Error('Exact Git text batch contains trailing output.');
  return Object.freeze(decoded);
}

/** Raw protocol decoding only; callers retain their own transport and budgets. */
export function parseExactGitBlobsBatch(
  entries: readonly ExactGitBlobRequest[],
  output: Buffer,
  maxTotalBytes: number
): readonly ExactGitBlobBytes[] {
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) {
    throw new Error('Exact Git text batch maxTotalBytes must be one non-negative safe integer.');
  }
  if (entries.length > MAX_TREE_ENTRIES) {
    throw new Error(`Exact Git text batch exceeds entry limit ${MAX_TREE_ENTRIES}.`);
  }
  let offset = 0;
  let totalBytes = 0;
  const decoded = entries.map((entry) => {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error('Exact Git text batch header is incomplete.');
    const size = parseExactGitBlobHeader(entry, output.subarray(offset, newline));
    totalBytes += size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Exact Git text batch exceeds maxTotalBytes ${maxTotalBytes}.`);
    }
    const start = newline + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 0x0a) {
      throw new Error(`Exact Git text batch byte count is malformed for ${entry.repositoryPath}.`);
    }
    offset = end + 1;
    return Object.freeze({
      blobSha: entry.blobSha,
      repositoryPath: entry.repositoryPath,
      byteLength: size,
      bytes: new Uint8Array(output.subarray(start, end))
    });
  });
  if (offset !== output.length) {
    throw new Error('Exact Git text batch contains trailing output.');
  }
  return Object.freeze(decoded);
}

export async function ReadExactGitBlobBytesBatchFromSession(
  session: GitReadSession,
  input: Readonly<{
    entries: readonly ExactGitTreeEntry[];
    maxTotalBytes?: number;
  }>
): Promise<readonly ExactGitBlobBytes[]> {
  const maxTotalBytes = input.maxTotalBytes ?? MAX_BATCH_TEXT_BYTES;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) {
    throw new Error('Exact Git text batch maxTotalBytes must be one non-negative safe integer.');
  }
  if (input.entries.length > MAX_TREE_ENTRIES) {
    throw new Error(`Exact Git text batch exceeds entry limit ${MAX_TREE_ENTRIES}.`);
  }
  const entries = input.entries.map((entry) => {
    assertCanonicalRepositoryPath(entry.repositoryPath);
    if ((entry.mode !== '100644' && entry.mode !== '100755')
        || entry.type !== 'blob'
        || !GIT_OBJECT_SHA.test(entry.blobSha)) {
      throw new Error(`Exact Git text batch entry is not one ordinary blob: ${entry.repositoryPath}.`);
    }
    return entry;
  });
  if (entries.length === 0) return Object.freeze([]);
  const request = Buffer.from(`${entries.map(({ blobSha }) => blobSha).join('\n')}\n`, 'ascii');
  const output = await executeSessionGit(session, ['cat-file', '--batch'], { input: request });
  const blobs = parseExactGitBlobsBatch(entries, output, maxTotalBytes);
  const failure = session.consumeRecords(blobs.length);
  if (failure !== null) {
    throw new Error(`Exact Git blob batch record budget is exhausted: ${failure.reason}.`);
  }
  return blobs;
}

export async function ReadExactGitTextBlobsBatchFromSession(
  session: GitReadSession,
  input: Readonly<{
    entries: readonly ExactGitTreeEntry[];
    maxTotalBytes?: number;
  }>
): Promise<readonly ExactGitTextBlob[]> {
  const blobs = await ReadExactGitBlobBytesBatchFromSession(session, input);
  return Object.freeze(blobs.map((blob) => Object.freeze({
    blobSha: blob.blobSha,
    repositoryPath: blob.repositoryPath,
    byteLength: blob.byteLength,
    source: decodeUtf8(blob.bytes, `source ${blob.repositoryPath}`)
  })));
}
