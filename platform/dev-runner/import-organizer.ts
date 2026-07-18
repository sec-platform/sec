import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { CompilerError } from '../shared/errors.ts';
import { compilerRoot, relativePosixPath } from '../shared/paths.ts';

type ImportSelectionEnvironment = Record<string, string | undefined>;

interface StagedIndexEntry {
  readonly mode: string;
  readonly objectId: string;
  readonly stage: number;
  readonly path: string;
}

interface StagedImportUpdate {
  readonly entry: StagedIndexEntry;
  readonly normalizedBytes: Buffer;
  readonly normalizedObjectId: string;
}

interface StagedImportOrganizerTestHooks {
  readonly beforeHash?: (fileName: string) => void;
  readonly afterIndexLock?: () => void | Promise<void>;
}

interface StagedImportSelection {
  readonly candidateBase?: string;
}

function formatDiagnostic(diagnostic: ts.Diagnostic, projectRoot = compilerRoot): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${relativePosixPath(projectRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
}

function loadProjectConfig(projectRoot = compilerRoot): ts.ParsedCommandLine {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('tsconfig.json not found');
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(formatDiagnostic(configFile.error, projectRoot));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((diagnostic) => formatDiagnostic(diagnostic, projectRoot)).join('\n'));
  }

  return parsed;
}

const importFormatOptions: ts.FormatCodeSettings = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  indentStyle: ts.IndentStyle.Smart,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
  insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
  insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  placeOpenBraceOnNewLineForControlBlocks: false,
  placeOpenBraceOnNewLineForFunctions: false,
  semicolons: ts.SemicolonPreference.Insert
};

const importPreferences: ts.UserPreferences = {
  quotePreference: 'single'
};

function sourceNewLine(source: string): '\n' | '\r\n' {
  const firstLineFeed = source.indexOf('\n');
  return firstLineFeed > 0 && source[firstLineFeed - 1] === '\r' ? '\r\n' : '\n';
}

function isSameFilePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function applyTextChanges(source: string, changes: readonly ts.TextChange[]): string {
  return [...changes]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((updated, change) => (
      `${updated.slice(0, change.span.start)}${change.newText}${updated.slice(change.span.start + change.span.length)}`
    ), source);
}

export function organizeImportsInSource(
  service: Pick<ts.LanguageService, 'organizeImports'>,
  fileName: string,
  source: string
): string {
  const edits = service
    .organizeImports(
      { type: 'file', fileName, mode: ts.OrganizeImportsMode.All },
      { ...importFormatOptions, newLineCharacter: sourceNewLine(source) },
      importPreferences
    )
    .flatMap((change) => isSameFilePath(change.fileName, fileName) ? change.textChanges : []);
  return applyTextChanges(source, edits);
}

export function selectChangedImportsOnly(env: ImportSelectionEnvironment = process.env): boolean {
  if (env.SEC_IMPORTS_CHANGED_ONLY === '1') return true;
  if (env.SEC_IMPORTS_CHANGED_ONLY === '0') return false;
  if (env.SEC_CHANGED_BASE) return true;
  return env.CI === 'true' && env.GITHUB_EVENT_NAME === 'pull_request';
}

export function resolveImportDiffBase(env: ImportSelectionEnvironment = process.env): string {
  if (env.SEC_CHANGED_BASE) return env.SEC_CHANGED_BASE;
  if (env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_BASE_REF) {
    return `origin/${env.GITHUB_BASE_REF}`;
  }
  return 'HEAD^1';
}

function gitError(args: readonly string[], stderr: Buffer | string | null): Error {
  const detail = stderr === null ? '' : Buffer.from(stderr).toString('utf8').trim();
  return new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
}

function gitText(projectRoot: string, args: readonly string[], input?: Buffer): string {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw gitError(args, result.stderr);
  }
  return result.stdout;
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
  if (result.error || result.status !== 0) {
    throw gitError(args, result.stderr);
  }
  return Buffer.from(result.stdout);
}

function nulFields(bytes: Buffer, source: string): string[] {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) {
    throw new Error(`${source} did not return NUL-terminated records`);
  }
  const text = bytes.subarray(0, -1).toString('utf8');
  if (!Buffer.from(`${text}\0`, 'utf8').equals(bytes)) {
    throw new Error(`${source} returned a non-UTF-8 path`);
  }
  return text.split('\0');
}

function isTypeScriptPath(value: string): boolean {
  return /\.[cm]?tsx?$/iu.test(value);
}

function resolvedCandidateBase(projectRoot: string, candidateBase: string | undefined): string | undefined {
  if (candidateBase === undefined) return undefined;
  if (!/^[0-9a-f]{40,64}$/u.test(candidateBase)) {
    throw new Error('Candidate import base must be one full Git object ID');
  }
  const resolved = gitText(projectRoot, ['rev-parse', '--verify', `${candidateBase}^{commit}`]).trim();
  if (resolved !== candidateBase) throw new Error('Candidate import base did not resolve exactly');
  return resolved;
}

