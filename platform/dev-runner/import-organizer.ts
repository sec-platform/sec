import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {
  inspectNoFollowDirectoryChainV1,
  retainNoFollowDirectoryForChildProcessV1,
  type RetainedNoFollowChildProcessDirectoryV1
} from '../shared/physical-no-follow.ts';

import {
  canonicalEquals,
  rawSha256,
  sha256
} from '../shared/canonical-primitives.ts';
import { CompilerError } from '../shared/errors.ts';
import { ensureDir } from '../shared/fs.ts';
import { compilerRoot, relativePosixPath } from '../shared/paths.ts';
import {
  publishImportTransformTransactionV1,
  type ImportTransformTransactionTestHooksV1
} from './import-transform-transaction.ts';

// Inline sync parse cache. Exact config bytes are the reuse identity; metadata
// is not correctness evidence because mtime/size can collide across rewrites.
const tsconfigCache = new Map<string, { digest: `sha256:${string}`; value: { config?: unknown; error?: ts.Diagnostic } }>();
function cachedParseConfigFile(configPath: string): { config?: unknown; error?: ts.Diagnostic } {
  const text = readFileSync(configPath, 'utf8');
  const digest = rawSha256(text);
  const existing = tsconfigCache.get(configPath);
  if (existing !== undefined && existing.digest === digest) return existing.value;
  const value = ts.parseConfigFileTextToJson(configPath, text);
  tsconfigCache.set(configPath, { digest, value });
  return value;
}

type ImportSelectionEnvironment = Record<string, string | undefined>;

/**
 * One deterministic pure import transform kernel with two explicit intents.
 * Snapshot selectors (working-tree / staged / candidate / CI changed-only)
 * choose which bytes to compare or transform; the kernel itself is shared and
 * never performs I/O. Sorting/combining is repository authoring
 * representation; unused-removal is a separate typed transform.
 */
export type ImportTransformIntentV1 = 'sort-and-combine' | 'remove-unused';

export type ImportOperationScopeV1 = 'candidate' | 'all';

export type ImportOperationOptionsV1 = Readonly<{
  intent?: ImportTransformIntentV1;
  scope?: ImportOperationScopeV1;
  candidateBase?: string;
}>;

export type ImportOperationPlanV1 = Readonly<{
  schema: 'sec-import-operation-plan-v1';
  intent: ImportTransformIntentV1;
  scope: ImportOperationScopeV1;
  candidateBase: string | null;
  providerRevision: string;
  projectConfigDigest: `sha256:${string}`;
  targets: readonly Readonly<{
    relativePath: string;
    preimageDigest: `sha256:${string}`;
    replacementDigest: `sha256:${string}`;
    changed: boolean;
  }>[];
  writePaths: readonly string[];
  planDigest: `sha256:${string}`;
}>;

type CompiledImportOperationPlanV1 = Readonly<{
  plan: ImportOperationPlanV1;
  writes: readonly Readonly<{
    relativePath: string;
    expectedBytes: Buffer;
    replacementBytes: Buffer;
  }>[];
}>;

export type ImportCheckOutcomeV1 = Readonly<{
  schema: 'sec-import-check-outcome-v1';
  status: 'canonical' | 'needs-import-transform';
  files: readonly string[];
}>;

export type ImportApplyOutcomeV1 =
  | Readonly<{
    schema: 'sec-import-apply-outcome-v1';
    status: 'noop';
    files: readonly string[];
    planDigest: `sha256:${string}`;
  }>
  | Readonly<{
    schema: 'sec-import-apply-outcome-v1';
    status: 'accepted';
    files: readonly string[];
    planDigest: `sha256:${string}`;
    transactionId: string;
    journalPath: string;
  }>
  | Readonly<{
    schema: 'sec-import-apply-outcome-v1';
    status: 'rolled-back' | 'recovery-required';
    files: readonly string[];
    planDigest: `sha256:${string}`;
    transactionId: string;
    journalPath: string;
    reasonCode: string;
  }>;

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
  readonly candidateContext?: (mode: 'working-tree' | 'snapshot') => void | Promise<void>;
  readonly beforeCandidateSnapshotWrite?: (snapshotRoot: string) => void | Promise<void>;
  readonly generatedStateLifecycle?: Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
    disposed(relativePath: string, outcome: string): Promise<void>;
  }>;
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

  const configFile = cachedParseConfigFile(configPath);
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
  source: string,
  intent: ImportTransformIntentV1 = 'sort-and-combine'
): string {
  const mode = intent === 'remove-unused'
    ? ts.OrganizeImportsMode.RemoveUnused
    : ts.OrganizeImportsMode.SortAndCombine;
  const edits = service
    .organizeImports(
      { type: 'file', fileName, mode },
      { ...importFormatOptions, newLineCharacter: sourceNewLine(source) },
      importPreferences
    )
    .flatMap((change) => isSameFilePath(change.fileName, fileName) ? change.textChanges : []);
  return applyTextChanges(source, edits);
}

