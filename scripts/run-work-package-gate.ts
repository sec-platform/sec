import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink
} from 'node:fs/promises';
import path from 'node:path';

import {
  runObservedCommand,
  type ObservedCommandOutcome
} from '../platform/shared/observed-process.ts';
import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import { recoverWindowsAppContainerOwnedTransaction } from '../platform/shared/windows-appcontainer-executor.ts';
import { acquireWorkspaceWriteLease } from '../platform/shared/workspace-write-lease.ts';
import {
  assertWorkPackageGateEvent,
  assertWorkPackageGateEvidence,
  assertWorkPackageGateEvidenceBundle,
  finalizeWorkPackageGateEvent,
  finalizeWorkPackageGateEvidence,
  parseFrozenWorkPackageGateSelection,
  syncWorkPackageGateDirectory,
  writeWorkPackageGateJsonAtomic,
  type WorkPackageGateChildEvidenceV1,
  type WorkPackageGateEventKind,
  type WorkPackageGateEvidenceV1,
  type WorkPackageGateIdentitySetEvidenceV1,
  type WorkPackageGateResidueCensusV1,
  type WorkPackageGateSelectionV1,
  type WorkPackageGateStateV1,
  type WorkPackageGateStatus
} from './work-package-gate-contract.ts';

const HEARTBEAT_INTERVAL_MS = 15_000;
const PROFILE_PROBE_TIMEOUT_MS = 30_000;
const RECOVERY_OWNER_FILE = '.semantic-mutation-appcontainer-owner-v1.json';
const RECOVERY_OWNER_PENDING_FILE = `${RECOVERY_OWNER_FILE}.pending-v1`;
const PROVISIONAL_OWNER_FILE = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
const PROVISIONAL_OWNER_PENDING_FILE = `${PROVISIONAL_OWNER_FILE}.pending-v1`;
const NATIVE_RESULT_FILE = '.semantic-mutation-appcontainer-result-v1.json';
const WINDOWS_WAIT_OBJECT_0 = 0x0000_0000;
const WINDOWS_WAIT_ABANDONED_0 = 0x0000_0080;
const WINDOWS_WAIT_TIMEOUT = 0x0000_0102;
let gateMutexKernel32Promise: Promise<any> | undefined;

async function loadGateMutexKernel32(): Promise<any> {
  gateMutexKernel32Promise ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('kernel32.dll', {
      CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.u64 },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      ReleaseMutex: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
    } as const);
  })();
  return gateMutexKernel32Promise;
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

export interface WorkPackageGateOptions {
  readonly manifestPath: string;
  readonly selectionManifestPath: string;
  readonly selectionIndex: number;
  readonly watchdogMs: number;
  readonly cleanupMs: number;
  readonly runDir: string;
}

export interface WorkPackageGateDependencies {
  readonly readText: (filePath: string) => Promise<string>;
  readonly pathExists: (filePath: string) => Promise<boolean>;
  readonly gitRevision: (repoRoot: string, revision: string) => string;
  readonly worktreeDigest: (repoRoot: string) => Promise<string>;
  readonly runChild: typeof runObservedCommand;
  readonly census: (
    namespaceRoot: string,
    deadlineAtMs?: number
  ) => Promise<WorkPackageGateResidueCensusV1>;
  readonly recoverOwnedNamespace: (
    namespaceRoot: string,
    deadlineAtMs: number
  ) => Promise<'not-needed' | 'completed' | 'failed'>;
  readonly removeNamespace: (namespaceRoot: string, deadlineAtMs: number) => Promise<boolean>;
  readonly prepareExecutionSnapshot: (
    repoRoot: string,
    snapshotRoot: string,
    headSha: string,
    treeSha: string,
    worktreeDigest: string
  ) => Promise<string>;
  readonly removeExecutionSnapshot: (repoRoot: string, snapshotRoot: string) => Promise<boolean>;
  readonly wallClock: () => Date;
  readonly monotonicNowMs: () => number;
}

function canonicalRelativePath(value: string, prefix: string): string {
  if (!value.startsWith(prefix) || value.includes('\\') || value.startsWith('/') || value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    throw new Error(`Path must be a canonical repository-relative ${prefix} path`);
  }
  return value;
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function gitRevision(repoRoot: string, revision: string): string {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  });
  const value = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('Work Package gate could not resolve repository identity');
  }
  return value;
}

async function defaultWorktreeDigest(repoRoot: string): Promise<string> {
  const diff = spawnSync('git', ['diff', '--binary', '--no-ext-diff', '--full-index', 'HEAD', '--', '.'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true
  });
  if (diff.status !== 0) throw new Error('Work Package gate could not snapshot tracked changes');
  const untrackedResult = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true
  });
  if (untrackedResult.status !== 0) throw new Error('Work Package gate could not snapshot untracked changes');
  const untracked: Array<{ path: string; size: number; digest: string }> = [];
  for (const relativePath of untrackedResult.stdout.split('\0').filter(Boolean).sort()) {
    if (relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.includes('../')) {
      throw new Error('Work Package gate encountered a non-canonical untracked path');
    }
    const bytes = await readFile(path.join(repoRoot, ...relativePath.split('/')));
    untracked.push({
      path: relativePath,
      size: bytes.byteLength,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    });
  }
  return CodexDevelopmentVerificationDigest({
    trackedDiffDigest: `sha256:${createHash('sha256').update(diff.stdout).digest('hex')}`,
    untracked
  });
}

function executionSnapshotParent(repoRoot: string): string {
  return path.join(repoRoot, '.tmp', 'gate-execution-snapshots');
}

const EXECUTION_SNAPSHOT_OWNER_SCHEMA = 'codex-work-package-execution-snapshot-owner-v1' as const;

interface ExecutionSnapshotOwnerV1 {
  readonly schema: typeof EXECUTION_SNAPSHOT_OWNER_SCHEMA;
  readonly repositoryRoot: string;
  readonly snapshotRoot: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly worktreeDigest: string;
}

function executionSnapshotOwnerPath(snapshotRoot: string): string {
  return `${snapshotRoot}.owner-v1.json`;
}

function assertExecutionSnapshotPath(repoRoot: string, snapshotRoot: string): void {
  const parent = path.resolve(executionSnapshotParent(repoRoot));
  const resolved = path.resolve(snapshotRoot);
  if (path.dirname(resolved) !== parent || path.basename(resolved).length === 0) {
    throw new Error('Work Package gate execution snapshot path escaped its authority root');
  }
}

function runGitSnapshotCommand(
  repoRoot: string,
  args: readonly string[],
  options: { readonly input?: Buffer; readonly encoding?: 'buffer' | 'utf8' } = {}
): ReturnType<typeof spawnSync> {
  return spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: options.encoding ?? 'buffer',
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true
  });
}

function canonicalFilesystemIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function expectedExecutionSnapshotOwner(
  repoRoot: string,
  snapshotRoot: string,
  headSha: string,
  treeSha: string,
  worktreeDigest: string
): ExecutionSnapshotOwnerV1 {
  return Object.freeze({
    schema: EXECUTION_SNAPSHOT_OWNER_SCHEMA,
    repositoryRoot: canonicalFilesystemIdentity(repoRoot),
    snapshotRoot: canonicalFilesystemIdentity(snapshotRoot),
    headSha,
    treeSha,
    worktreeDigest
  });
}

async function readExecutionSnapshotOwner(
  repoRoot: string,
  snapshotRoot: string
): Promise<ExecutionSnapshotOwnerV1> {
  const ownerPath = executionSnapshotOwnerPath(snapshotRoot);
  const metadata = await lstat(ownerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('Work Package gate execution snapshot owner is not a regular owned file');
  }
  const parsed = JSON.parse(await readFile(ownerPath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Work Package gate execution snapshot owner is invalid');
  }
  const owner = parsed as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'repositoryRoot', 'snapshotRoot', 'headSha', 'treeSha', 'worktreeDigest'
  ].sort();
  if (JSON.stringify(Object.keys(owner).sort()) !== JSON.stringify(expectedKeys) ||
    owner.schema !== EXECUTION_SNAPSHOT_OWNER_SCHEMA ||
    owner.repositoryRoot !== canonicalFilesystemIdentity(repoRoot) ||
    owner.snapshotRoot !== canonicalFilesystemIdentity(snapshotRoot) ||
    !/^[0-9a-f]{40}$/u.test(String(owner.headSha)) ||
    !/^[0-9a-f]{40}$/u.test(String(owner.treeSha)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(owner.worktreeDigest))) {
    throw new Error('Work Package gate execution snapshot owner binding is invalid');
  }
  return owner as unknown as ExecutionSnapshotOwnerV1;
}

