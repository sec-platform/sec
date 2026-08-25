import path from 'node:path';

import type {
  CodexDevelopmentExactGitBlobBytesV1,
  CodexDevelopmentExactGitBlobV1
} from '../shared/ci-evidence-reuse-contract.ts';
import { parseGitChangedRecordsOutput, type CodexDevelopmentGitChangedRecordV1 } from '../shared/ci-git-changed-files.ts';
import {
  readGitTransportBytes as readGitBytesPrivate,
  readGitTransportText as readGitTextPrivate,
  runGitReadTransport as runGitReadWithEnvironment
} from './transport.ts';

export interface GitTreeBlobEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly byteSize: number;
  readonly path: string;
}

export interface GitTreeInventoryEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly byteSize: number | null;
  readonly path: string;
  readonly type: 'blob' | 'commit';
}

export interface GitBlobBatchLimits {
  readonly maxBytes: number;
  readonly maxItems: number;
}

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be one positive safe integer`);
  }
  return value;
}

export function decodeExactUtf8(bytes: Buffer, label: string): string {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) {
    throw new Error(`${label} returned non-UTF-8 bytes`);
  }
  return value;
}

export function parseNulUtf8(bytes: Buffer, label: string): string[] {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new Error(`${label} did not return NUL-terminated records`);
  }
  const payload = bytes.subarray(0, -1);
  const text = decodeExactUtf8(payload, label);
  if (!Buffer.from(`${text}\0`, 'utf8').equals(bytes)) {
    throw new Error(`${label} returned an invalid NUL-delimited UTF-8 payload`);
  }
  return text.split('\0');
}

export function assertGitObjectId(value: string, label: string): string {
  if (!GIT_OBJECT_ID_PATTERN.test(value)) {
    throw new Error(`${label} is not one full SHA-1/SHA-256 Git object ID`);
  }
  return value;
}

export function resolveExactHeadCommit(repositoryRoot: string): string {
  return assertGitObjectId(
    readGitTextPrivate(
      repositoryRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { maxBuffer: 1024 * 1024, label: 'git rev-parse HEAD' }
    ).trim(),
    'HEAD commit'
  );
}

export function readCommitTreeInventory(
  repositoryRoot: string,
  commit: string
): readonly GitTreeInventoryEntry[] {
  const exactCommit = assertGitObjectId(commit, 'Git inventory commit');
  const fields = parseNulUtf8(
    readGitBytesPrivate(
      repositoryRoot,
      ['ls-tree', '-r', '-z', '--full-tree', '-l', exactCommit],
      { maxBuffer: 128 * 1024 * 1024, label: 'git ls-tree' }
    ),
    'git ls-tree'
  );
  const entries: GitTreeInventoryEntry[] = [];
  for (const field of fields) {
    const separator = field.indexOf('\t');
    const header = separator < 0 ? '' : field.slice(0, separator);
    const filePath = separator < 0 ? '' : field.slice(separator + 1);
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}(?:[0-9a-f]{24})?) +([0-9]+|-)$/u.exec(header);
    if (!match || filePath.length === 0) {
      throw new Error('git ls-tree returned an invalid record');
    }
    if (match[2] !== 'blob' && match[2] !== 'commit') {
      throw new Error(`git ls-tree returned unsupported object type ${match[2]} for ${filePath}`);
    }
    const byteSize = match[4] === '-' ? null : Number(match[4]);
    if ((match[2] === 'blob' && (!Number.isSafeInteger(byteSize) || (byteSize as number) < 0))
        || (match[2] === 'commit' && byteSize !== null)) {
      throw new Error(`git ls-tree returned an invalid blob size for ${filePath}`);
    }
    entries.push(Object.freeze({
      mode: match[1]!,
      objectId: match[3]!,
      byteSize,
      path: filePath,
      type: match[2]
    }));
  }
  return Object.freeze(entries);
}

export function readCommitBlobInventory(
  repositoryRoot: string,
  commit: string
): readonly GitTreeBlobEntry[] {
  return Object.freeze(readCommitTreeInventory(repositoryRoot, commit)
    .filter((entry): entry is GitTreeInventoryEntry & Readonly<{ byteSize: number; type: 'blob' }> =>
      entry.type === 'blob')
    .map(({ mode, objectId, byteSize, path }) => Object.freeze({ mode, objectId, byteSize, path })));
}

export function chunkByCount<Value>(values: readonly Value[], maxItems: number): readonly (readonly Value[])[] {
  const limit = positiveSafeInteger(maxItems, 'Git observation batch item limit');
  const batches: Value[][] = [];
  for (let index = 0; index < values.length; index += limit) {
    batches.push(values.slice(index, index + limit));
  }
  return Object.freeze(batches.map((batch) => Object.freeze(batch)));
}

export function chunkBlobEntries(
  entries: readonly GitTreeBlobEntry[],
  limits: GitBlobBatchLimits
): readonly (readonly GitTreeBlobEntry[])[] {
  const maxBytes = positiveSafeInteger(limits.maxBytes, 'Git blob batch byte limit');
  const maxItems = positiveSafeInteger(limits.maxItems, 'Git blob batch item limit');
  const batches: GitTreeBlobEntry[][] = [];
  let current: GitTreeBlobEntry[] = [];
  let currentBytes = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBytes = 0;
  };

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0) {
      throw new Error(`Git blob inventory contains an invalid byte size for ${entry.path}`);
    }
    if (entry.byteSize > maxBytes) {
      throw new Error(`Git blob ${entry.path} exceeds the ${maxBytes}-byte observation batch limit`);
    }
    if (
      current.length > 0 &&
      (current.length >= maxItems || entry.byteSize > maxBytes - currentBytes)
    ) {
      flush();
    }
    current.push(entry);
    currentBytes += entry.byteSize;
    if (current.length >= maxItems || currentBytes >= maxBytes) flush();
  }
  flush();
  return Object.freeze(batches.map((batch) => Object.freeze(batch)));
}

export function readBlobBatch(
  repositoryRoot: string,
  objectIds: readonly string[],
  maxBuffer = 512 * 1024 * 1024
): ReadonlyMap<string, Buffer> {
  if (objectIds.length === 0) return new Map();
  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const objectId of objectIds) {
    assertGitObjectId(objectId, 'Git blob object ID');
    if (!seen.has(objectId)) {
      seen.add(objectId);
      uniqueIds.push(objectId);
    }
  }
  const output = readGitBytesPrivate(
    repositoryRoot,
    ['cat-file', '--batch'],
    {
      input: Buffer.from(`${uniqueIds.join('\n')}\n`, 'ascii'),
      maxBuffer,
      label: 'git cat-file --batch'
    }
  );
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const requestedId of uniqueIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) {
      throw new Error(`git cat-file --batch returned an incomplete header for ${requestedId}`);
    }
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== requestedId) {
      throw new Error(`git cat-file --batch returned an invalid blob header for ${requestedId}`);
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`git cat-file --batch returned an invalid blob size for ${requestedId}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + byteLength;
    if (contentEnd >= output.byteLength || output[contentEnd] !== 0x0a) {
      throw new Error(`git cat-file --batch returned incomplete blob bytes for ${requestedId}`);
    }
    blobs.set(requestedId, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== output.byteLength) {
    throw new Error('git cat-file --batch returned trailing bytes');
  }
  return blobs;
}

