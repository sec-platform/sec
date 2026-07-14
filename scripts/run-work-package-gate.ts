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
  stat,
  unlink
} from 'node:fs/promises';
import path from 'node:path';

import { assertSemanticMutationRecoveryRecordInvariant } from
  '../platform/compiler/semantic-mutation/mutation-recovery-record.ts';
import {
  assertSemanticMutationRejectedTerminalRecordInvariant,
  readRejectedSemanticMutationTerminal
} from '../platform/compiler/semantic-mutation/mutation-terminal-record.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationWorkspaceRootFromTransactionRoot
} from '../platform/compiler/semantic-mutation/transaction-identity.ts';
import {
  runObservedCommand,
  type ObservedCommandOutcome
} from '../platform/shared/observed-process.ts';
import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import { recoverWindowsAppContainerOwnedTransaction } from '../platform/shared/windows-appcontainer-executor.ts';
import { acquireWorkspaceWriteLease } from '../platform/shared/workspace-write-lease.ts';
import {
  WORK_PACKAGE_GATE_CHECKPOINT_SCHEMA_V4,
  WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4,
  WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4,
  WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_NAMESPACE_V4,
  WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4,
  WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4,
  WORK_PACKAGE_GATE_RUN_DIRECTORY_V4,
  WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4,
  assertWorkPackageGateEventV4,
  assertWorkPackageGateDiagnosticV4,
  assertWorkPackageGateEvidenceBundleV4,
  assertWorkPackageGateEvidenceV4,
  assertWorkPackageGateResidueCensusV4,
  finalizeWorkPackageGateEventV4,
  finalizeWorkPackageGateEvidenceV4,
  parseFrozenWorkPackageGateSelectionV4,
  syncWorkPackageGateDirectory,
  writeWorkPackageGateJsonAtomic,
  type WorkPackageGateChildEvidenceV1,
  type WorkPackageGateDiagnosticV4,
  type WorkPackageGateEventKind,
  type WorkPackageGateEventV4,
  type WorkPackageGateEvidenceV4,
  type WorkPackageGateExecutionAuthorityV4,
  type WorkPackageGateIdentityProbeEvidenceV4,
  type WorkPackageGateIdentitySetEvidenceV1,
  type WorkPackageGateRecoveryEvidenceV4,
  type WorkPackageGateResidueCensusV4,
  type WorkPackageGateSelectionV1,
  type WorkPackageGateStateV4,
  type WorkPackageGateStatus
} from './work-package-gate-contract.ts';

const AUTHORITY_PROBE_TIMEOUT_MS = 30_000;
const DIAGNOSTIC_OBSERVER_LIMIT_BYTES = 1024 * 1024;
const DIAGNOSTIC_LINE_LIMIT = 8 * 1024;
const RECOVERY_OWNER_FILE = '.semantic-mutation-appcontainer-owner-v1.json';
const RECOVERY_OWNER_PENDING_FILE = `${RECOVERY_OWNER_FILE}.pending-v1`;
const PROVISIONAL_OWNER_FILE = '.semantic-mutation-appcontainer-provisional-owner-v1.json';
const PROVISIONAL_OWNER_PENDING_FILE = `${PROVISIONAL_OWNER_FILE}.pending-v1`;
const NATIVE_RESULT_FILE = '.semantic-mutation-appcontainer-result-v1.json';
const WORKSPACE_WRITE_LEASE_DIRECTORY = 'workspace-write-lease';
const WORKSPACE_WRITE_LEASE_OWNER_FILE = 'owner.json';
const TERMINAL_RECORD_FILE = 'terminal-rejected.json';
const RECOVERY_OWNER_FORMAT_VERSION = 'windows-appcontainer-recovery-owner-v1';
const PROVISIONAL_OWNER_FORMAT_VERSION = 'windows-appcontainer-provisional-owner-v1';
const WORKSPACE_WRITE_LEASE_FORMAT_VERSION = 'workspace-write-lease-token-v1';
const STAGING_DIRECTORY_NAME = 'workspace';
const RUNTIME_RELATIVE_PATH = '.sm3r';
const HOST_BUN_CONFIG_RELATIVE_PATH = '.sm3h';
const TERMINAL_ORDER_DIRECTORY = 'terminal-order';
const TERMINAL_SEQUENCE_HEAD_FILE = '.sequence-head.json';
const R2_EXECUTION_SNAPSHOT_HEAD_SHA = 'f29ecb73ac64aaae23b7989688c4a3ca79593d43';
const R2_EXECUTION_SNAPSHOT_TREE_SHA = 'dcdc37f6353a61a6770f930c54a25c22200a8829';
const R2_EXECUTION_SNAPSHOT_WORKTREE_DIGEST =
  'sha256:6468cf74715c883051ce85bab5d2fd8bbad8e170d73efc48225cb906fb93740c';
const WINDOWS_WAIT_OBJECT_0 = 0x0000_0000;
const WINDOWS_WAIT_ABANDONED_0 = 0x0000_0080;
const WINDOWS_WAIT_TIMEOUT = 0x0000_0102;
const WINDOWS_INVALID_FILE_ATTRIBUTES = 0xffff_ffff;
const WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
let gateMutexKernel32Promise: Promise<any> | undefined;

async function loadGateMutexKernel32(): Promise<any> {
  gateMutexKernel32Promise ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('kernel32.dll', {
      CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.u64 },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      ReleaseMutex: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
      GetFileAttributesW: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetLastError: { args: [], returns: FFIType.u32 }
    } as const);
  })();
  return gateMutexKernel32Promise;
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