async function ensureExecutionSnapshotOwner(
  repoRoot: string,
  snapshotRoot: string,
  headSha: string,
  treeSha: string,
  worktreeDigest: string
): Promise<void> {
  const expected = expectedExecutionSnapshotOwner(
    repoRoot,
    snapshotRoot,
    headSha,
    treeSha,
    worktreeDigest
  );
  const ownerPath = executionSnapshotOwnerPath(snapshotRoot);
  if (await defaultPathExists(ownerPath)) {
    const existing = await readExecutionSnapshotOwner(repoRoot, snapshotRoot);
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new Error('Work Package gate execution snapshot owner does not match the frozen worktree');
    }
    return;
  }
  if (await defaultPathExists(snapshotRoot)) {
    throw new Error('Work Package gate execution snapshot has no durable owner authority');
  }
  await mkdir(executionSnapshotParent(repoRoot), { recursive: true });
  await writeWorkPackageGateJsonAtomic(ownerPath, expected, (readback) => {
    if (JSON.stringify(readback) !== JSON.stringify(expected)) {
      throw new Error('Work Package gate execution snapshot owner publication failed');
    }
  });
}

function registeredExecutionWorktrees(repoRoot: string): ReadonlySet<string> {
  const result = runGitSnapshotCommand(repoRoot, ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8'
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('Work Package gate could not enumerate execution worktrees');
  }
  return new Set(result.stdout.split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => canonicalFilesystemIdentity(line.slice('worktree '.length))));
}

async function assertOwnedExecutionSnapshotRoot(
  repoRoot: string,
  snapshotRoot: string
): Promise<void> {
  assertExecutionSnapshotPath(repoRoot, snapshotRoot);
  await readExecutionSnapshotOwner(repoRoot, snapshotRoot);
  const metadata = await lstat(snapshotRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    canonicalFilesystemIdentity(await realpath(snapshotRoot)) !==
      canonicalFilesystemIdentity(snapshotRoot) ||
    !registeredExecutionWorktrees(repoRoot).has(canonicalFilesystemIdentity(snapshotRoot))) {
    throw new Error('Work Package gate execution snapshot is not an owned registered worktree');
  }
}

async function defaultRemoveExecutionSnapshot(repoRoot: string, snapshotRoot: string): Promise<boolean> {
  assertExecutionSnapshotPath(repoRoot, snapshotRoot);
  const ownerPath = executionSnapshotOwnerPath(snapshotRoot);
  if (!await defaultPathExists(snapshotRoot)) {
    runGitSnapshotCommand(repoRoot, ['worktree', 'prune'], { encoding: 'utf8' });
    if (await defaultPathExists(ownerPath)) {
      await readExecutionSnapshotOwner(repoRoot, snapshotRoot);
      await unlink(ownerPath);
      await syncWorkPackageGateDirectory(executionSnapshotParent(repoRoot));
    }
    return true;
  }
  await assertOwnedExecutionSnapshotRoot(repoRoot, snapshotRoot);
  const removed = runGitSnapshotCommand(
    repoRoot,
    ['worktree', 'remove', '--force', snapshotRoot],
    { encoding: 'utf8' }
  );
  if (removed.status !== 0) return false;
  runGitSnapshotCommand(repoRoot, ['worktree', 'prune'], { encoding: 'utf8' });
  if (await defaultPathExists(snapshotRoot)) return false;
  await unlink(ownerPath);
  await syncWorkPackageGateDirectory(executionSnapshotParent(repoRoot));
  return !await defaultPathExists(ownerPath);
}

async function defaultPrepareExecutionSnapshot(
  repoRoot: string,
  snapshotRoot: string,
  headSha: string,
  treeSha: string,
  worktreeDigest: string
): Promise<string> {
  assertExecutionSnapshotPath(repoRoot, snapshotRoot);
  await ensureExecutionSnapshotOwner(repoRoot, snapshotRoot, headSha, treeSha, worktreeDigest);
  let created = false;
  try {
    if (await defaultPathExists(snapshotRoot)) {
      let reusable = false;
      try {
        await assertOwnedExecutionSnapshotRoot(repoRoot, snapshotRoot);
        reusable = gitRevision(snapshotRoot, 'HEAD') === headSha &&
          gitRevision(snapshotRoot, 'HEAD^{tree}') === treeSha &&
          await defaultWorktreeDigest(snapshotRoot) === worktreeDigest &&
          await defaultWorktreeDigest(repoRoot) === worktreeDigest;
      } catch {
        reusable = false;
      }
      if (reusable) return worktreeDigest;
      if (!await defaultRemoveExecutionSnapshot(repoRoot, snapshotRoot)) {
        throw new Error('Work Package gate partial execution snapshot could not be reclaimed');
      }
    }
    if (!await defaultPathExists(snapshotRoot)) {
      await ensureExecutionSnapshotOwner(repoRoot, snapshotRoot, headSha, treeSha, worktreeDigest);
      await mkdir(executionSnapshotParent(repoRoot), { recursive: true });
      runGitSnapshotCommand(repoRoot, ['worktree', 'prune'], { encoding: 'utf8' });
      const added = runGitSnapshotCommand(
        repoRoot,
        ['worktree', 'add', '--detach', snapshotRoot, headSha],
        { encoding: 'utf8' }
      );
      if (added.status !== 0) throw new Error('Work Package gate execution worktree creation failed');
      created = true;

      const diff = runGitSnapshotCommand(
        repoRoot,
        ['diff', '--binary', '--no-ext-diff', '--full-index', 'HEAD', '--', '.']
      );
      if (diff.status !== 0 || !Buffer.isBuffer(diff.stdout)) {
        throw new Error('Work Package gate execution snapshot diff failed');
      }
      if (diff.stdout.byteLength > 0) {
        const applied = runGitSnapshotCommand(
          snapshotRoot,
          ['apply', '--binary', '--whitespace=nowarn', '-'],
          { input: diff.stdout }
        );
        if (applied.status !== 0) throw new Error('Work Package gate execution snapshot apply failed');
      }

      const untrackedResult = runGitSnapshotCommand(
        repoRoot,
        ['ls-files', '--others', '--exclude-standard', '-z'],
        { encoding: 'utf8' }
      );
      if (untrackedResult.status !== 0 || typeof untrackedResult.stdout !== 'string') {
        throw new Error('Work Package gate execution snapshot inventory failed');
      }
      for (const relativePath of untrackedResult.stdout.split('\0').filter(Boolean).sort()) {
        if (relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.includes('../')) {
          throw new Error('Work Package gate execution snapshot contains a non-canonical path');
        }
        const source = path.join(repoRoot, ...relativePath.split('/'));
        const metadata = await lstat(source);
        if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1) {
          throw new Error('Work Package gate execution snapshot source is not an owned regular file');
        }
        const destination = path.join(snapshotRoot, ...relativePath.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
      }
    }

    if (gitRevision(snapshotRoot, 'HEAD') !== headSha ||
      gitRevision(snapshotRoot, 'HEAD^{tree}') !== treeSha) {
      throw new Error('Work Package gate execution snapshot revision drifted');
    }
    const snapshotDigest = await defaultWorktreeDigest(snapshotRoot);
    if (snapshotDigest !== worktreeDigest ||
      await defaultWorktreeDigest(repoRoot) !== worktreeDigest) {
      throw new Error('Work Package gate execution snapshot does not match the frozen worktree');
    }
    return snapshotDigest;
  } catch (error) {
    if (created) await defaultRemoveExecutionSnapshot(repoRoot, snapshotRoot);
    throw error;
  }
}

/** Test-only exact dirty-tree snapshot seam used by the synthetic supervisor contract. */
export async function prepareWorkPackageExecutionSnapshotForTests(
  repoRoot: string,
  snapshotRoot: string,
  headSha: string,
  treeSha: string,
  worktreeDigest: string
): Promise<string> {
  return defaultPrepareExecutionSnapshot(repoRoot, snapshotRoot, headSha, treeSha, worktreeDigest);
}

