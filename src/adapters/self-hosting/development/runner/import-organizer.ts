import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { GeneratedStateCleanupProfile, GeneratedStateDisposalReceipt } from '../../../runtime-state/generated-state/contract.ts';
import { assertGeneratedStateDisposalReceipt } from '../../../runtime-state/generated-state/lifecycle.ts';
import { inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, type RetainedNoFollowChildProcessDirectory } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

import { CompilerError } from '../../../../compiler/errors.ts';
import { canonicalEquals, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { relativePosixPath } from '../../../../contracts/relative-path.ts';
import { ensureDir } from "../../../filesystem/files.ts";
import { compilerRoot } from "../../../workspace-context.ts";
import {
  normalizeImportSnapshots,
  type ImportCheckOutcome,
  type ImportSourceSnapshot,
  type ImportTransformIntent
} from '../import-normalization/kernel.ts';
import {
  publishImportTransformTransaction,
  type ImportTransformTransactionTestHooks
} from './import-transform-transaction.ts';

// Inline sync parse cache. The exact already-read config text is the reuse
// identity. Hashing it would add a second full pass plus collision semantics
// without reducing I/O; this cache dies with the process and has no wire format.
const tsconfigCache = new Map<string, { source: string; value: { config?: unknown; error?: ts.Diagnostic } }>();
function cachedParseConfigFile(configPath: string): { config?: unknown; error?: ts.Diagnostic } {
  const source = readFileSync(configPath, 'utf8');
  const existing = tsconfigCache.get(configPath);
  if (existing !== undefined && existing.source === source) return existing.value;
  const value = ts.parseConfigFileTextToJson(configPath, source);
  tsconfigCache.set(configPath, { source, value });
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
type ImportOperationScope = 'candidate' | 'all';

export type ImportOperationOptions = Readonly<{
  intent?: ImportTransformIntent;
  scope?: ImportOperationScope;
  candidateBase?: string;
}>;

export type ImportOperationPlan = Readonly<{
  schema: 'sec-import-operation-plan-v1';
  intent: ImportTransformIntent;
  scope: ImportOperationScope;
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

type CompiledImportOperationPlan = Readonly<{
  plan: ImportOperationPlan;
  writes: readonly Readonly<{
    relativePath: string;
    expectedBytes: Buffer;
    replacementBytes: Buffer;
  }>[];
}>;

export type ImportApplyOutcome =
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
  readonly expectedBytes: Buffer;
  readonly normalizedBytes: Buffer;
  readonly normalizedObjectId: string;
}

interface StagedImportOrganizerTestHooks {
  readonly beforeHash?: (fileName: string) => void;
  readonly afterIndexLock?: () => void | Promise<void>;
  readonly beforeSynchronizedIndexPublish?: () => void | Promise<void>;
  readonly candidateContext?: (mode: 'working-tree' | 'snapshot') => void | Promise<void>;
  readonly beforeCandidateSnapshotWrite?: (snapshotRoot: string) => void | Promise<void>;
  readonly generatedStateLifecycle?: Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
    disposed(
      relativePath: string,
      request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
    ): Promise<GeneratedStateDisposalReceipt>;
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
  retainedDirectory?: RetainedNoFollowChildProcessDirectory
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

type ImportSnapshotLifecycleOwner = Readonly<{
  born(relativePath: string, operationId: string): Promise<void>;
  disposed(
    relativePath: string,
    request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
  ): Promise<GeneratedStateDisposalReceipt>;
}>;

type ImportSnapshotLifecycleReceipt = Readonly<{
  dispose(outcome: string): Promise<GeneratedStateDisposalReceipt>;
}>;

function issueImportSnapshotLifecycleReceipt(
  owner: ImportSnapshotLifecycleOwner,
  relativePath: string
): ImportSnapshotLifecycleReceipt {
  return Object.freeze({
    dispose: async (outcome) => {
      const receipt = await owner.disposed(relativePath, { outcome, profile: 'automatic' });
      assertGeneratedStateDisposalReceipt(receipt);
      if (receipt.relativePath !== relativePath || receipt.profile !== 'automatic') {
        throw new Error('Import snapshot lifecycle disposal receipt differs from its owner request.');
      }
      return receipt;
    }
  });
}

type MaterializedCandidateIndex = Readonly<{
  snapshotRoot: string;
  lifecycle: ImportSnapshotLifecycleReceipt | null;
}>;

async function materializeCandidateIndex(
  projectRoot: string,
  lifecycleOverride?: StagedImportOrganizerTestHooks['generatedStateLifecycle'],
  beforeWrite?: StagedImportOrganizerTestHooks['beforeCandidateSnapshotWrite']
): Promise<MaterializedCandidateIndex> {
  const snapshotsRoot = path.join(projectRoot, '.tmp', 'import-candidate-snapshots');
  const operationId = randomUUID();
  const snapshotName = `snapshot-${operationId}`;
  const relativePath = `.tmp/import-candidate-snapshots/${snapshotName}`;
  const snapshotRoot = path.join(snapshotsRoot, snapshotName);
  let lifecycleOwner: ImportSnapshotLifecycleOwner | null = null;
  let lifecycleReceipt: ImportSnapshotLifecycleReceipt | null = null;
  await ensureDir(snapshotRoot);
  const retainedSnapshot = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(snapshotRoot, 'Import candidate snapshot'),
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
      lifecycleOwner = lifecycleOverride;
      await lifecycleOwner.born(relativePath, `import-candidate-snapshot:${operationId}`);
      lifecycleReceipt = issueImportSnapshotLifecycleReceipt(lifecycleOwner, relativePath);
    } else if (sameCompilerRoot) {
      const { generatedStateProducerHooks } = await import(
        '../../../runtime-state/generated-state/lifecycle.ts'
      );
      lifecycleOwner = generatedStateProducerHooks({ repositoryRoot: projectRoot });
      await lifecycleOwner.born(relativePath, `import-candidate-snapshot:${operationId}`);
      lifecycleReceipt = issueImportSnapshotLifecycleReceipt(lifecycleOwner, relativePath);
    }
    await beforeWrite?.(snapshotRoot);
    const prefix = `${retainedSnapshot.childPath.replace(/\\/gu, '/')}/`;
    // The index may contain canonical content-addressed owner names whose
    // absolute snapshot path exceeds Win32's legacy MAX_PATH. Keep this
    // invocation self-contained instead of relying on mutable repository or
    // machine Git configuration.
    const args = ['-c', 'core.longpaths=true', 'checkout-index', '--all', '--force', `--prefix=${prefix}`];
    gitBytes(
      projectRoot,
      args,
      undefined,
      pureGitReadEnvironment(process.env),
      retainedSnapshot
    );
    return Object.freeze({ snapshotRoot, lifecycle: lifecycleReceipt });
  } catch (error) {
    try {
      if (lifecycleOwner === null) {
        await fs.rm(snapshotRoot, { recursive: true, force: true });
      } else if (lifecycleReceipt !== null) {
        await lifecycleReceipt.dispose('materialization-failed');
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
  readonly snapshotLifecycle: ImportSnapshotLifecycleReceipt | null;
  readonly mode: 'working-tree' | 'snapshot';
}> {
  if (await workingTreeMatchesIndex(projectRoot)) {
    await testHooks.candidateContext?.('working-tree');
    return Object.freeze({
      root: projectRoot,
      snapshotRoot: null,
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
    snapshotLifecycle: snapshot.lifecycle,
    mode: 'snapshot'
  });
}

async function disposeCandidateContext(context: Readonly<{
  snapshotRoot: string | null;
  snapshotLifecycle: ImportSnapshotLifecycleReceipt | null;
}>): Promise<void> {
  if (context.snapshotRoot === null) return;
  if (context.snapshotLifecycle !== null) {
    await context.snapshotLifecycle.dispose('candidate-snapshot-consumed');
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

function assertIndexUnchanged(
  projectRoot: string,
  targetPaths: readonly string[],
  selectedEntries: readonly StagedIndexEntry[],
  candidateBase: string | undefined
): void {
  const currentTargets = stagedTypeScriptTargets(projectRoot, candidateBase);
  const targetSet = new Set(targetPaths);
  const unexpectedTargets = currentTargets.filter((targetPath) => !targetSet.has(targetPath));
  if (unexpectedTargets.length > 0) {
    throw new Error(
      `Git index gained an unexpected TypeScript target while organizing staged imports: ${unexpectedTargets.join(', ')}`
    );
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
  const publication = await prepareStagedIndexPublication(
    projectRoot,
    targetPaths,
    selectedEntries,
    updates,
    testHooks,
    candidateBase
  );
  try {
    await publication.commit();
  } finally {
    await publication.dispose();
  }
}

type PreparedStagedIndexPublication = Readonly<{
  commit(): Promise<void>;
  dispose(): Promise<void>;
  isPublished(): boolean;
}>;

async function prepareStagedIndexPublication(
  projectRoot: string,
  targetPaths: readonly string[],
  selectedEntries: readonly StagedIndexEntry[],
  updates: readonly StagedImportUpdate[],
  testHooks: StagedImportOrganizerTestHooks,
  candidateBase: string | undefined
): Promise<PreparedStagedIndexPublication> {
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
    return Object.freeze({
      commit: async () => {
        if (published || lock === null) {
          throw new Error('Prepared staged index publication is no longer live');
        }
        await lock.writeFile(completedIndex);
        await lock.sync();
        await lock.close();
        lock = null;
        await fs.rename(lockPath, indexPath);
        published = true;
        if (!(await fs.readFile(indexPath)).equals(completedIndex)) {
          throw new Error('Published Git index bytes failed exact readback');
        }
      },
      dispose: async () => {
        if (lock !== null) {
          await lock.close().catch(() => undefined);
          lock = null;
        }
        await fs.rm(alternateLockPath, { force: true }).catch(() => undefined);
        await fs.rm(alternateIndexPath, { force: true }).catch(() => undefined);
        if (ownsLock && !published) await fs.rm(lockPath, { force: true }).catch(() => undefined);
      },
      isPublished: () => published
    });
  } catch (error) {
    if (lock !== null) await lock.close().catch(() => undefined);
    await fs.rm(alternateLockPath, { force: true }).catch(() => undefined);
    await fs.rm(alternateIndexPath, { force: true }).catch(() => undefined);
    if (ownsLock && !published) await fs.rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

type StagedImportComputation = Readonly<{
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
): Promise<StagedImportComputation | null> {
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
      snapshotLifecycle: null,
      mode: 'working-tree' as const
    })
    : await candidateContext(projectRoot, testHooks);
  const contextRoot = context.root;
  try {
    const config = loadProjectConfig(contextRoot);
    const blobs = readStagedBlobs(projectRoot, selectedEntries);
    const sources = selectedEntries.map((entry): ImportSourceSnapshot => {
      const bytes = blobs.get(entry.path);
      if (!bytes) throw new Error(`TypeScript staged blob was not batch-loaded: ${entry.path}`);
      return Object.freeze({
        relativePath: entry.path,
        absolutePath: absoluteRepositoryPath(contextRoot, entry.path),
        bytes,
        text: decodeTypeScriptBlob(bytes, entry.path)
      });
    });
    const normalized = normalizeImportSnapshots(config, contextRoot, sources);
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
        expectedBytes: Buffer.from(result.source.bytes),
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
        await disposeCandidateContext(context);
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

function disposeStagedComputation(computation: StagedImportComputation): Promise<void> {
  return disposeCandidateContext(computation.context);
}

export async function runStagedImportCheck(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  selection: StagedImportSelection = {}
): Promise<ImportCheckOutcome> {
  if (Object.keys(testHooks).length > 0) {
    throw new Error('Staged import checks do not accept effect test hooks');
  }
  const [{ withAuthorityGitReadSession }, { GIT_READ_EXACT_TREE_OPERATION_BUDGET }, {
    checkStagedCandidateImportNormalization
  }] = await Promise.all([
    import('../../../providers/git-read/authority.ts'),
    import('../../../providers/git-read/runtime/session.ts'),
    import('../import-normalization/runtime.ts')
  ]);
  return withAuthorityGitReadSession({
    cwd: projectRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, (session) => checkStagedCandidateImportNormalization({
    session,
    ...(selection.candidateBase === undefined ? {} : {
      candidateBase: selection.candidateBase
    })
  }));
}

export async function runStagedIndexOnlyImportOrganizer(
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

async function assertSynchronizedWorktreePreimages(
  projectRoot: string,
  updates: readonly StagedImportUpdate[]
): Promise<void> {
  for (const update of updates) {
    const absolutePath = absoluteRepositoryPath(projectRoot, update.entry.path);
    let metadata: Awaited<ReturnType<typeof fs.lstat>>;
    let bytes: Buffer;
    try {
      metadata = await fs.lstat(absolutePath);
      bytes = await fs.readFile(absolutePath);
    } catch (error) {
      throw new CompilerError(
        'IMPORT-STAGED-WORKTREE-DIVERGED',
        `Cannot synchronize staged imports because the worktree preimage is unavailable: ${update.entry.path}`,
        { path: update.entry.path, cause: String(error) }
      );
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || !bytes.equals(update.expectedBytes)) {
      throw new CompilerError(
        'IMPORT-STAGED-WORKTREE-DIVERGED',
        `Cannot synchronize staged imports because index and worktree bytes differ: ${update.entry.path}`,
        { path: update.entry.path }
      );
    }
  }
}

function synchronizedWorktreeWrites(
  updates: readonly StagedImportUpdate[],
  direction: 'forward' | 'rollback'
): readonly Readonly<{
  relativePath: string;
  expectedBytes: Buffer;
  replacementBytes: Buffer;
}>[] {
  return Object.freeze(updates.map((update) => Object.freeze({
    relativePath: update.entry.path,
    expectedBytes: Buffer.from(direction === 'forward' ? update.expectedBytes : update.normalizedBytes),
    replacementBytes: Buffer.from(direction === 'forward' ? update.normalizedBytes : update.expectedBytes)
  })));
}

/**
 * Author-facing staged apply owns both visible source images. It refuses a
 * partial-stage preimage before any publication, then holds the real Git index
 * lock while the canonical durable worktree transaction publishes and reads
 * back the same replacement bytes. A failure before index publication is
 * rolled back through that same transaction owner; its journal paths are
 * returned in the typed failure instead of asking callers to reconstruct bytes
 * from stdout or `git show` presentation.
 */
export async function runSynchronizedStagedImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  selection: StagedImportSelection = {}
): Promise<number> {
  const computed = await computeStagedImportUpdates(projectRoot, testHooks, selection);
  if (computed === null) {
    console.log('No staged TypeScript import targets selected.');
    return 0;
  }
  let indexPublication: PreparedStagedIndexPublication | null = null;
  let forwardJournalPath: string | null = null;
  try {
    if (computed.updates.length === 0) {
      console.log('Staged TypeScript imports are organized.');
      return 0;
    }
    await assertSynchronizedWorktreePreimages(projectRoot, computed.updates);
    indexPublication = await prepareStagedIndexPublication(
      projectRoot,
      computed.targetPaths,
      computed.selectedEntries,
      computed.updates,
      testHooks,
      computed.candidateBase
    );
    await assertSynchronizedWorktreePreimages(projectRoot, computed.updates);
    const forward = await publishImportTransformTransaction(
      projectRoot,
      synchronizedWorktreeWrites(computed.updates, 'forward')
    );
    forwardJournalPath = forward.journalPath;
    if (forward.status !== 'accepted') {
      throw new CompilerError(
        'IMPORT-STAGED-SYNC-RECOVERY-REQUIRED',
        `Synchronized staged import worktree publication did not reach accepted: ${forward.status}`,
        { journalPath: forward.journalPath, reasonCode: forward.reasonCode }
      );
    }
    try {
      await testHooks.beforeSynchronizedIndexPublish?.();
      await indexPublication.commit();
    } catch (error) {
      if (indexPublication.isPublished()) {
        throw new CompilerError(
          'IMPORT-STAGED-SYNC-RECOVERY-REQUIRED',
          'Synchronized staged import index publication crossed its atomic rename but exact readback failed.',
          { forwardJournalPath, cause: String(error) }
        );
      }
      const rollback = await publishImportTransformTransaction(
        projectRoot,
        synchronizedWorktreeWrites(computed.updates, 'rollback')
      );
      if (rollback.status !== 'accepted') {
        throw new CompilerError(
          'IMPORT-STAGED-SYNC-RECOVERY-REQUIRED',
          'Synchronized staged import publication and rollback require owner recovery.',
          {
            forwardJournalPath,
            rollbackJournalPath: rollback.journalPath,
            rollbackStatus: rollback.status,
            rollbackReasonCode: rollback.reasonCode,
            cause: String(error)
          }
        );
      }
      throw new CompilerError(
        'IMPORT-STAGED-SYNC-ROLLED-BACK',
        'Synchronized staged import publication failed before index commit and was rolled back exactly.',
        { forwardJournalPath, rollbackJournalPath: rollback.journalPath, cause: String(error) }
      );
    }
    for (const update of computed.updates) {
      const worktreeBytes = await fs.readFile(absoluteRepositoryPath(projectRoot, update.entry.path));
      if (!worktreeBytes.equals(update.normalizedBytes)) {
        throw new CompilerError(
          'IMPORT-STAGED-SYNC-RECOVERY-REQUIRED',
          `Synchronized staged import worktree readback drifted: ${update.entry.path}`,
          { path: update.entry.path, forwardJournalPath }
        );
      }
    }
    const normalizedByPath = new Map(computed.updates.map((update) => [
      update.entry.path,
      update.normalizedObjectId
    ]));
    assertIndexUnchanged(
      projectRoot,
      computed.targetPaths,
      computed.selectedEntries.map((entry) => Object.freeze({
        ...entry,
        objectId: normalizedByPath.get(entry.path) ?? entry.objectId
      })),
      computed.candidateBase
    );
    console.log(`Synchronized staged imports in ${computed.updates.length} file(s); exact index and worktree readback accepted.`);
    return 0;
  } finally {
    await indexPublication?.dispose();
    await disposeStagedComputation(computed);
  }
}

export async function runCandidateImportOrganizer(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  env: ImportSelectionEnvironment = process.env
): Promise<number> {
  const candidateBase = resolveCandidateImportBase(projectRoot, undefined, env);
  return runStagedIndexOnlyImportOrganizer(projectRoot, testHooks, { candidateBase });
}

export async function runCandidateImportCheck(
  projectRoot = compilerRoot,
  testHooks: StagedImportOrganizerTestHooks = {},
  env: ImportSelectionEnvironment = process.env
): Promise<ImportCheckOutcome> {
  const candidateBase = resolveCandidateImportBase(projectRoot, undefined, env);
  return runStagedImportCheck(projectRoot, testHooks, { candidateBase });
}

async function compileImportOperationExecution(
  options: ImportOperationOptions = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<CompiledImportOperationPlan> {
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

  const sources = (await Promise.all(selectedCandidates.map(async (fileName): Promise<ImportSourceSnapshot | null> => {
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
  }))).filter((source): source is ImportSourceSnapshot => source !== null);
  const normalized = normalizeImportSnapshots(config, projectRoot, sources, intent);
  const targets: Array<ImportOperationPlan['targets'][number]> = [];
  const writes: Array<CompiledImportOperationPlan['writes'][number]> = [];
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

export async function compileImportOperationPlan(
  options: ImportOperationOptions = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportOperationPlan> {
  return (await compileImportOperationExecution(options, projectRoot, env)).plan;
}

export async function runImportCheck(
  options: ImportOperationOptions = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportCheckOutcome> {
  const { plan } = await compileImportOperationExecution(options, projectRoot, env);
  return plan.writePaths.length === 0
    ? Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
      status: 'canonical' as const, files: Object.freeze([]) })
    : Object.freeze({ schema: 'sec-import-check-outcome-v1' as const,
      status: 'needs-import-transform' as const, files: plan.writePaths });
}

export async function runImportApply(
  options: ImportOperationOptions & {
    transactionTestHooks?: ImportTransformTransactionTestHooks;
  } = {},
  projectRoot = compilerRoot,
  env: ImportSelectionEnvironment = process.env
): Promise<ImportApplyOutcome> {
  const { transactionTestHooks, ...planOptions } = options;
  const compiled = await compileImportOperationExecution(planOptions, projectRoot, env);
  if (compiled.writes.length === 0) {
    return Object.freeze({
      schema: 'sec-import-apply-outcome-v1' as const,
      status: 'noop' as const,
      files: Object.freeze([]),
      planDigest: compiled.plan.planDigest
    });
  }
  const outcome = await publishImportTransformTransaction(
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
  }) as ImportApplyOutcome;
}