export function readBlobEntryBatch(
  repositoryRoot: string,
  entries: readonly GitTreeBlobEntry[]
): ReadonlyMap<string, Buffer> {
  if (entries.length === 0) return new Map();
  const expectedSizes = new Map<string, number>();
  for (const entry of entries) {
    const prior = expectedSizes.get(entry.objectId);
    if (prior !== undefined && prior !== entry.byteSize) {
      throw new Error(`Git blob ${entry.objectId} has inconsistent inventory sizes`);
    }
    expectedSizes.set(entry.objectId, entry.byteSize);
  }
  const expectedBytes = [...expectedSizes.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new Error('Git blob batch expected byte total exceeds the safe integer range');
  }
  const overhead = Math.max(1024 * 1024, expectedSizes.size * 256);
  const maxBuffer = expectedBytes + overhead;
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) {
    throw new Error('Git blob batch output buffer bound is invalid');
  }
  const blobs = readBlobBatch(
    repositoryRoot,
    [...expectedSizes.keys()],
    Math.max(1024 * 1024, maxBuffer)
  );
  for (const [objectId, expectedSize] of expectedSizes) {
    if (blobs.get(objectId)?.byteLength !== expectedSize) {
      throw new Error(`Git blob ${objectId} readback size differs from ls-tree inventory`);
    }
  }
  return blobs;
}