/** Test-only crash seam: publish durable ownership before an injected worktree-add failure. */
export function publishWorkPackageExecutionSnapshotOwnerForTests(
  repoRoot: string,
  snapshotRoot: string,
  headSha: string,
  treeSha: string,
  worktreeDigest: string
): Promise<void> {
  return ensureExecutionSnapshotOwner(repoRoot, snapshotRoot, headSha, treeSha, worktreeDigest);
}

/** Test-only worktree digest seam paired with the snapshot builder. */
export function workPackageWorktreeDigestForTests(repoRoot: string): Promise<string> {
  return defaultWorktreeDigest(repoRoot);
}

/** Test-only safe removal seam for a snapshot created by the paired builder. */
export function removeWorkPackageExecutionSnapshotForTests(
  repoRoot: string,
  snapshotRoot: string
): Promise<boolean> {
  return defaultRemoveExecutionSnapshot(repoRoot, snapshotRoot);
}

function identitySetEvidence(values: readonly string[]): WorkPackageGateIdentitySetEvidenceV1 {
  const canonical = [...new Set(values)].sort();
  return Object.freeze({
    count: canonical.length,
    digest: CodexDevelopmentVerificationDigest(canonical)
  });
}

function authoritativeProbeOutcome(
  outcome: ObservedCommandOutcome,
  completedAtMs = 0,
  deadlineAtMs = Number.POSITIVE_INFINITY
): boolean {
  return outcome.status === 'exited' && outcome.exitCode === 0 &&
    !outcome.stdout.observerTruncated && !outcome.stderr.observerTruncated &&
    outcome.stderr.bytes === 0 && outcome.termination.treeClosed && completedAtMs < deadlineAtMs;
}

interface AuthorityProbeBudget {
  readonly timeoutMs: number;
  readonly terminationDeadlineMs: number;
  readonly terminationGraceMs: number;
}

function authorityProbeBudget(
  deadlineAtMs: number,
  nowMs: number
): AuthorityProbeBudget | null {
  const totalBudgetMs = Math.min(
    PROFILE_PROBE_TIMEOUT_MS,
    Math.floor(deadlineAtMs - nowMs)
  );
  if (totalBudgetMs < 3) return null;
  const terminationDeadlineMs = Math.max(
    1,
    Math.min(20_000, Math.floor(totalBudgetMs / 4))
  );
  return Object.freeze({
    timeoutMs: totalBudgetMs - terminationDeadlineMs,
    terminationDeadlineMs,
    terminationGraceMs: Math.max(1, Math.min(5_000, terminationDeadlineMs))
  });
}

/** Test-only absolute-deadline allocator shared by both authority probes. */
export function workPackageGateAuthorityProbeBudgetForTests(
  remainingBudgetMs: number
): AuthorityProbeBudget | null {
  return authorityProbeBudget(remainingBudgetMs, 0);
}

/** Test-only fail-closed projection shared by profile and ACL authority probes. */
export function workPackageGateProbeOutcomeAcceptedForTests(
  outcome: ObservedCommandOutcome,
  completedAtMs = 0,
  deadlineAtMs = Number.POSITIVE_INFINITY
): boolean {
  return authoritativeProbeOutcome(outcome, completedAtMs, deadlineAtMs);
}

async function boundedProfileIdentities(
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<WorkPackageGateIdentitySetEvidenceV1 | null> {
  if (process.platform !== 'win32') return identitySetEvidence([]);
  const configuredRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
  const systemRoot = path.isAbsolute(configuredRoot) ? configuredRoot : String.raw`C:\Windows`;
  const budget = authorityProbeBudget(deadlineAtMs, performance.now());
  if (!budget) return null;
  const chunks: Buffer[] = [];
  const outcome = await runObservedCommand(path.join(systemRoot, 'System32', 'reg.exe'), [
    'query',
    'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings',
    '/s'
  ], {
    cwd: path.join(systemRoot, 'System32'),
    env: { PATH: '', SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot },
    envMode: 'replace',
    maxObservedOutputBytes: 1024 * 1024,
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') chunks.push(Buffer.from(chunk));
    },
    terminationDeadlineMs: budget.terminationDeadlineMs,
    terminationGraceMs: budget.terminationGraceMs,
    timeoutMs: budget.timeoutMs
  });
  if (!authoritativeProbeOutcome(outcome, performance.now(), deadlineAtMs)) return null;
  const profiles = Buffer.concat(chunks).toString()
    .split(/\r?\n/u)
    .map((line) => line.trim().toLocaleLowerCase('en-US'))
    .flatMap((line) => line.match(/sec\.sm3\.[a-z0-9.]+/gu) ?? []);
  const evidence = identitySetEvidence(profiles);
  return performance.now() < deadlineAtMs ? evidence : null;
}

async function boundedAclIdentitySet(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<WorkPackageGateIdentitySetEvidenceV1 | null> {
  if (process.platform !== 'win32' || !await defaultPathExists(namespaceRoot)) {
    return identitySetEvidence([]);
  }
  const configuredRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
  const systemRoot = path.isAbsolute(configuredRoot) ? configuredRoot : String.raw`C:\Windows`;
  const canonicalRoot = await realpath(namespaceRoot);
  const rootBefore = await lstat(namespaceRoot, { bigint: true });
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() ||
    path.resolve(canonicalRoot) !== path.resolve(namespaceRoot)) return null;
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$root = $args[0]',
    '$items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Force -Recurse)',
    'if ($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }) { exit 4 }',
    '$values = foreach ($item in $items) {',
    '  foreach ($ace in (Get-Acl -LiteralPath $item.FullName).Access) {',
    '    $identity = $ace.IdentityReference.Value',
    '    if ($identity -match "^S-1-15-2-(?:[0-9]+-){6}[0-9]+$") { $identity }',
    '  }',
    '}',
    '@($values | Sort-Object -Unique) | ConvertTo-Json -Compress'
  ].join('; ');
  const budget = authorityProbeBudget(deadlineAtMs, performance.now());
  if (!budget) return null;
  const chunks: Buffer[] = [];
  const outcome = await runObservedCommand(path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  ), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, namespaceRoot], {
    cwd: path.join(systemRoot, 'System32'),
    env: { PATH: '', SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot },
    envMode: 'replace',
    maxObservedOutputBytes: 1024 * 1024,
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') chunks.push(Buffer.from(chunk));
    },
    terminationDeadlineMs: budget.terminationDeadlineMs,
    terminationGraceMs: budget.terminationGraceMs,
    timeoutMs: budget.timeoutMs
  });
  if (!authoritativeProbeOutcome(outcome, performance.now(), deadlineAtMs)) return null;
  const rootAfter = await lstat(namespaceRoot, { bigint: true });
  if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino ||
    rootAfter.isSymbolicLink()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString() || '[]') as unknown;
  } catch {
    return null;
  }
  const values = typeof parsed === 'string' ? [parsed] : parsed;
  if (!Array.isArray(values) || values.some((value) =>
    typeof value !== 'string' || !/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(value))) return null;
  const evidence = identitySetEvidence(values as string[]);
  return performance.now() < deadlineAtMs ? evidence : null;
}

async function scanNamespaceStructure(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<{
  readonly counts: Omit<WorkPackageGateResidueCensusV1, 'appContainerProfiles' | 'aclPresentOwners'>;
  readonly transactionRoots: readonly string[];
}> {
  const counts = {
    workspaceRoots: 0,
    recoveryOwners: 0,
    pendingOwners: 0,
    nativeResults: 0,
    writerLeases: 0
  };
  const transactionRoots = new Set<string>();
  if (await defaultPathExists(namespaceRoot)) {
    const canonical = await realpath(namespaceRoot);
    const rootBefore = await lstat(namespaceRoot, { bigint: true });
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() ||
      path.resolve(canonical) !== path.resolve(namespaceRoot)) {
      throw new Error('Work Package gate namespace root is not a physical canonical directory');
    }
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (performance.now() >= deadlineAtMs) throw new Error('Work Package gate census deadline exceeded');
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const child = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error('Work Package gate namespace contains a reparse entry');
        }
        if (depth === 0 && entry.isDirectory() && entry.name !== '.templates') counts.workspaceRoots += 1;
        if (entry.name === RECOVERY_OWNER_FILE && entry.isFile()) {
          counts.recoveryOwners += 1;
          transactionRoots.add(path.dirname(child));
        } else if ((entry.name === RECOVERY_OWNER_PENDING_FILE ||
          entry.name === PROVISIONAL_OWNER_FILE ||
          entry.name === PROVISIONAL_OWNER_PENDING_FILE) && entry.isFile()) {
          counts.pendingOwners += 1;
          transactionRoots.add(path.dirname(child));
        } else if (entry.name === NATIVE_RESULT_FILE && entry.isFile()) {
          counts.nativeResults += 1;
        } else if (entry.name === 'workspace-write-lease' && entry.isDirectory()) {
          counts.writerLeases += 1;
        }
        if (entry.isDirectory()) await visit(child, depth + 1);
      }
    };
    await visit(namespaceRoot, 0);
    const rootAfter = await lstat(namespaceRoot, { bigint: true });
    if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino) {
      throw new Error('Work Package gate namespace identity changed during census');
    }
  }
  return Object.freeze({ counts, transactionRoots: Object.freeze([...transactionRoots].sort()) });
}

