import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import prettier, { type Options } from 'prettier';

import { createConcurrencyLimit } from '../shared/concurrency.ts';
import { compilerRoot } from '../shared/paths.ts';
import { resolveCandidateImportBase } from './import-organizer.ts';

type FormatterEnvironment = Record<string, string | undefined>;
type FileHandle = Awaited<ReturnType<typeof fs.open>>;
type NamedFileStats = Awaited<ReturnType<typeof fs.lstat>>;
type OpenedFileStats = Awaited<ReturnType<FileHandle['stat']>>;

type GitIndexEntry = {
  readonly mode: string;
  readonly objectId: string;
  readonly stage: number;
  readonly path: string;
};

type FormattedIndexUpdate = {
  readonly entry: GitIndexEntry;
  readonly originalBytes: Buffer;
  readonly formattedBytes: Buffer;
  readonly formattedObjectId: string;
};

type RepositoryFileBinding = {
  readonly absolutePath: string;
  readonly realPath: string;
  readonly named: NamedFileStats;
};

type OpenRepositoryFile = {
  readonly handle: FileHandle;
  readonly realPath: string;
};

export type FormatterTestHooks = {
  readonly afterIndexLock?: () => void | Promise<void>;
  readonly beforeWorkingTreeWrite?: (filePath: string) => void | Promise<void>;
};

const FORMAT_EXACT_EXCLUSIONS = new Set(['bun.lock']);
const FORMAT_PREFIX_EXCLUSIONS = [
  '.shared-deps/',
  '.tmp/',
  'dist/',
  'docs/archive/',
  'docs/evidence/',
  'node_modules/',
  'report/',
  'tests/fixtures/'
] as const;

const FORMATTER_SCHEMA = 'https://json.schemastore.org/prettierrc';
const FORMATTER_CONFIG_KEYS = [
  '$schema',
  'arrowParens',
  'bracketSpacing',
  'endOfLine',
  'printWidth',
  'semi',
  'singleQuote',
  'tabWidth',
  'trailingComma',
  'useTabs'
] as const;

function gitFailure(args: readonly string[], stderr: Buffer | string | null): Error {
  const detail = stderr === null ? '' : Buffer.from(stderr).toString('utf8').trim();
  return new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
}

function gitBytes(
  projectRoot: string,
  args: readonly string[],
  input?: Buffer,
  env: NodeJS.ProcessEnv = process.env
): Buffer {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'buffer',
    env,
    input,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) throw gitFailure(args, result.stderr);
  return Buffer.from(result.stdout);
}

function gitText(projectRoot: string, args: readonly string[], input?: Buffer): string {
  return gitBytes(projectRoot, args, input).toString('utf8');
}

function nulFields(bytes: Buffer, source: string): string[] {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new Error(`${source} did not return NUL-terminated records.`);
  }
  const text = bytes.subarray(0, -1).toString('utf8');
  if (!Buffer.from(`${text}\0`, 'utf8').equals(bytes)) {
    throw new Error(`${source} returned a non-UTF-8 path.`);
  }
  return text.split('\0');
}

function canonicalRepositoryPath(value: string): string {
  if (
    value.length === 0
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`Formatter path is not canonical repository-relative POSIX: ${value}`);
  }
  return value;
}

