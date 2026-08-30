import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withAuthorityGitReadSession } from '../external-capabilities/git-read/authority.ts';
import { type GitReadSession, type GitReadSessionCommand } from '../external-capabilities/git-read/runtime/session.ts';

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/v1\n', 'utf8');
const RELEASE_GIT_BLOB_BATCH_MAX_BYTES = 24 * 1024 * 1024;
const RELEASE_GIT_BLOB_BATCH_MAX_ITEMS = 1024;

interface ReleaseGitBlobEntry {
  readonly mode: '100644' | '100755';
  readonly objectId: string;
  readonly byteSize: number;
  readonly path: string;
}

export interface ExactReleaseGitTree {
  readonly schema: 'sec-exact-release-git-tree-v1';
  readonly root: string;
  readonly stageRoot: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly fileCount: number;
}

function completedGitCommand(
  command: GitReadSessionCommand,
  label: string
): Readonly<{ code: number; stdout: Buffer; stderr: string }> {
  if (command.kind !== 'completed') {
    throw new Error(`${label} could not be observed: ${command.reason}: ${command.detail}`);
  }
  return Object.freeze({
    code: command.result.code,
    stdout: Buffer.from(command.result.stdout),
    stderr: command.result.stderr
  });
}

function exactUtf8(bytes: Buffer, label: string): string {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label} contains non-UTF-8 bytes`);
  return text;
}

async function gitBytes(
  session: GitReadSession,
  args: readonly string[],
  label: string,
  input?: Buffer
): Promise<Buffer> {
  const result = completedGitCommand(await session.run(args, input === undefined ? {} : { input }), label);
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

async function gitText(session: GitReadSession, args: readonly string[], label: string): Promise<string> {
  return exactUtf8(await gitBytes(session, args, label), label).trim();
}

function assertGitObjectId(value: string, label: string): string {
  if (!GIT_OBJECT_ID_PATTERN.test(value)) throw new Error(`${label} is not one full SHA-1/SHA-256 Git object ID`);
  return value;
}

async function assertTrackedWorktreeMatchesCommit(
  session: GitReadSession,
  sourceCommit: string
): Promise<void> {
  const result = completedGitCommand(await session.run([
    'diff', '--quiet', '--no-ext-diff', '--no-textconv', sourceCommit, '--'
  ]), 'Release tracked worktree comparison');
  if (result.code === 1) throw new Error('Release tracked worktree/index differs from captured source commit');
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`Release tracked worktree comparison failed${detail ? `: ${detail}` : ''}`);
  }
}

function canonicalReleaseGitPath(value: string): string {
  if (
    value.length === 0 || value.startsWith('/') || value.includes('\\') || value.includes('\0') ||
    path.posix.normalize(value) !== value
  ) {
    throw new Error(`Release source Git tree contains a non-canonical path: ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Release source Git tree contains an unsafe path: ${JSON.stringify(value)}`);
  }
  return value;
}

async function parseGitTree(
  session: GitReadSession,
  sourceCommit: string
): Promise<readonly ReleaseGitBlobEntry[]> {
  const output = await gitBytes(
    session,
    ['ls-tree', '-r', '-z', '--full-tree', '-l', sourceCommit],
    'git ls-tree release source'
  );
  if (output.byteLength === 0) return Object.freeze([]);
  if (output[output.byteLength - 1] !== 0) throw new Error('Release source Git tree did not return NUL-terminated records');
  const payload = output.subarray(0, -1);
  const decoded = exactUtf8(payload, 'Release source Git tree');
  if (!Buffer.from(`${decoded}\0`, 'utf8').equals(output)) {
    throw new Error('Release source Git tree returned an invalid NUL-delimited payload');
  }

  const entries: ReleaseGitBlobEntry[] = [];
  for (const record of decoded.split('\0')) {
    const separator = record.indexOf('\t');
    const header = separator < 0 ? '' : record.slice(0, separator);
    const filePath = canonicalReleaseGitPath(separator < 0 ? '' : record.slice(separator + 1));
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}(?:[0-9a-f]{24})?) +([0-9]+|-)$/u.exec(header);
    if (!match) throw new Error(`Release source Git tree returned an invalid entry for ${filePath}`);
    const mode = match[1]!;
    const type = match[2]!;
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(`Release source tree contains unsupported Git entry ${filePath} (${mode} ${type})`);
    }
    const byteSize = Number(match[4]);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new Error(`Release source tree contains an invalid blob size for ${filePath}`);
    }
    if (byteSize > RELEASE_GIT_BLOB_BATCH_MAX_BYTES) {
      throw new Error(
        `Release source blob exceeds the ${RELEASE_GIT_BLOB_BATCH_MAX_BYTES}-byte materialization budget: ${filePath}`
      );
    }
    entries.push(Object.freeze({
      mode,
      objectId: assertGitObjectId(match[3]!, `Release source blob ${filePath}`),
      byteSize,
      path: filePath
    }));
  }
  const recordFailure = session.consumeRecords(entries.length);
  if (recordFailure !== null) {
    throw new Error(`Release Git tree record budget failed: ${recordFailure.reason}: ${recordFailure.detail}`);
  }
  return Object.freeze(entries);
}

function chunkEntries(entries: readonly ReleaseGitBlobEntry[]): readonly (readonly ReleaseGitBlobEntry[])[] {
  const batches: ReleaseGitBlobEntry[][] = [];
  let current: ReleaseGitBlobEntry[] = [];
  let currentBytes = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBytes = 0;
  };
  for (const entry of entries) {
    if (
      current.length > 0 &&
      (current.length >= RELEASE_GIT_BLOB_BATCH_MAX_ITEMS || entry.byteSize > RELEASE_GIT_BLOB_BATCH_MAX_BYTES - currentBytes)
    ) flush();
    current.push(entry);
    currentBytes += entry.byteSize;
    if (current.length >= RELEASE_GIT_BLOB_BATCH_MAX_ITEMS || currentBytes >= RELEASE_GIT_BLOB_BATCH_MAX_BYTES) flush();
  }
  flush();
  return Object.freeze(batches.map((batch) => Object.freeze(batch)));
}

async function readBlobBatch(
  session: GitReadSession,
  entries: readonly ReleaseGitBlobEntry[]
): Promise<ReadonlyMap<string, Buffer>> {
  const expectedSizes = new Map<string, number>();
  for (const entry of entries) {
    const previous = expectedSizes.get(entry.objectId);
    if (previous !== undefined && previous !== entry.byteSize) {
      throw new Error(`Release source blob ${entry.objectId} has inconsistent tree sizes`);
    }
    expectedSizes.set(entry.objectId, entry.byteSize);
  }
  if (expectedSizes.size === 0) return new Map();
  const expectedBytes = [...expectedSizes.values()].reduce((sum, value) => sum + value, 0);
  const overhead = Math.max(1024 * 1024, expectedSizes.size * 256);
  const maxBuffer = expectedBytes + overhead;
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0) throw new Error('Release source blob batch exceeds safe output bounds');
  if (maxBuffer > 32 * 1024 * 1024) throw new Error('Release source blob batch exceeds the Git provider command-output bound');

  const objectIds = [...expectedSizes.keys()];
  const output = await gitBytes(
    session,
    ['cat-file', '--batch'],
    'git cat-file release source',
    Buffer.from(`${objectIds.join('\n')}\n`, 'ascii')
  );
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const objectId of objectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`Release source blob ${objectId} has an incomplete cat-file header`);
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== objectId) throw new Error(`Release source blob ${objectId} returned an invalid cat-file header`);
    const byteLength = Number(match[2]);
    if (byteLength !== expectedSizes.get(objectId)) throw new Error(`Release source blob ${objectId} differs from ls-tree byte size`);
    const start = headerEnd + 1;
    const end = start + byteLength;
    if (end >= output.byteLength || output[end] !== 0x0a) throw new Error(`Release source blob ${objectId} returned incomplete bytes`);
    blobs.set(objectId, Buffer.from(output.subarray(start, end)));
    offset = end + 1;
  }
  if (offset !== output.byteLength) throw new Error('Release source cat-file batch returned trailing bytes');
  return blobs;
}

function assertNotLfsPointer(bytes: Buffer, filePath: string): void {
  if (
    bytes.byteLength >= GIT_LFS_POINTER_PREFIX.byteLength &&
    bytes.subarray(0, GIT_LFS_POINTER_PREFIX.byteLength).equals(GIT_LFS_POINTER_PREFIX)
  ) {
    throw new Error(`Frozen release source contains a Git LFS pointer: ${filePath}`);
  }
}

async function ensureOrdinaryParent(
  lexicalRoot: string,
  physicalRoot: string,
  filePath: string
): Promise<string> {
  const segments = filePath.split('/');
  let current = lexicalRoot;
  const physicalSegments: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    physicalSegments.push(segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const metadata = await fs.lstat(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Release source parent is not one ordinary directory: ${filePath}`);
    }
    const real = path.resolve(await fs.realpath(current));
    const expectedPhysical = path.resolve(physicalRoot, ...physicalSegments);
    if (real !== expectedPhysical) {
      throw new Error(`Release source parent aliases another physical path: ${filePath}`);
    }
  }
  return current;
}