async function defaultCensus(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<WorkPackageGateResidueCensusV1> {
  const structure = await scanNamespaceStructure(namespaceRoot, deadlineAtMs);
  const appContainerProfiles = await boundedProfileIdentities(deadlineAtMs);
  if (appContainerProfiles === null) {
    return Object.freeze({
      ...structure.counts,
      appContainerProfiles: null,
      aclPresentOwners: null
    });
  }
  return Object.freeze({
    ...structure.counts,
    appContainerProfiles,
    aclPresentOwners: await boundedAclIdentitySet(namespaceRoot, deadlineAtMs)
  });
}

function workspaceRootForTransaction(namespaceRoot: string, transactionRoot: string): string {
  const relative = path.relative(namespaceRoot, transactionRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Work Package gate recovery transaction escaped its namespace');
  }
  const segments = relative.split(path.sep);
  const secIndex = segments.indexOf('.sec');
  if (secIndex < 1) throw new Error('Work Package gate recovery transaction has no workspace root');
  return path.join(namespaceRoot, ...segments.slice(0, secIndex));
}

async function defaultRecoverOwnedNamespace(
  namespaceRoot: string,
  deadlineAtMs: number
): Promise<'not-needed' | 'completed' | 'failed'> {
  try {
    const discovered = await scanNamespaceStructure(namespaceRoot, deadlineAtMs);
    if (discovered.transactionRoots.length === 0) return 'not-needed';
    for (const transactionRoot of discovered.transactionRoots) {
      const workspaceRoot = workspaceRootForTransaction(namespaceRoot, transactionRoot);
      const totalBudgetMs = Math.floor(deadlineAtMs - performance.now());
      if (totalBudgetMs < 3) return 'failed';
      const terminationDeadlineMs = Math.max(1, Math.min(5_000, Math.floor(totalBudgetMs / 4)));
      const timeoutMs = totalBudgetMs - terminationDeadlineMs;
      const outcome = await runObservedCommand(process.execPath, [
        path.join(path.resolve(namespaceRoot, '..', '..', '..'), 'scripts', 'run-work-package-gate.ts'),
        '--internal-owned-recovery',
        path.join(transactionRoot, 'workspace'),
        workspaceRoot
      ], {
        cwd: path.resolve(namespaceRoot, '..', '..', '..'),
        env: process.env,
        envMode: 'replace',
        maxObservedOutputBytes: 0,
        terminationDeadlineMs,
        terminationGraceMs: Math.max(1, Math.min(1_000, terminationDeadlineMs)),
        timeoutMs,
        windowsHide: true
      });
      if (outcome.status !== 'exited' || outcome.exitCode !== 0 ||
        outcome.stdout.bytes !== 0 || outcome.stderr.bytes !== 0 ||
        outcome.stdout.observerTruncated || outcome.stderr.observerTruncated ||
        !outcome.termination.treeClosed || performance.now() >= deadlineAtMs) return 'failed';
    }
    const after = await scanNamespaceStructure(namespaceRoot, deadlineAtMs);
    return after.counts.recoveryOwners === 0 && after.counts.pendingOwners === 0
      ? 'completed'
      : 'failed';
  } catch {
    return 'failed';
  }
}

async function runInternalOwnedRecovery(stagingRoot: string, workspaceRoot: string): Promise<number> {
  let lease: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>> | undefined;
  try {
    lease = await acquireWorkspaceWriteLease(workspaceRoot);
    await recoverWindowsAppContainerOwnedTransaction({
      stagingRoot,
      workspaceRoot,
      workspaceWriteLease: lease.token
    });
    return 0;
  } catch {
    return 1;
  } finally {
    try {
      await lease?.release();
    } catch {
      return 1;
    }
  }
}

async function defaultRemoveNamespace(namespaceRoot: string, deadlineAtMs: number): Promise<boolean> {
  const removeEntry = async (entryPath: string): Promise<void> => {
    if (performance.now() > deadlineAtMs) throw new Error('Namespace cleanup deadline exceeded');
    let metadata;
    try {
      metadata = await lstat(entryPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      for (const entry of await readdir(entryPath)) await removeEntry(path.join(entryPath, entry));
      await rmdir(entryPath);
    } else {
      await unlink(entryPath);
    }
  };
  try {
    await removeEntry(namespaceRoot);
    return !await defaultPathExists(namespaceRoot);
  } catch {
    return false;
  }
}

const DEFAULT_DEPENDENCIES: WorkPackageGateDependencies = {
  readText: (filePath) => readFile(filePath, 'utf8'),
  pathExists: defaultPathExists,
  gitRevision,
  worktreeDigest: defaultWorktreeDigest,
  runChild: runObservedCommand,
  census: defaultCensus,
  recoverOwnedNamespace: defaultRecoverOwnedNamespace,
  removeNamespace: defaultRemoveNamespace,
  prepareExecutionSnapshot: defaultPrepareExecutionSnapshot,
  removeExecutionSnapshot: defaultRemoveExecutionSnapshot,
  wallClock: () => new Date(),
  monotonicNowMs: () => performance.now()
};

function noAuthority(census: WorkPackageGateResidueCensusV1): boolean {
  return census.recoveryOwners === 0 && census.pendingOwners === 0 &&
    census.nativeResults === 0 && census.writerLeases === 0 &&
    census.aclPresentOwners?.count === 0;
}

function childEvidence(outcome: ObservedCommandOutcome): WorkPackageGateChildEvidenceV1 {
  return Object.freeze({
    status: outcome.status,
    trigger: outcome.trigger ?? null,
    started: outcome.started,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    durationMs: outcome.durationMs,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    termination: outcome.termination
  });
}

interface WorkPackageGateCheckpointV1 {
  readonly schema: 'codex-work-package-gate-checkpoint-v1';
  readonly runId: string;
  readonly startedAt: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly worktreeBeforeDigest: string;
  readonly executionSnapshotDigest: string;
  readonly executionSnapshotPrepared: boolean;
  readonly executionSnapshotVerified: boolean;
  readonly executionSnapshotRemoved: boolean;
  readonly selection: WorkPackageGateSelectionV1;
  readonly before: WorkPackageGateResidueCensusV1 | null;
  readonly childAttempted: boolean;
  readonly child: WorkPackageGateChildEvidenceV1 | null;
  readonly recoveryAttempted: boolean;
  readonly recovery: WorkPackageGateEvidenceV1['recovery'] | null;
  readonly residueAfter: WorkPackageGateResidueCensusV1 | null;
  readonly namespaceRemoved: boolean;
  readonly checkpointDigest: string;
}

type WorkPackageGateCheckpointDraftV1 = Omit<WorkPackageGateCheckpointV1, 'checkpointDigest'>;

function finalizeCheckpoint(
  draft: WorkPackageGateCheckpointDraftV1
): WorkPackageGateCheckpointV1 {
  return Object.freeze({
    ...draft,
    checkpointDigest: CodexDevelopmentVerificationDigest(draft)
  });
}

function updateCheckpoint(
  checkpoint: WorkPackageGateCheckpointV1,
  patch: Partial<WorkPackageGateCheckpointDraftV1>
): WorkPackageGateCheckpointV1 {
  const { checkpointDigest: _checkpointDigest, ...draft } = checkpoint;
  return finalizeCheckpoint({ ...draft, ...patch });
}

function assertCheckpoint(
  value: unknown,
  expectedRunId: string,
  expectedSelection: WorkPackageGateSelectionV1
): asserts value is WorkPackageGateCheckpointV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Work Package gate checkpoint must be an object');
  }
  const checkpoint = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'runId', 'startedAt', 'headSha', 'treeSha', 'worktreeBeforeDigest',
    'executionSnapshotDigest', 'executionSnapshotPrepared', 'executionSnapshotVerified',
    'executionSnapshotRemoved',
    'selection', 'before', 'childAttempted', 'child', 'recoveryAttempted', 'recovery',
    'residueAfter', 'namespaceRemoved', 'checkpointDigest'
  ].sort();
  if (JSON.stringify(Object.keys(checkpoint).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('Work Package gate checkpoint keys are invalid');
  }
  const { checkpointDigest, ...draft } = checkpoint;
  if (checkpoint.schema !== 'codex-work-package-gate-checkpoint-v1' ||
    checkpoint.runId !== expectedRunId ||
    !Number.isFinite(Date.parse(String(checkpoint.startedAt))) ||
    !/^[0-9a-f]{40}$/u.test(String(checkpoint.headSha)) ||
    !/^[0-9a-f]{40}$/u.test(String(checkpoint.treeSha)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(checkpoint.worktreeBeforeDigest)) ||
    checkpoint.executionSnapshotDigest !== checkpoint.worktreeBeforeDigest ||
    typeof checkpoint.executionSnapshotPrepared !== 'boolean' ||
    typeof checkpoint.executionSnapshotVerified !== 'boolean' ||
    typeof checkpoint.executionSnapshotRemoved !== 'boolean' ||
    JSON.stringify(checkpoint.selection) !== JSON.stringify(expectedSelection) ||
    typeof checkpoint.childAttempted !== 'boolean' ||
    typeof checkpoint.recoveryAttempted !== 'boolean' ||
    typeof checkpoint.namespaceRemoved !== 'boolean' ||
    typeof checkpointDigest !== 'string' ||
    checkpointDigest !== CodexDevelopmentVerificationDigest(draft) ||
    (!checkpoint.childAttempted && checkpoint.child !== null) ||
    (checkpoint.childAttempted && !checkpoint.executionSnapshotPrepared) ||
    (checkpoint.executionSnapshotVerified && !checkpoint.executionSnapshotPrepared) ||
    (checkpoint.executionSnapshotRemoved && !checkpoint.executionSnapshotPrepared) ||
    (checkpoint.executionSnapshotRemoved && !checkpoint.executionSnapshotVerified) ||
    (checkpoint.childAttempted && checkpoint.before === null) ||
    (!checkpoint.childAttempted && (checkpoint.recoveryAttempted || checkpoint.recovery !== null ||
      checkpoint.residueAfter !== null || checkpoint.namespaceRemoved)) ||
    (!checkpoint.recoveryAttempted && checkpoint.recovery !== null &&
      ['completed', 'failed'].includes(String((checkpoint.recovery as { reason?: unknown }).reason))) ||
    (checkpoint.recoveryAttempted && checkpoint.recovery !== null &&
      !['completed', 'failed'].includes(String((checkpoint.recovery as { reason?: unknown }).reason))) ||
    (checkpoint.recoveryAttempted && checkpoint.child === null) ||
    (checkpoint.recoveryAttempted &&
      (checkpoint.child as { termination?: { treeClosed?: unknown } } | null)?.termination?.treeClosed !== true) ||
    (checkpoint.recovery === null && (checkpoint.residueAfter !== null || checkpoint.namespaceRemoved)) ||
    (checkpoint.namespaceRemoved && (checkpoint.residueAfter === null ||
      (checkpoint.recovery as { complete?: unknown } | null)?.complete !== true)) ||
    (checkpoint.executionSnapshotRemoved && checkpoint.childAttempted &&
      (checkpoint.residueAfter === null || !checkpoint.namespaceRemoved))) {
    throw new Error('Work Package gate checkpoint binding is invalid');
  }
  const probe = finalizeWorkPackageGateEvidence({
    runId: expectedRunId,
    status: 'unknown',
    startedAt: String(checkpoint.startedAt),
    completedAt: String(checkpoint.startedAt),
    durationMs: 0,
    selection: expectedSelection,
    repository: {
      headSha: String(checkpoint.headSha),
      treeSha: String(checkpoint.treeSha),
      headShaAfter: null,
      treeShaAfter: null,
      worktreeBeforeDigest: String(checkpoint.worktreeBeforeDigest),
      worktreeAfterDigest: null,
      executionSnapshotDigest: String(checkpoint.executionSnapshotDigest),
      executionSnapshotAfterDigest: null,
      executionSnapshotRemoved: Boolean(checkpoint.executionSnapshotRemoved)
    },
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 },
    child: checkpoint.child === null
      ? unknownChildEvidence(Boolean(checkpoint.childAttempted))
      : checkpoint.child as WorkPackageGateChildEvidenceV1,
    recovery: checkpoint.recovery === null
      ? { attempted: false, complete: false, reason: 'authority-preserved' }
      : checkpoint.recovery as WorkPackageGateEvidenceV1['recovery'],
    residue: {
      before: checkpoint.before as WorkPackageGateResidueCensusV1 | null,
      after: checkpoint.residueAfter as WorkPackageGateResidueCensusV1 | null,
      namespaceRemoved: Boolean(checkpoint.namespaceRemoved)
    },
    journal: { lastSequence: 1, digest: `sha256:${'0'.repeat(64)}` }
  });
  assertWorkPackageGateEvidence(probe);
}

async function assertSafeCheckpointPublicationDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    path.resolve(await realpath(directory)) !== path.resolve(directory)) {
    throw new Error('Work Package gate checkpoint publication directory is not owned');
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() ||
      (entry.name !== 'checkpoint.json' &&
        !/^checkpoint\.json\.[0-9a-f-]+\.tmp$/u.test(entry.name))) {
      throw new Error('Work Package gate checkpoint publication directory contains foreign content');
    }
    const entryMetadata = await lstat(path.join(directory, entry.name));
    if (!entryMetadata.isFile() || entryMetadata.isSymbolicLink() || entryMetadata.nlink !== 1) {
      throw new Error('Work Package gate checkpoint publication file is not owned');
    }
  }
}

async function publishInitialCheckpoint(
  repoRoot: string,
  namespace: string,
  runDir: string,
  checkpoint: WorkPackageGateCheckpointV1,
  runId: string,
  selection: WorkPackageGateSelectionV1
): Promise<WorkPackageGateCheckpointV1> {
  const publicationParent = path.join(repoRoot, '.tmp', '.gate-checkpoint-publications');
  const publicationDirectory = path.join(publicationParent, `${namespace}.pending`);
  const publicationCheckpoint = path.join(publicationDirectory, 'checkpoint.json');
  await mkdir(path.dirname(runDir), { recursive: true });
  await mkdir(publicationParent, { recursive: true });
  if (await defaultPathExists(publicationDirectory)) {
    await assertSafeCheckpointPublicationDirectory(publicationDirectory);
    if (await defaultPathExists(publicationCheckpoint)) {
      const parsed = JSON.parse(await readFile(publicationCheckpoint, 'utf8')) as unknown;
      assertCheckpoint(parsed, runId, selection);
    } else {
      await rm(publicationDirectory, { recursive: true, force: false });
    }
  }
  if (!await defaultPathExists(publicationDirectory)) {
    await mkdir(publicationDirectory, { recursive: false });
    await writeWorkPackageGateJsonAtomic(
      publicationCheckpoint,
      checkpoint,
      (readback) => assertCheckpoint(readback, runId, selection)
    );
  }
  await rename(publicationDirectory, runDir);
  await syncWorkPackageGateDirectory(path.dirname(runDir));
  await syncWorkPackageGateDirectory(publicationParent);
  const readback = JSON.parse(await readFile(path.join(runDir, 'checkpoint.json'), 'utf8')) as unknown;
  assertCheckpoint(readback, runId, selection);
  return readback;
}

function namespaceForRunDirectory(runDir: string): string {
  const canonical = process.platform === 'win32'
    ? path.resolve(runDir).toLocaleLowerCase('en-US')
    : path.resolve(runDir);
  const suffix = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `gate-${suffix}-owned`;
}