function gitError(args: readonly string[], stderr: Buffer | string | null): Error {
  const detail = stderr === null ? '' : Buffer.from(stderr).toString('utf8').trim();
  return new Error(`git ${args[0] ?? 'command'} failed${detail.length > 0 ? `: ${detail}` : ''}`);
}

function gitText(
  projectRoot: string,
  args: readonly string[],
  input?: Buffer,
  env: NodeJS.ProcessEnv = pureGitReadEnvironment(process.env)
): string {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
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
  env: NodeJS.ProcessEnv = pureGitReadEnvironment(process.env),
  retainedDirectory?: RetainedNoFollowChildProcessDirectoryV1
): Buffer {
  retainedDirectory?.assertCurrent();
  const stdio: SpawnSyncOptions['stdio'] = retainedDirectory?.stdioSourceDescriptor === null
    || retainedDirectory === undefined
    ? ['pipe', 'pipe', 'pipe']
    : ['pipe', 'pipe', 'pipe', retainedDirectory.stdioSourceDescriptor];
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'buffer',
    env,
    input,
    maxBuffer: 128 * 1024 * 1024,
    stdio,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw gitError(args, result.stderr);
  }
  retainedDirectory?.assertCurrent();
  return Buffer.from(result.stdout);
}

function pureGitReadEnvironment(env: ImportSelectionEnvironment): NodeJS.ProcessEnv {
  return { ...process.env, ...env, GIT_OPTIONAL_LOCKS: '0' };
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

function isTypeScriptDeclarationPath(value: string): boolean {
  return /\.d\.[cm]?ts$/iu.test(value);
}

export function importServiceRootFileNames(
  config: Pick<ts.ParsedCommandLine, 'fileNames'>,
  targetFileNames: readonly string[]
): readonly string[] {
  const roots = new Set(targetFileNames.map((fileName) => path.resolve(fileName)));
  for (const fileName of config.fileNames) {
    if (isTypeScriptDeclarationPath(fileName)) {
      roots.add(path.resolve(fileName));
    }
  }
  return Object.freeze([...roots].sort());
}

function typeScriptTargetsFromNameStatus(bytes: Buffer, source: string): readonly string[] {
  const fields = nulFields(bytes, source);
  const targets = new Set<string>();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status || !/^[ACMR][0-9]*$/u.test(status)) {
      throw new Error(`${source} returned an invalid status record`);
    }
    const kind = status[0];
    if (kind === 'C' || kind === 'R') {
      const sourcePath = fields[index++];
      const targetPath = fields[index++];
      if (sourcePath === undefined || targetPath === undefined) {
        throw new Error(`${source} returned an incomplete rename record`);
      }
      if (isTypeScriptPath(targetPath)) targets.add(targetPath);
      continue;
    }
    const targetPath = fields[index++];
    if (targetPath === undefined) {
      throw new Error(`${source} returned an incomplete path record`);
    }
    if (isTypeScriptPath(targetPath)) targets.add(targetPath);
  }
  return Object.freeze([...targets].sort());
}

// Parses `git status --porcelain=v1 -z` output into a sorted list of TypeScript
// file paths. The porcelain format is `XY PATH\0` for normal entries and
// `XY PATH\0ORIG_PATH\0` for renames/copies, where XY is the 2-character index
// (X) and work-tree (Y) status. Untracked files appear as `?? PATH\0`.
// A single porcelain call replaces the former --cached, working-tree, and
// ls-files --others calls, deriving staged, unstaged, and untracked targets in
// one pass.
function typeScriptTargetsFromPorcelain(bytes: Buffer, source: string): readonly string[] {
  const fields = nulFields(bytes, source);
  const targets = new Set<string>();
  for (let index = 0; index < fields.length;) {
    const entry = fields[index++];
    if (entry.length < 3) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const filePath = entry.slice(3);

    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      if (index < fields.length) index++;
    }

    if (x === '?' && y === '?') {
      if (isTypeScriptPath(filePath)) targets.add(filePath);
      continue;
    }

    if (x === 'A' || x === 'C' || x === 'M' || x === 'R' ||
      y === 'A' || y === 'C' || y === 'M' || y === 'R') {
      if (isTypeScriptPath(filePath)) targets.add(filePath);
    }
  }
  return Object.freeze([...targets].sort());
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