async function materializeEntry(
  lexicalRoot: string,
  physicalRoot: string,
  entry: ReleaseGitBlobEntry,
  bytes: Buffer
): Promise<void> {
  assertNotLfsPointer(bytes, entry.path);
  const parent = await ensureOrdinaryParent(lexicalRoot, physicalRoot, entry.path);
  const target = path.join(parent, path.basename(entry.path));
  try {
    await fs.lstat(target);
    throw new Error(`Release source path collides on this filesystem: ${entry.path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const mode = entry.mode === '100755' ? 0o755 : 0o644;
  await fs.writeFile(target, bytes, { flag: 'wx', mode });
  if (process.platform !== 'win32') await fs.chmod(target, mode);
  const [metadata, readback, real] = await Promise.all([
    fs.lstat(target),
    fs.readFile(target),
    fs.realpath(target)
  ]);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error(`Release source materialization did not produce one ordinary private file: ${entry.path}`);
  }
  const expectedPhysical = path.resolve(physicalRoot, ...entry.path.split('/'));
  if (path.resolve(real) !== expectedPhysical) {
    throw new Error(`Release source materialization aliases another physical path: ${entry.path}`);
  }
  if (!readback.equals(bytes) || readback.byteLength !== entry.byteSize) {
    throw new Error(`Release source materialization readback differs from Git blob: ${entry.path}`);
  }
  if (process.platform !== 'win32' && ((metadata.mode & 0o111) !== 0) !== (entry.mode === '100755')) {
    throw new Error(`Release source executable mode differs from Git tree: ${entry.path}`);
  }
}

export async function materializeExactReleaseGitTree(repositoryRoot: string): Promise<ExactReleaseGitTree> {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  return withAuthorityGitReadSession({
    cwd: absoluteRepositoryRoot,
    budget: {
      deadlineMs: 120_000,
      maxProcesses: 128,
      maxTotalArgumentBytes: 1024 * 1024,
      maxStdinBytes: 1024 * 1024,
      maxStdoutBytes: 64 * 1024 * 1024,
      maxStderrBytes: 2 * 1024 * 1024,
      maxRecords: 250_000,
      maxRootObservedBytes: 256 * 1024 * 1024,
      maxReopenRefreshes: 10_000,
      maxSettlementAttempts: 128,
      maxCommandStdoutBytes: 32 * 1024 * 1024,
      maxCommandStderrBytes: 512 * 1024,
      maxExecutableBytes: 64 * 1024 * 1024
    }
  }, async (session) => {
    const sourceCommit = assertGitObjectId(
      await gitText(session, ['rev-parse', '--verify', 'HEAD^{commit}'], 'git rev-parse release commit'),
      'Release source Git commit identity'
    );
    await assertTrackedWorktreeMatchesCommit(session, sourceCommit);
    const sourceTree = assertGitObjectId(
      await gitText(session, ['rev-parse', '--verify', `${sourceCommit}^{tree}`], 'git rev-parse release tree'),
      'Release source Git tree identity'
    );
    const entries = await parseGitTree(session, sourceCommit);

    const stageRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-source-'));
    const sourceRoot = path.join(stageRoot, 'source');
    try {
      await fs.mkdir(sourceRoot);
      const sourceMetadata = await fs.lstat(sourceRoot);
      if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
        throw new Error('Release source root is not one ordinary directory');
      }
      const physicalSourceRoot = path.resolve(await fs.realpath(sourceRoot));
      for (const batch of chunkEntries(entries)) {
        const blobs = await readBlobBatch(session, batch);
        for (const entry of batch) {
          const bytes = blobs.get(entry.objectId);
          if (bytes === undefined) throw new Error(`Release source blob bytes are absent for ${entry.path}`);
          await materializeEntry(sourceRoot, physicalSourceRoot, entry, bytes);
        }
      }
      return Object.freeze({
        schema: 'sec-exact-release-git-tree-v1' as const,
        root: sourceRoot,
        stageRoot,
        sourceCommit,
        sourceTree,
        fileCount: entries.length
      });
    } catch (error) {
      try {
        await fs.rm(stageRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Exact release Git tree materialization failed and staging cleanup did not converge: ${stageRoot}`
        );
      }
      throw error;
    }
  });
}
