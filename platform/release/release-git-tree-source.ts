import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/v1\n', 'utf8');
const RELEASE_GIT_BLOB_BATCH_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_GIT_BLOB_BATCH_MAX_ITEMS = 1024;
const AMBIENT_GIT_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_ATTR_SOURCE',
  'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'
] as const;

interface ReleaseGitBlobEntryV1 {
  readonly mode: '100644' | '100755';
  readonly objectId: string;
  readonly byteSize: number;
  readonly path: string;
}

export interface ExactReleaseGitTreeV1 {
  readonly schema: 'sec-exact-release-git-tree-v1';
  readonly root: string;
  readonly stageRoot: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly fileCount: number;
}

interface CommandResult {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly error: Error | undefined;
}

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of AMBIENT_GIT_ENV_KEYS) delete env[key];
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) delete env[key];
  }
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  env.GIT_CONFIG_NOSYSTEM = '1';
  return env;
}

function command(
  cwd: string,
  executable: string,
  args: readonly string[],
  input?: Buffer,
  maxBuffer = 256 * 1024 * 1024,
  env?: NodeJS.ProcessEnv
): CommandResult {
  const result = spawnSync(executable, [...args], {
    cwd,
    encoding: 'buffer',
    input,
    maxBuffer,
    windowsHide: true,
    env
  });
  return Object.freeze({
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? Buffer.from(result.stdout) : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr) ? Buffer.from(result.stderr) : Buffer.from(String(result.stderr ?? '')),
    error: result.error
  });
}

function commandBytes(
  cwd: string,
  executable: string,
  args: readonly string[],
  options: Readonly<{ input?: Buffer; maxBuffer?: number; env?: NodeJS.ProcessEnv; label?: string }> = {}
): Buffer {
  const result = command(cwd, executable, args, options.input, options.maxBuffer, options.env);
  if (result.error || result.status !== 0) {
    const detail = result.stderr.toString('utf8').trim();
    const label = options.label ?? `${executable} ${args[0] ?? ''}`;
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`, { cause: result.error });
  }
  return result.stdout;
}

function gitBytes(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{ input?: Buffer; maxBuffer?: number; label?: string }> = {}
): Buffer {
  return commandBytes(repositoryRoot, 'git', args, { ...options, env: isolatedGitEnvironment() });
}

function exactUtf8(bytes: Buffer, label: string): string {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label} contains non-UTF-8 bytes`);
  return text;
}

function gitText(repositoryRoot: string, args: readonly string[], label: string): string {
  return exactUtf8(gitBytes(repositoryRoot, args, { maxBuffer: 16 * 1024 * 1024, label }), label).trim();
}

function assertGitObjectId(value: string, label: string): string {
  if (!GIT_OBJECT_ID_PATTERN.test(value)) throw new Error(`${label} is not one full SHA-1/SHA-256 Git object ID`);
  return value;
}

function assertTrackedWorktreeMatchesCommit(repositoryRoot: string, sourceCommit: string): void {
  const result = command(
    repositoryRoot,
    'git',
    ['diff', '--quiet', '--no-ext-diff', '--no-textconv', sourceCommit, '--'],
    undefined,
    16 * 1024 * 1024,
    isolatedGitEnvironment()
  );
  if (result.error) throw new Error('Release tracked worktree comparison could not start', { cause: result.error });
  if (result.status === 1) throw new Error('Release tracked worktree/index differs from captured source commit');
  if (result.status !== 0) {
    const detail = result.stderr.toString('utf8').trim();
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

function parseGitTree(repositoryRoot: string, sourceCommit: string): readonly ReleaseGitBlobEntryV1[] {
  const output = gitBytes(
    repositoryRoot,
    ['ls-tree', '-r', '-z', '--full-tree', '-l', sourceCommit],
    { maxBuffer: 128 * 1024 * 1024, label: 'git ls-tree release source' }
  );
  if (output.byteLength === 0) return Object.freeze([]);
  if (output[output.byteLength - 1] !== 0) throw new Error('Release source Git tree did not return NUL-terminated records');
  const payload = output.subarray(0, -1);
  const decoded = exactUtf8(payload, 'Release source Git tree');
  if (!Buffer.from(`${decoded}\0`, 'utf8').equals(output)) {
    throw new Error('Release source Git tree returned an invalid NUL-delimited payload');
  }

  const entries: ReleaseGitBlobEntryV1[] = [];
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
    entries.push(Object.freeze({
      mode,
      objectId: assertGitObjectId(match[3]!, `Release source blob ${filePath}`),
      byteSize,
      path: filePath
    }));
  }
  return Object.freeze(entries);
}

function chunkEntries(entries: readonly ReleaseGitBlobEntryV1[]): readonly (readonly ReleaseGitBlobEntryV1[])[] {
  const batches: ReleaseGitBlobEntryV1[][] = [];
  let current: ReleaseGitBlobEntryV1[] = [];
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

function readBlobBatch(
  repositoryRoot: string,
  entries: readonly ReleaseGitBlobEntryV1[]
): ReadonlyMap<string, Buffer> {
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

  const objectIds = [...expectedSizes.keys()];
  const output = gitBytes(
    repositoryRoot,
    ['cat-file', '--batch'],
    { input: Buffer.from(`${objectIds.join('\n')}\n`, 'ascii'), maxBuffer, label: 'git cat-file release source' }
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
  entry: ReleaseGitBlobEntryV1,
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

export async function materializeExactReleaseGitTreeV1(repositoryRoot: string): Promise<ExactReleaseGitTreeV1> {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const sourceCommit = assertGitObjectId(
    gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], 'git rev-parse release commit'),
    'Release source Git commit identity'
  );
  assertTrackedWorktreeMatchesCommit(absoluteRepositoryRoot, sourceCommit);
  const sourceTree = assertGitObjectId(
    gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', `${sourceCommit}^{tree}`], 'git rev-parse release tree'),
    'Release source Git tree identity'
  );
  const entries = parseGitTree(absoluteRepositoryRoot, sourceCommit);

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
      const blobs = readBlobBatch(absoluteRepositoryRoot, batch);
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
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