export const CodexDevelopmentExactGitBlobMaxBytesV1 = 16 * 1024 * 1024;

export type CodexDevelopmentExactGitBlobReadOptionsV1 = Readonly<{
  commitSha: string;
  maxBytes?: number;
  repositoryPath: string;
  repositoryRoot: string;
}>;

export type CodexDevelopmentExactGitBlobEntryV1 =
  CodexDevelopmentExactGitBlobV1 & Readonly<{ size: number }>;

export type CodexDevelopmentExactGitTreeEntryV1 = Readonly<{
  blobSha: string;
  mode: string;
  repositoryPath: string;
  type: string;
}>;

export type CodexDevelopmentExactGitTextBlobV1 = Readonly<{
  blobSha: string;
  repositoryPath: string;
  source: string;
}>;

const FULL_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const GIT_OBJECT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_TREE_OUTPUT_BYTES = 1024 * 1024;
const MAX_REPOSITORY_PATH_BYTES = 4096;
const MAX_TREE_ENTRIES = 100_000;
const MAX_REPOSITORY_TREE_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_TEXT_BYTES = 128 * 1024 * 1024;

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
  repositoryRoot: string,
  args: readonly string[],
  maxBuffer: number
): Buffer {
  const result = runGitReadWithEnvironment(repositoryRoot, args, { maxBuffer });
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

export function parseExactGitBlobBytesV1(
  bytes: Uint8Array,
  expectedSize: number,
  repositoryPath: string
): Uint8Array {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error('Exact Git blob expected size must be one non-negative safe integer.');
  }
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `Exact Git blob size mismatch for ${repositoryPath}: expected=${expectedSize} actual=${bytes.byteLength}.`
    );
  }
  return new Uint8Array(bytes);
}

export function parseExactGitTextBatchHeaderV1(
  bytes: Uint8Array,
  expectedBlobSha: string,
  repositoryPath: string
): string {
  const newline = bytes.indexOf(0x0a);
  if (newline < 0) throw new Error('Exact Git text batch header is incomplete.');
  const header = decodeUtf8(bytes.subarray(0, newline), 'batch header');
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9]\d*)$/u.exec(header);
  if (!match || match[1] !== expectedBlobSha) {
    throw new Error(`Exact Git text batch header does not match ${repositoryPath}.`);
  }
  return header;
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

  const treeBytes = executeGit(options.repositoryRoot, [
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
    executeGit(options.repositoryRoot, ['cat-file', '-s', match[3]!], 1024),
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
    options.repositoryRoot,
    ['cat-file', 'blob', entry.blobSha],
    Math.max(64 * 1024, entry.size + 64 * 1024)
  );
  const exactBytes = parseExactGitBlobBytesV1(bytes, entry.size, options.repositoryPath);
  return Object.freeze({
    blobSha: entry.blobSha,
    bytes: exactBytes,
    mode: entry.mode,
    type: 'blob'
  });
}