function absoluteRepositoryPath(projectRoot: string, gitPath: string): string {
  canonicalRepositoryPath(gitPath);
  const absolute = path.resolve(projectRoot, ...gitPath.split('/'));
  const relative = path.relative(path.resolve(projectRoot), absolute);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Formatter path escaped the repository: ${gitPath}`);
  }
  return absolute;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameResolvedPath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparablePath(root), comparablePath(candidate));
  return relative.length > 0
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
}

function sameFileIdentity(
  left: Pick<NamedFileStats, 'dev' | 'ino'>,
  right: Pick<OpenedFileStats, 'dev' | 'ino'>
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function resolveRepositoryRoot(projectRoot: string): Promise<string> {
  const named = await fs.lstat(projectRoot);
  if (!named.isDirectory() || named.isSymbolicLink()) {
    throw new Error('Formatter repository root must be one real directory, not a symlink or reparse alias.');
  }
  const real = await fs.realpath(projectRoot);
  const resolved = path.resolve(projectRoot);
  if (!sameResolvedPath(real, resolved)) {
    throw new Error('Formatter repository root real path does not match its configured path.');
  }
  return real;
}

async function resolveRepositoryFileBinding(
  projectRoot: string,
  repositoryPath: string
): Promise<RepositoryFileBinding | null> {
  canonicalRepositoryPath(repositoryPath);
  const rootRealPath = await resolveRepositoryRoot(projectRoot);
  const segments = repositoryPath.split('/');
  let current = rootRealPath;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const ancestor = await fs.lstat(current);
    if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) {
      throw new Error(`Formatter ancestor is not one real repository directory: ${repositoryPath}`);
    }
  }

  const absolutePath = path.join(rootRealPath, ...segments);
  let named: NamedFileStats;
  try {
    named = await fs.lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1) {
    throw new Error(`Formatter target is not one unaliased regular repository file: ${repositoryPath}`);
  }
  const realPath = await fs.realpath(absolutePath);
  const expectedRealPath = path.resolve(rootRealPath, ...segments);
  if (!pathInside(rootRealPath, realPath) || !sameResolvedPath(realPath, expectedRealPath)) {
    throw new Error(`Formatter target resolved outside its repository identity: ${repositoryPath}`);
  }
  return Object.freeze({ absolutePath, realPath, named });
}

async function openRegularRepositoryFile(
  projectRoot: string,
  repositoryPath: string
): Promise<OpenRepositoryFile | null> {
  const before = await resolveRepositoryFileBinding(projectRoot, repositoryPath);
  if (before === null) return null;
  const handle = await fs.open(before.absolutePath, 'r+');
  try {
    const opened = await handle.stat();
    const after = await resolveRepositoryFileBinding(projectRoot, repositoryPath);
    if (
      after === null
      || !opened.isFile()
      || opened.nlink !== 1
      || !sameFileIdentity(before.named, opened)
      || !sameFileIdentity(after.named, opened)
      || !sameResolvedPath(before.realPath, after.realPath)
    ) {
      throw new Error(`Formatter target identity changed before open: ${repositoryPath}`);
    }
    return Object.freeze({ handle, realPath: after.realPath });
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function assertPathStillNamesHandle(
  projectRoot: string,
  repositoryPath: string,
  openedFile: OpenRepositoryFile
): Promise<void> {
  const [binding, opened] = await Promise.all([
    resolveRepositoryFileBinding(projectRoot, repositoryPath),
    openedFile.handle.stat()
  ]);
  if (
    binding === null
    || !opened.isFile()
    || opened.nlink !== 1
    || !sameFileIdentity(binding.named, opened)
    || !sameResolvedPath(binding.realPath, openedFile.realPath)
  ) {
    throw new Error(`Formatter target identity changed before write: ${repositoryPath}`);
  }
}

export function isFormattingPathEligible(filePath: string): boolean {
  canonicalRepositoryPath(filePath);
  return !FORMAT_EXACT_EXCLUSIONS.has(filePath)
    && !FORMAT_PREFIX_EXCLUSIONS.some((prefix) => filePath.startsWith(prefix));
}

function pathsFromPorcelain(bytes: Buffer): readonly string[] {
  const fields = nulFields(bytes, 'git status --porcelain=v1');
  const targets = new Set<string>();
  for (let index = 0; index < fields.length;) {
    const entry = fields[index++];
    if (entry.length < 3) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const filePath = canonicalRepositoryPath(entry.slice(3));
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      if (index >= fields.length) throw new Error('git status returned an incomplete rename record.');
      index++;
    }
    if (
      (x === '?' && y === '?')
      || x === 'A' || x === 'C' || x === 'M' || x === 'R'
      || y === 'A' || y === 'C' || y === 'M' || y === 'R'
    ) targets.add(filePath);
  }
  return Object.freeze([...targets].sort());
}

function changedPathsBetween(projectRoot: string, left: string, right?: string): readonly string[] {
  const args = [
    'diff',
    ...(right === undefined ? ['--cached', left] : [left, right]),
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
    '--find-renames',
    '--'
  ];
  return Object.freeze(nulFields(gitBytes(projectRoot, args), `git ${args.join(' ')}`)
    .map(canonicalRepositoryPath)
    .sort());
}

export function workingTreeFormattingTargets(
  projectRoot = compilerRoot,
  env: FormatterEnvironment = process.env
): readonly string[] {
  const candidateBase = resolveCandidateImportBase(projectRoot, env);
  const targets = new Set(changedPathsBetween(projectRoot, candidateBase, 'HEAD'));
  for (const target of pathsFromPorcelain(
    gitBytes(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )) targets.add(target);
  return Object.freeze([...targets].filter(isFormattingPathEligible).sort());
}

export function candidateFormattingTargets(
  projectRoot = compilerRoot,
  env: FormatterEnvironment = process.env
): readonly string[] {
  const candidateBase = resolveCandidateImportBase(projectRoot, env);
  return Object.freeze(changedPathsBetween(projectRoot, candidateBase, 'HEAD')
    .filter(isFormattingPathEligible));
}

export function stagedFormattingTargets(
  projectRoot = compilerRoot,
  env: FormatterEnvironment = process.env
): readonly string[] {
  const candidateBase = resolveCandidateImportBase(projectRoot, env);
  return Object.freeze(changedPathsBetween(projectRoot, candidateBase)
    .filter(isFormattingPathEligible));
}

function decodeUtf8(bytes: Buffer, source: string): string {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${source} is not valid UTF-8.`);
  if (text.includes('\0')) throw new Error(`${source} contains a NUL byte.`);
  return text;
}