function tryResolveGitCommit(
  projectRoot: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = pureGitReadEnvironment(process.env)
): string | undefined {
  const result = spawnSync('git', [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env,
    windowsHide: true
  });
  if (result.error || result.status !== 0) return undefined;
  const resolved = result.stdout.trim();
  return /^[0-9a-f]{40,64}$/u.test(resolved) ? resolved : undefined;
}

function changedTypeScriptFiles(
  projectRoot: string,
  candidateBase: string,
  env: ImportSelectionEnvironment
): readonly string[] {
  const result = spawnSync('git', [
    'diff', '--name-only', '-z', '--diff-filter=ACMR', '--find-renames',
    candidateBase, 'HEAD', '--'
  ], {
    cwd: projectRoot,
    encoding: 'buffer',
    env: pureGitReadEnvironment(env),
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw gitError(['diff'], result.stderr);
  }
  return Object.freeze(nulFields(Buffer.from(result.stdout), 'git diff candidate base HEAD')
    .filter(isTypeScriptPath));
}

export function resolveCandidateImportBase(
  projectRoot = compilerRoot,
  requestedBase?: string,
  env: ImportSelectionEnvironment = process.env
): string {
  const ambientBase = env.SEC_CHANGED_BASE;
  if (requestedBase !== undefined && ambientBase !== undefined && requestedBase !== ambientBase) {
    throw new Error('Candidate import base conflicts with the exact ambient verification base');
  }
  const exactBase = requestedBase ?? ambientBase;
  if (exactBase !== undefined) {
    return resolvedCandidateBase(projectRoot, exactBase)!;
  }
  const readEnvironment = pureGitReadEnvironment(env);
  return tryResolveGitCommit(projectRoot, ['merge-base', 'HEAD', 'refs/remotes/origin/main'], readEnvironment)
    ?? (() => {
      throw new Error(
        'Candidate import base is unavailable; supply --candidate-base or SEC_CHANGED_BASE after trusted default readback'
      );
    })();
}

function stagedTypeScriptTargets(
  projectRoot: string,
  candidateBase: string | undefined
): readonly string[] {
  return typeScriptTargetsFromNameStatus(gitBytes(projectRoot, [
    'diff', '--cached', '--name-status', '-z', '--diff-filter=ACMR', '--find-renames',
    ...(candidateBase === undefined ? [] : [candidateBase]),
    '--'
  ]), 'git diff --cached');
}

export function workingTreeTypeScriptTargets(
  projectRoot = compilerRoot,
  candidateBase?: string,
  env: ImportSelectionEnvironment = process.env
): readonly string[] {
  const resolvedBase = resolveCandidateImportBase(projectRoot, candidateBase, env);
  const targets = new Set<string>();

  for (const target of changedTypeScriptFiles(projectRoot, resolvedBase, env)) {
    targets.add(target);
  }

  for (const target of typeScriptTargetsFromPorcelain(
    gitBytes(projectRoot, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], undefined, pureGitReadEnvironment(env)),
    'git status --porcelain=v1'
  )) {
    targets.add(target);
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
    throw new CompilerError(
      'IMPORT-PARTIAL-STAGE-CONFLICT',
      `Cannot organize unresolved TypeScript index stages: ${unresolved.path}`,
      { path: unresolved.path }
    );
  }
  const selected = targetPaths.map((targetPath) => {
    const matches = entries.filter((entry) => entry.path === targetPath);
    if (matches.length !== 1 || matches[0]!.stage !== 0) {
      throw new CompilerError(
        'IMPORT-STAGED-ENTRY-UNAVAILABLE',
        `TypeScript staged entry is unavailable or ambiguous: ${targetPath}`,
        { path: targetPath }
      );
    }
    const entry = matches[0]!;
    if (entry.mode !== '100644' && entry.mode !== '100755') {
      throw new CompilerError(
        'IMPORT-STAGED-NOT-ORDINARY',
        `TypeScript staged entry is not an ordinary file: ${targetPath}`,
        { path: targetPath, mode: entry.mode }
      );
    }
    return entry;
  });
  return Object.freeze(selected);
}