function tryResolveGitCommit(projectRoot: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error || result.status !== 0) return undefined;
  const resolved = result.stdout.trim();
  return /^[0-9a-f]{40,64}$/u.test(resolved) ? resolved : undefined;
}

export function resolveCandidateImportBase(
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): string {
  if (env.SEC_CHANGED_BASE) {
    return resolvedCandidateBase(projectRoot, env.SEC_CHANGED_BASE)!;
  }
  return tryResolveGitCommit(projectRoot, ['merge-base', 'HEAD', 'refs/remotes/origin/main'])
    ?? tryResolveGitCommit(projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    ?? (() => {
      throw new Error('Candidate import base is unavailable');
    })();
}

function stagedTypeScriptTargets(
  projectRoot: string,
  candidateBase: string | undefined
): readonly string[] {
  const fields = nulFields(gitBytes(projectRoot, [
    'diff', '--cached', '--name-status', '-z', '--diff-filter=ACMR', '--find-renames',
    ...(candidateBase === undefined ? [] : [candidateBase]),
    '--'
  ]), 'git diff --cached');
  const targets = new Set<string>();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status || !/^[ACMR][0-9]*$/u.test(status)) {
      throw new Error('git diff --cached returned an invalid status record');
    }
    const kind = status[0];
    if (kind === 'C' || kind === 'R') {
      const source = fields[index++];
      const target = fields[index++];
      if (source === undefined || target === undefined) {
        throw new Error('git diff --cached returned an incomplete rename record');
      }
      if (isTypeScriptPath(target)) targets.add(target);
      continue;
    }
    const target = fields[index++];
    if (target === undefined) {
      throw new Error('git diff --cached returned an incomplete path record');
    }
    if (isTypeScriptPath(target)) targets.add(target);
  }
  return Object.freeze([...targets].sort());
}

function readIndexEntries(projectRoot: string): readonly StagedIndexEntry[] {
  return Object.freeze(nulFields(
    gitBytes(projectRoot, ['ls-files', '--stage', '-z']),
    'git ls-files --stage'
  ).map((record) => {
    const separator = record.indexOf('\t');
    const header = separator < 0 ? '' : record.slice(0, separator);
    const filePath = separator < 0 ? '' : record.slice(separator + 1);
    const match = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])$/u.exec(header);
    if (!match || filePath.length === 0) {
      throw new Error('git ls-files --stage returned an invalid index record');
    }
    return Object.freeze({
      mode: match[1]!,
      objectId: match[2]!,
      stage: Number(match[3]),
      path: filePath
    });
  }));
}

function selectStagedEntries(
  entries: readonly StagedIndexEntry[],
  targetPaths: readonly string[]
): readonly StagedIndexEntry[] {
  const unresolved = entries.find((entry) => entry.stage !== 0 && isTypeScriptPath(entry.path));
  if (unresolved) {
    throw new Error(`Cannot organize unresolved TypeScript index stages: ${unresolved.path}`);
  }
  const selected = targetPaths.map((targetPath) => {
    const matches = entries.filter((entry) => entry.path === targetPath);
    if (matches.length !== 1 || matches[0]!.stage !== 0) {
      throw new Error(`TypeScript staged entry is unavailable or ambiguous: ${targetPath}`);
    }
    const entry = matches[0]!;
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      throw new Error(`TypeScript staged entry is not an ordinary file: ${targetPath}`);
    }
    return entry;
  });
  return Object.freeze(selected);
}

function absoluteStagedPath(projectRoot: string, gitPath: string): string {
  if (gitPath.length === 0 || gitPath.includes('\\') || path.posix.isAbsolute(gitPath)) {
    throw new Error(`TypeScript staged path is invalid: ${gitPath}`);
  }
  const absolute = path.resolve(projectRoot, ...gitPath.split('/'));
  const relative = path.relative(projectRoot, absolute);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`TypeScript staged path escaped the repository: ${gitPath}`);
  }
  return absolute;
}

async function materializeCandidateIndex(projectRoot: string): Promise<string> {
  const snapshotsRoot = path.join(projectRoot, '.tmp', 'import-candidate-snapshots');
  const snapshotRoot = path.join(snapshotsRoot, randomUUID());
  await fs.mkdir(snapshotRoot, { recursive: true });
  try {
    const prefix = `${snapshotRoot.replace(/\\/gu, '/')}/`;
    gitBytes(projectRoot, ['checkout-index', '--all', '--force', `--prefix=${prefix}`]);
    return snapshotRoot;
  } catch (error) {
    await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function decodeTypeScriptBlob(bytes: Buffer, gitPath: string): string {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`TypeScript staged blob is not valid UTF-8: ${gitPath}`);
  }
  return source;
}