function exactObjectKeys(value: Record<string, unknown>, source: string): void {
  const actual = Object.keys(value).sort();
  if (
    actual.length !== FORMATTER_CONFIG_KEYS.length
    || actual.some((key, index) => key !== FORMATTER_CONFIG_KEYS[index])
  ) {
    throw new Error(`${source} contains unsupported or missing formatter options.`);
  }
}

function boundedInteger(value: unknown, source: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${source} must be an integer in [${minimum}, ${maximum}].`);
  }
  return value as number;
}

function booleanOption(value: unknown, source: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${source} must be boolean.`);
  return value;
}

function enumOption<T extends string>(
  value: unknown,
  allowed: readonly T[],
  source: string
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${source} is not an allowed formatter value.`);
  }
  return value as T;
}

export function parseFormatterConfig(bytes: Buffer, source: string): Options {
  const text = decodeUtf8(bytes, source);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain one JSON object.`);
  }
  const record = value as Record<string, unknown>;
  exactObjectKeys(record, source);
  if (record.$schema !== FORMATTER_SCHEMA) {
    throw new Error(`${source} must use the pinned formatter schema identity.`);
  }
  return Object.freeze({
    arrowParens: enumOption(record.arrowParens, ['always', 'avoid'] as const, `${source}.arrowParens`),
    bracketSpacing: booleanOption(record.bracketSpacing, `${source}.bracketSpacing`),
    endOfLine: enumOption(record.endOfLine, ['lf'] as const, `${source}.endOfLine`),
    printWidth: boundedInteger(record.printWidth, `${source}.printWidth`, 40, 400),
    semi: booleanOption(record.semi, `${source}.semi`),
    singleQuote: booleanOption(record.singleQuote, `${source}.singleQuote`),
    tabWidth: boundedInteger(record.tabWidth, `${source}.tabWidth`, 1, 16),
    trailingComma: enumOption(record.trailingComma, ['all', 'es5', 'none'] as const, `${source}.trailingComma`),
    useTabs: booleanOption(record.useTabs, `${source}.useTabs`)
  });
}

async function formatBytes(
  bytes: Buffer,
  repositoryPath: string,
  config: Options
): Promise<Buffer | null> {
  const info = await prettier.getFileInfo(repositoryPath, {
    ignorePath: [],
    plugins: [],
    resolveConfig: false,
    withNodeModules: false
  });
  if (info.inferredParser === null) return null;
  const source = decodeUtf8(bytes, repositoryPath);
  const formatted = await prettier.format(source, {
    ...config,
    filepath: repositoryPath,
    parser: info.inferredParser,
    plugins: []
  });
  return Buffer.from(formatted, 'utf8');
}

async function readWorkingTreeConfig(projectRoot: string): Promise<Options> {
  const openedFile = await openRegularRepositoryFile(projectRoot, '.prettierrc.json');
  if (openedFile === null) throw new Error('Working-tree .prettierrc.json is unavailable.');
  try {
    return parseFormatterConfig(
      await readHandleBytes(openedFile.handle),
      'Working-tree .prettierrc.json'
    );
  } finally {
    await openedFile.handle.close();
  }
}

async function readHandleBytes(handle: FileHandle): Promise<Buffer> {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error('Formatter target is not one unaliased regular file.');
  }
  const bytes = Buffer.alloc(metadata.size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesRead === 0) throw new Error('Formatter target changed while being read.');
    offset += bytesRead;
  }
  return bytes;
}