function absoluteRepositoryPath(projectRoot: string, gitPath: string): string {
  if (gitPath.length === 0 || gitPath.includes('\\') || path.posix.isAbsolute(gitPath)) {
    throw new Error(`TypeScript repository path is invalid: ${gitPath}`);
  }
  const absolute = path.resolve(projectRoot, ...gitPath.split('/'));
  const relative = path.relative(projectRoot, absolute);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`TypeScript repository path escaped the repository: ${gitPath}`);
  }
  return absolute;
}

type ImportSnapshotLifecycleV1 = Readonly<{
  disposed(relativePath: string, outcome: string): Promise<void>;
}>;

type MaterializedCandidateIndexV1 = Readonly<{
  snapshotRoot: string;
  relativePath: string;
  lifecycle: ImportSnapshotLifecycleV1 | null;
}>;

async function materializeCandidateIndex(
  projectRoot: string,
  lifecycleOverride?: StagedImportOrganizerTestHooks['generatedStateLifecycle'],
  beforeWrite?: StagedImportOrganizerTestHooks['beforeCandidateSnapshotWrite']
): Promise<MaterializedCandidateIndexV1> {
  const snapshotsRoot = path.join(projectRoot, '.tmp', 'import-candidate-snapshots');
  const operationId = randomUUID();
  const snapshotName = `snapshot-${operationId}`;
  const relativePath = `.tmp/import-candidate-snapshots/${snapshotName}`;
  const snapshotRoot = path.join(snapshotsRoot, snapshotName);
  let lifecycle: (ImportSnapshotLifecycleV1 & Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
  }>) | null = null;
  await ensureDir(snapshotRoot);
  const retainedSnapshot = retainNoFollowDirectoryForChildProcessV1(
    inspectNoFollowDirectoryChainV1(snapshotRoot, 'Import candidate snapshot'),
    3,
    'Import candidate snapshot'
  );
  try {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const resolvedCompilerRoot = path.resolve(compilerRoot);
    const sameCompilerRoot = process.platform === 'win32'
      ? resolvedProjectRoot.toLowerCase() === resolvedCompilerRoot.toLowerCase()
      : resolvedProjectRoot === resolvedCompilerRoot;
    if (sameCompilerRoot && lifecycleOverride !== undefined) {
      throw new Error('Canonical import snapshots cannot replace the generated-state lifecycle owner.');
    }
    if (lifecycleOverride !== undefined) {
      lifecycle = lifecycleOverride;
      await lifecycle.born(relativePath, `import-candidate-snapshot:${operationId}`);
    } else if (sameCompilerRoot) {
      const { generatedStateProducerHooksV1 } = await import(
        '../../tooling/sec-dev/generated-state-lifecycle.ts'
      );
      lifecycle = generatedStateProducerHooksV1({ repositoryRoot: projectRoot });
      await lifecycle.born(relativePath, `import-candidate-snapshot:${operationId}`);
    }
    await beforeWrite?.(snapshotRoot);
    const prefix = `${retainedSnapshot.childPath.replace(/\\/gu, '/')}/`;
    const args = ['checkout-index', '--all', '--force', `--prefix=${prefix}`];
    gitBytes(
      projectRoot,
      args,
      undefined,
      pureGitReadEnvironment(process.env),
      retainedSnapshot
    );
    return Object.freeze({ snapshotRoot, relativePath, lifecycle });
  } catch (error) {
    try {
      if (lifecycle === null) {
        await fs.rm(snapshotRoot, { recursive: true, force: true });
      } else {
        await lifecycle.disposed(relativePath, 'materialization-failed');
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Import candidate snapshot materialization and lifecycle cleanup both failed.'
      );
    }
    throw error;
  } finally {
    retainedSnapshot.dispose();
  }
}

function gitIndexPath(projectRoot: string): string {
  const configured = gitText(projectRoot, ['rev-parse', '--git-path', 'index']).trim();
  if (configured.length === 0) throw new Error('Git index path is unavailable');
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(projectRoot, configured);
}