/** Test-only deterministic pending-publication path for crash recovery vectors. */
export function workPackageGateCheckpointPublicationDirectoryForTests(
  repoRoot: string,
  runDir: string
): string {
  return path.join(
    repoRoot,
    '.tmp',
    '.gate-checkpoint-publications',
    `${namespaceForRunDirectory(runDir)}.pending`
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireNamespaceLease(
  repoRoot: string,
  namespace: string,
  runId: string
): Promise<() => Promise<void>> {
  if (process.platform === 'win32') {
    const kernel32 = await loadGateMutexKernel32();
    const handle = kernel32.symbols.CreateMutexW(
      null,
      0,
      windowsWide(`Local\\sec-work-package-${namespace}`)
    ) as bigint;
    if (handle === 0n) throw new Error('Work Package gate namespace mutex could not be created');
    const wait = kernel32.symbols.WaitForSingleObject(handle, 0);
    if (wait !== WINDOWS_WAIT_OBJECT_0 && wait !== WINDOWS_WAIT_ABANDONED_0) {
      kernel32.symbols.CloseHandle(handle);
      if (wait === WINDOWS_WAIT_TIMEOUT) {
        throw new Error('Work Package gate namespace already has a live supervisor');
      }
      throw new Error('Work Package gate namespace mutex wait failed');
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      kernel32.symbols.ReleaseMutex(handle);
      kernel32.symbols.CloseHandle(handle);
    };
  }
  const leaseParent = path.join(repoRoot, '.tmp', 'test-workspaces', '.gate-supervisor-leases');
  const leasePath = path.join(leaseParent, `${namespace}.lock`);
  await mkdir(leaseParent, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const owner = JSON.stringify({ runId, pid: process.pid, nonce: randomUUID() });
      handle = await open(leasePath, 'wx');
      try {
        await handle.writeFile(owner, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
        handle = undefined;
      }
      return async () => {
        if (await defaultPathExists(leasePath) && await readFile(leasePath, 'utf8') === owner) {
          await unlink(leasePath);
        }
      };
    } catch (error) {
      await handle?.close();
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      let owner: { readonly runId?: unknown; readonly pid?: unknown } | undefined;
      try {
        owner = JSON.parse(await readFile(leasePath, 'utf8')) as typeof owner;
      } catch {
        throw new Error('Work Package gate namespace lease publication is incomplete');
      }
      if (!owner || !Number.isSafeInteger(owner.pid)) {
        throw new Error('Work Package gate namespace lease owner is invalid');
      }
      if (processIsAlive(Number(owner.pid))) {
        throw new Error('Work Package gate namespace already has a live supervisor');
      }
      await unlink(leasePath);
    }
  }
  throw new Error('Work Package gate namespace lease could not be acquired');
}

function unknownChildEvidence(childAttempted: boolean): WorkPackageGateChildEvidenceV1 {
  const empty = `sha256:${createHash('sha256').digest('hex')}`;
  return Object.freeze({
    status: childAttempted ? 'termination-unproven' : 'spawn-failed',
    trigger: null,
    started: false,
    exitCode: null,
    signal: null,
    durationMs: 0,
    stdout: Object.freeze({ bytes: 0, digest: empty, observerTruncated: false }),
    stderr: Object.freeze({ bytes: 0, digest: empty, observerTruncated: false }),
    termination: Object.freeze({
      requested: childAttempted,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: false,
      streamsDrained: !childAttempted,
      treeClosed: !childAttempted
    })
  });
}

function resultStatus(
  outcome: WorkPackageGateChildEvidenceV1,
  before: WorkPackageGateResidueCensusV1,
  after: WorkPackageGateResidueCensusV1 | null,
  namespaceRemoved: boolean,
  repositoryStable: boolean
): WorkPackageGateStatus {
  if (!outcome.started || !outcome.termination.childCloseObserved ||
    !outcome.termination.streamsDrained || !outcome.termination.treeClosed ||
    outcome.stdout.observerTruncated || outcome.stderr.observerTruncated ||
    after === null || !namespaceRemoved || !repositoryStable ||
    !noAuthority(after) || after.appContainerProfiles === null ||
    before.appContainerProfiles === null ||
    after.appContainerProfiles.count !== before.appContainerProfiles.count ||
    after.appContainerProfiles.digest !== before.appContainerProfiles.digest ||
    after.workspaceRoots !== 0) return 'unknown';
  if (outcome.status === 'exited') return outcome.exitCode === 0 ? 'passed' : 'failed';
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out') return 'timed-out';
  return 'unknown';
}

function exitCodeForEvidence(evidence: WorkPackageGateEvidenceV1): number {
  if (evidence.status === 'passed') return 0;
  if (evidence.status === 'failed') return 1;
  if (evidence.status === 'timed-out') return 124;
  return evidence.child.termination.treeClosed ? 126 : 125;
}

async function appendEventDurable(filePath: string, serialized: string): Promise<void> {
  const handle = await open(filePath, 'a');
  try {
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function runWorkPackageGate(
  options: WorkPackageGateOptions,
  overrides: Partial<WorkPackageGateDependencies> = {}
): Promise<{ readonly evidence: WorkPackageGateEvidenceV1; readonly exitCode: number }> {
  if (options.watchdogMs !== 1_800_000 || options.cleanupMs !== 120_000 || options.selectionIndex !== 0) {
    throw new Error('Work Package gate invocation does not match the frozen timeout/selection contract');
  }
  const manifestPath = canonicalRelativePath(options.manifestPath, 'docs/work-packages/');
  const selectionManifestPath = canonicalRelativePath(
    options.selectionManifestPath,
    'docs/work-packages/'
  );
  const runDirRelative = canonicalRelativePath(options.runDir, '.tmp/');
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const repoRoot = path.resolve(import.meta.dir, '..');
  const runDir = path.resolve(repoRoot, ...runDirRelative.split('/'));
  const runId = path.basename(runDirRelative);
  if (runId.length > 128 || !/^[a-z0-9-]+$/u.test(runId)) {
    throw new Error('Work Package gate run ID is invalid');
  }
  const namespace = namespaceForRunDirectory(runDir);
  const snapshotRoot = path.join(executionSnapshotParent(repoRoot), namespace);
  const namespaceRoot = path.join(snapshotRoot, '.tmp', 'test-workspaces', namespace);
  const eventsPath = path.join(runDir, 'events.jsonl');
  const statePath = path.join(runDir, 'state.json');
  const evidencePath = path.join(runDir, 'evidence.json');
  const checkpointPath = path.join(runDir, 'checkpoint.json');
  if (await dependencies.pathExists(evidencePath)) {
    const evidence = JSON.parse(await dependencies.readText(evidencePath)) as unknown;
    const journalSource = await dependencies.readText(eventsPath);
    const bundle = { evidence, journalSource };
    assertWorkPackageGateEvidenceBundle(bundle);
    return {
      evidence: bundle.evidence,
      exitCode: exitCodeForEvidence(bundle.evidence)
    };
  }
  const executionManifestSource = await dependencies.readText(path.join(repoRoot, ...manifestPath.split('/')));
  const selectionManifestSource = await dependencies.readText(
    path.join(repoRoot, ...selectionManifestPath.split('/'))
  );
  const selection = parseFrozenWorkPackageGateSelection({
    executionManifestSource,
    executionManifestPath: manifestPath,
    selectionManifestSource,
    selectionManifestPath,
    selectionIndex: options.selectionIndex
  });
  for (const testFile of selection.testFiles) {
    if (!await dependencies.pathExists(path.join(repoRoot, ...testFile.split('/')))) {
      throw new Error('Work Package gate selection references a missing test file');
    }
  }
  const releaseNamespaceLease = await acquireNamespaceLease(repoRoot, namespace, runId);
  try {
  let checkpoint: WorkPackageGateCheckpointV1;
  if (await dependencies.pathExists(runDir)) {
    if (!await dependencies.pathExists(checkpointPath)) {
      throw new Error('Work Package gate run directory is not owned by a checkpoint');
    } else {
      const parsedCheckpoint = JSON.parse(await dependencies.readText(checkpointPath)) as unknown;
      assertCheckpoint(parsedCheckpoint, runId, selection);
      checkpoint = parsedCheckpoint;
    }
  } else {
    const headSha = dependencies.gitRevision(repoRoot, 'HEAD');
    const treeSha = dependencies.gitRevision(repoRoot, 'HEAD^{tree}');
    const worktreeBeforeDigest = await dependencies.worktreeDigest(repoRoot);
    checkpoint = finalizeCheckpoint({
      schema: 'codex-work-package-gate-checkpoint-v1',
      runId,
      startedAt: dependencies.wallClock().toISOString(),
      headSha,
      treeSha,
      worktreeBeforeDigest,
      executionSnapshotDigest: worktreeBeforeDigest,
      executionSnapshotPrepared: false,
      executionSnapshotVerified: false,
      executionSnapshotRemoved: false,
      selection,
      before: null,
      childAttempted: false,
      child: null,
      recoveryAttempted: false,
      recovery: null,
      residueAfter: null,
      namespaceRemoved: false
    });
    checkpoint = await publishInitialCheckpoint(
      repoRoot,
      namespace,
      runDir,
      checkpoint,
      runId,
      selection
    );
  }

  const startedAt = new Date(checkpoint.startedAt);
  const startedMonotonic = dependencies.monotonicNowMs();
  let sequence = 0;
  let journalDigest: string | null = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let phase = 'preflight';
  let elapsedOffsetMs = 0;
  const recordedKinds: WorkPackageGateEventKind[] = [];
  if (await dependencies.pathExists(eventsPath)) {
    const source = await dependencies.readText(eventsPath);
    for (const line of source.trimEnd().split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as unknown;
      assertWorkPackageGateEvent(event, journalDigest);
      if (event.sequence !== sequence + 1) throw new Error('Work Package gate journal sequence is invalid');
      sequence = event.sequence;
      journalDigest = event.eventDigest;
      stdoutBytes = event.stdoutBytes;
      stderrBytes = event.stderrBytes;
      phase = event.phase;
      elapsedOffsetMs = event.elapsedMs;
      recordedKinds.push(event.kind);
    }
  }
  let eventTail: Promise<void> = Promise.resolve();
  let heartbeatInFlight = false;
  const elapsedMs = (): number => elapsedOffsetMs +
    Math.max(0, dependencies.monotonicNowMs() - startedMonotonic);
  const record = (
    kind: WorkPackageGateEventKind,
    nextPhase: string,
    subject?: unknown
  ): Promise<void> => {
    phase = nextPhase;
    const eventPhase = nextPhase;
    const eventStdoutBytes = stdoutBytes;
    const eventStderrBytes = stderrBytes;
    const operation = eventTail.then(async () => {
      const event = finalizeWorkPackageGateEvent({
        sequence: sequence + 1,
        kind,
        elapsedMs: elapsedMs(),
        phase: eventPhase,
        stdoutBytes: eventStdoutBytes,
        stderrBytes: eventStderrBytes,
        subject,
        previousDigest: journalDigest
      });
      await appendEventDurable(eventsPath, JSON.stringify(event));
      sequence = event.sequence;
      journalDigest = event.eventDigest;
      recordedKinds.push(kind);
      const state: WorkPackageGateStateV1 = {
        schema: 'codex-work-package-gate-state-v1',
        runId,
        status: kind === 'completed' &&
          ['passed', 'failed', 'timed-out', 'unknown'].includes(eventPhase)
          ? eventPhase as WorkPackageGateStatus
          : 'running',
        phase: eventPhase,
        elapsedMs: elapsedMs(),
        sequence,
        journalDigest,
        stdoutBytes,
        stderrBytes
      };
      await writeWorkPackageGateJsonAtomic(statePath, state).catch(() => undefined);
    });
    eventTail = operation.catch(() => undefined);
    return operation;
  };

    if (!recordedKinds.includes('started')) await record('started', 'preflight');

    if (!checkpoint.childAttempted) {
      try {
        const snapshotDigest = await dependencies.prepareExecutionSnapshot(
          repoRoot,
          snapshotRoot,
          checkpoint.headSha,
          checkpoint.treeSha,
          checkpoint.executionSnapshotDigest
        );
        checkpoint = updateCheckpoint(checkpoint, {
          executionSnapshotPrepared: snapshotDigest === checkpoint.executionSnapshotDigest,
          executionSnapshotVerified: snapshotDigest === checkpoint.executionSnapshotDigest
        });
      } catch {
        checkpoint = updateCheckpoint(checkpoint, { executionSnapshotPrepared: false });
      }
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
      try {
        const before = checkpoint.executionSnapshotPrepared
          ? await dependencies.census(namespaceRoot)
          : null;
        const clean = before !== null && noAuthority(before) && before.workspaceRoots === 0 &&
          before.appContainerProfiles !== null && before.aclPresentOwners !== null &&
          before.aclPresentOwners.count === 0;
        checkpoint = updateCheckpoint(checkpoint, { before: clean ? before : null });
      } catch {
        checkpoint = updateCheckpoint(checkpoint, { before: null });
      }
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
    }

    let launchIdentityStable = false;
    if (!checkpoint.childAttempted && checkpoint.before !== null &&
      checkpoint.executionSnapshotPrepared) {
      try {
        launchIdentityStable = dependencies.gitRevision(repoRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(repoRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(repoRoot) === checkpoint.worktreeBeforeDigest &&
          dependencies.gitRevision(snapshotRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(snapshotRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(snapshotRoot) === checkpoint.executionSnapshotDigest;
      } catch {
        launchIdentityStable = false;
      }
    }
    if (!checkpoint.childAttempted && checkpoint.before !== null && launchIdentityStable) {
      checkpoint = updateCheckpoint(checkpoint, {
        childAttempted: true,
        executionSnapshotVerified: false
      });
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
      phase = 'owner-batch';
      const heartbeat = setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        void record('heartbeat', phase).catch(() => undefined).finally(() => {
          heartbeatInFlight = false;
        });
      }, HEARTBEAT_INTERVAL_MS);
      try {
        const outcome = await dependencies.runChild(process.execPath, selection.argv.slice(1), {
          cwd: snapshotRoot,
          env: { ...process.env, SEC_TEST_WORKSPACE_NAMESPACE: namespace },
          envMode: 'replace',
          onChunk: (stream, byteLength) => {
            if (stream === 'stdout') stdoutBytes += byteLength;
            else stderrBytes += byteLength;
          },
          terminationDeadlineMs: 30_000,
          terminationGraceMs: 5_000,
          timeoutMs: options.watchdogMs,
          windowsHide: true
        });
        checkpoint = updateCheckpoint(checkpoint, { child: childEvidence(outcome) });
      } catch {
        checkpoint = updateCheckpoint(checkpoint, { child: unknownChildEvidence(true) });
      } finally {
        clearInterval(heartbeat);
      }
      await eventTail;
      if (checkpoint.child) {
        stdoutBytes = checkpoint.child.stdout.bytes;
        stderrBytes = checkpoint.child.stderr.bytes;
      }
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
    }

    const child = checkpoint.child ?? unknownChildEvidence(checkpoint.childAttempted);
    if (child.trigger === 'timed-out' && !recordedKinds.includes('deadline')) {
      await record('deadline', 'watchdog', {
        status: child.status,
        trigger: child.trigger,
        watchdogMs: options.watchdogMs
      });
    }
    if (child.termination.requested && !recordedKinds.includes('termination')) {
      await record('termination', 'tree-close', child.termination);
    }

    let after = checkpoint.residueAfter;
    let namespaceRemoved = checkpoint.namespaceRemoved;
    let recovery: WorkPackageGateEvidenceV1['recovery'] = checkpoint.recovery ??
      (checkpoint.recoveryAttempted
        ? { attempted: true, complete: false, reason: 'failed' }
        : { attempted: false, complete: false, reason: 'authority-preserved' });
    const canProbe = checkpoint.child !== null && child.termination.treeClosed;
    const residueDeadlineAt = dependencies.monotonicNowMs() + options.cleanupMs;
    if (canProbe && after === null && !namespaceRemoved) {
      let observed: WorkPackageGateResidueCensusV1 | null = null;
      if (checkpoint.recoveryAttempted && checkpoint.recovery === null) {
        recovery = { attempted: true, complete: false, reason: 'failed' };
        checkpoint = updateCheckpoint(checkpoint, { recovery });
        await writeWorkPackageGateJsonAtomic(
          checkpointPath,
          checkpoint,
          (readback) => assertCheckpoint(readback, runId, selection)
        );
      } else if (!checkpoint.recovery || checkpoint.recovery.complete) {
        try {
          observed = await dependencies.census(namespaceRoot, residueDeadlineAt);
        } catch {
          observed = null;
        }
        if (observed && (observed.appContainerProfiles === null ||
          observed.aclPresentOwners === null)) {
          observed = null;
        }
        if (!checkpoint.recovery) {
          if (observed && noAuthority(observed)) {
            recovery = { attempted: false, complete: true, reason: 'not-needed' };
            checkpoint = updateCheckpoint(checkpoint, { recovery });
          } else if (observed) {
            checkpoint = updateCheckpoint(checkpoint, { recoveryAttempted: true });
            await writeWorkPackageGateJsonAtomic(
              checkpointPath,
              checkpoint,
              (readback) => assertCheckpoint(readback, runId, selection)
            );
            let recovered: 'not-needed' | 'completed' | 'failed' = 'failed';
            try {
              recovered = await dependencies.recoverOwnedNamespace(
                namespaceRoot,
                residueDeadlineAt
              );
            } catch {
              recovered = 'failed';
            }
            recovery = recovered === 'completed'
              ? { attempted: true, complete: true, reason: 'completed' }
              : { attempted: true, complete: false, reason: 'failed' };
            checkpoint = updateCheckpoint(checkpoint, { recovery });
            observed = null;
          }
          await writeWorkPackageGateJsonAtomic(
            checkpointPath,
            checkpoint,
            (readback) => assertCheckpoint(readback, runId, selection)
          );
        }
        if (recovery.complete && !observed) {
          try {
            observed = await dependencies.census(namespaceRoot, residueDeadlineAt);
          } catch {
            observed = null;
            recovery = recovery.attempted
              ? { attempted: true, complete: false, reason: 'failed' }
              : { attempted: false, complete: false, reason: 'authority-preserved' };
            checkpoint = updateCheckpoint(checkpoint, { recovery });
          }
        }
      }
      if (observed && recovery.complete && noAuthority(observed)) {
        namespaceRemoved = await dependencies.removeNamespace(namespaceRoot, residueDeadlineAt);
        try {
          after = await dependencies.census(namespaceRoot, residueDeadlineAt);
        } catch {
          after = null;
        }
      }
      checkpoint = updateCheckpoint(checkpoint, {
        recovery,
        residueAfter: after,
        namespaceRemoved
      });
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
    }

    let executionSnapshotAfterDigest: string | null = null;
    const snapshotMayBeRemoved = checkpoint.executionSnapshotPrepared &&
      (!checkpoint.childAttempted || (after !== null && namespaceRemoved && recovery.complete &&
        noAuthority(after)));
    if (checkpoint.executionSnapshotRemoved) {
      executionSnapshotAfterDigest = checkpoint.executionSnapshotVerified
        ? checkpoint.executionSnapshotDigest
        : null;
    } else if (snapshotMayBeRemoved) {
      try {
        const snapshotExists = await dependencies.pathExists(snapshotRoot);
        if (!snapshotExists && checkpoint.executionSnapshotVerified) {
          executionSnapshotAfterDigest = checkpoint.executionSnapshotVerified
            ? checkpoint.executionSnapshotDigest
            : null;
        } else {
          const digest = await dependencies.worktreeDigest(snapshotRoot);
          if (digest === checkpoint.executionSnapshotDigest) {
            executionSnapshotAfterDigest = digest;
            checkpoint = updateCheckpoint(checkpoint, { executionSnapshotVerified: true });
            await writeWorkPackageGateJsonAtomic(
              checkpointPath,
              checkpoint,
              (readback) => assertCheckpoint(readback, runId, selection)
            );
          }
        }
        if (executionSnapshotAfterDigest !== null) {
          const removed = await dependencies.removeExecutionSnapshot(repoRoot, snapshotRoot);
          checkpoint = updateCheckpoint(checkpoint, { executionSnapshotRemoved: removed });
        }
      } catch {
        executionSnapshotAfterDigest = null;
        checkpoint = updateCheckpoint(checkpoint, { executionSnapshotRemoved: false });
      }
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        checkpoint,
        (readback) => assertCheckpoint(readback, runId, selection)
      );
    }

    if (!recordedKinds.includes('recovery')) {
      await record(
        'recovery',
        recovery.complete ? 'recovery-complete' : 'authority-preserved',
        recovery
      );
    }
    if (!recordedKinds.includes('residue')) {
      await record('residue', after === null ? 'residue-unknown' : 'residue-census', {
        before: checkpoint.before,
        after,
        namespaceRemoved
      });
    }

    let headShaAfter: string | null = null;
    let treeShaAfter: string | null = null;
    let worktreeAfterDigest: string | null = null;
    try {
      headShaAfter = dependencies.gitRevision(repoRoot, 'HEAD');
      treeShaAfter = dependencies.gitRevision(repoRoot, 'HEAD^{tree}');
      worktreeAfterDigest = await dependencies.worktreeDigest(repoRoot);
    } catch {
      headShaAfter = null;
      treeShaAfter = null;
      worktreeAfterDigest = null;
    }
    const repositoryStable = headShaAfter === checkpoint.headSha &&
      treeShaAfter === checkpoint.treeSha &&
      worktreeAfterDigest === checkpoint.worktreeBeforeDigest &&
      executionSnapshotAfterDigest === checkpoint.executionSnapshotDigest &&
      checkpoint.executionSnapshotRemoved;
    const status = checkpoint.before === null
      ? 'unknown'
      : resultStatus(child, checkpoint.before, after, namespaceRemoved, repositoryStable);
    const repositoryEvidence = {
      headSha: checkpoint.headSha,
      treeSha: checkpoint.treeSha,
      headShaAfter,
      treeShaAfter,
      worktreeBeforeDigest: checkpoint.worktreeBeforeDigest,
      worktreeAfterDigest,
      executionSnapshotDigest: checkpoint.executionSnapshotDigest,
      executionSnapshotAfterDigest,
      executionSnapshotRemoved: checkpoint.executionSnapshotRemoved
    };
    if (!recordedKinds.includes('completed')) {
      await record('completed', status, { status, child, repository: repositoryEvidence });
    }
    await eventTail;
    const completedAt = dependencies.wallClock();
    const evidence = finalizeWorkPackageGateEvidence({
      runId,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: elapsedMs(),
      selection: checkpoint.selection,
      repository: repositoryEvidence,
      timeouts: { watchdogMs: options.watchdogMs, cleanupMs: options.cleanupMs },
      child,
      recovery,
      residue: { before: checkpoint.before, after, namespaceRemoved },
      journal: { lastSequence: sequence, digest: journalDigest! }
    });
    const journalSource = await readFile(eventsPath, 'utf8');
    assertWorkPackageGateEvidenceBundle({ evidence, journalSource });
    await writeWorkPackageGateJsonAtomic(evidencePath, evidence, assertWorkPackageGateEvidence);
    const finalState: WorkPackageGateStateV1 = {
      schema: 'codex-work-package-gate-state-v1',
      runId,
      status,
      phase: status,
      elapsedMs: elapsedMs(),
      sequence,
      journalDigest,
      stdoutBytes,
      stderrBytes
    };
    await writeWorkPackageGateJsonAtomic(statePath, finalState);
    return {
      evidence,
      exitCode: exitCodeForEvidence(evidence)
    };
  } finally {
    await releaseNamespaceLease();
  }
}

function parseCli(argv: readonly string[]): WorkPackageGateOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !value || !key.startsWith('--') || values.has(key)) {
      throw new Error('Work Package gate CLI requires unique --key value pairs');
    }
    values.set(key, value);
  }
  const expected = [
    '--manifest', '--selection-manifest', '--selection-index', '--watchdog-ms', '--cleanup-ms', '--run-dir'
  ];
  if (values.size !== expected.length || expected.some((key) => !values.has(key))) {
    throw new Error('Work Package gate CLI arguments are incomplete or unknown');
  }
  return {
    manifestPath: values.get('--manifest')!,
    selectionManifestPath: values.get('--selection-manifest')!,
    selectionIndex: Number(values.get('--selection-index')),
    watchdogMs: Number(values.get('--watchdog-ms')),
    cleanupMs: Number(values.get('--cleanup-ms')),
    runDir: values.get('--run-dir')!
  };
}

export async function workPackageGateMain(argv: readonly string[]): Promise<number> {
  try {
    if (argv[0] === '--internal-owned-recovery') {
      if (argv.length !== 3 || !path.isAbsolute(argv[1]!) || !path.isAbsolute(argv[2]!)) return 126;
      return await runInternalOwnedRecovery(argv[1]!, argv[2]!);
    }
    const result = await runWorkPackageGate(parseCli(argv));
    console.log(JSON.stringify({ status: result.evidence.status, evidenceDigest: result.evidence.evidenceDigest }));
    return result.exitCode;
  } catch {
    console.error(JSON.stringify({ status: 'infrastructure-failed' }));
    return 126;
  }
}

if (import.meta.main) process.exitCode = await workPackageGateMain(process.argv.slice(2));