export function CodexDevelopmentListExactGitTreeEntriesV1(options: Readonly<{
  commitSha: string;
  repositoryRoot: string;
}>): readonly CodexDevelopmentExactGitTreeEntryV1[] {
  assertRepositoryRoot(options.repositoryRoot);
  assertCommitSha(options.commitSha);
  const bytes = executeGit(options.repositoryRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    options.commitSha
  ], MAX_REPOSITORY_TREE_OUTPUT_BYTES);
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

export function CodexDevelopmentReadExactGitTextBlobsBatchV1(options: Readonly<{
  entries: readonly CodexDevelopmentExactGitTreeEntryV1[];
  maxTotalBytes?: number;
  repositoryRoot: string;
}>): readonly CodexDevelopmentExactGitTextBlobV1[] {
  assertRepositoryRoot(options.repositoryRoot);
  const maxTotalBytes = options.maxTotalBytes ?? MAX_BATCH_TEXT_BYTES;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) {
    throw new Error('Exact Git text batch maxTotalBytes must be one non-negative safe integer.');
  }
  if (options.entries.length > MAX_TREE_ENTRIES) {
    throw new Error(`Exact Git text batch exceeds entry limit ${MAX_TREE_ENTRIES}.`);
  }
  const entries = options.entries.map((entry) => {
    assertCanonicalRepositoryPath(entry.repositoryPath);
    if ((entry.mode !== '100644' && entry.mode !== '100755')
        || entry.type !== 'blob'
        || !GIT_OBJECT_SHA.test(entry.blobSha)) {
      throw new Error(`Exact Git text batch entry is not one ordinary blob: ${entry.repositoryPath}.`);
    }
    return entry;
  });
  if (entries.length === 0) return Object.freeze([]);
  const input = Buffer.from(`${entries.map(({ blobSha }) => blobSha).join('\n')}\n`, 'ascii');
  const args = ['cat-file', '--batch'];
  const result = runGitReadWithEnvironment(
    options.repositoryRoot,
    args,
    {
      maxBuffer: Math.max(64 * 1024, maxTotalBytes + entries.length * 128),
      input
    }
  );
  if (result.error) {
    throw new Error('Exact Git text batch command failed.', { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Exact Git text batch command failed${result.stderr.length > 0
      ? `: ${result.stderr.toString('utf8').trim()}` : '.'}`);
  }
  let offset = 0;
  let totalBytes = 0;
  const decoded = entries.map((entry) => {
    const newline = result.stdout.indexOf(0x0a, offset);
    if (newline < 0) throw new Error('Exact Git text batch header is incomplete.');
    const headerBytes = result.stdout.subarray(offset);
    const header = parseExactGitTextBatchHeaderV1(headerBytes, entry.blobSha, entry.repositoryPath);
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9]\d*)$/u.exec(header)!;
    const size = Number.parseInt(match[2]!, 10);
    if (!Number.isSafeInteger(size)) throw new Error('Exact Git text batch size exceeds safe integer range.');
    totalBytes += size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Exact Git text batch exceeds maxTotalBytes ${maxTotalBytes}.`);
    }
    const start = newline + 1;
    const end = start + size;
    if (end >= result.stdout.length || result.stdout[end] !== 0x0a) {
      throw new Error(`Exact Git text batch byte count is malformed for ${entry.repositoryPath}.`);
    }
    offset = end + 1;
    return Object.freeze({
      blobSha: entry.blobSha,
      repositoryPath: entry.repositoryPath,
      source: decodeUtf8(result.stdout.subarray(start, end), `source ${entry.repositoryPath}`)
    });
  });
  if (offset !== result.stdout.length) {
    throw new Error('Exact Git text batch contains trailing output.');
  }
  return Object.freeze(decoded);
}

function assertGitRevision(value: string, label: string): string {
  if (value.length === 0 || value.includes('\0') || value.startsWith('-')) {
    throw new Error(label + ' must be non-empty, NUL-free, and cannot start with a dash.');
  }
  return value;
}