function createImportService(
  config: ts.ParsedCommandLine,
  projectRoot: string,
  projectFileNames: readonly string[],
  files: Map<string, { version: number; content: string }>
): ts.LanguageService {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...projectFileNames],
    getScriptVersion: (fileName) => `${files.get(path.resolve(fileName))?.version ?? 0}`,
    getScriptSnapshot: (fileName) => {
      const content = files.get(path.resolve(fileName))?.content ?? ts.sys.readFile(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCompilationSettings: () => config.options,
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    readFile: (fileName) => files.get(path.resolve(fileName))?.content ?? ts.sys.readFile(fileName),
    fileExists: (fileName) => files.has(path.resolve(fileName)) || ts.sys.fileExists(fileName),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n'
  };
  return ts.createLanguageService(host);
}

function assertIndexUnchanged(
  projectRoot: string,
  targetPaths: readonly string[],
  selectedEntries: readonly StagedIndexEntry[],
  candidateBase: string | undefined
): void {
  const currentTargets = stagedTypeScriptTargets(projectRoot, candidateBase);
  if (JSON.stringify(currentTargets) !== JSON.stringify(targetPaths)) {
    throw new Error('Git index changed while organizing staged TypeScript imports');
  }
  const currentEntries = selectStagedEntries(readIndexEntries(projectRoot), targetPaths);
  if (JSON.stringify(currentEntries) !== JSON.stringify(selectedEntries)) {
    throw new Error('Git index entries changed while organizing staged TypeScript imports');
  }
}