async function isGateWindowsReparsePoint(filePath: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const kernel32 = await loadGateMutexKernel32();
  const target = windowsWide(path.toNamespacedPath(path.resolve(filePath)));
  const attributes = kernel32.symbols.GetFileAttributesW(target);
  if (attributes === WINDOWS_INVALID_FILE_ATTRIBUTES) {
    const errorCode = kernel32.symbols.GetLastError();
    throw new Error(`Work Package gate Windows filesystem attributes are unavailable (Win32 ${errorCode})`);
  }
  return (attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
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
  readonly readBytes: (filePath: string) => Promise<Uint8Array>;
  readonly pathExists: (filePath: string) => Promise<boolean>;
  readonly protectedPathAuthority: (repoRoot: string) => Promise<readonly {
    readonly path: string;
    readonly required: boolean;
  }[]>;
  readonly gitRevision: (repoRoot: string, revision: string) => string;
  readonly worktreeDigest: (repoRoot: string) => Promise<string>;
  readonly runChild: typeof runObservedCommand;
  readonly census: (
    namespaceRoot: string,
    deadlineAtMs?: number,
    probeAcl?: boolean
  ) => Promise<WorkPackageGateResidueCensusV4>;
  readonly sideEffectCensus: (
    stage: 'child' | 'recovery' | 'namespace-removal' | 'snapshot-removal',
    namespaceRoot: string,
    deadlineAtMs?: number,
    probeAcl?: boolean
  ) => Promise<WorkPackageGateResidueCensusV4>;
  readonly recoverOwnedNamespace: (
    namespaceRoot: string,
    deadlineAtMs: number,
    authorization: WorkPackageGateIdentitySetEvidenceV1
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
  /** Test-only crash seam invoked immediately after a durable attempt checkpoint. */
  readonly afterCheckpoint: (stage: WorkPackageGateCrashStageV4) => Promise<void>;
}

export type WorkPackageGateCrashStageV4 =
  | 'snapshot-preparation-attempted'
  | 'child-attempted'
  | 'recovery-attempted'
  | 'namespace-removal-attempted'
  | 'snapshot-removal-attempted'
  | 'completed-event-publication-attempted'
  | 'evidence-publication-attempted';

function sha256Bytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256Text(value: string): `sha256:${string}` {
  return sha256Bytes(Buffer.from(value, 'utf8'));
}

function pathContainsOrEquals(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`));
}

function pathsOverlap(left: string, right: string): boolean {
  const canonicalLeft = canonicalFilesystemIdentity(left);
  const canonicalRight = canonicalFilesystemIdentity(right);
  return pathContainsOrEquals(canonicalLeft, canonicalRight) ||
    pathContainsOrEquals(canonicalRight, canonicalLeft);
}

interface PhysicalPathIdentityV4 {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly kind: 'directory' | 'file';
  readonly nlink: bigint;
}

interface ProtectedPathV4 {
  readonly path: string;
  readonly required: boolean;
}

function normalizeProtectedPathAuthority(paths: readonly ProtectedPathV4[]): readonly ProtectedPathV4[] {
  const normalized = new Map<string, ProtectedPathV4>();
  for (const entry of paths) {
    if (typeof entry.path !== 'string' || !path.isAbsolute(entry.path) ||
      typeof entry.required !== 'boolean') {
      throw new Error('Work Package gate protected path authority entry is invalid');
    }
    const resolved = path.resolve(entry.path);
    const key = canonicalFilesystemIdentity(resolved);
    if (normalized.has(key)) {
      throw new Error('Work Package gate protected path authority contains a duplicate path');
    }
    normalized.set(key, Object.freeze({ path: resolved, required: entry.required }));
  }
  return Object.freeze([...normalized.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => entry));
}

function protectedPathAuthorityShape(paths: readonly ProtectedPathV4[]): string {
  return JSON.stringify(paths.map((entry) => Object.freeze({
    path: canonicalFilesystemIdentity(entry.path),
    required: entry.required
  })));
}

async function protectedPathSnapshotDigest(paths: readonly ProtectedPathV4[]): Promise<string> {
  const snapshot: Array<{
    readonly path: string;
    readonly required: boolean;
    readonly identity: null | {
      readonly dev: string;
      readonly ino: string;
      readonly kind: 'directory' | 'file';
      readonly nlink: string;
      readonly contentDigest: string | null;
    };
  }> = [];
  for (const entry of paths) {
    const identity = await physicalPathIdentity(entry.path, entry.required);
    let contentDigest: string | null = null;
    if (identity?.kind === 'file' && entry.required) {
      contentDigest = sha256Bytes(await readFile(entry.path));
      const readback = await physicalPathIdentity(entry.path, true);
      if (readback === null || !samePhysicalIdentity(identity, readback)) {
        throw new Error('Work Package gate protected path changed while snapshotting authority');
      }
    }
    snapshot.push(Object.freeze({
      path: canonicalFilesystemIdentity(entry.path),
      required: entry.required,
      identity: identity === null ? null : Object.freeze({
        dev: String(identity.dev),
        ino: String(identity.ino),
        kind: identity.kind,
        nlink: String(identity.nlink),
        contentDigest
      })
    }));
  }
  return CodexDevelopmentVerificationDigest(snapshot);
}

function samePhysicalIdentity(left: PhysicalPathIdentityV4, right: PhysicalPathIdentityV4): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function physicalPathIdentity(
  target: string,
  required: boolean
): Promise<PhysicalPathIdentityV4 | null> {
  let metadata;
  try {
    metadata = await lstat(target, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) return null;
    throw new Error('Work Package gate filesystem identity is unavailable');
  }
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()) ||
    await isGateWindowsReparsePoint(target) ||
    metadata.dev === 0n || metadata.ino === 0n ||
    (metadata.isFile() && metadata.nlink !== 1n)) {
    throw new Error('Work Package gate filesystem object identity is ambiguous');
  }
  let canonical: string;
  try {
    canonical = await realpath(target);
  } catch {
    throw new Error('Work Package gate filesystem physical identity is unavailable');
  }
  if (canonicalFilesystemIdentity(canonical) !== canonicalFilesystemIdentity(target)) {
    throw new Error('Work Package gate filesystem path is reparse-aliased');
  }
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    kind: metadata.isDirectory() ? 'directory' : 'file',
    nlink: metadata.nlink
  });
}

async function assertExistingPathChainPhysical(repoRoot: string, target: string): Promise<void> {
  const relative = path.relative(repoRoot, target);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' ||
    relative.startsWith(`..${path.sep}`)) {
    throw new Error('Work Package gate path escaped the repository');
  }
  let current = repoRoot;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (metadata.isSymbolicLink() || await isGateWindowsReparsePoint(current) ||
      (!metadata.isDirectory() && !metadata.isFile()) ||
      metadata.dev === 0n || metadata.ino === 0n ||
      (metadata.isFile() && (metadata.nlink !== 1n || index !== segments.length - 1)) ||
      canonicalFilesystemIdentity(await realpath(current)) !== canonicalFilesystemIdentity(current)) {
      throw new Error('Work Package gate path has a reparse or aliasing ancestor');
    }
  }
}

async function assertProtectedLedger(
  repoRoot: string,
  readBytes: (filePath: string) => Promise<Uint8Array>
): Promise<void> {
  for (const [relativePath, expectedDigest] of Object.entries({
    ...WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4,
    ...WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4
  })) {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    const before = await physicalPathIdentity(absolutePath, true);
    if (before?.kind !== 'file') {
      throw new Error(`Work Package gate protected ledger input is not a regular file: ${relativePath}`);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(absolutePath);
    } catch {
      throw new Error(`Work Package gate protected ledger input is missing: ${relativePath}`);
    }
    if (sha256Bytes(bytes) !== expectedDigest) {
      throw new Error(`Work Package gate protected ledger drifted: ${relativePath}`);
    }
    const after = await physicalPathIdentity(absolutePath, true);
    if (after === null || !samePhysicalIdentity(before, after)) {
      throw new Error(`Work Package gate protected ledger identity changed: ${relativePath}`);
    }
  }
}

async function assertV4PathAuthority(
  repoRoot: string,
  runDir: string,
  snapshotRoot: string,
  namespaceRoot: string,
  namespace: string,
  protectedPaths: readonly ProtectedPathV4[]
): Promise<WorkPackageGateExecutionAuthorityV4> {
  const runDirectoryIdentityDigest = sha256Text(canonicalFilesystemIdentity(runDir));
  const namespaceIdentityDigest = sha256Text(namespace);
  const snapshotIdentityDigest = sha256Text(canonicalFilesystemIdentity(snapshotRoot));
  const namespaceRootIdentityDigest = sha256Text(canonicalFilesystemIdentity(namespaceRoot));
  if (runDirectoryIdentityDigest !== WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4 ||
    namespace !== WORK_PACKAGE_GATE_NAMESPACE_V4 ||
    namespaceIdentityDigest !== WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4 ||
    snapshotIdentityDigest !== WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4 ||
    namespaceRootIdentityDigest !== WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4) {
    throw new Error('Work Package gate V4 filesystem identity binding is invalid');
  }
  const publicationDirectory = path.join(
    repoRoot,
    '.tmp',
    '.gate-checkpoint-publications',
    `${namespace}.pending`
  );
  const leasePath = path.join(
    repoRoot,
    '.tmp',
    'test-workspaces',
    '.gate-supervisor-leases',
    `${namespace}.lock`
  );
  const externalWorkspacesRoot = path.join(repoRoot, '.tmp', 'test-workspaces');
  const candidates = [
    runDir,
    publicationDirectory,
    snapshotRoot,
    `${snapshotRoot}.owner-v1.json`,
    namespaceRoot,
    leasePath
  ];
  const protectedIdentities = new Map<string, PhysicalPathIdentityV4>();
  for (const protectedPath of protectedPaths) {
    await assertExistingPathChainPhysical(repoRoot, protectedPath.path);
    const identity = await physicalPathIdentity(protectedPath.path, protectedPath.required);
    if (identity !== null) protectedIdentities.set(protectedPath.path, identity);
  }
  for (const candidate of candidates) {
    if (protectedPaths.some((protectedPath) => {
      const exactSupervisorLeaseRootPair =
        canonicalFilesystemIdentity(candidate) === canonicalFilesystemIdentity(leasePath) &&
        canonicalFilesystemIdentity(protectedPath.path) === canonicalFilesystemIdentity(externalWorkspacesRoot);
      return !exactSupervisorLeaseRootPair && pathsOverlap(candidate, protectedPath.path);
    })) {
      throw new Error('Work Package gate V4 path overlaps protected R1/R2/R3 authority');
    }
    await assertExistingPathChainPhysical(repoRoot, candidate);
    const candidateIdentity = await physicalPathIdentity(candidate, false);
    if (candidateIdentity !== null && [...protectedIdentities.values()].some((identity) =>
      samePhysicalIdentity(candidateIdentity, identity))) {
      throw new Error('Work Package gate V4 path aliases a protected filesystem object');
    }
  }
  return Object.freeze({
    protectedLedgerDigest: WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4,
    runDirectoryIdentityDigest,
    namespaceIdentityDigest,
    snapshotIdentityDigest,
    namespaceRootIdentityDigest
  });
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

function isFrozenR2ExecutionSnapshotOwner(owner: unknown): boolean {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return false;
  const candidate = owner as Partial<ExecutionSnapshotOwnerV1>;
  return candidate.headSha === R2_EXECUTION_SNAPSHOT_HEAD_SHA &&
    candidate.treeSha === R2_EXECUTION_SNAPSHOT_TREE_SHA &&
    candidate.worktreeDigest === R2_EXECUTION_SNAPSHOT_WORKTREE_DIGEST;
}

/** Test-only seam for the frozen R2 sidecar value binding used by the production collector. */
export function workPackageGateR2ExecutionSnapshotOwnerAcceptedForTests(owner: unknown): boolean {
  return isFrozenR2ExecutionSnapshotOwner(owner);
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

      const changedTrackedResult = runGitSnapshotCommand(
        repoRoot,
        ['diff', '--name-only', '-z', 'HEAD', '--', '.'],
        { encoding: 'utf8' }
      );
      if (changedTrackedResult.status !== 0 || typeof changedTrackedResult.stdout !== 'string') {
        throw new Error('Work Package gate execution snapshot tracked inventory failed');
      }
      for (const relativePath of changedTrackedResult.stdout.split('\0').filter(Boolean).sort()) {
        if (relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.includes('../')) {
          throw new Error('Work Package gate execution snapshot contains a non-canonical tracked path');
        }
        const source = path.join(repoRoot, ...relativePath.split('/'));
        if (!await defaultPathExists(source)) continue;
        const metadata = await lstat(source);
        if (!metadata.isFile() || metadata.isSymbolicLink() || Number(metadata.nlink) !== 1) {
          throw new Error('Work Package gate execution snapshot tracked source is not a regular file');
        }
        const destination = path.join(snapshotRoot, ...relativePath.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
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

function completeIdentityProbe(
  reason: 'observed' | 'not-applicable' | 'namespace-absent',
  values: readonly string[]
): WorkPackageGateIdentityProbeEvidenceV4 {
  return Object.freeze({ complete: true, reason, identities: identitySetEvidence(values) });
}

function unknownIdentityProbe(
  reason: 'not-probed' | 'deadline' | 'host-tool-failed' | 'lifecycle-failed' |
    'output-limit' | 'parse-failed' | 'identity-changed'
): WorkPackageGateIdentityProbeEvidenceV4 {
  return Object.freeze({ complete: false, reason, identities: null });
}

function probeFailureReason(
  outcome: ObservedCommandOutcome,
  completedAtMs: number,
  deadlineAtMs: number
): 'deadline' | 'host-tool-failed' | 'lifecycle-failed' | 'output-limit' | null {
  if (outcome.stdout.observerTruncated || outcome.stderr.observerTruncated) return 'output-limit';
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out' || completedAtMs >= deadlineAtMs) {
    return 'deadline';
  }
  if (['lifecycle-failed', 'observer-failed', 'tree-unproven', 'termination-unproven']
    .includes(outcome.status) || outcome.termination.treeClosed !== true) return 'lifecycle-failed';
  return authoritativeProbeOutcome(outcome, completedAtMs, deadlineAtMs)
    ? null
    : 'host-tool-failed';
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
    AUTHORITY_PROBE_TIMEOUT_MS,
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

/** Test-only fail-closed projection for bounded authority probes. */
export function workPackageGateProbeOutcomeAcceptedForTests(
  outcome: ObservedCommandOutcome,
  completedAtMs = 0,
  deadlineAtMs = Number.POSITIVE_INFINITY
): boolean {
  return authoritativeProbeOutcome(outcome, completedAtMs, deadlineAtMs);
}

async function boundedAclIdentitySet(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<WorkPackageGateIdentityProbeEvidenceV4> {
  if (process.platform !== 'win32') return completeIdentityProbe('not-applicable', []);
  if (!await defaultPathExists(namespaceRoot)) return completeIdentityProbe('namespace-absent', []);
  const configuredRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
  const systemRoot = path.isAbsolute(configuredRoot) ? configuredRoot : String.raw`C:\Windows`;
  const canonicalRoot = await realpath(namespaceRoot);
  const rootBefore = await lstat(namespaceRoot, { bigint: true });
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() ||
    path.resolve(canonicalRoot) !== path.resolve(namespaceRoot)) {
    return unknownIdentityProbe('identity-changed');
  }
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
  if (!budget) return unknownIdentityProbe('deadline');
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
  const completedAtMs = performance.now();
  const failure = probeFailureReason(outcome, completedAtMs, deadlineAtMs);
  if (failure) return unknownIdentityProbe(failure);
  let rootAfter;
  try {
    rootAfter = await lstat(namespaceRoot, { bigint: true });
  } catch {
    return unknownIdentityProbe('identity-changed');
  }
  if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino ||
    rootAfter.isSymbolicLink()) return unknownIdentityProbe('identity-changed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString() || '[]') as unknown;
  } catch {
    return unknownIdentityProbe('parse-failed');
  }
  const values = typeof parsed === 'string' ? [parsed] : parsed;
  if (!Array.isArray(values) || values.some((value) =>
    typeof value !== 'string' || !/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(value))) {
    return unknownIdentityProbe('parse-failed');
  }
  return performance.now() < deadlineAtMs
    ? completeIdentityProbe('observed', values as string[])
    : unknownIdentityProbe('deadline');
}

type RecoveryAuthorityKindV4 =
  | 'recovery-owner'
  | 'recovery-owner-pending'
  | 'provisional-owner'
  | 'provisional-owner-pending';

interface BoundRecoveryTargetV4 {
  readonly transactionRoot: string;
  readonly stagingRoot: string;
  readonly workspaceRoot: string;
  readonly binding: string;
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function rawJsonSha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

async function readStableJsonRecord(
  filePath: string,
  maximumBytes: number
): Promise<{
  readonly value: Record<string, unknown>;
  readonly bytesDigest: `sha256:${string}`;
  readonly identityDigest: string;
}> {
  await assertExistingPathChainPhysical(path.resolve(import.meta.dir, '..'), filePath);
  const before = await physicalPathIdentity(filePath, true);
  if (before?.kind !== 'file') throw new Error('Work Package gate reserved record is not a regular file');
  const beforeMetadata = await lstat(filePath, { bigint: true });
  if (beforeMetadata.size < 1n || beforeMetadata.size > BigInt(maximumBytes)) {
    throw new Error('Work Package gate reserved record size is invalid');
  }
  const handle = await open(filePath, 'r');
  let bytes: Buffer;
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    if (!handleMetadata.isFile() || handleMetadata.nlink !== 1n ||
      handleMetadata.dev !== before.dev || handleMetadata.ino !== before.ino) {
      throw new Error('Work Package gate reserved record handle identity is invalid');
    }
    bytes = Buffer.from(await handle.readFile());
  } finally {
    await handle.close();
  }
  const after = await physicalPathIdentity(filePath, true);
  if (after === null || !samePhysicalIdentity(before, after) || bytes.byteLength !== Number(beforeMetadata.size)) {
    throw new Error('Work Package gate reserved record identity changed during read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('Work Package gate reserved record JSON is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Work Package gate reserved record must be an object');
  }
  return Object.freeze({
    value: parsed as Record<string, unknown>,
    bytesDigest: sha256Bytes(bytes),
    identityDigest: CodexDevelopmentVerificationDigest({
      canonical: canonicalFilesystemIdentity(filePath),
      dev: String(before.dev),
      ino: String(before.ino),
      nlink: String(before.nlink)
    })
  });
}

async function workspaceIdentityDigest(workspaceRoot: string): Promise<string> {
  const canonical = await realpath(workspaceRoot);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory() || Number(metadata.dev) === 0 || Number(metadata.ino) === 0) {
    throw new Error('Work Package gate owner workspace identity is invalid');
  }
  return rawJsonSha256({
    domain: 'workspace-write-lease-workspace-identity-v1',
    canonical,
    dev: String(metadata.dev),
    ino: String(metadata.ino)
  });
}

async function stagingIdentityDigest(stagingRoot: string): Promise<string> {
  const canonical = await realpath(stagingRoot);
  const metadata = await lstat(stagingRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    canonicalFilesystemIdentity(canonical) !== canonicalFilesystemIdentity(stagingRoot) ||
    Number(metadata.dev) === 0 || Number(metadata.ino) === 0) {
    throw new Error('Work Package gate owner staging identity is invalid');
  }
  return rawJsonSha256({
    domain: 'windows-appcontainer-staging-identity-v1',
    canonical: canonicalFilesystemIdentity(canonical),
    dev: String(metadata.dev),
    ino: String(metadata.ino)
  });
}

function expectedAppContainerName(stagingRoot: string, stagingDigest: string): string {
  const rootDigest = rawJsonSha256({
    domain: 'windows-appcontainer-staging-path-v1',
    path: canonicalFilesystemIdentity(stagingRoot)
  }).slice('sha256:'.length, 'sha256:'.length + 12);
  const identityDigest = rawJsonSha256({
    domain: 'windows-appcontainer-profile-identity-v1',
    stagingIdentityDigest: stagingDigest
  }).slice('sha256:'.length, 'sha256:'.length + 24);
  return `sec.sm3.${rootDigest}.${identityDigest}`;
}

function ownerKindForName(name: string): RecoveryAuthorityKindV4 | null {
  if (name === RECOVERY_OWNER_FILE) return 'recovery-owner';
  if (name === RECOVERY_OWNER_PENDING_FILE) return 'recovery-owner-pending';
  if (name === PROVISIONAL_OWNER_FILE) return 'provisional-owner';
  if (name === PROVISIONAL_OWNER_PENDING_FILE) return 'provisional-owner-pending';
  return null;
}

async function bindRecoveryOwnerRecord(
  namespaceRoot: string,
  ownerPath: string,
  kind: RecoveryAuthorityKindV4
): Promise<{
  readonly identity: string;
  readonly target: BoundRecoveryTargetV4;
}> {
  const transactionRoot = path.dirname(ownerPath);
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  if (path.dirname(workspaceRoot) !== path.resolve(namespaceRoot)) {
    throw new Error('Work Package gate recovery owner is outside a direct namespace workspace');
  }
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const record = await readStableJsonRecord(ownerPath, 4096);
  const owner = record.value;
  const recovery = kind === 'recovery-owner' || kind === 'recovery-owner-pending';
  const expectedKeys = recovery
    ? [
      'appContainerName', 'appContainerSid', 'formatVersion', 'resultFileName',
      'runtimeRelativePath', 'stagingDirectoryName', 'stagingIdentityDigest',
      'workspaceIdentityDigest'
    ]
    : [
      'appContainerName', 'formatVersion', 'hostBunConfigRelativePath',
      'stagingDirectoryName', 'stagingIdentityDigest', 'workspaceIdentityDigest'
    ];
  if (!exactObjectKeys(owner, expectedKeys) ||
    owner.formatVersion !== (recovery ? RECOVERY_OWNER_FORMAT_VERSION : PROVISIONAL_OWNER_FORMAT_VERSION) ||
    owner.stagingDirectoryName !== STAGING_DIRECTORY_NAME ||
    (recovery && (owner.runtimeRelativePath !== RUNTIME_RELATIVE_PATH ||
      owner.resultFileName !== NATIVE_RESULT_FILE ||
      typeof owner.appContainerSid !== 'string' ||
      !/^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u.test(owner.appContainerSid))) ||
    (!recovery && owner.hostBunConfigRelativePath !== HOST_BUN_CONFIG_RELATIVE_PATH)) {
    throw new Error('Work Package gate recovery owner schema is invalid');
  }
  const stagingRoot = path.join(transactionRoot, STAGING_DIRECTORY_NAME);
  const [workspaceDigest, stagingDigest] = await Promise.all([
    workspaceIdentityDigest(workspaceRoot),
    stagingIdentityDigest(stagingRoot)
  ]);
  const appContainerName = expectedAppContainerName(stagingRoot, stagingDigest);
  if (owner.workspaceIdentityDigest !== workspaceDigest ||
    owner.stagingIdentityDigest !== stagingDigest || owner.appContainerName !== appContainerName) {
    throw new Error('Work Package gate recovery owner identity binding is invalid');
  }
  const relativeTransaction = path.relative(namespaceRoot, transactionRoot).replaceAll('\\', '/');
  const binding = CodexDevelopmentVerificationDigest({
    workspaceDigest,
    stagingDigest,
    appContainerName
  });
  return Object.freeze({
    identity: `${kind}:${relativeTransaction}:${record.bytesDigest}:${record.identityDigest}:${binding}`,
    target: Object.freeze({ transactionRoot, stagingRoot, workspaceRoot, binding })
  });
}

async function assertBoundNativeResult(filePath: string): Promise<void> {
  const transactionRoot = path.dirname(filePath);
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot);
  const record = await readStableJsonRecord(filePath, 128);
  if (!exactObjectKeys(record.value, ['exitCode']) ||
    !Number.isSafeInteger(record.value.exitCode) || Number(record.value.exitCode) < 0) {
    throw new Error('Work Package gate native result record is invalid');
  }
}

async function assertBoundWorkspaceLease(directory: string): Promise<void> {
  const workspaceRoot = path.resolve(directory, '..', '..');
  if (canonicalFilesystemIdentity(directory) !== canonicalFilesystemIdentity(
    path.join(workspaceRoot, '.sec', WORKSPACE_WRITE_LEASE_DIRECTORY)
  )) {
    throw new Error('Work Package gate writer lease is outside its canonical workspace location');
  }
  const physical = await physicalPathIdentity(directory, true);
  if (physical?.kind !== 'directory') throw new Error('Work Package gate writer lease is not a directory');
  const directoryMetadata = await lstat(directory);
  const directoryDigest = rawJsonSha256({
    domain: 'workspace-write-lease-directory-identity-v1',
    dev: String(directoryMetadata.dev),
    ino: String(directoryMetadata.ino),
    mode: Number(directoryMetadata.mode)
  });
  const record = await readStableJsonRecord(path.join(directory, WORKSPACE_WRITE_LEASE_OWNER_FILE), 4096);
  const owner = record.value;
  if (!exactObjectKeys(owner, [
    'formatVersion', 'workspaceIdentityDigest', 'leaseDirectoryIdentityDigest', 'hostname',
    'pid', 'processNonce', 'leaseId', 'createdAtMs', 'heartbeatAtMs'
  ]) || owner.formatVersion !== WORKSPACE_WRITE_LEASE_FORMAT_VERSION ||
    owner.workspaceIdentityDigest !== await workspaceIdentityDigest(workspaceRoot) ||
    owner.leaseDirectoryIdentityDigest !== directoryDigest ||
    !nonEmptyString(owner.hostname) || !Number.isSafeInteger(owner.pid) || Number(owner.pid) < 0 ||
    !nonEmptyString(owner.processNonce) || !nonEmptyString(owner.leaseId) ||
    !Number.isSafeInteger(owner.createdAtMs) || Number(owner.createdAtMs) < 0 ||
    !Number.isSafeInteger(owner.heartbeatAtMs) || Number(owner.heartbeatAtMs) < Number(owner.createdAtMs)) {
    throw new Error('Work Package gate writer lease owner is invalid');
  }
}

async function scanNamespaceStructure(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY
): Promise<{
  readonly namespacePresent: boolean;
  readonly counts: {
    readonly workspaceRoots: number;
    readonly recoveryOwners: number;
    readonly pendingOwners: number;
    readonly nativeResults: number;
    readonly writerLeases: number;
  };
  readonly recoveryAuthorityIdentities: readonly string[];
  readonly recoveryTargets: readonly BoundRecoveryTargetV4[];
}> {
  const counts = {
    workspaceRoots: 0,
    recoveryOwners: 0,
    pendingOwners: 0,
    nativeResults: 0,
    writerLeases: 0
  };
  const recoveryTargets = new Map<string, BoundRecoveryTargetV4>();
  const recoveryAuthorityIdentities = new Set<string>();
  const namespacePresent = await defaultPathExists(namespaceRoot);
  if (namespacePresent) {
    const canonical = await realpath(namespaceRoot);
    const rootBefore = await lstat(namespaceRoot, { bigint: true });
    if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() ||
      path.resolve(canonical) !== path.resolve(namespaceRoot)) {
      throw new Error('Work Package gate namespace root is not a physical canonical directory');
    }
    const visitedIdentities = new Set<string>();
    const ownerKindsByTransaction = new Map<string, Set<RecoveryAuthorityKindV4>>();
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (performance.now() >= deadlineAtMs) throw new Error('Work Package gate census deadline exceeded');
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const child = path.join(directory, entry.name);
        const identity = await physicalPathIdentity(child, true);
        if (identity === null) throw new Error('Work Package gate namespace object identity is unavailable');
        const identityKey = `${identity.dev}:${identity.ino}`;
        if (visitedIdentities.has(identityKey)) {
          throw new Error('Work Package gate namespace contains an aliased filesystem object');
        }
        visitedIdentities.add(identityKey);
        if (depth === 0 && entry.isDirectory() && entry.name !== '.templates') counts.workspaceRoots += 1;
        const ownerKind = ownerKindForName(entry.name);
        if (ownerKind !== null) {
          if (!entry.isFile()) throw new Error('Work Package gate recovery owner has the wrong object kind');
          const bound = await bindRecoveryOwnerRecord(namespaceRoot, child, ownerKind);
          const transactionKinds = ownerKindsByTransaction.get(bound.target.transactionRoot) ?? new Set();
          const samePublicationPair = ownerKind.endsWith('-pending')
            ? ownerKind.slice(0, -'-pending'.length) as RecoveryAuthorityKindV4
            : `${ownerKind}-pending` as RecoveryAuthorityKindV4;
          if (transactionKinds.has(samePublicationPair)) {
            throw new Error('Work Package gate recovery owner publication state is contradictory');
          }
          transactionKinds.add(ownerKind);
          ownerKindsByTransaction.set(bound.target.transactionRoot, transactionKinds);
          const previousTarget = recoveryTargets.get(bound.target.transactionRoot);
          if (previousTarget && previousTarget.binding !== bound.target.binding) {
            throw new Error('Work Package gate recovery owner records disagree');
          }
          recoveryTargets.set(bound.target.transactionRoot, bound.target);
          recoveryAuthorityIdentities.add(bound.identity);
          if (ownerKind === 'recovery-owner') counts.recoveryOwners += 1;
          else counts.pendingOwners += 1;
        } else if (entry.name === NATIVE_RESULT_FILE) {
          if (!entry.isFile()) throw new Error('Work Package gate native result has the wrong object kind');
          await assertBoundNativeResult(child);
          counts.nativeResults += 1;
        } else if (entry.name === WORKSPACE_WRITE_LEASE_DIRECTORY) {
          if (!entry.isDirectory()) throw new Error('Work Package gate writer lease has the wrong object kind');
          await assertBoundWorkspaceLease(child);
          counts.writerLeases += 1;
        } else if (entry.name === TERMINAL_RECORD_FILE) {
          if (!entry.isFile()) throw new Error('Work Package gate terminal record has the wrong object kind');
          const terminal = await readRejectedSemanticMutationTerminal(path.dirname(child));
          if (terminal === null) throw new Error('Work Package gate terminal record disappeared during census');
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
  return Object.freeze({
    namespacePresent,
    counts: Object.freeze(counts),
    recoveryAuthorityIdentities: Object.freeze([...recoveryAuthorityIdentities].sort()),
    recoveryTargets: Object.freeze([...recoveryTargets.values()].sort((left, right) =>
      left.transactionRoot.localeCompare(right.transactionRoot)))
  });
}

async function defaultCensus(
  namespaceRoot: string,
  deadlineAtMs = Number.POSITIVE_INFINITY,
  probeAcl = true
): Promise<WorkPackageGateResidueCensusV4> {
  let structure: WorkPackageGateResidueCensusV4['structure'];
  try {
    const scanned = await scanNamespaceStructure(namespaceRoot, deadlineAtMs);
    structure = Object.freeze({
      complete: true,
      reason: scanned.namespacePresent ? 'observed' : 'namespace-absent',
      counts: scanned.counts,
      recoveryAuthorities: identitySetEvidence(scanned.recoveryAuthorityIdentities)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = performance.now() >= deadlineAtMs || message.includes('deadline')
      ? 'deadline'
      : /identity|reparse|canonical/iu.test(message)
        ? 'identity-changed'
        : 'scan-failed';
    structure = Object.freeze({ complete: false, reason, counts: null, recoveryAuthorities: null });
  }
  return Object.freeze({
    structure,
    aclPresentOwners: probeAcl
      ? await boundedAclIdentitySet(namespaceRoot, deadlineAtMs)
      : unknownIdentityProbe('not-probed')
  });
}

/** Test-only filesystem authority seam for canonical owner and reserved-object vectors. */
export async function workPackageGateNamespaceStructureForTests(namespaceRoot: string): Promise<{
  readonly counts: {
    readonly workspaceRoots: number;
    readonly recoveryOwners: number;
    readonly pendingOwners: number;
    readonly nativeResults: number;
    readonly writerLeases: number;
  };
  readonly recoveryAuthorityIdentities: readonly string[];
}> {
  const scanned = await scanNamespaceStructure(path.resolve(namespaceRoot));
  return Object.freeze({
    counts: scanned.counts,
    recoveryAuthorityIdentities: scanned.recoveryAuthorityIdentities
  });
}

function protectedWorkspaceRelativePath(workspaceRoot: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\\') ||
    relativePath.startsWith('/') || relativePath.includes('//') ||
    relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Work Package gate protected record contains a non-canonical relative path');
  }
  const resolved = path.resolve(workspaceRoot, ...relativePath.split('/'));
  if (!pathContainsOrEquals(workspaceRoot, resolved)) {
    throw new Error('Work Package gate protected record path escaped its workspace');
  }
  return resolved;
}

function terminalCompletionAuthorityPaths(
  transactionRoot: string,
  terminalSequence: number
): readonly [string, string, string] {
  if (!Number.isSafeInteger(terminalSequence) || terminalSequence <= 0 ||
    terminalSequence > 999_999_999_999) {
    throw new Error('Work Package gate protected terminal sequence is invalid');
  }
  const terminalOrderDirectory = path.join(
    path.dirname(path.dirname(path.resolve(transactionRoot))),
    TERMINAL_ORDER_DIRECTORY
  );
  return Object.freeze([
    terminalOrderDirectory,
    path.join(terminalOrderDirectory, `${terminalSequence.toString().padStart(12, '0')}.json`),
    path.join(terminalOrderDirectory, TERMINAL_SEQUENCE_HEAD_FILE)
  ]);
}

function recoveryRecordAuthorityPath(
  recordsDirectory: string,
  sequence: number,
  state: string
): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0 ||
    !['prepared', 'authoring-committed', 'verified', 'rolled-back', 'recovery-required'].includes(state)) {
    throw new Error('Work Package gate protected recovery generation identity is invalid');
  }
  return path.join(recordsDirectory, `${sequence.toString().padStart(6, '0')}-${state}.json`);
}

type ProtectedTerminalStateV4 = 'rejected' | 'verified' | 'rolled-back';
type ProtectedRecoveryRecordV4 = Parameters<typeof assertSemanticMutationRecoveryRecordInvariant>[0];

interface ProtectedTerminalCompletionV4 {
  readonly formatRevision: 'semantic-mutation-terminal-completion-v1';
  readonly terminalSequence: number;
  readonly requestIdentityDigest: string;
  readonly state: ProtectedTerminalStateV4;
  readonly completionRevision: string;
}

async function readProtectedTerminalCompletion(
  completionPath: string
): Promise<ProtectedTerminalCompletionV4> {
  const completionRead = await readStableJsonRecord(completionPath, 4096);
  const completion = completionRead.value;
  const sequence = Number(path.basename(completionPath, '.json'));
  if (!exactObjectKeys(completion, [
    'formatRevision', 'terminalSequence', 'requestIdentityDigest', 'state', 'completionRevision'
  ]) || completion.formatRevision !== 'semantic-mutation-terminal-completion-v1' ||
    !Number.isSafeInteger(completion.terminalSequence) || Number(completion.terminalSequence) <= 0 ||
    Number(completion.terminalSequence) > 999_999_999_999 ||
    completion.terminalSequence !== sequence ||
    path.basename(completionPath) !== `${sequence.toString().padStart(12, '0')}.json` ||
    typeof completion.requestIdentityDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(completion.requestIdentityDigest) ||
    (completion.state !== 'rejected' && completion.state !== 'verified' &&
      completion.state !== 'rolled-back') ||
    !nonEmptyString(completion.completionRevision)) {
    throw new Error('Work Package gate protected terminal completion binding is invalid');
  }
  const { completionRevision: suppliedRevision, ...withoutRevision } = completion;
  const expectedRevision = rawJsonSha256({
    domain: 'semantic-mutation-terminal-completion-v1',
    ...withoutRevision
  });
  if (suppliedRevision !== expectedRevision) {
    throw new Error('Work Package gate protected terminal completion revision is invalid');
  }
  return Object.freeze(completion as unknown as ProtectedTerminalCompletionV4);
}

async function assertProtectedTerminalCompletion(
  transactionRoot: string,
  terminalSequence: number,
  requestIdentityDigest: string,
  state: ProtectedTerminalStateV4
): Promise<void> {
  const completionPaths = terminalCompletionAuthorityPaths(transactionRoot, terminalSequence);
  const completion = await readProtectedTerminalCompletion(completionPaths[1]!);
  if (completion.terminalSequence !== terminalSequence ||
    completion.requestIdentityDigest !== requestIdentityDigest ||
    completion.state !== state) {
    throw new Error('Work Package gate protected terminal completion binding is invalid');
  }
}

async function readProtectedRejectedTerminalRecord(
  transactionRoot: string
): Promise<Parameters<typeof assertSemanticMutationRejectedTerminalRecordInvariant>[0]> {
  const terminalPath = path.join(transactionRoot, TERMINAL_RECORD_FILE);
  const terminalRead = await readStableJsonRecord(terminalPath, Number.MAX_SAFE_INTEGER);
  const terminal = terminalRead.value as unknown as
    Parameters<typeof assertSemanticMutationRejectedTerminalRecordInvariant>[0];
  assertSemanticMutationRejectedTerminalRecordInvariant(terminal);
  if (terminal.requestIdentityDigest !== `sha256:${path.basename(transactionRoot)}`) {
    throw new Error('Work Package gate protected terminal transaction binding is invalid');
  }
  await assertProtectedTerminalCompletion(
    transactionRoot,
    terminal.terminalSequence,
    terminal.requestIdentityDigest,
    'rejected'
  );
  return terminal;
}

function parseRecoveryRecordEntry(
  recordsDirectory: string,
  name: string
): { readonly path: string; readonly sequence: number; readonly state: string } {
  const match = /^([0-9]+)-(prepared|authoring-committed|verified|rolled-back|recovery-required)\.json$/u
    .exec(name);
  if (!match) throw new Error('Work Package gate protected recovery directory contains an unknown entry');
  const sequence = Number(match[1]);
  const state = match[2]!;
  const recordPath = recoveryRecordAuthorityPath(recordsDirectory, sequence, state);
  if (path.basename(recordPath) !== name) {
    throw new Error('Work Package gate protected recovery generation filename is noncanonical');
  }
  return Object.freeze({ path: recordPath, sequence, state });
}

async function loadProtectedRecoveryRecords(
  transactionRoot: string,
  recordsDirectory: string
): Promise<readonly ProtectedRecoveryRecordV4[]> {
  const directoryBefore = await physicalPathIdentity(recordsDirectory, true);
  if (directoryBefore?.kind !== 'directory') {
    throw new Error('Work Package gate protected recovery records path is not a directory');
  }
  const entryShape = (entries: readonly { readonly name: string; isFile(): boolean;
    isSymbolicLink(): boolean }[]): string => JSON.stringify(entries.map((entry) => ({
      name: entry.name,
      file: entry.isFile(),
      symbolicLink: entry.isSymbolicLink()
    })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const entriesBefore = await readdir(recordsDirectory, { withFileTypes: true });
  const parsedEntries = entriesBefore.map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Work Package gate protected recovery directory contains an ambiguous entry');
    }
    return parseRecoveryRecordEntry(recordsDirectory, entry.name);
  }).sort((left, right) => left.sequence - right.sequence || left.state.localeCompare(right.state));

  const records: ProtectedRecoveryRecordV4[] = [];
  for (const entry of parsedEntries) {
    const read = await readStableJsonRecord(entry.path, Number.MAX_SAFE_INTEGER);
    const record = read.value as unknown as ProtectedRecoveryRecordV4;
    assertSemanticMutationRecoveryRecordInvariant(record, records.at(-1));
    if (record.sequence !== entry.sequence || record.state !== entry.state ||
      record.requestIdentityDigest !== `sha256:${path.basename(transactionRoot)}`) {
      throw new Error('Work Package gate protected recovery generation binding is invalid');
    }
    if (record.terminalSequence !== undefined &&
      (record.state === 'verified' || record.state === 'rolled-back')) {
      await assertProtectedTerminalCompletion(
        transactionRoot,
        record.terminalSequence,
        record.requestIdentityDigest,
        record.state
      );
    }
    records.push(record);
  }
  const entriesAfter = await readdir(recordsDirectory, { withFileTypes: true });
  const directoryAfter = await physicalPathIdentity(recordsDirectory, true);
  if (directoryAfter === null || !samePhysicalIdentity(directoryBefore, directoryAfter) ||
    entryShape(entriesBefore) !== entryShape(entriesAfter)) {
    throw new Error('Work Package gate protected recovery directory changed during collection');
  }
  return Object.freeze(records);
}

async function forEachSettledBatch<T>(
  values: readonly T[],
  width: number,
  action: (value: T) => Promise<void>
): Promise<void> {
  for (let offset = 0; offset < values.length; offset += width) {
    const settled = await Promise.allSettled(values.slice(offset, offset + width).map(action));
    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (firstFailure) throw firstFailure.reason;
  }
}

async function collectProtectedTerminalOrderAuthority(
  transactionsRoot: string
): Promise<readonly string[]> {
  const terminalOrderDirectory = path.join(path.dirname(transactionsRoot), TERMINAL_ORDER_DIRECTORY);
  if (!await defaultPathExists(terminalOrderDirectory)) return Object.freeze([]);
  const directoryBefore = await physicalPathIdentity(terminalOrderDirectory, true);
  if (directoryBefore?.kind !== 'directory') {
    throw new Error('Work Package gate protected terminal order path is not a directory');
  }
  const entryShape = (entries: readonly { readonly name: string; isFile(): boolean;
    isSymbolicLink(): boolean }[]): string => JSON.stringify(entries.map((entry) => ({
      name: entry.name,
      file: entry.isFile(),
      symbolicLink: entry.isSymbolicLink()
    })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const entriesBefore = await readdir(terminalOrderDirectory, { withFileTypes: true });
  const receiptPaths: string[] = [];
  let sequenceHeadPath: string | null = null;
  for (const entry of entriesBefore) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Work Package gate protected terminal order contains an ambiguous entry');
    }
    const kind = terminalOrderEntryKind(entry.name);
    if (kind === 'sequence-head') {
      sequenceHeadPath = path.join(terminalOrderDirectory, entry.name);
    } else {
      receiptPaths.push(path.join(terminalOrderDirectory, entry.name));
    }
  }
  receiptPaths.sort();
  await forEachSettledBatch(receiptPaths, 8, async (receiptPath) => {
    await readProtectedTerminalCompletion(receiptPath);
  });
  if (sequenceHeadPath !== null) {
    const headRead = await readStableJsonRecord(sequenceHeadPath, 4096);
    const head = headRead.value;
    if (!exactObjectKeys(head, ['formatRevision', 'highestReservedSequence', 'headRevision']) ||
      head.formatRevision !== 'semantic-mutation-terminal-sequence-head-v1' ||
      !Number.isSafeInteger(head.highestReservedSequence) || Number(head.highestReservedSequence) < 0 ||
      Number(head.highestReservedSequence) > 999_999_999_999 || !nonEmptyString(head.headRevision)) {
      throw new Error('Work Package gate protected terminal sequence head is invalid');
    }
    const { headRevision: suppliedRevision, ...withoutRevision } = head;
    if (suppliedRevision !== rawJsonSha256({
      domain: 'semantic-mutation-terminal-sequence-head-v1',
      ...withoutRevision
    })) {
      throw new Error('Work Package gate protected terminal sequence head revision is invalid');
    }
  }
  const entriesAfter = await readdir(terminalOrderDirectory, { withFileTypes: true });
  const directoryAfter = await physicalPathIdentity(terminalOrderDirectory, true);
  if (directoryAfter === null || !samePhysicalIdentity(directoryBefore, directoryAfter) ||
    entryShape(entriesBefore) !== entryShape(entriesAfter)) {
    throw new Error('Work Package gate protected terminal order changed during collection');
  }
  return Object.freeze([
    terminalOrderDirectory,
    ...receiptPaths,
    ...(sequenceHeadPath === null ? [] : [sequenceHeadPath])
  ]);
}

function terminalOrderEntryKind(name: string): 'sequence-head' | 'receipt' {
  if (name === TERMINAL_SEQUENCE_HEAD_FILE) return 'sequence-head';
  if (/^[0-9]{12}\.json$/u.test(name)) return 'receipt';
  throw new Error('Work Package gate protected terminal order contains an unknown entry');
}

/** Test-only seam for the exact production terminal completion path derivation. */
export function workPackageGateTerminalCompletionAuthorityPathsForTests(
  transactionRoot: string,
  terminalSequence: number
): readonly string[] {
  return terminalCompletionAuthorityPaths(transactionRoot, terminalSequence);
}

/** Test-only seam for the exact production recovery generation path derivation. */
export function workPackageGateRecoveryRecordAuthorityPathForTests(
  transactionRoot: string,
  sequence: number,
  state: string
): string {
  return recoveryRecordAuthorityPath(path.join(path.resolve(transactionRoot), 'records'), sequence, state);
}

/** Test-only seam for exhaustive recovery-directory entry classification. */
export function workPackageGateRecoveryRecordEntryPathForTests(
  recordsDirectory: string,
  name: string
): string {
  return parseRecoveryRecordEntry(path.resolve(recordsDirectory), name).path;
}

/** Test-only seam for exhaustive terminal-order entry classification. */
export function workPackageGateTerminalOrderEntryKindForTests(
  name: string
): 'sequence-head' | 'receipt' {
  return terminalOrderEntryKind(name);
}

async function collectProtectedPathAuthorityV4(repoRoot: string): Promise<readonly ProtectedPathV4[]> {
  const entries = new Map<string, ProtectedPathV4>();
  const add = (candidate: string, required: boolean): void => {
    const resolved = path.resolve(candidate);
    const key = canonicalFilesystemIdentity(resolved);
    const previous = entries.get(key);
    entries.set(key, Object.freeze({ path: resolved, required: required || previous?.required === true }));
  };
  const relative = (value: string, required: boolean): void => add(
    path.join(repoRoot, ...value.split('/')),
    required
  );
  relative('.tmp/sm3-r2-work-package-gate', true);
  relative('.tmp/sm3-r3-work-package-gate', false);
  relative('.tmp/sm3-r3-v2-work-package-gate', false);
  relative('.tmp/sm3-r3-v3-work-package-gate', false);

  const r2EvidencePath = path.join(repoRoot, 'docs', 'evidence', 'v0-4-semantic-mutation-apply-r2-verification.json');
  const r2Evidence = JSON.parse(await readFile(r2EvidencePath, 'utf8')) as {
    readonly preservedAuthority?: {
      readonly executionSnapshot?: unknown;
      readonly executionSnapshotOwner?: unknown;
      readonly retainedNamespace?: unknown;
    };
  };
  const preserved = r2Evidence.preservedAuthority;
  if (!preserved ||
    preserved.executionSnapshot !== '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned' ||
    preserved.executionSnapshotOwner !==
      '.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned.owner-v1.json' ||
    preserved.retainedNamespace !== 'engineering-compiler-sm3-terminal-retention-fSCj2d') {
    throw new Error('Work Package gate R2 preserved authority record is invalid');
  }
  const r2Snapshot = path.join(repoRoot, ...preserved.executionSnapshot.split('/'));
  const r2Sidecar = path.join(repoRoot, ...preserved.executionSnapshotOwner.split('/'));
  const r2NamespaceRoot = path.join(
    r2Snapshot,
    '.tmp',
    'test-workspaces',
    path.basename(r2Snapshot)
  );
  const r2RetainedWorkspace = path.join(r2NamespaceRoot, preserved.retainedNamespace);
  for (const value of [r2Snapshot, r2Sidecar, r2NamespaceRoot, r2RetainedWorkspace]) add(value, true);
  const r2Owner = await readExecutionSnapshotOwner(repoRoot, r2Snapshot);
  if (!isFrozenR2ExecutionSnapshotOwner(r2Owner)) {
    throw new Error('Work Package gate R2 execution snapshot owner drifted from frozen evidence');
  }

  const inspectWorkspace = async (workspaceRoot: string, namespaceParent: string): Promise<boolean> => {
    const transactionsRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1', 'transactions');
    const terminalOrderDirectory = path.join(path.dirname(transactionsRoot), TERMINAL_ORDER_DIRECTORY);
    const transactionsPresent = await defaultPathExists(transactionsRoot);
    if (!transactionsPresent && await defaultPathExists(terminalOrderDirectory)) {
      throw new Error('Work Package gate terminal authority has no canonical transactions root');
    }
    let protectedWorkspace = false;
    if (transactionsPresent) {
      await assertExistingPathChainPhysical(repoRoot, transactionsRoot);
      if ((await physicalPathIdentity(workspaceRoot, true))?.kind !== 'directory') {
        throw new Error('Work Package gate protected workspace is not a canonical directory');
      }
      const transactionsRootBefore = await physicalPathIdentity(transactionsRoot, true);
      if (transactionsRootBefore?.kind !== 'directory') {
        throw new Error('Work Package gate protected transactions root is not a canonical directory');
      }
      add(transactionsRoot, true);
      protectedWorkspace = true;
      const transactionEntries = (await readdir(transactionsRoot, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      await forEachSettledBatch(transactionEntries, 8, async (transactionEntry) => {
      if (!/^[0-9a-f]{64}$/u.test(transactionEntry.name) || !transactionEntry.isDirectory() ||
        transactionEntry.isSymbolicLink()) {
        throw new Error('Work Package gate protected transactions root contains an ambiguous entry');
      }
      const transactionRoot = path.join(transactionsRoot, transactionEntry.name);
      if ((await physicalPathIdentity(transactionRoot, true))?.kind !== 'directory') {
        throw new Error('Work Package gate protected transaction is not a canonical directory');
      }
      let transactionProtected = false;
      for (const name of [
        RECOVERY_OWNER_FILE,
        RECOVERY_OWNER_PENDING_FILE,
        PROVISIONAL_OWNER_FILE,
        PROVISIONAL_OWNER_PENDING_FILE
      ]) {
        const ownerPath = path.join(transactionRoot, name);
        if (!await defaultPathExists(ownerPath)) continue;
        const kind = ownerKindForName(name)!;
        const bound = await bindRecoveryOwnerRecord(namespaceParent, ownerPath, kind);
        for (const value of [
          ownerPath,
          bound.target.transactionRoot,
          bound.target.stagingRoot,
          path.join(bound.target.stagingRoot, RUNTIME_RELATIVE_PATH),
          path.join(bound.target.stagingRoot, HOST_BUN_CONFIG_RELATIVE_PATH),
          path.join(bound.target.transactionRoot, NATIVE_RESULT_FILE)
        ]) add(value, value === ownerPath || value === bound.target.transactionRoot ||
          value === bound.target.stagingRoot);
        transactionProtected = true;
      }
      const nativeResult = path.join(transactionRoot, NATIVE_RESULT_FILE);
      if (await defaultPathExists(nativeResult)) {
        await assertBoundNativeResult(nativeResult);
        add(nativeResult, true);
        transactionProtected = true;
      }
      const terminalPath = path.join(transactionRoot, TERMINAL_RECORD_FILE);
      if (await defaultPathExists(terminalPath)) {
        const terminal = await readProtectedRejectedTerminalRecord(transactionRoot);
        add(terminalPath, true);
        for (const terminalAuthorityPath of terminalCompletionAuthorityPaths(
          transactionRoot,
          terminal.terminalSequence
        )) add(terminalAuthorityPath, true);
        for (const sourceChange of terminal.result.sourceChanges) {
          add(protectedWorkspaceRelativePath(workspaceRoot, sourceChange.relativePath), false);
        }
        transactionProtected = true;
      }
      const recordsDirectory = path.join(transactionRoot, 'records');
      if (await defaultPathExists(recordsDirectory)) {
        const records = await loadProtectedRecoveryRecords(transactionRoot, recordsDirectory);
        add(recordsDirectory, true);
        for (const record of records) {
          add(recoveryRecordAuthorityPath(recordsDirectory, record.sequence, record.state), true);
          if (record.terminalSequence !== undefined) {
            for (const terminalAuthorityPath of terminalCompletionAuthorityPaths(
              transactionRoot,
              record.terminalSequence
            )) add(terminalAuthorityPath, true);
          }
          add(protectedWorkspaceRelativePath(workspaceRoot, record.relativePath), false);
        }
        transactionProtected = true;
      }
      if (transactionProtected) {
        add(transactionRoot, true);
        protectedWorkspace = true;
      }
      });
      const transactionEntriesAfter = await readdir(transactionsRoot, { withFileTypes: true });
      const transactionsRootAfter = await physicalPathIdentity(transactionsRoot, true);
      const transactionShape = (values: readonly { readonly name: string; isDirectory(): boolean;
        isSymbolicLink(): boolean }[]): string => JSON.stringify(values.map((entry) => ({
          name: entry.name,
          directory: entry.isDirectory(),
          symbolicLink: entry.isSymbolicLink()
        })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
      if (transactionsRootAfter === null ||
        !samePhysicalIdentity(transactionsRootBefore, transactionsRootAfter) ||
        transactionShape(transactionEntries) !== transactionShape(transactionEntriesAfter)) {
        throw new Error('Work Package gate protected transactions root changed during collection');
      }
      for (const terminalAuthorityPath of await collectProtectedTerminalOrderAuthority(transactionsRoot)) {
        add(terminalAuthorityPath, true);
      }
    }
    const leaseDirectory = path.join(workspaceRoot, '.sec', WORKSPACE_WRITE_LEASE_DIRECTORY);
    if (await defaultPathExists(leaseDirectory)) {
      await assertBoundWorkspaceLease(leaseDirectory);
      add(leaseDirectory, true);
      add(path.join(leaseDirectory, WORKSPACE_WRITE_LEASE_OWNER_FILE), true);
      protectedWorkspace = true;
    }
    if (protectedWorkspace) add(workspaceRoot, true);
    return protectedWorkspace;
  };

  await inspectWorkspace(r2RetainedWorkspace, r2NamespaceRoot);
  const externalWorkspacesRoot = path.join(repoRoot, '.tmp', 'test-workspaces');
  if (await defaultPathExists(externalWorkspacesRoot)) {
    const rootBefore = await physicalPathIdentity(externalWorkspacesRoot, true);
    if (rootBefore?.kind !== 'directory') {
      throw new Error('Work Package gate external workspace root is not a canonical directory');
    }
    add(externalWorkspacesRoot, true);
    const entriesBefore = (await readdir(externalWorkspacesRoot, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.gate-supervisor-leases')
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entriesBefore) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error('Work Package gate external workspace root contains an ambiguous entry');
      }
      await inspectWorkspace(path.join(externalWorkspacesRoot, entry.name), externalWorkspacesRoot);
    }
    const entriesAfter = (await readdir(externalWorkspacesRoot, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.gate-supervisor-leases')
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const rootAfter = await physicalPathIdentity(externalWorkspacesRoot, true);
    const workspaceShape = (values: readonly { readonly name: string; isDirectory(): boolean;
      isSymbolicLink(): boolean }[]): string => JSON.stringify(values.map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
        symbolicLink: entry.isSymbolicLink()
      })));
    if (rootAfter === null || !samePhysicalIdentity(rootBefore, rootAfter) ||
      workspaceShape(entriesBefore) !== workspaceShape(entriesAfter)) {
      throw new Error('Work Package gate external workspace root changed during collection');
    }
  }
  return Object.freeze([...entries.values()].sort((left, right) => left.path.localeCompare(right.path)));
}

/** Test-only seam exercising the complete production V4 protected-path collector. */
export async function workPackageGateProtectedPathAuthorityForTests(
  repoRoot: string
): Promise<readonly { readonly path: string; readonly required: boolean }[]> {
  return collectProtectedPathAuthorityV4(path.resolve(repoRoot));
}

async function defaultRecoverOwnedNamespace(
  namespaceRoot: string,
  deadlineAtMs: number,
  authorization: WorkPackageGateIdentitySetEvidenceV1
): Promise<'not-needed' | 'completed' | 'failed'> {
  try {
    const discovered = await scanNamespaceStructure(namespaceRoot, deadlineAtMs);
    const observedAuthorization = identitySetEvidence(discovered.recoveryAuthorityIdentities);
    if (observedAuthorization.count !== authorization.count ||
      observedAuthorization.digest !== authorization.digest) return 'failed';
    if (discovered.recoveryTargets.length === 0) return 'not-needed';
    for (const target of discovered.recoveryTargets) {
      const totalBudgetMs = Math.floor(deadlineAtMs - performance.now());
      if (totalBudgetMs < 3) return 'failed';
      const terminationDeadlineMs = Math.max(1, Math.min(5_000, Math.floor(totalBudgetMs / 4)));
      const timeoutMs = totalBudgetMs - terminationDeadlineMs;
      const outcome = await runObservedCommand(process.execPath, [
        path.join(path.resolve(namespaceRoot, '..', '..', '..'), 'scripts', 'run-work-package-gate.ts'),
        '--internal-owned-recovery',
        target.stagingRoot,
        target.workspaceRoot
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
  readBytes: (filePath) => readFile(filePath),
  pathExists: defaultPathExists,
  protectedPathAuthority: collectProtectedPathAuthorityV4,
  gitRevision,
  worktreeDigest: defaultWorktreeDigest,
  runChild: runObservedCommand,
  census: defaultCensus,
  sideEffectCensus: (_stage, namespaceRoot, deadlineAtMs, probeAcl) =>
    defaultCensus(namespaceRoot, deadlineAtMs, probeAcl),
  recoverOwnedNamespace: defaultRecoverOwnedNamespace,
  removeNamespace: defaultRemoveNamespace,
  prepareExecutionSnapshot: defaultPrepareExecutionSnapshot,
  removeExecutionSnapshot: defaultRemoveExecutionSnapshot,
  wallClock: () => new Date(),
  monotonicNowMs: () => performance.now(),
  afterCheckpoint: async () => undefined
};

function hasRecoveryAuthority(census: WorkPackageGateResidueCensusV4): boolean {
  return census.structure.complete && census.structure.recoveryAuthorities.count > 0 &&
    census.structure.counts.recoveryOwners + census.structure.counts.pendingOwners > 0;
}

function structureAllowsDeletion(census: WorkPackageGateResidueCensusV4): boolean {
  if (!census.structure.complete) return false;
  const counts = census.structure.counts;
  return counts.workspaceRoots === 0 && counts.recoveryOwners === 0 && counts.pendingOwners === 0 &&
    counts.nativeResults === 0 && counts.writerLeases === 0 &&
    census.structure.recoveryAuthorities.count === 0;
}

function ownedCensusClean(census: WorkPackageGateResidueCensusV4): boolean {
  return structureAllowsDeletion(census) && census.aclPresentOwners.complete &&
    census.aclPresentOwners.identities.count === 0;
}

function preflightCensusClean(census: WorkPackageGateResidueCensusV4): boolean {
  return ownedCensusClean(census);
}

function finalCensusClean(census: WorkPackageGateResidueCensusV4): boolean {
  return structureAllowsDeletion(census) && census.structure.complete &&
    census.structure.reason === 'namespace-absent' &&
    census.aclPresentOwners.complete &&
    census.aclPresentOwners.reason === 'namespace-absent' &&
    census.aclPresentOwners.identities.count === 0;
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

class WorkPackageGateFailureIndexCollector {
  private readonly pending = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  private readonly dropping = { stdout: false, stderr: false };
  private readonly currentSelectionIndex: { stdout: number | null; stderr: number | null } = {
    stdout: null,
    stderr: null
  };
  private readonly selected = new Set<number>();
  private failureMarkerCount = 0;
  private unmappedMarkerCount = 0;
  private malformedMarkerCount = 0;
  private oversizedLineCount = 0;
  private utf8Invalid = false;
  private ansiInvalid = false;
  private observerTruncated = false;
  private parserFailure = false;
  private observedBytes = 0;

  constructor(private readonly testFiles: readonly string[]) {}

  observe(stream: 'stdout' | 'stderr', chunk: Uint8Array): void {
    try {
      const remaining = Math.max(0, DIAGNOSTIC_OBSERVER_LIMIT_BYTES - this.observedBytes);
      const observed = Buffer.from(chunk).subarray(0, remaining);
      this.observedBytes += observed.byteLength;
      if (observed.byteLength < chunk.byteLength) this.observerTruncated = true;
      if (observed.byteLength > 0) this.consume(stream, observed);
    } catch {
      this.parserFailure = true;
      this.currentSelectionIndex[stream] = null;
    }
  }

  private consume(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    let bytes = chunk;
    if (this.dropping[stream]) {
      const newline = bytes.indexOf(0x0a);
      if (newline < 0) return;
      bytes = bytes.subarray(newline + 1);
      this.dropping[stream] = false;
    }
    const combined = this.pending[stream].byteLength === 0
      ? bytes
      : Buffer.concat([this.pending[stream], bytes]);
    let offset = 0;
    for (;;) {
      const newline = combined.indexOf(0x0a, offset);
      if (newline < 0) break;
      let line = combined.subarray(offset, newline);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.byteLength > DIAGNOSTIC_LINE_LIMIT) {
        this.oversizedLineCount += 1;
        this.currentSelectionIndex[stream] = null;
      } else {
        this.consumeLine(stream, line);
      }
      offset = newline + 1;
    }
    this.pending[stream] = Buffer.from(combined.subarray(offset));
    if (this.pending[stream].byteLength > DIAGNOSTIC_LINE_LIMIT) {
      this.pending[stream] = Buffer.alloc(0);
      this.dropping[stream] = true;
      this.oversizedLineCount += 1;
      this.currentSelectionIndex[stream] = null;
    }
  }

  private stripAnsiSgr(value: string): string | null {
    let output = '';
    for (let index = 0; index < value.length;) {
      if (value.charCodeAt(index) !== 0x1b) {
        output += value[index]!;
        index += 1;
        continue;
      }
      const match = /^\u001b\[[0-9;]*m/u.exec(value.slice(index));
      if (!match) return null;
      index += match[0].length;
    }
    return output;
  }

  private consumeLine(stream: 'stdout' | 'stderr', rawLine: Buffer): void {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawLine);
    } catch {
      this.utf8Invalid = true;
      this.currentSelectionIndex[stream] = null;
      return;
    }
    const line = this.stripAnsiSgr(decoded);
    if (line === null) {
      this.ansiInvalid = true;
      this.currentSelectionIndex[stream] = null;
      return;
    }
    const trimmed = line.trim();
    const lexicalHeaderCandidate = trimmed.toLocaleLowerCase('en-US').includes('.test.ts');
    if (lexicalHeaderCandidate) {
      this.currentSelectionIndex[stream] = null;
      const headerIndex = this.testFiles.findIndex((file) =>
        trimmed === file || trimmed === `${file}:`);
      if (headerIndex >= 0) this.currentSelectionIndex[stream] = headerIndex;
    }
    const validMarker = /^[\t ]*\(fail\)(?:[\t ]|$)/u.test(line);
    const markerLike = line.includes('(fail');
    if (!validMarker) {
      if (markerLike) this.malformedMarkerCount += 1;
      return;
    }
    this.failureMarkerCount += 1;
    const selectionIndex = this.currentSelectionIndex[stream];
    if (selectionIndex === null) this.unmappedMarkerCount += 1;
    else this.selected.add(selectionIndex);
  }

  finish(child: WorkPackageGateChildEvidenceV1): WorkPackageGateDiagnosticV4 {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (!this.dropping[stream] && this.pending[stream].byteLength > 0) {
        this.consumeLine(stream, this.pending[stream]);
        this.pending[stream] = Buffer.alloc(0);
      }
    }
    const selectionIndexes = [...this.selected].sort((left, right) => left - right);
    const observerTruncated = this.observerTruncated ||
      child.stdout.observerTruncated || child.stderr.observerTruncated;
    const actionable = child.status === 'exited' && child.exitCode !== null && child.exitCode !== 0 &&
      selectionIndexes.length > 0 && this.failureMarkerCount > 0 && this.unmappedMarkerCount === 0 &&
      this.malformedMarkerCount === 0 && this.oversizedLineCount === 0 &&
      !this.utf8Invalid && !this.ansiInvalid && !observerTruncated && !this.parserFailure;
    return Object.freeze({
      status: actionable ? 'actionable' : 'non-actionable',
      selectionIndexes: Object.freeze(selectionIndexes),
      failureMarkerCount: this.failureMarkerCount,
      unmappedMarkerCount: this.unmappedMarkerCount,
      malformedMarkerCount: this.malformedMarkerCount,
      oversizedLineCount: this.oversizedLineCount,
      utf8Invalid: this.utf8Invalid,
      ansiInvalid: this.ansiInvalid,
      observerTruncated,
      parserFailure: this.parserFailure
    });
  }
}

function emptyDiagnostic(child: WorkPackageGateChildEvidenceV1): WorkPackageGateDiagnosticV4 {
  return new WorkPackageGateFailureIndexCollector([]).finish(child);
}

/** Test-only pure projection for bounded chunk and redaction vectors. */
export function workPackageGateFailureIndexForTests(
  testFiles: readonly string[],
  chunks: readonly { readonly stream: 'stdout' | 'stderr'; readonly chunk: string | Uint8Array }[],
  child: WorkPackageGateChildEvidenceV1
): WorkPackageGateDiagnosticV4 {
  const collector = new WorkPackageGateFailureIndexCollector(testFiles);
  for (const chunk of chunks) collector.observe(
    chunk.stream,
    typeof chunk.chunk === 'string' ? Buffer.from(chunk.chunk) : chunk.chunk
  );
  return collector.finish(child);
}

interface WorkPackageGateTerminalV4 {
  readonly status: WorkPackageGateStatus;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly repository: WorkPackageGateEvidenceV4['repository'];
}

interface WorkPackageGatePublicationV4 {
  readonly completedEvent: WorkPackageGateEventV4;
  readonly evidence: WorkPackageGateEvidenceV4;
}

interface WorkPackageGateCheckpointV4 {
  readonly schema: typeof WORK_PACKAGE_GATE_CHECKPOINT_SCHEMA_V4;
  readonly runId: string;
  readonly startedAt: string;
  readonly authority: WorkPackageGateExecutionAuthorityV4;
  readonly headSha: string;
  readonly treeSha: string;
  readonly worktreeBeforeDigest: string;
  readonly executionSnapshotDigest: string;
  readonly snapshotPreparationAttempted: boolean;
  readonly executionSnapshotPrepared: boolean;
  readonly executionSnapshotVerified: boolean;
  readonly selection: WorkPackageGateSelectionV1;
  readonly preflight: WorkPackageGateResidueCensusV4 | null;
  readonly childAttempted: boolean;
  readonly child: WorkPackageGateChildEvidenceV1 | null;
  readonly diagnostic: WorkPackageGateDiagnosticV4 | null;
  readonly postChild: WorkPackageGateResidueCensusV4 | null;
  readonly recoveryAuthorization: WorkPackageGateIdentitySetEvidenceV1 | null;
  readonly recoveryAttempted: boolean;
  readonly recovery: WorkPackageGateRecoveryEvidenceV4 | null;
  readonly postRecovery: WorkPackageGateResidueCensusV4 | null;
  readonly namespaceRemovalAttempted: boolean;
  readonly namespaceRemoved: boolean;
  readonly finalCensus: WorkPackageGateResidueCensusV4 | null;
  readonly snapshotRemovalAttempted: boolean;
  readonly snapshotRemoved: boolean;
  readonly terminal: WorkPackageGateTerminalV4 | null;
  readonly journal: {
    readonly lastSequence: number;
    readonly digest: string | null;
    readonly events: readonly WorkPackageGateEventV4[];
  };
  readonly publication: WorkPackageGatePublicationV4 | null;
  readonly completedEventPublicationAttempted: boolean;
  readonly completedEventPublished: boolean;
  readonly evidencePublicationAttempted: boolean;
  readonly evidencePublished: boolean;
  readonly checkpointDigest: string;
}

type WorkPackageGateCheckpointDraftV4 = Omit<WorkPackageGateCheckpointV4, 'checkpointDigest'>;

function finalizeCheckpoint(
  draft: WorkPackageGateCheckpointDraftV4
): WorkPackageGateCheckpointV4 {
  return Object.freeze({
    ...draft,
    checkpointDigest: CodexDevelopmentVerificationDigest(draft)
  });
}

function updateCheckpoint(
  checkpoint: WorkPackageGateCheckpointV4,
  patch: Partial<WorkPackageGateCheckpointDraftV4>
): WorkPackageGateCheckpointV4 {
  const { checkpointDigest: _checkpointDigest, ...draft } = checkpoint;
  return finalizeCheckpoint({ ...draft, ...patch });
}

function assertCheckpointChild(value: unknown): asserts value is WorkPackageGateChildEvidenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'status', 'trigger', 'started', 'exitCode', 'signal', 'durationMs',
    'stdout', 'stderr', 'termination'
  ])) throw new Error('Work Package gate checkpoint child shape is invalid');
  const child = value as Record<string, unknown>;
  if (!['exited', 'spawn-failed', 'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed',
    'timed-out', 'tree-unproven', 'termination-unproven'].includes(String(child.status)) ||
    (child.trigger !== null && !['aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out']
      .includes(String(child.trigger))) || typeof child.started !== 'boolean' ||
    (child.exitCode !== null && !Number.isSafeInteger(child.exitCode)) ||
    (child.signal !== null && !/^SIG[A-Z0-9]+$/u.test(String(child.signal))) ||
    !Number.isFinite(child.durationMs) || Number(child.durationMs) < 0) {
    throw new Error('Work Package gate checkpoint child value is invalid');
  }
  for (const streamName of ['stdout', 'stderr'] as const) {
    const stream = child[streamName];
    if (!stream || typeof stream !== 'object' || Array.isArray(stream) ||
      !exactObjectKeys(stream, ['bytes', 'digest', 'observerTruncated'])) {
      throw new Error('Work Package gate checkpoint child stream is invalid');
    }
    const streamRecord = stream as Record<string, unknown>;
    if (!Number.isSafeInteger(streamRecord.bytes) || Number(streamRecord.bytes) < 0 ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(streamRecord.digest)) ||
      typeof streamRecord.observerTruncated !== 'boolean') {
      throw new Error('Work Package gate checkpoint child stream is invalid');
    }
  }
  const termination = child.termination;
  if (!termination || typeof termination !== 'object' || Array.isArray(termination) ||
    !exactObjectKeys(termination, [
      'requested', 'gracefulAttempted', 'forcedAttempted',
      'childCloseObserved', 'streamsDrained', 'treeClosed'
    ]) || Object.values(termination).some((entry) => typeof entry !== 'boolean')) {
    throw new Error('Work Package gate checkpoint child termination is invalid');
  }
  const typedTermination = termination as WorkPackageGateChildEvidenceV1['termination'];
  if ((!typedTermination.requested &&
      (typedTermination.gracefulAttempted || typedTermination.forcedAttempted)) ||
    (child.started && typedTermination.treeClosed &&
      (!typedTermination.childCloseObserved || !typedTermination.streamsDrained))) {
    throw new Error('Work Package gate checkpoint child termination is contradictory');
  }
}

function assertCheckpointRecovery(
  value: unknown,
  authorization: WorkPackageGateIdentitySetEvidenceV1 | null,
  postChild: WorkPackageGateResidueCensusV4 | null
): asserts value is WorkPackageGateRecoveryEvidenceV4 {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !exactObjectKeys(value, ['attempted', 'complete', 'reason', 'authorization'])) {
    throw new Error('Work Package gate checkpoint recovery shape is invalid');
  }
  const recovery = value as Record<string, unknown>;
  const postChildComplete = postChild?.structure.complete === true;
  const observedRecoveryAuthority = postChildComplete && hasRecoveryAuthority(postChild);
  const valid =
    (recovery.reason === 'not-needed' && recovery.attempted === false && recovery.complete === true &&
      recovery.authorization === null && postChildComplete && !observedRecoveryAuthority) ||
    (recovery.reason === 'authority-preserved' && recovery.attempted === false &&
      recovery.complete === false && recovery.authorization === null && !postChildComplete) ||
    (recovery.reason === 'completed' && recovery.attempted === true && recovery.complete === true &&
      recovery.authorization !== null && observedRecoveryAuthority) ||
    (recovery.reason === 'failed' && recovery.attempted === true && recovery.complete === false &&
      recovery.authorization !== null && observedRecoveryAuthority);
  if (!valid || JSON.stringify(recovery.authorization) !== JSON.stringify(authorization)) {
    throw new Error('Work Package gate checkpoint recovery algebra is invalid');
  }
  if (observedRecoveryAuthority !== (authorization !== null) ||
    (authorization !== null && (postChild === null || !postChild.structure.complete ||
      authorization.count !== postChild.structure.recoveryAuthorities.count ||
      authorization.digest !== postChild.structure.recoveryAuthorities.digest))) {
    throw new Error('Work Package gate checkpoint recovery authorization is not census-bound');
  }
}

function assertCheckpointRepository(value: unknown): asserts value is WorkPackageGateEvidenceV4['repository'] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactObjectKeys(value, [
    'headSha', 'treeSha', 'headShaAfter', 'treeShaAfter', 'worktreeBeforeDigest',
    'worktreeAfterDigest', 'executionSnapshotDigest', 'executionSnapshotAfterDigest',
    'executionSnapshotRemoved'
  ])) throw new Error('Work Package gate checkpoint terminal repository shape is invalid');
  const repository = value as Record<string, unknown>;
  if (!/^[0-9a-f]{40}$/u.test(String(repository.headSha)) ||
    !/^[0-9a-f]{40}$/u.test(String(repository.treeSha)) ||
    (repository.headShaAfter !== null && !/^[0-9a-f]{40}$/u.test(String(repository.headShaAfter))) ||
    (repository.treeShaAfter !== null && !/^[0-9a-f]{40}$/u.test(String(repository.treeShaAfter))) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(repository.worktreeBeforeDigest)) ||
    (repository.worktreeAfterDigest !== null &&
      !/^sha256:[0-9a-f]{64}$/u.test(String(repository.worktreeAfterDigest))) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(repository.executionSnapshotDigest)) ||
    (repository.executionSnapshotAfterDigest !== null &&
      !/^sha256:[0-9a-f]{64}$/u.test(String(repository.executionSnapshotAfterDigest))) ||
    typeof repository.executionSnapshotRemoved !== 'boolean') {
    throw new Error('Work Package gate checkpoint terminal repository is invalid');
  }
}

function checkpointResidue(checkpoint: WorkPackageGateCheckpointV4): WorkPackageGateEvidenceV4['residue'] {
  return Object.freeze({
    preflight: checkpoint.preflight,
    postChild: checkpoint.postChild,
    postRecovery: checkpoint.postRecovery,
    final: checkpoint.finalCensus,
    namespaceRemovalAttempted: checkpoint.namespaceRemovalAttempted,
    namespaceRemoved: checkpoint.namespaceRemoved
  });
}

function expectedCheckpointJournal(checkpoint: WorkPackageGateCheckpointV4): readonly WorkPackageGateEventV4[] {
  const events: WorkPackageGateEventV4[] = [];
  const push = (
    kind: Exclude<WorkPackageGateEventKind, 'heartbeat'>,
    phase: string,
    subject: unknown,
    elapsedMs: number,
    child: WorkPackageGateChildEvidenceV1 | null
  ): void => {
    events.push(finalizeWorkPackageGateEventV4({
      sequence: events.length + 1,
      kind,
      elapsedMs,
      phase,
      stdoutBytes: child?.stdout.bytes ?? 0,
      stderrBytes: child?.stderr.bytes ?? 0,
      subject,
      previousDigest: events.at(-1)?.eventDigest ?? null
    }));
  };
  push('started', 'preflight', {
    runId: checkpoint.runId,
    selection: checkpoint.selection,
    authority: checkpoint.authority,
    repositoryBefore: {
      headSha: checkpoint.headSha,
      treeSha: checkpoint.treeSha,
      worktreeBeforeDigest: checkpoint.worktreeBeforeDigest,
      executionSnapshotDigest: checkpoint.executionSnapshotDigest
    },
    timeouts: { watchdogMs: 1_800_000, cleanupMs: 120_000 }
  }, 0, null);
  const child = checkpoint.child;
  if (child !== null && child.trigger === 'timed-out') {
    push('deadline', 'watchdog', {
      status: child.status,
      trigger: child.trigger,
      watchdogMs: 1_800_000
    }, child.durationMs, child);
  }
  if (child !== null && child.termination.requested) {
    push('termination', 'tree-close', child.termination, child.durationMs, child);
  }
  if (child !== null && checkpoint.recovery !== null) {
    const recovery = checkpoint.recovery;
    push(
      'recovery',
      recovery.complete ? 'recovery-complete' : 'authority-preserved',
      recovery,
      child.durationMs,
      child
    );
    const residue = checkpointResidue(checkpoint);
    push(
      'residue',
      checkpoint.finalCensus === null ? 'residue-unknown' : 'residue-census',
      residue,
      child.durationMs,
      child
    );
    if (checkpoint.publication !== null && checkpoint.terminal !== null) {
      const terminal = checkpoint.terminal;
      push('completed', terminal.status, {
        status: terminal.status,
        child,
        diagnostic: checkpoint.diagnostic,
        repository: terminal.repository,
        recovery,
        residue
      }, Math.max(terminal.durationMs, events.at(-1)?.elapsedMs ?? 0), child);
    }
  }
  return Object.freeze(events);
}

function assertCheckpoint(
  value: unknown,
  expectedRunId: string,
  expectedSelection: WorkPackageGateSelectionV1,
  expectedAuthority: WorkPackageGateExecutionAuthorityV4
): asserts value is WorkPackageGateCheckpointV4 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Work Package gate checkpoint must be an object');
  }
  const checkpoint = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'runId', 'startedAt', 'authority', 'headSha', 'treeSha', 'worktreeBeforeDigest',
    'executionSnapshotDigest', 'snapshotPreparationAttempted',
    'executionSnapshotPrepared', 'executionSnapshotVerified',
    'selection', 'preflight', 'childAttempted', 'child', 'diagnostic', 'postChild',
    'recoveryAuthorization', 'recoveryAttempted', 'recovery', 'postRecovery',
    'namespaceRemovalAttempted', 'namespaceRemoved', 'finalCensus',
    'snapshotRemovalAttempted', 'snapshotRemoved', 'terminal', 'journal', 'publication',
    'completedEventPublicationAttempted', 'completedEventPublished',
    'evidencePublicationAttempted', 'evidencePublished', 'checkpointDigest'
  ].sort();
  if (JSON.stringify(Object.keys(checkpoint).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('Work Package gate checkpoint keys are invalid');
  }
  const { checkpointDigest, ...draft } = checkpoint;
  const childTreeClosed =
    (checkpoint.child as { termination?: { treeClosed?: unknown } } | null)?.termination?.treeClosed === true;
  const recoveryComplete = (checkpoint.recovery as { complete?: unknown } | null)?.complete === true;
  if (checkpoint.schema !== WORK_PACKAGE_GATE_CHECKPOINT_SCHEMA_V4 ||
    checkpoint.runId !== expectedRunId ||
    JSON.stringify(checkpoint.authority) !== JSON.stringify(expectedAuthority) ||
    !Number.isFinite(Date.parse(String(checkpoint.startedAt))) ||
    !/^[0-9a-f]{40}$/u.test(String(checkpoint.headSha)) ||
    !/^[0-9a-f]{40}$/u.test(String(checkpoint.treeSha)) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(checkpoint.worktreeBeforeDigest)) ||
    checkpoint.executionSnapshotDigest !== checkpoint.worktreeBeforeDigest ||
    typeof checkpoint.snapshotPreparationAttempted !== 'boolean' ||
    typeof checkpoint.executionSnapshotPrepared !== 'boolean' ||
    typeof checkpoint.executionSnapshotVerified !== 'boolean' ||
    JSON.stringify(checkpoint.selection) !== JSON.stringify(expectedSelection) ||
    typeof checkpoint.childAttempted !== 'boolean' ||
    typeof checkpoint.recoveryAttempted !== 'boolean' ||
    typeof checkpoint.namespaceRemovalAttempted !== 'boolean' ||
    typeof checkpoint.namespaceRemoved !== 'boolean' ||
    typeof checkpoint.snapshotRemovalAttempted !== 'boolean' ||
    typeof checkpoint.snapshotRemoved !== 'boolean' ||
    typeof checkpoint.completedEventPublicationAttempted !== 'boolean' ||
    typeof checkpoint.completedEventPublished !== 'boolean' ||
    typeof checkpoint.evidencePublicationAttempted !== 'boolean' ||
    typeof checkpoint.evidencePublished !== 'boolean' ||
    typeof checkpointDigest !== 'string' ||
    checkpointDigest !== CodexDevelopmentVerificationDigest(draft) ||
    (checkpoint.executionSnapshotPrepared && !checkpoint.snapshotPreparationAttempted) ||
    ((checkpoint.child === null) !== (checkpoint.diagnostic === null)) ||
    (checkpoint.childAttempted && !checkpoint.executionSnapshotPrepared) ||
    (checkpoint.executionSnapshotVerified && !checkpoint.executionSnapshotPrepared) ||
    (checkpoint.childAttempted && checkpoint.preflight === null) ||
    (!checkpoint.childAttempted && (checkpoint.postChild !== null || checkpoint.recoveryAttempted ||
      checkpoint.postRecovery !== null ||
      checkpoint.namespaceRemovalAttempted || checkpoint.namespaceRemoved ||
      checkpoint.finalCensus !== null || checkpoint.snapshotRemovalAttempted ||
      checkpoint.snapshotRemoved)) ||
    (checkpoint.postChild !== null && (!childTreeClosed || checkpoint.child === null)) ||
    (checkpoint.recoveryAuthorization !== null && checkpoint.postChild === null) ||
    (checkpoint.recoveryAttempted !== (checkpoint.recoveryAuthorization !== null)) ||
    (checkpoint.recoveryAttempted && checkpoint.child === null) ||
    (checkpoint.recoveryAttempted &&
      (checkpoint.child as { termination?: { treeClosed?: unknown } } | null)?.termination?.treeClosed !== true) ||
    (recoveryComplete && !childTreeClosed) ||
    (checkpoint.postRecovery !== null && checkpoint.recovery === null) ||
    (checkpoint.postRecovery !== null && !childTreeClosed) ||
    (checkpoint.namespaceRemovalAttempted && (checkpoint.postRecovery === null || !childTreeClosed)) ||
    (checkpoint.namespaceRemoved && !checkpoint.namespaceRemovalAttempted) ||
    (checkpoint.finalCensus !== null && (!checkpoint.namespaceRemoved || !childTreeClosed)) ||
    (checkpoint.snapshotRemovalAttempted && (!checkpoint.namespaceRemoved || checkpoint.finalCensus === null)) ||
    (checkpoint.snapshotRemoved && !checkpoint.snapshotRemovalAttempted) ||
    (checkpoint.terminal !== null && (checkpoint.child === null || checkpoint.diagnostic === null ||
      checkpoint.recovery === null)) ||
    (checkpoint.publication !== null && checkpoint.terminal === null) ||
    (checkpoint.completedEventPublicationAttempted && checkpoint.publication === null) ||
    (checkpoint.completedEventPublished && !checkpoint.completedEventPublicationAttempted) ||
    (checkpoint.evidencePublicationAttempted && (!checkpoint.completedEventPublished || checkpoint.publication === null)) ||
    (checkpoint.evidencePublished && !checkpoint.evidencePublicationAttempted)) {
    throw new Error('Work Package gate checkpoint binding is invalid');
  }
  const candidate = checkpoint as unknown as WorkPackageGateCheckpointV4;
  for (const census of [candidate.preflight, candidate.postChild, candidate.postRecovery, candidate.finalCensus]) {
    if (census !== null) assertWorkPackageGateResidueCensusV4(census);
  }
  if (candidate.childAttempted && (candidate.preflight === null || !preflightCensusClean(candidate.preflight))) {
    throw new Error('Work Package gate checkpoint child attempt lacks clean preflight authority');
  }
  if (candidate.child !== null && candidate.diagnostic !== null) {
    assertCheckpointChild(candidate.child);
    assertWorkPackageGateDiagnosticV4(candidate.diagnostic, candidate.child);
    if (!candidate.childAttempted && candidate.child.started) {
      throw new Error('Work Package gate checkpoint child started without a durable attempt');
    }
  }
  if (!candidate.journal || typeof candidate.journal !== 'object' ||
    Array.isArray(candidate.journal) ||
    !exactObjectKeys(candidate.journal, ['lastSequence', 'digest', 'events']) ||
    !Number.isSafeInteger(candidate.journal.lastSequence) || candidate.journal.lastSequence < 0 ||
    (candidate.journal.digest !== null && !/^sha256:[0-9a-f]{64}$/u.test(candidate.journal.digest)) ||
    !Array.isArray(candidate.journal.events) ||
    candidate.journal.events.length !== candidate.journal.lastSequence ||
    ((candidate.journal.lastSequence === 0) !== (candidate.journal.digest === null))) {
    throw new Error('Work Package gate checkpoint journal binding is invalid');
  }
  let previousEventDigest: string | null = null;
  for (let index = 0; index < candidate.journal.events.length; index += 1) {
    const event = candidate.journal.events[index]!;
    assertWorkPackageGateEventV4(event, previousEventDigest);
    if (event.sequence !== index + 1) {
      throw new Error('Work Package gate checkpoint journal sequence is invalid');
    }
    previousEventDigest = event.eventDigest;
  }
  if (previousEventDigest !== candidate.journal.digest) {
    throw new Error('Work Package gate checkpoint journal digest is invalid');
  }
  const expectedJournal = expectedCheckpointJournal(candidate);
  if (candidate.journal.events.length > expectedJournal.length ||
    candidate.journal.events.some((event, index) =>
      JSON.stringify(event) !== JSON.stringify(expectedJournal[index]))) {
    throw new Error('Work Package gate checkpoint journal is not a canonical state prefix');
  }
  const journalKinds = candidate.journal.events.map((event) => event.kind);
  if (candidate.snapshotPreparationAttempted && journalKinds[0] !== 'started') {
    throw new Error('Work Package gate checkpoint side effect has no started event');
  }
  if (candidate.terminal !== null && !journalKinds.includes('residue')) {
    throw new Error('Work Package gate checkpoint terminal has no residue event');
  }
  if (candidate.recoveryAuthorization !== null &&
    (!Number.isSafeInteger(candidate.recoveryAuthorization.count) || candidate.recoveryAuthorization.count < 1 ||
      !/^sha256:[0-9a-f]{64}$/u.test(candidate.recoveryAuthorization.digest))) {
    throw new Error('Work Package gate checkpoint recovery authorization is invalid');
  }
  if (candidate.recoveryAuthorization !== null &&
    (candidate.postChild === null || !candidate.postChild.structure.complete ||
      candidate.recoveryAuthorization.count !== candidate.postChild.structure.recoveryAuthorities.count ||
      candidate.recoveryAuthorization.digest !== candidate.postChild.structure.recoveryAuthorities.digest)) {
    throw new Error('Work Package gate checkpoint recovery authorization is not bound to post-child census');
  }
  if (candidate.recovery !== null) {
    assertCheckpointRecovery(candidate.recovery, candidate.recoveryAuthorization, candidate.postChild);
  }
  if (candidate.postRecovery !== null && candidate.recovery?.complete !== true) {
    throw new Error('Work Package gate checkpoint post-recovery census has no complete recovery');
  }
  if (candidate.namespaceRemovalAttempted &&
    (candidate.preflight === null || candidate.postRecovery === null ||
      candidate.recovery?.complete !== true || !ownedCensusClean(candidate.postRecovery))) {
    throw new Error('Work Package gate checkpoint namespace removal attempt lacks deletion authority');
  }
  if (candidate.snapshotRemovalAttempted &&
    (candidate.preflight === null || candidate.finalCensus === null ||
      !candidate.executionSnapshotVerified || !finalCensusClean(candidate.finalCensus))) {
    throw new Error('Work Package gate checkpoint snapshot removal attempt lacks final authority');
  }
  if (candidate.terminal !== null) {
    if (!candidate.terminal || typeof candidate.terminal !== 'object' || Array.isArray(candidate.terminal) ||
      !exactObjectKeys(candidate.terminal, ['status', 'completedAt', 'durationMs', 'repository']) ||
      !['passed', 'failed', 'timed-out', 'unknown'].includes(candidate.terminal.status) ||
      !Number.isFinite(Date.parse(candidate.terminal.completedAt)) ||
      !Number.isFinite(candidate.terminal.durationMs) || candidate.terminal.durationMs < 0) {
      throw new Error('Work Package gate checkpoint terminal shape is invalid');
    }
    assertCheckpointRepository(candidate.terminal.repository);
    if (candidate.child === null || candidate.diagnostic === null || candidate.recovery === null ||
      candidate.terminal.repository.headSha !== candidate.headSha ||
      candidate.terminal.repository.treeSha !== candidate.treeSha ||
      candidate.terminal.repository.worktreeBeforeDigest !== candidate.worktreeBeforeDigest ||
      candidate.terminal.repository.executionSnapshotDigest !== candidate.executionSnapshotDigest) {
      throw new Error('Work Package gate checkpoint terminal binding is invalid');
    }
    const repository = candidate.terminal.repository;
    const repositoryStable = repository.headShaAfter === repository.headSha &&
      repository.treeShaAfter === repository.treeSha &&
      repository.worktreeAfterDigest === repository.worktreeBeforeDigest &&
      repository.executionSnapshotAfterDigest === repository.executionSnapshotDigest &&
      repository.executionSnapshotRemoved === true;
    const expectedStatus = resultStatusV4({
      child: candidate.child,
      diagnostic: candidate.diagnostic,
      preflight: candidate.preflight,
      postChild: candidate.postChild,
      recovery: candidate.recovery,
      postRecovery: candidate.postRecovery,
      finalCensus: candidate.finalCensus,
      namespaceRemoved: candidate.namespaceRemoved,
      snapshotRemoved: candidate.snapshotRemoved,
      repositoryStable
    });
    if (candidate.terminal.status !== expectedStatus) {
      throw new Error('Work Package gate checkpoint terminal status is not state-derived');
    }
  }
  const publicationFlags = [
    candidate.completedEventPublicationAttempted,
    candidate.completedEventPublished,
    candidate.evidencePublicationAttempted,
    candidate.evidencePublished
  ];
  if ((candidate.publication === null && publicationFlags.some(Boolean)) ||
    (candidate.publication !== null && !candidate.completedEventPublicationAttempted) ||
    (candidate.completedEventPublished && !candidate.completedEventPublicationAttempted) ||
    (candidate.evidencePublicationAttempted && !candidate.completedEventPublished) ||
    (candidate.evidencePublished && !candidate.evidencePublicationAttempted)) {
    throw new Error('Work Package gate checkpoint publication flags are contradictory');
  }
  if (candidate.publication !== null) {
    const completedPreviousDigest = candidate.journal.events.at(-2)?.eventDigest ?? null;
    assertWorkPackageGateEventV4(candidate.publication.completedEvent, completedPreviousDigest);
    assertWorkPackageGateEvidenceV4(candidate.publication.evidence);
    const residue = checkpointResidue(candidate);
    if (candidate.terminal === null || candidate.child === null || candidate.diagnostic === null ||
      candidate.recovery === null ||
      candidate.publication.completedEvent.kind !== 'completed' ||
      candidate.journal.events.at(-1)?.eventDigest !== candidate.publication.completedEvent.eventDigest ||
      candidate.publication.completedEvent.eventDigest !== candidate.publication.evidence.journal.digest ||
      candidate.publication.completedEvent.sequence !== candidate.publication.evidence.journal.lastSequence ||
      candidate.publication.evidence.runId !== candidate.runId ||
      candidate.publication.evidence.status !== candidate.terminal.status ||
      candidate.publication.evidence.startedAt !== candidate.startedAt ||
      candidate.publication.evidence.completedAt !== candidate.terminal.completedAt ||
      candidate.publication.evidence.durationMs !== candidate.terminal.durationMs ||
      JSON.stringify(candidate.publication.evidence.selection) !== JSON.stringify(candidate.selection) ||
      JSON.stringify(candidate.publication.evidence.authority) !== JSON.stringify(candidate.authority) ||
      JSON.stringify(candidate.publication.evidence.repository) !== JSON.stringify(candidate.terminal.repository) ||
      JSON.stringify(candidate.publication.evidence.child) !== JSON.stringify(candidate.child) ||
      JSON.stringify(candidate.publication.evidence.diagnostic) !== JSON.stringify(candidate.diagnostic) ||
      JSON.stringify(candidate.publication.evidence.recovery) !== JSON.stringify(candidate.recovery) ||
      JSON.stringify(candidate.publication.evidence.residue) !== JSON.stringify(residue) ||
      candidate.publication.evidence.timeouts.watchdogMs !== 1_800_000 ||
      candidate.publication.evidence.timeouts.cleanupMs !== 120_000 ||
      candidate.publication.evidence.evidenceDigest !==
        CodexDevelopmentVerificationDigest((({ evidenceDigest: _, ...rest }) => rest)(candidate.publication.evidence))) {
      throw new Error('Work Package gate checkpoint publication binding is invalid');
    }
  }
}

async function assertOwnedRunDirectoryState(
  runDir: string,
  checkpoint: WorkPackageGateCheckpointV4,
  pathExists: (filePath: string) => Promise<boolean>,
  readBytes: (filePath: string) => Promise<Uint8Array>
): Promise<void> {
  const runIdentity = await physicalPathIdentity(runDir, true);
  if (runIdentity?.kind !== 'directory') {
    throw new Error('Work Package gate run directory is not a physical directory');
  }
  const allowed = new Set(['checkpoint.json', 'events.jsonl', 'state.json', 'evidence.json']);
  const present = new Set<string>();
  for (const entry of await readdir(runDir, { withFileTypes: true })) {
    if (!allowed.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Work Package gate run directory contains foreign content');
    }
    const identity = await physicalPathIdentity(path.join(runDir, entry.name), true);
    if (identity?.kind !== 'file') {
      throw new Error('Work Package gate run directory artifact is not an owned regular file');
    }
    present.add(entry.name);
  }
  if (!present.has('checkpoint.json')) {
    throw new Error('Work Package gate run directory is not owned by a checkpoint');
  }

  const eventsPath = path.join(runDir, 'events.jsonl');
  if (present.has('events.jsonl')) {
    const existing = Buffer.from(await readBytes(eventsPath)).toString('utf8');
    const validPrefixes = new Set<string>(['']);
    for (let index = 1; index <= checkpoint.journal.events.length; index += 1) {
      validPrefixes.add(serializedJournal(checkpoint.journal.events.slice(0, index)));
    }
    if (!validPrefixes.has(existing) ||
      (checkpoint.completedEventPublished && existing !== serializedJournal(checkpoint.journal.events))) {
      throw new Error('Work Package gate run directory journal state is invalid');
    }
  } else if (checkpoint.completedEventPublished) {
    throw new Error('Work Package gate published terminal event is missing');
  }

  const evidencePath = path.join(runDir, 'evidence.json');
  if (present.has('evidence.json')) {
    if (!checkpoint.evidencePublicationAttempted || checkpoint.publication === null) {
      throw new Error('Work Package gate evidence exists before its durable publication attempt');
    }
    const expected = Buffer.from(JSON.stringify(checkpoint.publication.evidence), 'utf8');
    if (!Buffer.from(await readBytes(evidencePath)).equals(expected)) {
      throw new Error('Work Package gate run directory evidence bytes are invalid');
    }
  } else if (checkpoint.evidencePublished) {
    throw new Error('Work Package gate published evidence is missing');
  }

  if (present.has('state.json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(await readBytes(path.join(runDir, 'state.json'))).toString('utf8')) as unknown;
    } catch {
      throw new Error('Work Package gate run directory state JSON is invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !exactObjectKeys(parsed, [
      'schema', 'runId', 'status', 'phase', 'elapsedMs', 'sequence', 'journalDigest',
      'stdoutBytes', 'stderrBytes'
    ])) throw new Error('Work Package gate run directory state shape is invalid');
    const state = parsed as Record<string, unknown>;
    if (state.schema !== 'codex-work-package-gate-state-v4' || state.runId !== checkpoint.runId ||
      !Number.isSafeInteger(state.sequence) || Number(state.sequence) < 1 ||
      Number(state.sequence) > checkpoint.journal.lastSequence || !Number.isFinite(state.elapsedMs) ||
      Number(state.elapsedMs) < 0 || !Number.isSafeInteger(state.stdoutBytes) || Number(state.stdoutBytes) < 0 ||
      !Number.isSafeInteger(state.stderrBytes) || Number(state.stderrBytes) < 0) {
      throw new Error('Work Package gate run directory state value is invalid');
    }
    const event = checkpoint.journal.events[Number(state.sequence) - 1]!;
    const running = state.status === 'running' && state.phase === event.phase &&
      state.elapsedMs === event.elapsedMs;
    const terminal = checkpoint.evidencePublished && checkpoint.terminal !== null &&
      Number(state.sequence) === checkpoint.journal.lastSequence && event.kind === 'completed' &&
      state.status === checkpoint.terminal.status && state.phase === checkpoint.terminal.status &&
      state.elapsedMs === checkpoint.terminal.durationMs;
    if ((!running && !terminal) || state.journalDigest !== event.eventDigest ||
      state.stdoutBytes !== event.stdoutBytes || state.stderrBytes !== event.stderrBytes) {
      throw new Error('Work Package gate run directory state is not journal-bound');
    }
  }

  for (const fileName of present) {
    if (!await pathExists(path.join(runDir, fileName))) {
      throw new Error('Work Package gate run directory changed during inventory');
    }
  }
}

async function assertSafeCheckpointPublicationDirectory(directory: string): Promise<void> {
  if ((await physicalPathIdentity(directory, true))?.kind !== 'directory') {
    throw new Error('Work Package gate checkpoint publication directory is not owned');
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() ||
      entry.name !== 'checkpoint.json') {
      throw new Error('Work Package gate checkpoint publication directory contains foreign content');
    }
    if ((await physicalPathIdentity(path.join(directory, entry.name), true))?.kind !== 'file') {
      throw new Error('Work Package gate checkpoint publication file is not owned');
    }
  }
}

function assertInitialCheckpointPublication(
  candidate: WorkPackageGateCheckpointV4,
  fresh: WorkPackageGateCheckpointV4
): WorkPackageGateCheckpointV4 {
  const { checkpointDigest: _freshDigest, ...freshDraft } = fresh;
  const expected = finalizeCheckpoint({ ...freshDraft, startedAt: candidate.startedAt });
  if (JSON.stringify(candidate) !== JSON.stringify(expected)) {
    throw new Error('Work Package gate pending checkpoint is not an exact initial publication');
  }
  return candidate;
}

async function publishInitialCheckpoint(
  repoRoot: string,
  namespace: string,
  runDir: string,
  checkpoint: WorkPackageGateCheckpointV4,
  runId: string,
  selection: WorkPackageGateSelectionV1,
  authority: WorkPackageGateExecutionAuthorityV4
): Promise<WorkPackageGateCheckpointV4> {
  const publicationParent = path.join(repoRoot, '.tmp', '.gate-checkpoint-publications');
  const publicationDirectory = path.join(publicationParent, `${namespace}.pending`);
  const publicationCheckpoint = path.join(publicationDirectory, 'checkpoint.json');
  let expectedPublication = checkpoint;
  await mkdir(path.dirname(runDir), { recursive: true });
  await mkdir(publicationParent, { recursive: true });
  if (await defaultPathExists(publicationDirectory)) {
    await assertSafeCheckpointPublicationDirectory(publicationDirectory);
    if (await defaultPathExists(publicationCheckpoint)) {
      const parsed = JSON.parse(await readFile(publicationCheckpoint, 'utf8')) as unknown;
      assertCheckpoint(parsed, runId, selection, authority);
      expectedPublication = assertInitialCheckpointPublication(parsed, checkpoint);
    } else {
      await rm(publicationDirectory, { recursive: true, force: false });
    }
  }
  if (!await defaultPathExists(publicationDirectory)) {
    await mkdir(publicationDirectory, { recursive: false });
    await writeWorkPackageGateJsonAtomic(
      publicationCheckpoint,
      checkpoint,
      (readback) => assertCheckpoint(readback, runId, selection, authority)
    );
  }
  await rename(publicationDirectory, runDir);
  await syncWorkPackageGateDirectory(path.dirname(runDir));
  await syncWorkPackageGateDirectory(publicationParent);
  const readback = JSON.parse(await readFile(path.join(runDir, 'checkpoint.json'), 'utf8')) as unknown;
  assertCheckpoint(readback, runId, selection, authority);
  if (JSON.stringify(readback) !== JSON.stringify(expectedPublication)) {
    throw new Error('Work Package gate initial checkpoint publication changed during adoption');
  }
  return readback;
}

function namespaceForRunDirectory(runDir: string): string {
  const canonical = process.platform === 'win32'
    ? path.resolve(runDir).toLocaleLowerCase('en-US')
    : path.resolve(runDir);
  const suffix = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `gate-${suffix}-owned`;
}

function namespaceMutexName(namespace: string): string {
  return `Global\\sec-work-package-${namespace}`;
}

/** Test-only cross-session Windows mutex name for the single-supervisor contract. */
export function workPackageGateNamespaceMutexNameForTests(runDir: string): string {
  return namespaceMutexName(namespaceForRunDirectory(runDir));
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

function processLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return 'dead';
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return 'alive';
    return 'unknown';
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
      windowsWide(namespaceMutexName(namespace))
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
      let owner: { readonly runId?: unknown; readonly pid?: unknown; readonly nonce?: unknown } | undefined;
      try {
        owner = JSON.parse(await readFile(leasePath, 'utf8')) as typeof owner;
      } catch {
        throw new Error('Work Package gate namespace lease publication is incomplete');
      }
      if (!owner || !exactObjectKeys(owner, ['runId', 'pid', 'nonce']) ||
        !nonEmptyString(owner.runId) || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 ||
        !nonEmptyString(owner.nonce)) {
        throw new Error('Work Package gate namespace lease owner is invalid');
      }
      const liveness = processLiveness(Number(owner.pid));
      if (liveness === 'alive') {
        throw new Error('Work Package gate namespace already has a live supervisor');
      }
      if (liveness === 'unknown') {
        throw new Error('Work Package gate namespace supervisor liveness is unknown');
      }
      throw new Error('Work Package gate stale namespace lease requires explicit recovery');
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

function diagnosticIsClean(diagnostic: WorkPackageGateDiagnosticV4): boolean {
  return diagnostic.status === 'non-actionable' && diagnostic.selectionIndexes.length === 0 &&
    diagnostic.failureMarkerCount === 0 && diagnostic.unmappedMarkerCount === 0 &&
    diagnostic.malformedMarkerCount === 0 && diagnostic.oversizedLineCount === 0 &&
    !diagnostic.utf8Invalid && !diagnostic.ansiInvalid && !diagnostic.observerTruncated &&
    !diagnostic.parserFailure;
}

function resultStatusV4(input: {
  readonly child: WorkPackageGateChildEvidenceV1;
  readonly diagnostic: WorkPackageGateDiagnosticV4;
  readonly preflight: WorkPackageGateResidueCensusV4 | null;
  readonly postChild: WorkPackageGateResidueCensusV4 | null;
  readonly recovery: WorkPackageGateRecoveryEvidenceV4;
  readonly postRecovery: WorkPackageGateResidueCensusV4 | null;
  readonly finalCensus: WorkPackageGateResidueCensusV4 | null;
  readonly namespaceRemoved: boolean;
  readonly snapshotRemoved: boolean;
  readonly repositoryStable: boolean;
}): WorkPackageGateStatus {
  const cleanCompletion = input.child.started &&
    input.child.termination.childCloseObserved && input.child.termination.streamsDrained &&
    input.child.termination.treeClosed && !input.child.stdout.observerTruncated &&
    !input.child.stderr.observerTruncated && input.preflight !== null &&
    input.postChild !== null && input.postChild.structure.complete &&
    input.recovery.complete && input.postRecovery !== null &&
    ownedCensusClean(input.postRecovery) &&
    input.finalCensus !== null && input.namespaceRemoved &&
    input.snapshotRemoved && input.repositoryStable && finalCensusClean(input.finalCensus);
  if (!cleanCompletion) return 'unknown';
  if (input.child.status === 'exited' && input.child.trigger === null &&
    input.child.termination.requested === false) {
    if (input.child.exitCode === 0 && diagnosticIsClean(input.diagnostic)) return 'passed';
    if (input.child.exitCode !== null && input.child.exitCode !== 0 &&
      input.diagnostic.status === 'actionable') return 'failed';
    return 'unknown';
  }
  if (input.child.status === 'timed-out' && input.child.trigger === 'timed-out' &&
    input.child.termination.requested && input.child.exitCode === null) return 'timed-out';
  return 'unknown';
}

function exitCodeForEvidence(evidence: WorkPackageGateEvidenceV4): number {
  if (evidence.status === 'passed') return 0;
  if (evidence.status === 'failed') return 1;
  if (evidence.status === 'timed-out') return 124;
  return evidence.child.termination.treeClosed ? 126 : 125;
}

function serializedJournal(events: readonly WorkPackageGateEventV4[]): string {
  return events.length === 0
    ? ''
    : `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

async function ensureJournalPublication(
  filePath: string,
  events: readonly WorkPackageGateEventV4[],
  pathExists: (filePath: string) => Promise<boolean>,
  readBytes: (filePath: string) => Promise<Uint8Array>
): Promise<void> {
  const expected = serializedJournal(events);
  const exists = await pathExists(filePath);
  if (expected.length === 0) {
    if (exists) throw new Error('Work Package gate journal exists before its publication is bound');
    return;
  }
  let existing = '';
  if (exists) {
    existing = Buffer.from(await readBytes(filePath)).toString('utf8');
    const validPrefixes = new Set<string>(['']);
    for (let index = 1; index <= events.length; index += 1) {
      validPrefixes.add(serializedJournal(events.slice(0, index)));
    }
    if (!validPrefixes.has(existing)) {
      throw new Error('Work Package gate journal does not match the checkpoint-bound prefix');
    }
  }
  if (existing === expected) return;
  const handle = await open(filePath, exists ? 'a' : 'wx');
  try {
    await handle.writeFile(expected.slice(existing.length), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (Buffer.from(await readBytes(filePath)).toString('utf8') !== expected) {
    throw new Error('Work Package gate journal publication readback mismatch');
  }
}

async function publishExactJson(
  filePath: string,
  value: unknown,
  pathExists: (filePath: string) => Promise<boolean>,
  readBytes: (filePath: string) => Promise<Uint8Array>
): Promise<void> {
  const expected = Buffer.from(JSON.stringify(value), 'utf8');
  if (await pathExists(filePath)) {
    if (!Buffer.from(await readBytes(filePath)).equals(expected)) {
      throw new Error('Work Package gate publication bytes do not match the checkpoint binding');
    }
    return;
  }
  const handle = await open(filePath, 'wx');
  try {
    await handle.writeFile(expected);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!Buffer.from(await readBytes(filePath)).equals(expected)) {
    throw new Error('Work Package gate publication readback mismatch');
  }
}

export async function runWorkPackageGate(
  options: WorkPackageGateOptions,
  overrides: Partial<WorkPackageGateDependencies> = {}
): Promise<{ readonly evidence: WorkPackageGateEvidenceV4; readonly exitCode: number }> {
  if (options.watchdogMs !== 1_800_000 || options.cleanupMs !== 120_000 || options.selectionIndex !== 0) {
    throw new Error('Work Package gate invocation does not match the frozen timeout/selection contract');
  }
  const manifestPath = canonicalRelativePath(options.manifestPath, 'docs/work-packages/');
  const selectionManifestPath = canonicalRelativePath(
    options.selectionManifestPath,
    'docs/work-packages/'
  );
  const runDirRelative = canonicalRelativePath(options.runDir, '.tmp/');
  if (manifestPath !== 'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md' ||
    selectionManifestPath !== 'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md' ||
    runDirRelative !== WORK_PACKAGE_GATE_RUN_DIRECTORY_V4) {
    throw new Error('Work Package gate invocation does not match the exact V4 authority');
  }
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
  await assertProtectedLedger(repoRoot, dependencies.readBytes);
  const protectedPaths = normalizeProtectedPathAuthority(
    await dependencies.protectedPathAuthority(repoRoot)
  );
  const protectedPathsShape = protectedPathAuthorityShape(protectedPaths);
  const protectedPathsSnapshotDigest = await protectedPathSnapshotDigest(protectedPaths);
  const authority = await assertV4PathAuthority(
    repoRoot,
    runDir,
    snapshotRoot,
    namespaceRoot,
    namespace,
    protectedPaths
  );
  const revalidateExternalAuthority = async (): Promise<void> => {
    await assertProtectedLedger(repoRoot, dependencies.readBytes);
    const pendingPublicationDirectory = path.join(
      repoRoot,
      '.tmp',
      '.gate-checkpoint-publications',
      `${namespace}.pending`
    );
    if (await dependencies.pathExists(pendingPublicationDirectory)) {
      throw new Error('Work Package gate pending checkpoint publication reappeared after initial adoption');
    }
    const currentProtectedPaths = normalizeProtectedPathAuthority(
      await dependencies.protectedPathAuthority(repoRoot)
    );
    if (protectedPathAuthorityShape(currentProtectedPaths) !== protectedPathsShape ||
      await protectedPathSnapshotDigest(currentProtectedPaths) !== protectedPathsSnapshotDigest) {
      throw new Error('Work Package gate protected path authority changed');
    }
    const current = await assertV4PathAuthority(
      repoRoot,
      runDir,
      snapshotRoot,
      namespaceRoot,
      namespace,
      currentProtectedPaths
    );
    if (JSON.stringify(current) !== JSON.stringify(authority)) {
      throw new Error('Work Package gate execution authority changed');
    }
  };
  const executionManifestSource = await dependencies.readText(path.join(repoRoot, ...manifestPath.split('/')));
  const selectionManifestSource = await dependencies.readText(
    path.join(repoRoot, ...selectionManifestPath.split('/'))
  );
  const selection = parseFrozenWorkPackageGateSelectionV4({
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
  let checkpointBeforeLease: WorkPackageGateCheckpointV4 | null = null;
  const runDirectoryExistedBeforeLease = await dependencies.pathExists(runDir);
  if (runDirectoryExistedBeforeLease) {
    if (!await dependencies.pathExists(checkpointPath)) {
      throw new Error('Work Package gate run directory is not owned by a checkpoint');
    }
    const parsed = JSON.parse(await dependencies.readText(checkpointPath)) as unknown;
    assertCheckpoint(parsed, runId, selection, authority);
    await assertOwnedRunDirectoryState(runDir, parsed, dependencies.pathExists, dependencies.readBytes);
    checkpointBeforeLease = parsed;
  }
  const releaseNamespaceLease = await acquireNamespaceLease(repoRoot, namespace, runId);
  try {
    let checkpoint: WorkPackageGateCheckpointV4;
    if (checkpointBeforeLease !== null) {
      if (!await dependencies.pathExists(checkpointPath)) {
        throw new Error('Work Package gate run directory is not owned by a checkpoint');
      }
      const parsedCheckpoint = JSON.parse(await dependencies.readText(checkpointPath)) as unknown;
      assertCheckpoint(parsedCheckpoint, runId, selection, authority);
      if (parsedCheckpoint.checkpointDigest !== checkpointBeforeLease.checkpointDigest) {
        throw new Error('Work Package gate checkpoint changed while acquiring its supervisor lease');
      }
      await assertOwnedRunDirectoryState(
        runDir,
        parsedCheckpoint,
        dependencies.pathExists,
        dependencies.readBytes
      );
      checkpoint = parsedCheckpoint;
    } else {
      if (await dependencies.pathExists(runDir)) {
        throw new Error('Work Package gate run directory appeared before initial publication');
      }
      const headSha = dependencies.gitRevision(repoRoot, 'HEAD');
      const treeSha = dependencies.gitRevision(repoRoot, 'HEAD^{tree}');
      const worktreeBeforeDigest = await dependencies.worktreeDigest(repoRoot);
      checkpoint = finalizeCheckpoint({
        schema: WORK_PACKAGE_GATE_CHECKPOINT_SCHEMA_V4,
        runId,
        startedAt: dependencies.wallClock().toISOString(),
        authority,
        headSha,
        treeSha,
        worktreeBeforeDigest,
        executionSnapshotDigest: worktreeBeforeDigest,
        snapshotPreparationAttempted: false,
        executionSnapshotPrepared: false,
        executionSnapshotVerified: false,
        selection,
        preflight: null,
        childAttempted: false,
        child: null,
        diagnostic: null,
        postChild: null,
        recoveryAuthorization: null,
        recoveryAttempted: false,
        recovery: null,
        postRecovery: null,
        namespaceRemovalAttempted: false,
        namespaceRemoved: false,
        finalCensus: null,
        snapshotRemovalAttempted: false,
        snapshotRemoved: false,
        terminal: null,
        journal: { lastSequence: 0, digest: null, events: Object.freeze([]) },
        publication: null,
        completedEventPublicationAttempted: false,
        completedEventPublished: false,
        evidencePublicationAttempted: false,
        evidencePublished: false
      });
      checkpoint = await publishInitialCheckpoint(
        repoRoot,
        namespace,
        runDir,
        checkpoint,
        runId,
        selection,
        authority
      );
    }

    const persistCheckpoint = async (next: WorkPackageGateCheckpointV4): Promise<void> => {
      await writeWorkPackageGateJsonAtomic(
        checkpointPath,
        next,
        (readback) => assertCheckpoint(readback, runId, selection, authority)
      );
    };
    const replaceCheckpoint = async (
      patch: Partial<WorkPackageGateCheckpointDraftV4>
    ): Promise<void> => {
      const next = updateCheckpoint(checkpoint, patch);
      await persistCheckpoint(next);
      checkpoint = next;
    };
    const revalidateDurableCheckpoint = async (): Promise<void> => {
      const parsed = JSON.parse(await dependencies.readText(checkpointPath)) as unknown;
      assertCheckpoint(parsed, runId, selection, authority);
      if (parsed.checkpointDigest !== checkpoint.checkpointDigest) {
        throw new Error('Work Package gate durable checkpoint changed before side effect');
      }
      await assertOwnedRunDirectoryState(runDir, parsed, dependencies.pathExists, dependencies.readBytes);
    };
    const writeState = async (
      status: 'running' | WorkPackageGateStatus,
      phase: string,
      elapsedMs: number
    ): Promise<void> => {
      const tail = checkpoint.journal.events.at(-1);
      const state: WorkPackageGateStateV4 = {
        schema: 'codex-work-package-gate-state-v4',
        runId,
        status,
        phase,
        elapsedMs,
        sequence: checkpoint.journal.lastSequence,
        journalDigest: checkpoint.journal.digest,
        stdoutBytes: tail?.stdoutBytes ?? 0,
        stderrBytes: tail?.stderrBytes ?? 0
      };
      await writeWorkPackageGateJsonAtomic(statePath, state).catch(() => undefined);
    };
    const record = async (
      kind: Exclude<WorkPackageGateEventKind, 'heartbeat'>,
      phase: string,
      subject: unknown,
      elapsedMs: number,
      childForBytes: WorkPackageGateChildEvidenceV1 | null = checkpoint.child
    ): Promise<void> => {
      if (checkpoint.journal.events.some((event) => event.kind === kind)) return;
      const event = finalizeWorkPackageGateEventV4({
        sequence: checkpoint.journal.lastSequence + 1,
        kind,
        elapsedMs,
        phase,
        stdoutBytes: childForBytes?.stdout.bytes ?? 0,
        stderrBytes: childForBytes?.stderr.bytes ?? 0,
        subject,
        previousDigest: checkpoint.journal.digest
      });
      const events = Object.freeze([...checkpoint.journal.events, event]);
      await replaceCheckpoint({
        journal: Object.freeze({
          lastSequence: events.length,
          digest: event.eventDigest,
          events
        })
      });
      await ensureJournalPublication(eventsPath, events, dependencies.pathExists, dependencies.readBytes);
      await writeState('running', phase, elapsedMs);
    };

    const finishBoundPublication = async (): Promise<{
      readonly evidence: WorkPackageGateEvidenceV4;
      readonly exitCode: number;
    } | null> => {
      if (checkpoint.publication === null) return null;
      if (!checkpoint.completedEventPublicationAttempted) {
        throw new Error('Work Package gate terminal publication has no durable event attempt');
      }
      await revalidateDurableCheckpoint();
      await revalidateExternalAuthority();
      await ensureJournalPublication(
        eventsPath,
        checkpoint.journal.events,
        dependencies.pathExists,
        dependencies.readBytes
      );
      if (!checkpoint.completedEventPublished) {
        await replaceCheckpoint({ completedEventPublished: true });
      }
      if (!checkpoint.evidencePublicationAttempted) {
        if (await dependencies.pathExists(evidencePath)) {
          throw new Error('Work Package gate evidence exists before its durable publication attempt');
        }
        await replaceCheckpoint({ evidencePublicationAttempted: true });
        await dependencies.afterCheckpoint('evidence-publication-attempted');
        await revalidateDurableCheckpoint();
        await revalidateExternalAuthority();
      }
      await publishExactJson(
        evidencePath,
        checkpoint.publication.evidence,
        dependencies.pathExists,
        dependencies.readBytes
      );
      if (!checkpoint.evidencePublished) await replaceCheckpoint({ evidencePublished: true });
      const journalSource = await dependencies.readText(eventsPath);
      const bundle = { evidence: checkpoint.publication.evidence, journalSource };
      assertWorkPackageGateEvidenceBundleV4(bundle);
      await writeState(
        bundle.evidence.status,
        bundle.evidence.status,
        bundle.evidence.durationMs
      );
      return { evidence: bundle.evidence, exitCode: exitCodeForEvidence(bundle.evidence) };
    };

    const replayed = await finishBoundPublication();
    if (replayed) return replayed;
    await ensureJournalPublication(
      eventsPath,
      checkpoint.journal.events,
      dependencies.pathExists,
      dependencies.readBytes
    );
    if (await dependencies.pathExists(evidencePath)) {
      throw new Error('Work Package gate evidence exists without a checkpoint-bound publication');
    }

    if (!checkpoint.journal.events.some((event) => event.kind === 'started')) {
      await record('started', 'preflight', {
        runId,
        selection: checkpoint.selection,
        authority: checkpoint.authority,
        repositoryBefore: {
          headSha: checkpoint.headSha,
          treeSha: checkpoint.treeSha,
          worktreeBeforeDigest: checkpoint.worktreeBeforeDigest,
          executionSnapshotDigest: checkpoint.executionSnapshotDigest
        },
        timeouts: { watchdogMs: options.watchdogMs, cleanupMs: options.cleanupMs }
      }, 0, null);
    }

    if (!checkpoint.snapshotPreparationAttempted) {
      await replaceCheckpoint({ snapshotPreparationAttempted: true });
      await dependencies.afterCheckpoint('snapshot-preparation-attempted');
      await revalidateDurableCheckpoint();
      let prepared = false;
      try {
        await revalidateExternalAuthority();
        const sourceStable = dependencies.gitRevision(repoRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(repoRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(repoRoot) === checkpoint.worktreeBeforeDigest;
        if (!sourceStable) throw new Error('Work Package gate snapshot source changed after durable attempt');
        const snapshotDigest = await dependencies.prepareExecutionSnapshot(
          repoRoot,
          snapshotRoot,
          checkpoint.headSha,
          checkpoint.treeSha,
          checkpoint.executionSnapshotDigest
        );
        prepared = snapshotDigest === checkpoint.executionSnapshotDigest;
      } catch {
        prepared = false;
      }
      await replaceCheckpoint({
        executionSnapshotPrepared: prepared,
        executionSnapshotVerified: prepared
      });
    }

    if (checkpoint.executionSnapshotPrepared && checkpoint.preflight === null) {
      try {
        const preflight = await dependencies.census(namespaceRoot, undefined, true);
        await replaceCheckpoint({ preflight });
      } catch {
        // A missing typed preflight is terminally unknown and never authorizes the child.
      }
    }

    let launchIdentityStable = false;
    if (!checkpoint.childAttempted && checkpoint.child === null &&
      checkpoint.executionSnapshotPrepared && checkpoint.preflight !== null &&
      preflightCensusClean(checkpoint.preflight)) {
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

    if (!checkpoint.childAttempted && checkpoint.child === null && launchIdentityStable) {
      await replaceCheckpoint({ childAttempted: true });
      await dependencies.afterCheckpoint('child-attempted');
      await revalidateDurableCheckpoint();
      const collector = new WorkPackageGateFailureIndexCollector(selection.testFiles);
      let child: WorkPackageGateChildEvidenceV1;
      try {
        await revalidateExternalAuthority();
        const currentPreflight = await dependencies.sideEffectCensus(
          'child',
          namespaceRoot,
          undefined,
          true
        );
        const launchStillStable = checkpoint.preflight !== null && preflightCensusClean(checkpoint.preflight) &&
          JSON.stringify(currentPreflight) === JSON.stringify(checkpoint.preflight) &&
          preflightCensusClean(currentPreflight) &&
          dependencies.gitRevision(repoRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(repoRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(repoRoot) === checkpoint.worktreeBeforeDigest &&
          dependencies.gitRevision(snapshotRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(snapshotRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(snapshotRoot) === checkpoint.executionSnapshotDigest;
        if (!launchStillStable) throw new Error('Work Package gate launch identity changed after durable attempt');
        const outcome = await dependencies.runChild(process.execPath, selection.argv.slice(1), {
          cwd: snapshotRoot,
          env: { ...process.env, SEC_TEST_WORKSPACE_NAMESPACE: namespace },
          envMode: 'replace',
          maxObservedOutputBytes: DIAGNOSTIC_OBSERVER_LIMIT_BYTES,
          onOutput: (stream, chunk) => collector.observe(stream, chunk),
          terminationDeadlineMs: 30_000,
          terminationGraceMs: 5_000,
          timeoutMs: options.watchdogMs,
          windowsHide: true
        });
        child = childEvidence(outcome);
      } catch {
        child = unknownChildEvidence(true);
      }
      const diagnostic = collector.finish(child);
      await replaceCheckpoint({ child, diagnostic });
    } else if (checkpoint.child === null) {
      const child = unknownChildEvidence(checkpoint.childAttempted);
      await replaceCheckpoint({ child, diagnostic: emptyDiagnostic(child) });
    }

    const child = checkpoint.child!;
    const diagnostic = checkpoint.diagnostic!;
    if (child.trigger === 'timed-out') {
      await record('deadline', 'watchdog', {
        status: child.status,
        trigger: child.trigger,
        watchdogMs: options.watchdogMs
      }, child.durationMs, child);
    }
    if (child.termination.requested) {
      await record('termination', 'tree-close', child.termination, child.durationMs, child);
    }

    const cleanupDeadlineAt = dependencies.monotonicNowMs() + options.cleanupMs;
    let protectedLedgerStable = true;
    try {
      await assertProtectedLedger(repoRoot, dependencies.readBytes);
    } catch {
      protectedLedgerStable = false;
    }
    const canInspectResidue = checkpoint.childAttempted && child.termination.treeClosed &&
      protectedLedgerStable;
    if (canInspectResidue && checkpoint.postChild === null) {
      try {
        const postChild = await dependencies.census(namespaceRoot, cleanupDeadlineAt, true);
        await replaceCheckpoint({ postChild });
      } catch {
        // Typed census failure is represented by a null stage and fails closed.
      }
    }

    if (checkpoint.recoveryAttempted && checkpoint.recovery === null) {
      await replaceCheckpoint({
        recovery: Object.freeze({
          attempted: true,
          complete: false,
          reason: 'failed',
          authorization: checkpoint.recoveryAuthorization
        })
      });
    } else if (checkpoint.recovery === null && canInspectResidue && checkpoint.postChild !== null) {
      if (!checkpoint.postChild.structure.complete) {
        await replaceCheckpoint({
          recovery: Object.freeze({
            attempted: false,
            complete: false,
            reason: 'authority-preserved',
            authorization: null
          })
        });
      } else if (!hasRecoveryAuthority(checkpoint.postChild)) {
        await replaceCheckpoint({
          recovery: Object.freeze({
            attempted: false,
            complete: true,
            reason: 'not-needed',
            authorization: null
          })
        });
      } else {
        const authorization = checkpoint.postChild.structure.recoveryAuthorities;
        await replaceCheckpoint({
          recoveryAuthorization: authorization,
          recoveryAttempted: true
        });
        await dependencies.afterCheckpoint('recovery-attempted');
        await revalidateDurableCheckpoint();
        let recovered: 'not-needed' | 'completed' | 'failed' = 'failed';
        try {
          await revalidateExternalAuthority();
          const currentPostChild = await dependencies.sideEffectCensus(
            'recovery',
            namespaceRoot,
            cleanupDeadlineAt,
            true
          );
          if (checkpoint.postChild === null ||
            JSON.stringify(currentPostChild.structure) !== JSON.stringify(checkpoint.postChild.structure) ||
            !currentPostChild.structure.complete || !hasRecoveryAuthority(currentPostChild) ||
            currentPostChild.structure.recoveryAuthorities.count !== authorization.count ||
            currentPostChild.structure.recoveryAuthorities.digest !== authorization.digest) {
            throw new Error('Work Package gate recovery census changed after durable attempt');
          }
          recovered = await dependencies.recoverOwnedNamespace(
            namespaceRoot,
            cleanupDeadlineAt,
            authorization
          );
        } catch {
          recovered = 'failed';
        }
        await replaceCheckpoint({
          recovery: Object.freeze({
            attempted: true,
            complete: recovered === 'completed',
            reason: recovered === 'completed' ? 'completed' : 'failed',
            authorization
          })
        });
      }
    } else if (checkpoint.recovery === null) {
      await replaceCheckpoint({
        recovery: Object.freeze({
          attempted: false,
          complete: false,
          reason: 'authority-preserved',
          authorization: null
        })
      });
    }

    if (canInspectResidue && checkpoint.recovery?.complete && checkpoint.postRecovery === null) {
      try {
        const postRecovery = await dependencies.census(namespaceRoot, cleanupDeadlineAt, true);
        await replaceCheckpoint({ postRecovery });
      } catch {
        // Missing post-recovery proof blocks deletion.
      }
    }

    const namespaceCanBeRemoved = checkpoint.recovery?.complete === true &&
      checkpoint.preflight !== null && checkpoint.postRecovery !== null &&
      ownedCensusClean(checkpoint.postRecovery);
    if (namespaceCanBeRemoved && !checkpoint.namespaceRemovalAttempted) {
      await replaceCheckpoint({ namespaceRemovalAttempted: true });
      await dependencies.afterCheckpoint('namespace-removal-attempted');
      await revalidateDurableCheckpoint();
      let namespaceRemoved = false;
      try {
        await revalidateExternalAuthority();
        const currentPostRecovery = await dependencies.sideEffectCensus(
          'namespace-removal',
          namespaceRoot,
          cleanupDeadlineAt,
          true
        );
        if (checkpoint.postRecovery === null || checkpoint.preflight === null ||
          JSON.stringify(currentPostRecovery) !== JSON.stringify(checkpoint.postRecovery) ||
          !ownedCensusClean(currentPostRecovery)) {
          throw new Error('Work Package gate deletion census changed after durable attempt');
        }
        namespaceRemoved = await dependencies.removeNamespace(namespaceRoot, cleanupDeadlineAt);
      } catch {
        namespaceRemoved = false;
      }
      await replaceCheckpoint({ namespaceRemoved });
    }
    if (checkpoint.namespaceRemoved && checkpoint.finalCensus === null) {
      try {
        const finalCensus = await dependencies.census(namespaceRoot, cleanupDeadlineAt, true);
        await replaceCheckpoint({ finalCensus });
      } catch {
        // A successful remove without final absence proof remains unknown.
      }
    }

    let repositoryStableBeforeSnapshotRemoval = false;
    let snapshotDigestBeforeRemoval: string | null = null;
    if (checkpoint.namespaceRemoved && checkpoint.finalCensus !== null &&
      finalCensusClean(checkpoint.finalCensus) && checkpoint.preflight !== null) {
      try {
        repositoryStableBeforeSnapshotRemoval =
          dependencies.gitRevision(repoRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(repoRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(repoRoot) === checkpoint.worktreeBeforeDigest;
        snapshotDigestBeforeRemoval = await dependencies.worktreeDigest(snapshotRoot);
        if (snapshotDigestBeforeRemoval === checkpoint.executionSnapshotDigest &&
          !checkpoint.executionSnapshotVerified) {
          await replaceCheckpoint({ executionSnapshotVerified: true });
        }
      } catch {
        repositoryStableBeforeSnapshotRemoval = false;
        snapshotDigestBeforeRemoval = null;
      }
    }
    if (repositoryStableBeforeSnapshotRemoval &&
      snapshotDigestBeforeRemoval === checkpoint.executionSnapshotDigest &&
      !checkpoint.snapshotRemovalAttempted) {
      await replaceCheckpoint({ snapshotRemovalAttempted: true });
      await dependencies.afterCheckpoint('snapshot-removal-attempted');
      await revalidateDurableCheckpoint();
      let snapshotRemoved = false;
      try {
        await revalidateExternalAuthority();
        const currentFinalCensus = await dependencies.sideEffectCensus(
          'snapshot-removal',
          namespaceRoot,
          cleanupDeadlineAt,
          true
        );
        const removalIdentityStable = checkpoint.finalCensus !== null && checkpoint.preflight !== null &&
          JSON.stringify(currentFinalCensus) === JSON.stringify(checkpoint.finalCensus) &&
          finalCensusClean(currentFinalCensus) &&
          dependencies.gitRevision(repoRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(repoRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(repoRoot) === checkpoint.worktreeBeforeDigest &&
          dependencies.gitRevision(snapshotRoot, 'HEAD') === checkpoint.headSha &&
          dependencies.gitRevision(snapshotRoot, 'HEAD^{tree}') === checkpoint.treeSha &&
          await dependencies.worktreeDigest(snapshotRoot) === checkpoint.executionSnapshotDigest &&
          checkpoint.executionSnapshotVerified;
        if (!removalIdentityStable) {
          throw new Error('Work Package gate snapshot removal authority changed after durable attempt');
        }
        snapshotRemoved = await dependencies.removeExecutionSnapshot(repoRoot, snapshotRoot);
      } catch {
        snapshotRemoved = false;
      }
      await replaceCheckpoint({ snapshotRemoved });
    }

    const recovery = checkpoint.recovery!;
    const residue = Object.freeze({
      preflight: checkpoint.preflight,
      postChild: checkpoint.postChild,
      postRecovery: checkpoint.postRecovery,
      final: checkpoint.finalCensus,
      namespaceRemovalAttempted: checkpoint.namespaceRemovalAttempted,
      namespaceRemoved: checkpoint.namespaceRemoved
    });
    await record(
      'recovery',
      recovery.complete ? 'recovery-complete' : 'authority-preserved',
      recovery,
      child.durationMs,
      child
    );
    await record(
      'residue',
      checkpoint.finalCensus === null ? 'residue-unknown' : 'residue-census',
      residue,
      child.durationMs,
      child
    );

    if (checkpoint.terminal === null) {
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
      const executionSnapshotAfterDigest = checkpoint.snapshotRemoved &&
        checkpoint.executionSnapshotVerified
        ? checkpoint.executionSnapshotDigest
        : null;
      const repositoryStable = protectedLedgerStable &&
        headShaAfter === checkpoint.headSha && treeShaAfter === checkpoint.treeSha &&
        worktreeAfterDigest === checkpoint.worktreeBeforeDigest &&
        executionSnapshotAfterDigest === checkpoint.executionSnapshotDigest &&
        checkpoint.snapshotRemoved;
      const repository = Object.freeze({
        headSha: checkpoint.headSha,
        treeSha: checkpoint.treeSha,
        headShaAfter,
        treeShaAfter,
        worktreeBeforeDigest: checkpoint.worktreeBeforeDigest,
        worktreeAfterDigest,
        executionSnapshotDigest: checkpoint.executionSnapshotDigest,
        executionSnapshotAfterDigest,
        executionSnapshotRemoved: checkpoint.snapshotRemoved
      });
      const status = resultStatusV4({
        child,
        diagnostic,
        preflight: checkpoint.preflight,
        postChild: checkpoint.postChild,
        recovery,
        postRecovery: checkpoint.postRecovery,
        finalCensus: checkpoint.finalCensus,
        namespaceRemoved: checkpoint.namespaceRemoved,
        snapshotRemoved: checkpoint.snapshotRemoved,
        repositoryStable
      });
      const completedAt = dependencies.wallClock();
      const durationMs = Math.max(0, completedAt.getTime() - Date.parse(checkpoint.startedAt));
      await replaceCheckpoint({
        terminal: Object.freeze({
          status,
          completedAt: completedAt.toISOString(),
          durationMs,
          repository
        })
      });
    }

    const terminal = checkpoint.terminal!;
    const completedEvent = finalizeWorkPackageGateEventV4({
      sequence: checkpoint.journal.lastSequence + 1,
      kind: 'completed',
      elapsedMs: Math.max(
        terminal.durationMs,
        checkpoint.journal.events.at(-1)?.elapsedMs ?? 0
      ),
      phase: terminal.status,
      stdoutBytes: child.stdout.bytes,
      stderrBytes: child.stderr.bytes,
      subject: {
        status: terminal.status,
        child,
        diagnostic,
        repository: terminal.repository,
        recovery,
        residue
      },
      previousDigest: checkpoint.journal.digest
    });
    const completedEvents = Object.freeze([...checkpoint.journal.events, completedEvent]);
    const evidence = finalizeWorkPackageGateEvidenceV4({
      runId,
      status: terminal.status,
      startedAt: checkpoint.startedAt,
      completedAt: terminal.completedAt,
      durationMs: terminal.durationMs,
      selection: checkpoint.selection,
      repository: terminal.repository,
      authority: checkpoint.authority,
      timeouts: { watchdogMs: options.watchdogMs, cleanupMs: options.cleanupMs },
      child,
      diagnostic,
      recovery,
      residue,
      journal: { lastSequence: completedEvents.length, digest: completedEvent.eventDigest }
    });
    await replaceCheckpoint({
      journal: Object.freeze({
        lastSequence: completedEvents.length,
        digest: completedEvent.eventDigest,
        events: completedEvents
      }),
      publication: Object.freeze({ completedEvent, evidence }),
      completedEventPublicationAttempted: true
    });
    await dependencies.afterCheckpoint('completed-event-publication-attempted');
    const published = await finishBoundPublication();
    if (!published) throw new Error('Work Package gate publication was not bound');
    return published;
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