export function readGitRevision(repositoryRoot: string, ref: string): string | null {
  assertGitRevision(ref, 'Git revision');
  const result = runGitReadWithEnvironment(repositoryRoot, ['rev-parse', ref], { maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  return decodeExactUtf8(result.stdout, 'Git revision').trim();
}

export function readGitTreeRevision(repositoryRoot: string, commitRef = 'HEAD'): string | null {
  assertGitRevision(commitRef, 'Git tree commit');
  return readGitRevision(repositoryRoot, `${commitRef}^{tree}`);
}

/**
 * Reads candidate commit messages through one fixed machine projection. The
 * caller supplies exact endpoints, never an argv or presentation format.
 */
export function readGitCommitLogTextV1(
  repositoryRoot: string,
  baseCommit: string,
  headCommit: string
): string {
  const base = assertGitObjectId(baseCommit, 'Git log base commit');
  const head = assertGitObjectId(headCommit, 'Git log head commit');
  return readGitTextPrivate(
    repositoryRoot,
    ['log', '--format=%H%x09%s%n%b', `${base}..${head}`],
    { maxBuffer: 32 * 1024 * 1024, label: 'Git candidate commit log' }
  );
}

export function readGitWorkingTreeStatus(repositoryRoot: string): readonly string[] {
  return parseNulUtf8(readGitBytesPrivate(repositoryRoot, [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'
  ], { maxBuffer: 32 * 1024 * 1024, label: 'Git working-tree status' }), 'Git working-tree status');
}

export function readGitTrackedPaths(repositoryRoot: string): readonly string[] {
  return parseNulUtf8(readGitBytesPrivate(repositoryRoot, ['ls-files', '-z', '--'], {
    maxBuffer: 64 * 1024 * 1024,
    label: 'Git tracked-path inventory'
  }), 'Git tracked-path inventory');
}

export function readGitChangedRecords(
  repositoryRoot: string,
  baseRef: string,
  currentRef: string
): readonly CodexDevelopmentGitChangedRecordV1[] {
  assertGitRevision(baseRef, 'Git changed-path base');
  assertGitRevision(currentRef, 'Git changed-path current');
  return parseGitChangedRecordsOutput(readGitBytesPrivate(repositoryRoot, [
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames', '--find-copies',
    '--diff-filter=ACDMRTUXB', baseRef, currentRef
  ], { maxBuffer: 128 * 1024 * 1024, label: 'Git changed-path observation' }));
}

export function readGitVersion(repositoryRoot: string): string {
  return readGitTextPrivate(repositoryRoot, ['--version'], { maxBuffer: 1024, label: 'git --version' }).trim();
}

export function readGitObjectDirectory(repositoryRoot: string): string {
  return readGitTextPrivate(repositoryRoot, ['rev-parse', '--git-path', 'objects'], {
    maxBuffer: 1024 * 1024,
    label: 'git object directory'
  }).trim();
}

export function readGitObjectFormat(repositoryRoot: string): string {
  return readGitTextPrivate(repositoryRoot, ['rev-parse', '--show-object-format'], {
    maxBuffer: 1024,
    label: 'git object format'
  }).trim();
}

export function readGitConfig(repositoryRoot: string, key: string): string | null {
  if (key.length === 0 || key.includes('\0') || key.startsWith('-')) {
    throw new Error('Git config key must be non-empty, NUL-free, and cannot start with a dash.');
  }
  const result = runGitReadWithEnvironment(repositoryRoot, ['config', '--get', key], { maxBuffer: 1024 * 1024 });
  if (result.error) {
    throw new Error(`git config ${key} could not start`, { cause: result.error });
  }
  if (result.status === 1 && result.stdout.byteLength === 0) return null;
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(`git config ${key} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return decodeExactUtf8(result.stdout, `git config ${key}`).trim();
}