async function publishStagedIndex(
  projectRoot: string,
  targetPaths: readonly string[],
  selectedEntries: readonly StagedIndexEntry[],
  updates: readonly StagedImportUpdate[],
  testHooks: StagedImportOrganizerTestHooks,
  candidateBase: string | undefined
): Promise<void> {
  const configuredIndexPath = gitText(projectRoot, ['rev-parse', '--git-path', 'index']).trim();
  if (configuredIndexPath.length === 0) throw new Error('Git index path is unavailable');
  const indexPath = path.isAbsolute(configuredIndexPath)
    ? path.resolve(configuredIndexPath)
    : path.resolve(projectRoot, configuredIndexPath);
  const lockPath = `${indexPath}.lock`;
  const alternateIndexPath = `${indexPath}.imports-staged-${process.pid}-${randomUUID()}`;
  const alternateLockPath = `${alternateIndexPath}.lock`;
  const metadata = await fs.stat(indexPath);
  if (!metadata.isFile()) throw new Error('Git index is not a regular file');

  let lock: Awaited<ReturnType<typeof fs.open>> | null = null;
  let ownsLock = false;
  let published = false;
  try {
    try {
      lock = await fs.open(lockPath, 'wx', metadata.mode & 0o777);
      ownsLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Git index is locked; staged imports were not published');
      }
      throw error;
    }

    await testHooks.afterIndexLock?.();
    assertIndexUnchanged(projectRoot, targetPaths, selectedEntries, candidateBase);
    const seed = await fs.readFile(indexPath);
    await fs.writeFile(alternateIndexPath, seed, {
      flag: 'wx',
      mode: metadata.mode & 0o777
    });
    const indexInfo = Buffer.from(updates
      .map((update) => `${update.entry.mode} ${update.normalizedObjectId} 0\t${update.entry.path}\0`)
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
  } catch (error) {
    throw error;
  } finally {
    if (lock !== null) await lock.close().catch(() => undefined);
    await fs.rm(alternateLockPath, { force: true }).catch(() => undefined);
    await fs.rm(alternateIndexPath, { force: true }).catch(() => undefined);
    if (ownsLock && !published) await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function runStagedImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  selection: StagedImportSelection = {}
): Promise<number> {
  const candidateBase = resolvedCandidateBase(projectRoot, selection.candidateBase);
  const targetPaths = stagedTypeScriptTargets(projectRoot, candidateBase);
  const indexEntries = readIndexEntries(projectRoot);
  const selectedEntries = selectStagedEntries(indexEntries, targetPaths);
  if (targetPaths.length === 0) {
    console.log('No staged TypeScript import targets selected.');
    return 0;
  }

  const snapshotRoot = candidateBase === undefined ? null : await materializeCandidateIndex(projectRoot);
  const contextRoot = snapshotRoot ?? projectRoot;
  try {
    const config = loadProjectConfig(contextRoot);
    const stagedFiles = new Map<string, { version: number; content: string }>();
    const originals = new Map<string, Buffer>();
    for (const entry of selectedEntries) {
      const absolutePath = absoluteStagedPath(contextRoot, entry.path);
      const bytes = gitBytes(projectRoot, ['cat-file', 'blob', entry.objectId]);
      originals.set(entry.path, bytes);
      stagedFiles.set(absolutePath, {
        version: 0,
        content: decodeTypeScriptBlob(bytes, entry.path)
      });
    }
    const projectFileNames = Object.freeze([...new Set([
      ...config.fileNames.map((fileName) => path.resolve(fileName)),
      ...stagedFiles.keys()
    ])]);
    const service = createImportService(config, contextRoot, projectFileNames, stagedFiles);
    const updates: StagedImportUpdate[] = [];

    for (const entry of selectedEntries) {
      const absolutePath = absoluteStagedPath(contextRoot, entry.path);
      const file = stagedFiles.get(absolutePath);
      const originalBytes = originals.get(entry.path);
      if (!file || !originalBytes) {
        throw new Error(`TypeScript staged blob was not loaded: ${entry.path}`);
      }
      const normalized = organizeImportsInSource(service, absolutePath, file.content);
      const normalizedBytes = Buffer.from(normalized, 'utf8');
      if (normalizedBytes.equals(originalBytes)) continue;
      testHooks.beforeHash?.(entry.path);
      const normalizedObjectId = gitText(projectRoot, ['hash-object', '-w', '--stdin'], normalizedBytes).trim();
      if (!/^[0-9a-f]{40,64}$/u.test(normalizedObjectId)) {
        throw new Error(`git hash-object returned an invalid object ID for ${entry.path}`);
      }
      updates.push(Object.freeze({
        entry,
        normalizedBytes,
        normalizedObjectId
      }));
    }

    if (updates.length === 0) {
      console.log('Staged TypeScript imports are organized.');
      return 0;
    }

    await publishStagedIndex(
      projectRoot,
      targetPaths,
      selectedEntries,
      updates,
      testHooks,
      candidateBase
    );

    const fileList = updates.map((update) => `- ${update.entry.path}`).join('\n');
    const scope = candidateBase === undefined ? 'staged' : 'candidate';
    console.log(`Organized ${scope} imports in ${updates.length} file(s); working tree unchanged:\n${fileList}`);
    return 0;
  } finally {
    if (snapshotRoot !== null) {
      await fs.rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function runCandidateImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  env: ImportSelectionEnvironment = process.env
): Promise<number> {
  const candidateBase = resolveCandidateImportBase(projectRoot, env);
  return runStagedImportOrganizer(projectRoot, testHooks, { candidateBase });
}

export function changedTypeScriptFiles(
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Set<string> {
  const baseRef = resolveImportDiffBase(env);
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr.trim();
    throw new CompilerError('IMPORT-AUTHORITY-003', `Import diff base is invalid: ${baseRef}`, {
      baseRef,
      detail
    });
  }

  return new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => /\.[cm]?tsx?$/u.test(line))
  );
}

function selectedFileNames(config: ts.ParsedCommandLine): string[] {
  if (!selectChangedImportsOnly()) {
    return config.fileNames;
  }

  const changedFiles = changedTypeScriptFiles();

  return config.fileNames.filter((fileName) => changedFiles.has(relativePosixPath(compilerRoot, fileName)));
}

export async function runImportOrganizer(options: { check: boolean }): Promise<number> {
  const config = loadProjectConfig();
  const projectFileNames = config.fileNames;
  const targetFileNames = selectedFileNames(config);
  if (targetFileNames.length === 0) {
    console.log('No TypeScript import targets selected.');
    return 0;
  }

  const files = new Map<string, { version: number; content: string }>(
    await Promise.all(targetFileNames.map(async (fileName): Promise<[string, { version: number; content: string }]> => [
      fileName,
      {
        version: 0,
        content: await fs.readFile(fileName, 'utf8')
      }
    ]))
  );
  const service = createImportService(config, compilerRoot, projectFileNames, files);
  const changedFiles: string[] = [];

  for (const fileName of targetFileNames) {
    const file = files.get(fileName);
    if (!file) {
      continue;
    }

    const updated = organizeImportsInSource(service, fileName, file.content);
    if (updated === file.content) {
      continue;
    }

    changedFiles.push(relativePosixPath(compilerRoot, fileName));
    if (!options.check) {
      await fs.writeFile(fileName, updated, 'utf8');
      file.content = updated;
      file.version += 1;
    }
  }

  if (changedFiles.length === 0) {
    console.log('Imports are organized.');
    return 0;
  }

  const fileList = changedFiles.map((fileName) => `- ${fileName}`).join('\n');
  if (options.check) {
    console.error(`Imports need organizing in ${changedFiles.length} file(s):\n${fileList}\nRun bun run imports:organize.`);
    return 1;
  }

  console.log(`Organized imports in ${changedFiles.length} file(s):\n${fileList}`);
  return 0;
}
