import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface GitReadResult {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly error: Error | undefined;
}

export interface GitTreeBlobEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly byteSize: number;
  readonly path: string;
}

export interface GitTextAttributes {
  readonly textAttr: 'set' | 'unset' | 'unspecified';
  readonly eolAttr: 'lf' | 'crlf' | 'unspecified';
}

export interface GitBlobBatchLimits {
  readonly maxBytes: number;
  readonly maxItems: number;
}

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const GIT_REPOSITORY_REDIRECTION_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM'
] as const;

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be one positive safe integer`);
  }
  return value;
}

function isolatedGitEnvironment(
  overrides: Readonly<Record<string, string>> | undefined
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of GIT_REPOSITORY_REDIRECTION_ENV_KEYS) delete env[key];
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  for (const [key, value] of Object.entries(overrides ?? {})) env[key] = value;
  return env;
}

export function runGitRead(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    env?: Readonly<Record<string, string>>;
  }> = {}
): GitReadResult {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    windowsHide: true,
    env: isolatedGitEnvironment(options.env)
  });
  return Object.freeze({
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout)
      ? Buffer.from(result.stdout)
      : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? Buffer.from(result.stderr)
      : Buffer.from(String(result.stderr ?? '')),
    error: result.error
  });
}

export function gitReadBytes(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    label?: string;
    env?: Readonly<Record<string, string>>;
  }> = {}
): Buffer {
  const result = runGitRead(repositoryRoot, args, options);
  if (result.error || result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    const label = options.label ?? `git ${args[0] ?? 'command'}`;
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ''}`, {
      cause: result.error
    });
  }
  return result.stdout;
}

export function decodeExactUtf8(bytes: Buffer, label: string): string {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) {
    throw new Error(`${label} returned non-UTF-8 bytes`);
  }
  return value;
}

export function gitReadText(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{
    input?: Buffer;
    maxBuffer?: number;
    label?: string;
    env?: Readonly<Record<string, string>>;
  }> = {}
): string {
  return decodeExactUtf8(gitReadBytes(repositoryRoot, args, options), options.label ?? 'Git output');
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
    gitReadText(
      repositoryRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      { maxBuffer: 1024 * 1024, label: 'git rev-parse HEAD' }
    ).trim(),
    'HEAD commit'
  );
}