async function workingTreeMatchesIndex(projectRoot: string): Promise<boolean> {
  const indexPath = gitIndexPath(projectRoot);
  const observationIndexPath = `${indexPath}.imports-observation-${process.pid}-${randomUUID()}`;
  const observationLockPath = `${observationIndexPath}.lock`;
  await fs.copyFile(indexPath, observationIndexPath);
  const environment = {
    ...pureGitReadEnvironment(process.env),
    GIT_INDEX_FILE: observationIndexPath
  };
  try {
    return gitBytes(
      projectRoot,
      ['diff', '--name-status', '-z', '--'],
      undefined,
      environment
    ).byteLength === 0 && gitBytes(
      projectRoot,
      ['ls-files', '--others', '--exclude-standard', '-z', '--'],
      undefined,
      environment
    ).byteLength === 0;
  } finally {
    await fs.rm(observationLockPath, { force: true });
    await fs.rm(observationIndexPath, { force: true });
  }
}

async function candidateContext(
  projectRoot: string,
  testHooks: StagedImportOrganizerTestHooks
): Promise<{
  readonly root: string;
  readonly snapshotRoot: string | null;
  readonly snapshotRelativePath: string | null;
  readonly snapshotLifecycle: ImportSnapshotLifecycleV1 | null;
  readonly mode: 'working-tree' | 'snapshot';
}> {
  if (await workingTreeMatchesIndex(projectRoot)) {
    await testHooks.candidateContext?.('working-tree');
    return Object.freeze({
      root: projectRoot,
      snapshotRoot: null,
      snapshotRelativePath: null,
      snapshotLifecycle: null,
      mode: 'working-tree'
    });
  }
  const snapshot = await materializeCandidateIndex(
    projectRoot,
    testHooks.generatedStateLifecycle,
    testHooks.beforeCandidateSnapshotWrite
  );
  await testHooks.candidateContext?.('snapshot');
  return Object.freeze({
    root: snapshot.snapshotRoot,
    snapshotRoot: snapshot.snapshotRoot,
    snapshotRelativePath: snapshot.relativePath,
    snapshotLifecycle: snapshot.lifecycle,
    mode: 'snapshot'
  });
}

async function disposeCandidateContextV1(context: Readonly<{
  snapshotRoot: string | null;
  snapshotRelativePath: string | null;
  snapshotLifecycle: ImportSnapshotLifecycleV1 | null;
}>): Promise<void> {
  if (context.snapshotRoot === null) return;
  if (context.snapshotLifecycle !== null && context.snapshotRelativePath !== null) {
    await context.snapshotLifecycle.disposed(context.snapshotRelativePath, 'candidate-snapshot-consumed');
    return;
  }
  await fs.rm(context.snapshotRoot, { recursive: true, force: true });
}

function decodeTypeScriptBlob(bytes: Buffer, gitPath: string): string {
  const source = bytes.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`TypeScript staged blob is not valid UTF-8: ${gitPath}`);
  }
  return source;
}