async function replaceHandleBytes(handle: FileHandle, bytes: Buffer): Promise<void> {
  await handle.truncate(0);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten === 0) throw new Error('Formatter target write made no progress.');
    offset += bytesWritten;
  }
  await handle.sync();
}

async function formatWorkingTreeFile(
  projectRoot: string,
  repositoryPath: string,
  config: Options
): Promise<boolean> {
  const openedFile = await openRegularRepositoryFile(projectRoot, repositoryPath);
  if (openedFile === null) return false;
  try {
    const original = await readHandleBytes(openedFile.handle);
    const formatted = await formatBytes(original, repositoryPath, config);
    if (formatted === null || formatted.equals(original)) return false;
    await assertPathStillNamesHandle(projectRoot, repositoryPath, openedFile);
    await replaceHandleBytes(openedFile.handle, formatted);
    return true;
  } finally {
    await openedFile.handle.close();
  }
}

export async function runFormatPreparation(projectRoot = compilerRoot): Promise<number> {
  try {
    const targets = workingTreeFormattingTargets(projectRoot);
    if (targets.length === 0) {
      console.log('No changed formatting targets selected.');
      return 0;
    }
    const config = await readWorkingTreeConfig(projectRoot);
    const limit = createConcurrencyLimit(10);
    const changed = (await Promise.all(targets.map((repositoryPath) => limit(
      async () => await formatWorkingTreeFile(projectRoot, repositoryPath, config)
        ? repositoryPath
        : null
    )))).filter((repositoryPath): repositoryPath is string => repositoryPath !== null);
    console.log(changed.length === 0
      ? `Formatting already converged for ${targets.length} changed file(s).`
      : `Formatted ${changed.length} of ${targets.length} changed file(s).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readIndexEntries(projectRoot: string): readonly GitIndexEntry[] {
  return Object.freeze(nulFields(
    gitBytes(projectRoot, ['ls-files', '--stage', '-z']),
    'git ls-files --stage'
  ).map((record) => {
    const separator = record.indexOf('\t');
    const header = separator < 0 ? '' : record.slice(0, separator);
    const repositoryPath = separator < 0 ? '' : canonicalRepositoryPath(record.slice(separator + 1));
    const match = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])$/u.exec(header);
    if (!match || repositoryPath.length === 0) {
      throw new Error('git ls-files --stage returned an invalid index record.');
    }
    return Object.freeze({
      mode: match[1]!,
      objectId: match[2]!,
      stage: Number(match[3]),
      path: repositoryPath
    });
  }));
}

function selectOrdinaryEntries(
  entries: readonly GitIndexEntry[],
  targetPaths: readonly string[]
): readonly GitIndexEntry[] {
  const unresolved = entries.find((entry) => entry.stage !== 0 && targetPaths.includes(entry.path));
  if (unresolved) throw new Error(`Cannot format unresolved Git index stages: ${unresolved.path}`);
  return Object.freeze(targetPaths.map((targetPath) => {
    const matches = entries.filter((entry) => entry.path === targetPath);
    if (matches.length !== 1 || matches[0]!.stage !== 0) {
      throw new Error(`Formatting index entry is unavailable or ambiguous: ${targetPath}`);
    }
    const entry = matches[0]!;
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      throw new Error(`Formatting index entry is not an ordinary file: ${targetPath}`);
    }
    return entry;
  }));
}

function readBlobs(
  projectRoot: string,
  entries: readonly GitIndexEntry[]
): ReadonlyMap<string, Buffer> {
  if (entries.length === 0) return new Map();
  const input = Buffer.from(`${entries.map((entry) => entry.objectId).join('\n')}\n`, 'utf8');
  const output = gitBytes(projectRoot, ['cat-file', '--batch'], input);
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error('git cat-file --batch returned an incomplete header.');
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]{40,64}) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== entry.objectId) {
      throw new Error(`git cat-file --batch returned an invalid header for ${entry.path}.`);
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`git cat-file --batch returned an invalid blob length for ${entry.path}.`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + byteLength;
    if (contentEnd >= output.byteLength || output[contentEnd] !== 0x0a) {
      throw new Error(`git cat-file --batch returned incomplete blob bytes for ${entry.path}.`);
    }
    blobs.set(entry.path, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== output.byteLength) throw new Error('git cat-file --batch returned trailing bytes.');
  return blobs;
}

function indexConfig(projectRoot: string, entries: readonly GitIndexEntry[]): Options {
  const configEntry = entries.find((entry) => entry.path === '.prettierrc.json' && entry.stage === 0);
  if (!configEntry) throw new Error('Git index does not contain .prettierrc.json.');
  const bytes = readBlobs(projectRoot, [configEntry]).get(configEntry.path);
  if (!bytes) throw new Error('Git index formatter configuration blob was not loaded.');
  return parseFormatterConfig(bytes, 'Git index .prettierrc.json');
}

function assertIndexUnchanged(
  projectRoot: string,
  targets: readonly string[],
  expectedEntries: readonly GitIndexEntry[],
  env: FormatterEnvironment
): void {
  const currentTargets = stagedFormattingTargets(projectRoot, env);
  if (JSON.stringify(currentTargets) !== JSON.stringify(targets)) {
    throw new Error('Git index changed while formatting the candidate.');
  }
  const currentEntries = selectOrdinaryEntries(readIndexEntries(projectRoot), targets);
  if (JSON.stringify(currentEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error('Git index entries changed while formatting the candidate.');
  }
}

async function publishIndexUpdates(
  projectRoot: string,
  targets: readonly string[],
  entries: readonly GitIndexEntry[],
  updates: readonly FormattedIndexUpdate[],
  env: FormatterEnvironment,
  hooks: FormatterTestHooks
): Promise<void> {
  const configuredIndexPath = gitText(projectRoot, ['rev-parse', '--git-path', 'index']).trim();
  if (configuredIndexPath.length === 0) throw new Error('Git index path is unavailable.');
  const indexPath = path.isAbsolute(configuredIndexPath)
    ? path.resolve(configuredIndexPath)
    : path.resolve(projectRoot, configuredIndexPath);
  const lockPath = `${indexPath}.lock`;
  const alternateIndexPath = `${indexPath}.format-${process.pid}-${randomUUID()}`;
  const alternateLockPath = `${alternateIndexPath}.lock`;
  const metadata = await fs.stat(indexPath);
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error('Git index is not one unaliased regular file.');
  }

  let lock: FileHandle | null = null;
  let ownsLock = false;
  let published = false;
  try {
    try {
      lock = await fs.open(lockPath, 'wx', metadata.mode & 0o777);
      ownsLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Git index is locked; formatting was not published.');
      }
      throw error;
    }
    await hooks.afterIndexLock?.();
    assertIndexUnchanged(projectRoot, targets, entries, env);
    await fs.writeFile(alternateIndexPath, await fs.readFile(indexPath), {
      flag: 'wx',
      mode: metadata.mode & 0o777
    });
    const indexInfo = Buffer.from(updates
      .map((update) => `${update.entry.mode} ${update.formattedObjectId} 0\t${update.entry.path}\0`)
      .join(''), 'utf8');
    gitBytes(
      projectRoot,
      ['update-index', '-z', '--index-info'],
      indexInfo,
      { ...process.env, GIT_INDEX_FILE: alternateIndexPath }
    );
    const completedIndex = await fs.readFile(alternateIndexPath);
    await lock.writeFile(completedIndex);
    await lock.sync();
    await lock.close();
    lock = null;
    await fs.rename(lockPath, indexPath);
    published = true;
  } finally {
    if (lock !== null) await lock.close().catch(() => undefined);
    await fs.rm(alternateLockPath, { force: true }).catch(() => undefined);
    await fs.rm(alternateIndexPath, { force: true }).catch(() => undefined);
    if (ownsLock && !published) await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function synchronizeWorkingTree(
  projectRoot: string,
  update: FormattedIndexUpdate,
  hooks: FormatterTestHooks
): Promise<void> {
  const openedFile = await openRegularRepositoryFile(projectRoot, update.entry.path);
  if (openedFile === null) return;
  try {
    const current = await readHandleBytes(openedFile.handle);
    if (!current.equals(update.originalBytes)) return;
    await hooks.beforeWorkingTreeWrite?.(update.entry.path);
    const rechecked = await readHandleBytes(openedFile.handle);
    if (!rechecked.equals(update.originalBytes)) return;
    await assertPathStillNamesHandle(projectRoot, update.entry.path, openedFile);
    await replaceHandleBytes(openedFile.handle, update.formattedBytes);
  } finally {
    await openedFile.handle.close();
  }
}

export async function runStagedFormatter(
  projectRoot = compilerRoot,
  hooks: FormatterTestHooks = {},
  env: FormatterEnvironment = process.env
): Promise<number> {
  try {
    const targets = stagedFormattingTargets(projectRoot, env);
    if (targets.length === 0) {
      console.log('No candidate formatting targets selected.');
      return 0;
    }
    const allEntries = readIndexEntries(projectRoot);
    const entries = selectOrdinaryEntries(allEntries, targets);
    const blobs = readBlobs(projectRoot, entries);
    const config = indexConfig(projectRoot, allEntries);
    const limit = createConcurrencyLimit(10);
    const updates = (await Promise.all(entries.map((entry) => limit(async () => {
      const originalBytes = blobs.get(entry.path);
      if (!originalBytes) throw new Error(`Formatting blob was not loaded: ${entry.path}`);
      const formattedBytes = await formatBytes(originalBytes, entry.path, config);
      if (formattedBytes === null || formattedBytes.equals(originalBytes)) return null;
      const formattedObjectId = gitText(
        projectRoot,
        ['hash-object', '-w', '--stdin'],
        formattedBytes
      ).trim();
      if (!/^[0-9a-f]{40,64}$/u.test(formattedObjectId)) {
        throw new Error(`git hash-object returned an invalid object ID for ${entry.path}.`);
      }
      return Object.freeze({ entry, originalBytes, formattedBytes, formattedObjectId });
    })))).filter((update): update is FormattedIndexUpdate => update !== null);
    if (updates.length === 0) {
      console.log(`Candidate formatting already converged for ${targets.length} file(s).`);
      return 0;
    }
    await publishIndexUpdates(projectRoot, targets, entries, updates, env, hooks);
    for (const update of updates) await synchronizeWorkingTree(projectRoot, update, hooks);
    console.log(`Formatted ${updates.length} candidate Git index file(s).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readHeadEntries(projectRoot: string): readonly GitIndexEntry[] {
  return Object.freeze(nulFields(
    gitBytes(projectRoot, ['ls-tree', '-r', '-z', 'HEAD']),
    'git ls-tree -r HEAD'
  ).flatMap((record) => {
    const separator = record.indexOf('\t');
    const header = separator < 0 ? '' : record.slice(0, separator);
    const repositoryPath = separator < 0 ? '' : canonicalRepositoryPath(record.slice(separator + 1));
    const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64})$/u.exec(header);
    if (!match || repositoryPath.length === 0) {
      throw new Error('git ls-tree returned an invalid entry.');
    }
    if (match[2] !== 'blob') return [];
    return [Object.freeze({
      mode: match[1]!,
      objectId: match[3]!,
      stage: 0,
      path: repositoryPath
    })];
  }));
}

export async function runFormatCheck(
  projectRoot = compilerRoot,
  env: FormatterEnvironment = process.env
): Promise<number> {
  try {
    const targets = candidateFormattingTargets(projectRoot, env);
    if (targets.length === 0) {
      console.log('No committed formatting targets selected.');
      return 0;
    }
    const allEntries = readHeadEntries(projectRoot);
    const entries = selectOrdinaryEntries(allEntries, targets);
    const blobs = readBlobs(projectRoot, entries);
    const configEntry = allEntries.find((entry) => entry.path === '.prettierrc.json');
    if (!configEntry) throw new Error('HEAD does not contain .prettierrc.json.');
    const configBytes = readBlobs(projectRoot, [configEntry]).get(configEntry.path);
    if (!configBytes) throw new Error('HEAD formatter configuration blob was not loaded.');
    const config = parseFormatterConfig(configBytes, 'HEAD .prettierrc.json');
    const limit = createConcurrencyLimit(10);
    const drift = (await Promise.all(entries.map((entry) => limit(async () => {
      const original = blobs.get(entry.path);
      if (!original) throw new Error(`HEAD formatting blob was not loaded: ${entry.path}`);
      const formatted = await formatBytes(original, entry.path, config);
      return formatted !== null && !formatted.equals(original) ? entry.path : null;
    })))).filter((repositoryPath): repositoryPath is string => repositoryPath !== null);
    if (drift.length > 0) {
      console.error(`Candidate formatting drift: ${drift.join(', ')}`);
      return 1;
    }
    console.log(`Candidate formatting check passed for ${targets.length} file(s).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