export function readCommitBlobInventory(
  repositoryRoot: string,
  commit: string
): readonly GitTreeBlobEntry[] {
  const exactCommit = assertGitObjectId(commit, 'Git inventory commit');
  const fields = parseNulUtf8(
    gitReadBytes(
      repositoryRoot,
      ['ls-tree', '-r', '-z', '--full-tree', '-l', exactCommit],
      { maxBuffer: 128 * 1024 * 1024, label: 'git ls-tree' }
    ),
    'git ls-tree'
  );
  const entries: GitTreeBlobEntry[] = [];
  for (const field of fields) {
    const separator = field.indexOf('\t');
    const header = separator < 0 ? '' : field.slice(0, separator);
    const filePath = separator < 0 ? '' : field.slice(separator + 1);
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}(?:[0-9a-f]{24})?) +([0-9]+|-)$/u.exec(header);
    if (!match || filePath.length === 0) {
      throw new Error('git ls-tree returned an invalid record');
    }
    if (match[2] !== 'blob') continue;
    const byteSize = Number(match[4]);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new Error(`git ls-tree returned an invalid blob size for ${filePath}`);
    }
    entries.push(Object.freeze({
      mode: match[1]!,
      objectId: match[3]!,
      byteSize,
      path: filePath
    }));
  }
  return Object.freeze(entries);
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
  const output = gitReadBytes(
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

function parseTextAttribute(value: string): GitTextAttributes['textAttr'] {
  if (value === 'set') return 'set';
  if (value === 'unset') return 'unset';
  return 'unspecified';
}

function parseEolAttribute(value: string): GitTextAttributes['eolAttr'] {
  if (value === 'lf' || value === 'crlf') return value;
  return 'unspecified';
}

interface IsolatedAttributeReader {
  readonly read: (paths: readonly string[]) => ReadonlyMap<string, GitTextAttributes>;
  readonly dispose: () => void;
}

function createIsolatedAttributeReader(
  repositoryRoot: string,
  sourceCommit: string
): IsolatedAttributeReader {
  const exactCommit = assertGitObjectId(sourceCommit, 'Attribute source commit');
  const gitObjectsPath = gitReadText(
    repositoryRoot,
    ['rev-parse', '--git-path', 'objects'],
    { maxBuffer: 1024 * 1024, label: 'git object directory' }
  ).trim();
  if (gitObjectsPath.length === 0) {
    throw new Error('Git object directory could not be resolved');
  }
  const objectDirectory = path.isAbsolute(gitObjectsPath)
    ? path.resolve(gitObjectsPath)
    : path.resolve(repositoryRoot, gitObjectsPath);
  const shadowGitDir = mkdtempSync(path.join(tmpdir(), 'sec-git-attributes-'));
  try {
    mkdirSync(path.join(shadowGitDir, 'refs'), { recursive: true });
    mkdirSync(path.join(shadowGitDir, 'info'), { recursive: true });
    writeFileSync(path.join(shadowGitDir, 'HEAD'), 'ref: refs/heads/sec-attribute-source\n', 'utf8');
    writeFileSync(
      path.join(shadowGitDir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tbare = true\n',
      'utf8'
    );
  } catch (error) {
    rmSync(shadowGitDir, { recursive: true, force: true });
    throw error;
  }

  const env = Object.freeze({
    GIT_DIR: shadowGitDir,
    GIT_COMMON_DIR: shadowGitDir,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_NOSYSTEM: '1'
  });

  const read = (paths: readonly string[]): ReadonlyMap<string, GitTextAttributes> => {
    if (paths.length === 0) return new Map();
    for (const filePath of paths) {
      if (filePath.length === 0 || filePath.includes('\0')) {
        throw new Error('Attribute input contains an invalid path');
      }
    }
    const input = Buffer.from(`${paths.join('\0')}\0`, 'utf8');
    const fields = parseNulUtf8(
      gitReadBytes(
        repositoryRoot,
        ['-c', 'core.attributesFile=', 'check-attr', '-z', '--stdin', '--source', exactCommit, 'text', 'eol'],
        {
          input,
          maxBuffer: Math.max(1024 * 1024, input.byteLength * 8 + 1024 * 1024),
          label: 'git check-attr',
          env
        }
      ),
      'git check-attr'
    );
    if (fields.length !== paths.length * 6) {
      throw new Error('git check-attr returned an unexpected attribute record count');
    }
    const attributes = new Map<string, GitTextAttributes>();
    for (let index = 0; index < fields.length; index += 6) {
      const expectedPath = paths[index / 6]!;
      const pathA = fields[index]!;
      const attrA = fields[index + 1]!;
      const valueA = fields[index + 2]!;
      const pathB = fields[index + 3]!;
      const attrB = fields[index + 4]!;
      const valueB = fields[index + 5]!;
      if (pathA !== expectedPath || pathB !== expectedPath || attrA !== 'text' || attrB !== 'eol') {
        throw new Error(`git check-attr returned an unexpected record order for ${expectedPath}`);
      }
      attributes.set(expectedPath, Object.freeze({
        textAttr: parseTextAttribute(valueA),
        eolAttr: parseEolAttribute(valueB)
      }));
    }
    return attributes;
  };

  return Object.freeze({
    read,
    dispose: () => rmSync(shadowGitDir, { recursive: true, force: true })
  });
}

export function withIsolatedTextAttributeReader<Value>(
  repositoryRoot: string,
  sourceCommit: string,
  execute: (readBatch: (paths: readonly string[]) => ReadonlyMap<string, GitTextAttributes>) => Value
): Value {
  const reader = createIsolatedAttributeReader(repositoryRoot, sourceCommit);
  try {
    return execute(reader.read);
  } finally {
    reader.dispose();
  }
}

export function readTextAttributesBatch(
  repositoryRoot: string,
  sourceCommit: string,
  paths: readonly string[]
): ReadonlyMap<string, GitTextAttributes> {
  return withIsolatedTextAttributeReader(repositoryRoot, sourceCommit, (readBatch) => readBatch(paths));
}

export function readOptionalGitConfig(repositoryRoot: string, key: string): string {
  const result = runGitRead(repositoryRoot, ['config', '--get', key], { maxBuffer: 1024 * 1024 });
  if (result.error) {
    throw new Error(`git config ${key} could not start`, { cause: result.error });
  }
  if (result.status === 1 && result.stdout.byteLength === 0) return '<unset>';
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(`git config ${key} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return decodeExactUtf8(result.stdout, `git config ${key}`).trim();
}