function readStagedBlobs(
  projectRoot: string,
  selectedEntries: readonly StagedIndexEntry[]
): ReadonlyMap<string, Buffer> {
  const input = Buffer.from(`${selectedEntries.map((entry) => entry.objectId).join('\n')}\n`, 'utf8');
  const output = gitBytes(projectRoot, ['cat-file', '--batch'], input);
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of selectedEntries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error('git cat-file --batch returned an incomplete header');
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]{40,64}) blob ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== entry.objectId) {
      throw new Error(`git cat-file --batch returned an invalid blob header for ${entry.path}`);
    }
    const byteLength = Number(match[2]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new Error(`git cat-file --batch returned an invalid blob length for ${entry.path}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + byteLength;
    if (contentEnd >= output.byteLength || output[contentEnd] !== 0x0a) {
      throw new Error(`git cat-file --batch returned incomplete blob bytes for ${entry.path}`);
    }
    blobs.set(entry.path, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== output.byteLength) {
    throw new Error('git cat-file --batch returned trailing bytes');
  }
  return blobs;
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

type ImportSourceSnapshotV1 = Readonly<{
  relativePath: string;
  absolutePath: string;
  bytes: Buffer;
  text: string;
}>;

type NormalizedImportSnapshotV1 = Readonly<{
  source: ImportSourceSnapshotV1;
  replacementBytes: Buffer;
}>;

/**
 * The only semantic import-normalization kernel. Snapshot adapters may read
 * bytes from the worktree or Git index, but both must submit the same shape to
 * this function. TypeScript remains the sole ordering/combining provider.
 */
function normalizeImportSnapshotsV1(
  config: ts.ParsedCommandLine,
  projectRoot: string,
  sources: readonly ImportSourceSnapshotV1[],
  intent: ImportTransformIntentV1 = 'sort-and-combine'
): readonly NormalizedImportSnapshotV1[] {
  const ordered = [...sources].sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  if (new Set(ordered.map((source) => source.relativePath)).size !== ordered.length) {
    throw new Error('Import normalization received duplicate repository paths');
  }
  const serviceFiles = new Map<string, { version: number; content: string }>(
    ordered.map((source) => [source.absolutePath, { version: 0, content: source.text }])
  );
  const service = createImportService(
    config,
    projectRoot,
    importServiceRootFileNames(config, ordered.map((source) => source.absolutePath)),
    serviceFiles
  );
  try {
    return Object.freeze(ordered.map((source) => Object.freeze({
      source,
      replacementBytes: Buffer.from(
        organizeImportsInSource(service, source.absolutePath, source.text, intent),
        'utf8'
      )
    })));
  } finally {
    service.dispose();
  }
}

function assertIndexUnchanged(
  projectRoot: string,
  targetPaths: readonly string[],
  selectedEntries: readonly StagedIndexEntry[],
  candidateBase: string | undefined
): void {
  const currentTargets = stagedTypeScriptTargets(projectRoot, candidateBase);
  if (!canonicalEquals(currentTargets, targetPaths)) {
    throw new Error('Git index changed while organizing staged TypeScript imports');
  }
  const currentEntries = selectStagedEntries(readIndexEntries(projectRoot), targetPaths);
  if (!canonicalEquals(currentEntries, selectedEntries)) {
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
  const indexPath = gitIndexPath(projectRoot);
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
    for (const update of updates) {
      const publishedObjectId = gitText(
        projectRoot,
        ['hash-object', '-w', '--stdin'],
        update.normalizedBytes,
        process.env
      ).trim();
      if (publishedObjectId !== update.normalizedObjectId) {
        throw new Error(`Published Git object identity changed for ${update.entry.path}`);
      }
    }
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
  } finally {
    if (lock !== null) await lock.close().catch(() => undefined);
    await fs.rm(alternateLockPath, { force: true }).catch(() => undefined);
    await fs.rm(alternateIndexPath, { force: true }).catch(() => undefined);
    if (ownsLock && !published) await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

type StagedImportComputationV1 = Readonly<{
  candidateBase: string | undefined;
  targetPaths: readonly string[];
  selectedEntries: readonly StagedIndexEntry[];
  updates: readonly StagedImportUpdate[];
  context: Awaited<ReturnType<typeof candidateContext>>;
}>;

async function computeStagedImportUpdates(
  projectRoot: string,
  testHooks: StagedImportOrganizerTestHooks,
  selection: StagedImportSelection
): Promise<StagedImportComputationV1 | null> {
  const candidateBase = resolvedCandidateBase(projectRoot, selection.candidateBase);
  const targetPaths = stagedTypeScriptTargets(projectRoot, candidateBase);
  const indexEntries = readIndexEntries(projectRoot);
  if (targetPaths.length === 0) {
    const unresolved = indexEntries.find((entry) => entry.stage !== 0 && isTypeScriptPath(entry.path));
    if (unresolved) {
      throw new CompilerError(
        'IMPORT-PARTIAL-STAGE-CONFLICT',
        `Cannot organize unresolved TypeScript index stages: ${unresolved.path}`,
        { path: unresolved.path }
      );
    }
    return null;
  }
  const selectedEntries = selectStagedEntries(indexEntries, targetPaths);

  const context = candidateBase === undefined
    ? Object.freeze({
      root: projectRoot,
      snapshotRoot: null,
      snapshotRelativePath: null,
      snapshotLifecycle: null,
      mode: 'working-tree' as const
    })
    : await candidateContext(projectRoot, testHooks);
  const contextRoot = context.root;
  try {
    const config = loadProjectConfig(contextRoot);
    const blobs = readStagedBlobs(projectRoot, selectedEntries);
    const sources = selectedEntries.map((entry): ImportSourceSnapshotV1 => {
      const bytes = blobs.get(entry.path);
      if (!bytes) throw new Error(`TypeScript staged blob was not batch-loaded: ${entry.path}`);
      return Object.freeze({
        relativePath: entry.path,
        absolutePath: absoluteRepositoryPath(contextRoot, entry.path),
        bytes,
        text: decodeTypeScriptBlob(bytes, entry.path)
      });
    });
    const normalized = normalizeImportSnapshotsV1(config, contextRoot, sources);
    const updates: StagedImportUpdate[] = [];
    for (let index = 0; index < selectedEntries.length; index += 1) {
      const entry = selectedEntries[index]!;
      const result = normalized[index]!;
      if (result.source.relativePath !== entry.path) {
        throw new Error('Import normalization changed canonical staged path order');
      }
      if (result.replacementBytes.equals(result.source.bytes)) continue;
      testHooks.beforeHash?.(entry.path);
      const normalizedObjectId = gitText(projectRoot, ['hash-object', '--stdin'], result.replacementBytes).trim();
      if (!/^[0-9a-f]{40,64}$/u.test(normalizedObjectId)) {
        throw new Error(`git hash-object returned an invalid object ID for ${entry.path}`);
      }
      updates.push(Object.freeze({
        entry,
        normalizedBytes: result.replacementBytes,
        normalizedObjectId
      }));
    }

    if (candidateBase !== undefined && context.mode === 'working-tree'
        && !await workingTreeMatchesIndex(projectRoot)) {
      throw new Error('Working tree or untracked paths changed while organizing candidate imports');
    }

    return Object.freeze({ candidateBase, targetPaths, selectedEntries,
      updates: Object.freeze(updates), context });
  } catch (error) {
    if (context.snapshotRoot !== null) {
      try {
        await disposeCandidateContextV1(context);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Import candidate computation and lifecycle cleanup both failed.'
        );
      }
    }
    throw error;
  }
}

function disposeStagedComputation(computation: StagedImportComputationV1): Promise<void> {
  return disposeCandidateContextV1(computation.context);
}

export async function runStagedImportCheck(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  selection: StagedImportSelection = {}
): Promise<ImportCheckOutcomeV1> {
  const computed = await computeStagedImportUpdates(projectRoot, testHooks, selection);
  if (computed === null) {
    return Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
      status: 'canonical' as const, files: Object.freeze([]) });
  }
  try {
    if (computed.updates.length === 0) {
      return Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
        status: 'canonical' as const, files: Object.freeze([]) });
    }
    return Object.freeze({
      schema: 'sec-import-check-outcome-v1' as const,
      status: 'needs-import-transform' as const,
      files: Object.freeze(computed.updates.map((update) => update.entry.path))
    });
  } finally {
    await disposeStagedComputation(computed);
  }
}

export async function runStagedImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  selection: StagedImportSelection = {}
): Promise<number> {
  const computed = await computeStagedImportUpdates(projectRoot, testHooks, selection);
  if (computed === null) {
    console.log('No staged TypeScript import targets selected.');
    return 0;
  }
  try {
    if (computed.updates.length === 0) {
      console.log('Staged TypeScript imports are organized.');
      return 0;
    }
    await publishStagedIndex(
      projectRoot,
      computed.targetPaths,
      computed.selectedEntries,
      computed.updates,
      testHooks,
      computed.candidateBase
    );
    const fileList = computed.updates.map((update) => `- ${update.entry.path}`).join('\n');
    const scope = computed.candidateBase === undefined ? 'staged' : 'candidate';
    console.log(`Organized ${scope} imports in ${computed.updates.length} file(s); working tree unchanged:\n${fileList}`);
    return 0;
  } finally {
    await disposeStagedComputation(computed);
  }
}

export async function runCandidateImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  env: ImportSelectionEnvironment = process.env
): Promise<number> {
  const candidateBase = resolveCandidateImportBase(projectRoot, undefined, env);
  return runStagedImportOrganizer(projectRoot, testHooks, { candidateBase });
}

export async function runCandidateImportCheck(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  env: ImportSelectionEnvironment = process.env
): Promise<ImportCheckOutcomeV1> {
  const candidateBase = resolveCandidateImportBase(projectRoot, undefined, env);
  return runStagedImportCheck(projectRoot, testHooks, { candidateBase });
}

async function compileImportOperationExecutionV1(
  options: ImportOperationOptionsV1 = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<CompiledImportOperationPlanV1> {
  const intent = options.intent ?? 'sort-and-combine';
  const scope = options.scope ?? 'candidate';
  if (scope === 'all' && options.candidateBase !== undefined) {
    throw new Error('Full-repository import scope cannot also select a candidate base');
  }

  const config = loadProjectConfig(projectRoot);
  const candidateBase = scope === 'candidate'
    ? resolveCandidateImportBase(projectRoot, options.candidateBase, env)
    : null;
  const selectedPaths = scope === 'candidate'
    ? workingTreeTypeScriptTargets(projectRoot, candidateBase!, env)
    : null;
  // Git owns the candidate surface. A changed TypeScript module can be a
  // transitive program node without being a tsconfig root (tooling is the
  // canonical example), so filtering candidate paths through config.fileNames
  // would make working-tree check/apply disagree with staged freeze. tsconfig
  // still owns compiler options and declaration roots; it cannot shrink the
  // exact Git-selected candidate.
  const selectedCandidates = Object.freeze((selectedPaths === null
    ? [...config.fileNames]
    : selectedPaths.map((gitPath) => absoluteRepositoryPath(projectRoot, gitPath)))
    .sort((left, right) => {
      const leftPath = relativePosixPath(projectRoot, left);
      const rightPath = relativePosixPath(projectRoot, right);
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    }));

  const sources = (await Promise.all(selectedCandidates.map(async (fileName): Promise<ImportSourceSnapshotV1 | null> => {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(fileName);
    } catch (error) {
      // A path changed earlier in the branch may be deleted in the current
      // working candidate. Deletion has no import bytes to normalize.
      if (scope === 'candidate' && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error(`Import target is not exact UTF-8: ${relativePosixPath(projectRoot, fileName)}`);
    }
    return Object.freeze({
      relativePath: relativePosixPath(projectRoot, fileName),
      absolutePath: fileName,
      bytes,
      text
    });
  }))).filter((source): source is ImportSourceSnapshotV1 => source !== null);
  const normalized = normalizeImportSnapshotsV1(config, projectRoot, sources, intent);
  const targets: Array<ImportOperationPlanV1['targets'][number]> = [];
  const writes: Array<CompiledImportOperationPlanV1['writes'][number]> = [];
  for (const result of normalized) {
    const changed = !result.replacementBytes.equals(result.source.bytes);
    targets.push(Object.freeze({
      relativePath: result.source.relativePath,
      preimageDigest: rawSha256(result.source.bytes),
      replacementDigest: rawSha256(result.replacementBytes),
      changed
    }));
    if (changed) {
      writes.push(Object.freeze({
        relativePath: result.source.relativePath,
        expectedBytes: result.source.bytes,
        replacementBytes: result.replacementBytes
      }));
    }
  }

  const projectConfigDigest = sha256({
    rawProjectConfig: JSON.parse(JSON.stringify(config.raw ?? {})) as unknown
  }) as `sha256:${string}`;
  const identity = Object.freeze({
    schema: 'sec-import-operation-plan-v1' as const,
    intent,
    scope,
    candidateBase,
    providerRevision: `typescript@${ts.version}`,
    projectConfigDigest,
    targets: Object.freeze(targets),
    writePaths: Object.freeze(writes.map((write) => write.relativePath))
  });
  const plan = Object.freeze({
    ...identity,
    planDigest: sha256(identity) as `sha256:${string}`
  });
  return Object.freeze({ plan, writes: Object.freeze(writes) });
}

export async function compileImportOperationPlanV1(
  options: ImportOperationOptionsV1 = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportOperationPlanV1> {
  return (await compileImportOperationExecutionV1(options, projectRoot, env)).plan;
}

export async function runImportCheck(
  options: ImportOperationOptionsV1 = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportCheckOutcomeV1> {
  const { plan } = await compileImportOperationExecutionV1(options, projectRoot, env);
  return plan.writePaths.length === 0
    ? Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
      status: 'canonical' as const, files: Object.freeze([]) })
    : Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
      status: 'needs-import-transform' as const, files: plan.writePaths });
}

export async function runImportApply(
  options: ImportOperationOptionsV1 & {
    transactionTestHooks?: ImportTransformTransactionTestHooksV1;
  } = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportApplyOutcomeV1> {
  const { transactionTestHooks, ...planOptions } = options;
  const compiled = await compileImportOperationExecutionV1(planOptions, projectRoot, env);
  if (compiled.writes.length === 0) {
    return Object.freeze({
      schema: 'sec-import-apply-outcome-v1' as const,
      status: 'noop' as const,
      files: Object.freeze([]),
      planDigest: compiled.plan.planDigest
    });
  }
  const outcome = await publishImportTransformTransactionV1(
    projectRoot,
    compiled.writes,
    transactionTestHooks
  );
  return Object.freeze({
    schema: 'sec-import-apply-outcome-v1' as const,
    status: outcome.status,
    files: outcome.files,
    planDigest: compiled.plan.planDigest,
    transactionId: outcome.transactionId,
    journalPath: outcome.journalPath,
    ...(outcome.status === 'accepted' ? {} : { reasonCode: outcome.reasonCode })
  }) as ImportApplyOutcomeV1;
}
