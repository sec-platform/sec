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
  readonly path: string;
}

export interface GitTextAttributes {
  readonly textAttr: 'set' | 'unset' | 'unspecified';
  readonly eolAttr: 'lf' | 'crlf' | 'unspecified';
}

const GIT_OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

export function runGitRead(
  repositoryRoot: string,
  args: readonly string[],
  options: Readonly<{ input?: Buffer; maxBuffer?: number }> = {}
): GitReadResult {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    windowsHide: true
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
  options: Readonly<{ input?: Buffer; maxBuffer?: number; label?: string }> = {}
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
  options: Readonly<{ input?: Buffer; maxBuffer?: number; label?: string }> = {}
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
      ['ls-tree', '-r', '-z', '--full-tree', exactCommit],
      { maxBuffer: 128 * 1024 * 1024, label: 'git ls-tree' }
    ),
    'git ls-tree'
  );
  const entries: GitTreeBlobEntry[] = [];
  for (const field of fields) {
    const separator = field.indexOf('\t');
    const header = separator < 0 ? '' : field.slice(0, separator);
    const filePath = separator < 0 ? '' : field.slice(separator + 1);
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/u.exec(header);
    if (!match || filePath.length === 0) {
      throw new Error('git ls-tree returned an invalid record');
    }
    if (match[2] !== 'blob') continue;
    entries.push(Object.freeze({
      mode: match[1]!,
      objectId: match[3]!,
      path: filePath
    }));
  }
  return Object.freeze(entries);
}

export function readBlobBatch(
  repositoryRoot: string,
  objectIds: readonly string[]
): ReadonlyMap<string, Buffer> {
  if (objectIds.length === 0) return new Map();
  for (const objectId of objectIds) assertGitObjectId(objectId, 'Git blob object ID');
  const output = gitReadBytes(
    repositoryRoot,
    ['cat-file', '--batch'],
    {
      input: Buffer.from(`${objectIds.join('\n')}\n`, 'ascii'),
      maxBuffer: 512 * 1024 * 1024,
      label: 'git cat-file --batch'
    }
  );
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const requestedId of objectIds) {
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

function parseTextAttribute(value: string): GitTextAttributes['textAttr'] {
  if (value === 'set') return 'set';
  if (value === 'unset') return 'unset';
  if (value === 'unspecified') return 'unspecified';
  throw new Error(`git check-attr returned unsupported text value "${value}"`);
}

function parseEolAttribute(value: string): GitTextAttributes['eolAttr'] {
  if (value === 'lf' || value === 'crlf') return value;
  if (value === 'unspecified') return 'unspecified';
  throw new Error(`git check-attr returned unsupported eol value "${value}"`);
}

export function readTextAttributesBatch(
  repositoryRoot: string,
  sourceCommit: string,
  paths: readonly string[]
): ReadonlyMap<string, GitTextAttributes> {
  if (paths.length === 0) return new Map();
  const exactCommit = assertGitObjectId(sourceCommit, 'Attribute source commit');
  for (const filePath of paths) {
    if (filePath.length === 0 || filePath.includes('\0')) {
      throw new Error('Attribute input contains an invalid path');
    }
  }
  const input = Buffer.from(`${paths.join('\0')}\0`, 'utf8');
  const fields = parseNulUtf8(
    gitReadBytes(
      repositoryRoot,
      ['check-attr', '-z', '--stdin', '--source', exactCommit, 'text', 'eol'],
      { input, maxBuffer: 128 * 1024 * 1024, label: 'git check-attr' }
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
