import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ResourceCompositeSettlementError, withAcquiredResource } from '../../execution/resource-settlement.ts';

import { canonicalEquals, rawSha256Hex, sha256 } from '../../contracts/canonical.ts';
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { resolveWorkspaceLocalStateRoot } from '../../workspace/contract/local-state.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation/staging.ts';
import {
  issueWindowsAppContainerExecutionCapability as issuePhysicalWindowsAppContainerExecutionCapability,
  type WindowsAppContainerExecutionCapability
} from '../runtime-state/physical/contract/windows-appcontainer-execution-capability.ts';
import { assertSameNoFollowDirectoryIdentity, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectoryAcrossParents, scanNoFollowDirectoryTree, type PhysicalDirectoryIdentity } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../runtime-state/physical/runtime/process.ts';
import { ensureDir } from "./files.ts";

export const WORKSPACE_WRITE_LEASE_TOKEN_VERSION = 'workspace-write-lease-token-v3' as const;
export const WORKSPACE_WRITE_LEASE_INSPECTION_VERSION =
  'workspace-write-lease-inspection-v1' as const;
export const WORKSPACE_WRITE_LEASE_DIRECTORY_NAME = 'workspace-write-lease' as const;

const WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION = 'workspace-write-lease-protocol-v3' as const;
const WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION = 'workspace-write-lease-heartbeat-v3' as const;
const WORKSPACE_WRITE_LEASE_TERMINAL_VERSION = 'workspace-write-lease-terminal-v3' as const;
const LEASE_DIRECTORY = WORKSPACE_WRITE_LEASE_DIRECTORY_NAME;
const PROTOCOL_FILE = 'protocol.json';
const HOLDERS_DIRECTORY = 'holders';
const LEGACY_OWNER_FILE = 'owner.json';
const OWNER_FILE = 'owner.json';
const HEARTBEAT_FILE = 'heartbeat.json';
const GENERATION_WIDTH = 16;
const PROTOCOL_CANDIDATE_PATTERN = /^\.protocol-[0-9a-f]{64}\.candidate$/u;
const TERMINAL_CANDIDATE_PATTERN = /^\.terminal-[0-9a-f]{64}\.candidate$/u;
const OWNER_GENERATION_PATTERN = /^([0-9]{16})\.owner\.json$/u;
const TERMINAL_GENERATION_PATTERN = /^([0-9]{16})\.terminal\.json$/u;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_LEASE_ID_LENGTH = 256;
const PROCESS_NONCE = randomUUID();
const RETIREMENT_RECOVERY_ACQUIRE = Symbol('workspace-write-lease-retirement-recovery-acquire-v1');
type InternalWorkspaceWriteLeaseAcquireOptions = WorkspaceWriteLeaseAcquireOptions & {
  readonly [RETIREMENT_RECOVERY_ACQUIRE]?: WorkspaceWriteLeaseRetirementReceipt;
};

const workspaceWriteCommitFenceBindings = new WeakMap<
  CommitFence,
  Readonly<{
    workspaceRoot: string;
    token: WorkspaceWriteLeaseToken;
  }>
>();

export type WorkspaceWriteLeaseErrorCode =
  | 'WORKSPACE-WRITE-LEASE-001'
  | 'WORKSPACE-WRITE-LEASE-002'
  | 'WORKSPACE-WRITE-LEASE-003'
  | 'WORKSPACE-WRITE-LEASE-004';

export class WorkspaceWriteLeaseError extends Error {
  readonly code: WorkspaceWriteLeaseErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: WorkspaceWriteLeaseErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean>> = {}
  ) {
    super(message);
    this.name = 'WorkspaceWriteLeaseError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class WorkspaceWriteLeaseRetirementRecoveryReady extends WorkspaceWriteLeaseError {
  constructor(readonly receipt: WorkspaceWriteLeaseRetirementReceipt) {
    super('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement generation reached terminal recovery state');
  }
}

export interface WorkspaceWriteLeaseToken {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_TOKEN_VERSION;
  readonly workspaceIdentityDigest: string;
  readonly generation: number;
  readonly ownerFileIdentityDigest: string;
  readonly hostname: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly leaseId: string;
}

interface WorkspaceWriteLeaseOwner extends WorkspaceWriteLeaseToken {
  readonly createdAtMs: number;
}

interface WorkspaceWriteLeaseHeartbeat {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION;
  readonly token: WorkspaceWriteLeaseToken;
  readonly heartbeatAtMs: number;
}

interface WorkspaceWriteLeaseTerminal {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_TERMINAL_VERSION;
  readonly token: WorkspaceWriteLeaseToken;
  readonly outcome: 'released' | 'recovered';
  readonly terminalAtMs: number;
}

interface WorkspaceWriteLeasePaths {
  readonly parent: string;
  readonly root: string;
  readonly holders: string;
}

interface WorkspaceWriteLeaseInventory {
  readonly ownerGenerations: readonly number[];
  readonly terminalGenerations: ReadonlySet<number>;
  readonly highestGeneration: number | undefined;
}

interface WorkspaceWriteLeaseGenerationState {
  readonly owner: WorkspaceWriteLeaseOwner;
  readonly ownerFileIdentityDigest: string;
  readonly ownerLinkCount: number;
  readonly terminal: WorkspaceWriteLeaseTerminal | null;
}

interface PreparedWorkspaceWriteLease {
  readonly holder: string;
  readonly ownerPath: string;
  readonly owner: WorkspaceWriteLeaseOwner;
  readonly token: WorkspaceWriteLeaseToken;
}

type ImmutablePublicationOutcome =
  | Readonly<{ state: 'published' }>
  | Readonly<{
      state: 'not-published';
      reason: 'target-exists' | 'link-failed';
      systemCode: string;
    }>
  | Readonly<{ state: 'durability-unknown'; systemCode: string }>;

export interface WorkspaceWriteLeaseInspection {
  readonly formatVersion: typeof WORKSPACE_WRITE_LEASE_INSPECTION_VERSION;
  readonly protocolRoot: string;
  readonly state: 'active' | 'quiescent';
  readonly activeGeneration: number | null;
  readonly ownerGenerations: readonly number[];
  readonly terminalGenerations: readonly number[];
  readonly authorityPaths: readonly string[];
  readonly stateDigest: string;
}

export interface WorkspaceWriteLeaseHandle {
  readonly token: WorkspaceWriteLeaseToken;
  heartbeat(): Promise<void>;
  assertOwned(): Promise<void>;
  /**
   * Closeout-only retained-identity relocation.  The caller performs the
   * same-parent rename through its physical handle authority first; this
   * method proves the new lexical root is the token's same directory object
   * before moving subsequent heartbeat/assert/release operations there.
   */
  relocate(nextWorkspaceRoot: string): Promise<void>;
  /** Exact active mutable subtree; valid only after `assertOwned()`. */
  ownedNamespace(): Promise<Readonly<{ workspaceRoot: string; relativePath: '.sec/workspace-write-lease' }>>;
  retireOwnedNamespace(intentDigest: string, proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity): Promise<WorkspaceWriteLeaseRetirementReceipt>;
  release(): Promise<void>;
}

export interface WorkspaceWriteLeaseRetirementReceipt {
  readonly formatVersion: 'workspace-write-lease-retirement-receipt-v1';
  readonly workspaceIdentityDigest: string;
  readonly workspaceDevice: string;
  readonly workspaceInode: string;
  readonly intentDigest: string;
  readonly tokenGeneration: number;
  readonly ownerFileIdentityDigest: string;
  readonly terminalDigest: string;
  readonly transitionDigest: string;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
  readonly namespaceTombstoneName: string;
  readonly fenceName: string;
  readonly retirementDigest: string;
}

export interface WorkspaceWriteLeaseManager {
  acquire(
    workspaceRoot: string,
    options?: WorkspaceWriteLeaseAcquireOptions
  ): Promise<WorkspaceWriteLeaseHandle>;
  assertOwned(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  release(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  withControlPlaneQuiesced<Value>(
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value>;
  withLease<Value>(
    workspaceRoot: string,
    reentrantToken: WorkspaceWriteLeaseToken | undefined,
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>,
    options?: WorkspaceWriteLeaseAcquireOptions
  ): Promise<Value>;
}

export interface WorkspaceWriteLeaseAcquireOptions {
  readonly executionBoundary?: 'windows-appcontainer';
}

export interface WorkspaceWriteLeaseManagerOptions {
  readonly heartbeatIntervalMs?: number;
  readonly staleAfterMs?: number;
  readonly hostname?: string;
  readonly pid?: number;
  readonly processNonce?: string;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly processAlive?: (pid: number) => 'alive' | 'dead' | 'unknown';
  /** Internal deterministic fault seam for the owner-publication directory sync only. */
  readonly ownerPublicationDirectorySync?: (directory: string) => Promise<void>;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return safeInteger(value) && value > 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return canonicalEquals(actual, expected);
}

function tokenLooksValid(value: unknown): value is WorkspaceWriteLeaseToken {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'generation',
    'ownerFileIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId'
  ])) return false;
  const token = value as Record<string, unknown>;
  return token.formatVersion === WORKSPACE_WRITE_LEASE_TOKEN_VERSION &&
    nonEmpty(token.workspaceIdentityDigest) && positiveSafeInteger(token.generation) &&
    nonEmpty(token.ownerFileIdentityDigest) && nonEmpty(token.hostname) &&
    safeInteger(token.pid) && nonEmpty(token.processNonce) && nonEmpty(token.leaseId);
}

function ownerLooksValid(value: unknown): value is WorkspaceWriteLeaseOwner {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'generation',
    'ownerFileIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId',
    'createdAtMs'
  ])) return false;
  const owner = value as Record<string, unknown>;
  return tokenLooksValid({
    formatVersion: owner.formatVersion,
    workspaceIdentityDigest: owner.workspaceIdentityDigest,
    generation: owner.generation,
    ownerFileIdentityDigest: owner.ownerFileIdentityDigest,
    hostname: owner.hostname,
    pid: owner.pid,
    processNonce: owner.processNonce,
    leaseId: owner.leaseId
  }) && safeInteger(owner.createdAtMs);
}

function heartbeatLooksValid(value: unknown): value is WorkspaceWriteLeaseHeartbeat {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['formatVersion', 'token', 'heartbeatAtMs'])) return false;
  const heartbeat = value as Record<string, unknown>;
  return heartbeat.formatVersion === WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION &&
    tokenLooksValid(heartbeat.token) && safeInteger(heartbeat.heartbeatAtMs);
}

function terminalLooksValid(value: unknown): value is WorkspaceWriteLeaseTerminal {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['formatVersion', 'token', 'outcome', 'terminalAtMs'])) return false;
  const terminal = value as Record<string, unknown>;
  return terminal.formatVersion === WORKSPACE_WRITE_LEASE_TERMINAL_VERSION &&
    tokenLooksValid(terminal.token) &&
    (terminal.outcome === 'released' || terminal.outcome === 'recovered') &&
    safeInteger(terminal.terminalAtMs);
}

function tokenFromOwner(owner: WorkspaceWriteLeaseOwner): WorkspaceWriteLeaseToken {
  return Object.freeze({
    formatVersion: owner.formatVersion,
    workspaceIdentityDigest: owner.workspaceIdentityDigest,
    generation: owner.generation,
    ownerFileIdentityDigest: owner.ownerFileIdentityDigest,
    hostname: owner.hostname,
    pid: owner.pid,
    processNonce: owner.processNonce,
    leaseId: owner.leaseId
  });
}

function sameToken(left: WorkspaceWriteLeaseToken, right: WorkspaceWriteLeaseToken): boolean {
  return canonicalEquals(left, right);
}

function sameHeartbeat(
  left: WorkspaceWriteLeaseHeartbeat,
  right: WorkspaceWriteLeaseHeartbeat
): boolean {
  return canonicalEquals(left, right);
}

function defaultProcessAlive(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return 'dead';
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

type WorkspaceIdentityFailureReason = 'missing' | 'inaccessible' | 'not-directory' | 'unknown';

function systemErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  if (typeof error.code !== 'string') return undefined;
  const normalized = error.code.toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(normalized) ? normalized : undefined;
}

function acquisitionSystemCode(error: unknown): string | undefined {
  if (error instanceof WorkspaceWriteLeaseError) {
    return systemErrorCode({ code: error.details.systemCode });
  }
  return systemErrorCode(error);
}

type WorkspaceWriteLeaseAcquisitionPhase =
  | 'retirement-fence-observation'
  | 'lease-root-initialization'
  | 'lease-inventory'
  | 'acquisition-clock'
  | 'owner-preparation'
  | 'owner-publication'
  | 'unclassified';

function acquisitionFailure(
  phase: WorkspaceWriteLeaseAcquisitionPhase,
  error: unknown,
  message: string
): WorkspaceWriteLeaseError {
  return new WorkspaceWriteLeaseError(
    'WORKSPACE-WRITE-LEASE-004',
    message,
    {
      operation: 'acquire',
      phase,
      systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN'
    }
  );
}

function acquisitionPhaseFailure(
  phase: WorkspaceWriteLeaseAcquisitionPhase,
  error: unknown,
  message: string
): WorkspaceWriteLeaseError {
  // Manager callbacks are public capabilities.  A callback can construct this
  // exported error class, so `instanceof WorkspaceWriteLeaseError` is not an
  // issuer credential.  Every acquisition callback boundary is projected into
  // the same closed contract: fixed message, fixed keys, and a bounded native
  // code.  No callback-owned message or details survive the boundary.
  if (!(error instanceof WorkspaceWriteLeaseError)) {
    return acquisitionFailure(phase, error, message);
  }
  // Structural protocol and contention errors are created below the callback
  // boundary and retain their typed semantics.  Capability wrappers above
  // convert every caller-issued exception to code 004 before it reaches here.
  if (error.code !== 'WORKSPACE-WRITE-LEASE-004') return error;
  return acquisitionFailure(phase, error, message);
}

function workspaceIdentityFailureReason(error: unknown): WorkspaceIdentityFailureReason {
  if (error instanceof WorkspaceWriteLeaseError &&
    (error.details.reason === 'not-directory' || error.details.reason === 'missing' || error.details.reason === 'inaccessible' || error.details.reason === 'unknown')) {
    return error.details.reason;
  }
  const code = systemErrorCode(error);
  if (code === 'PHYSICAL_NO_FOLLOW_ABSENT') return 'missing';
  switch (code) {
    case 'ENOENT':
      return 'missing';
    case 'EACCES':
    case 'EPERM':
      return 'inaccessible';
    case 'ENOTDIR':
      return 'not-directory';
    default:
      return 'unknown';
  }
}

function isExistsError(error: unknown): boolean {
  return systemErrorCode(error) === 'EEXIST';
}

function isMissingError(error: unknown): boolean {
  return systemErrorCode(error) === 'ENOENT';
}

function assertWorkspaceIdentityBoundary(
  workspaceRoot: string,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): void {
  if (executionBoundary === undefined) return;
  if (executionBoundary !== 'windows-appcontainer' || process.platform !== 'win32' ||
    process.env[ISOLATED_VERIFICATION_ENV_KEY] !== '1' ||
    !isSemanticMutationStagingWorkspace(workspaceRoot)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace lexical identity boundary is invalid'
    );
  }
}

async function workspaceIdentity(
  workspaceRoot: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<string> {
  assertWorkspaceIdentityBoundary(workspaceRoot, executionBoundary);
  if (executionBoundary === 'windows-appcontainer') {
    const resolved = path.resolve(workspaceRoot);
    const stat = await fs.lstat(resolved, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace lexical identity is not a real directory',
        { reason: 'not-directory' }
      );
    }
    return sha256({
      domain: 'workspace-write-lease-appcontainer-lexical-identity-v1',
      resolved,
      dev: String(stat.dev),
      ino: String(stat.ino),
      mode: String(stat.mode)
    });
  }
  if (process.platform === 'darwin') {
    // macOS ordinary writers still need the canonical lease protocol even
    // though #186 destructive no-follow effects deliberately have no macOS
    // backend.  Scope this fallback to the non-destructive lease resource:
    // reject links and bind the directory's native dev/inode, leaving physical
    // closeout to fail closed instead of silently reusing this identity.
    const resolved = path.resolve(workspaceRoot);
    let metadata;
    try { metadata = await fs.lstat(resolved, { bigint: true }); } catch (error) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace lexical identity cannot be inspected on macOS', {
        reason: workspaceIdentityFailureReason(error),
        systemCode: systemErrorCode(error) ?? 'UNKNOWN'
      });
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace lexical identity is not a real macOS directory', { reason: 'not-directory' });
    }
    return sha256({
      domain: 'workspace-write-lease-macos-directory-identity-v1',
      dev: String(metadata.dev),
      ino: String(metadata.ino)
    });
  }
  // The resource is the physical directory object, not its spelling.  This
  // permits an authorized retained-handle rename to move an active closeout
  // workspace while ensuring aliases and the post-rename location compete for
  // exactly the same lease token resource.
  try {
    return physicalWorkspaceIdentityDigest(
      inspectNoFollowDirectoryChain(path.resolve(workspaceRoot), 'Workspace lease physical identity').target
    );
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace physical identity cannot be proven', {
      reason: workspaceIdentityFailureReason(error),
      systemCode: systemErrorCode(error) ?? 'UNKNOWN'
    });
  }
}

async function assertLeaseParent(
  workspaceRoot: string,
  parent: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  assertWorkspaceIdentityBoundary(workspaceRoot, executionBoundary);
  if (executionBoundary === 'windows-appcontainer') {
    const resolvedWorkspace = path.resolve(workspaceRoot);
    const resolvedParent = path.resolve(parent);
    const expectedParent = resolveWorkspaceLocalStateRoot(resolvedWorkspace);
    const [workspaceMetadata, parentMetadata] = await Promise.all([
      fs.lstat(resolvedWorkspace),
      fs.lstat(resolvedParent)
    ]);
    if (resolvedParent !== expectedParent ||
      !workspaceMetadata.isDirectory() || workspaceMetadata.isSymbolicLink() ||
      !parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease parent is not a lexical real directory inside the AppContainer workspace'
      );
    }
    return;
  }
  const [canonicalWorkspace, parentMetadata, canonicalParent] = await Promise.all([
    fs.realpath(workspaceRoot),
    fs.lstat(parent),
    fs.realpath(parent)
  ]);
  const relative = path.relative(canonicalWorkspace, canonicalParent);
  const escapesWorkspace = relative === '..' || relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || escapesWorkspace) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease parent is not a real directory inside the workspace'
    );
  }
}

async function assertProtocolDirectory(
  parent: string,
  root: string,
  holders: string,
  executionBoundary?: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  const [rootMetadata, holdersMetadata] = await Promise.all([
    fs.lstat(root),
    fs.lstat(holders)
  ]);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() ||
    !holdersMetadata.isDirectory() || holdersMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root is not canonical'
    );
  }
  if (executionBoundary === 'windows-appcontainer') {
    if (path.resolve(root) !== path.join(path.resolve(parent), LEASE_DIRECTORY) ||
      path.resolve(holders) !== path.join(path.resolve(root), HOLDERS_DIRECTORY)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol root escaped its lexical parent'
      );
    }
    return;
  }
  const [canonicalParent, canonicalRoot, canonicalHolders] = await Promise.all([
    fs.realpath(parent),
    fs.realpath(root),
    fs.realpath(holders)
  ]);
  if (canonicalRoot !== path.join(canonicalParent, LEASE_DIRECTORY) ||
    canonicalHolders !== path.join(canonicalRoot, HOLDERS_DIRECTORY)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root escaped its canonical parent'
    );
  }
}

function ownerFileIdentity(metadata: { readonly dev: bigint | number; readonly ino: bigint | number }): string {
  return sha256({
    domain: 'workspace-write-lease-owner-file-identity-v2',
    dev: String(metadata.dev),
    ino: String(metadata.ino)
  });
}

function sameFileIdentity(
  left: { readonly dev: bigint | number; readonly ino: bigint | number },
  right: { readonly dev: bigint | number; readonly ino: bigint | number }
): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = systemErrorCode(error);
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function candidateFileName(kind: string, id: string): string {
  const digestHex = rawSha256Hex(JSON.stringify({ kind, id }));
  return `.${kind}-${digestHex}.candidate`;
}

async function createImmutableCandidate(
  directory: string,
  kind: string,
  value: unknown,
  createId: () => string
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = path.join(directory, candidateFileName(kind, createId()));
    let handle;
    try {
      handle = await fs.open(candidate, 'wx');
      await handle.writeFile(jsonFile(value), 'utf8');
      await handle.sync();
      await handle.close();
      await fsyncDirectory(directory);
      return candidate;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (isExistsError(error)) continue;
      throw error;
    }
  }
  throw new WorkspaceWriteLeaseError(
    'WORKSPACE-WRITE-LEASE-004',
    'Workspace writer lease immutable candidate identity collided repeatedly'
  );
}

async function publicationTargetRelationship(
  candidate: string,
  target: string
): Promise<'absent' | 'same' | 'different' | 'unknown'> {
  let candidateMetadata;
  let targetMetadata;
  try {
    candidateMetadata = await fs.lstat(candidate, { bigint: true });
  } catch {
    return 'unknown';
  }
  try {
    targetMetadata = await fs.lstat(target, { bigint: true });
  } catch (error) {
    return isMissingError(error) ? 'absent' : 'unknown';
  }
  if (!candidateMetadata.isFile() || candidateMetadata.isSymbolicLink() ||
    !targetMetadata.isFile() || targetMetadata.isSymbolicLink()) {
    return 'different';
  }
  return sameFileIdentity(candidateMetadata, targetMetadata) ? 'same' : 'different';
}

async function linkImmutableCandidateNoReplace(
  candidate: string,
  targetDirectory: string,
  target: string,
  syncTargetDirectory: (directory: string) => Promise<void> = fsyncDirectory
): Promise<ImmutablePublicationOutcome> {
  try {
    await fs.link(candidate, target);
  } catch (error) {
    const systemCode = systemErrorCode(error) ?? 'UNKNOWN';
    const relationship = await publicationTargetRelationship(candidate, target);
    if (relationship === 'same') return Object.freeze({ state: 'durability-unknown', systemCode });
    if (relationship === 'unknown') return Object.freeze({ state: 'durability-unknown', systemCode });
    if (relationship === 'different' && isExistsError(error)) {
      return Object.freeze({ state: 'not-published', reason: 'target-exists', systemCode });
    }
    if (relationship === 'absent') {
      return Object.freeze({ state: 'not-published', reason: 'link-failed', systemCode });
    }
    return Object.freeze({ state: 'durability-unknown', systemCode });
  }
  try {
    await syncTargetDirectory(targetDirectory);
    return Object.freeze({ state: 'published' });
  } catch (error) {
    return Object.freeze({
      state: 'durability-unknown',
      systemCode: systemErrorCode(error) ?? 'UNKNOWN'
    });
  }
}

async function removeImmutableCandidate(
  candidateDirectory: string,
  candidate: string
): Promise<void> {
  await fs.unlink(candidate);
  await fsyncDirectory(candidateDirectory);
}

async function publishImmutableJsonNoReplace(
  candidateDirectory: string,
  targetDirectory: string,
  target: string,
  kind: string,
  value: unknown,
  createId: () => string
): Promise<boolean> {
  const candidate = await createImmutableCandidate(candidateDirectory, kind, value, createId);
  const outcome = await linkImmutableCandidateNoReplace(candidate, targetDirectory, target);
  if (outcome.state === 'durability-unknown') {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication durability is unknown',
      {
        reason: 'publication-durability-unknown',
        retryable: true,
        systemCode: outcome.systemCode
      }
    );
  }
  try {
    await removeImmutableCandidate(candidateDirectory, candidate);
  } catch (error) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication cleanup durability is unknown',
      {
        reason: 'publication-cleanup-durability-unknown',
        retryable: true,
        systemCode: systemErrorCode(error) ?? 'UNKNOWN'
      }
    );
  }
  if (outcome.state === 'not-published') {
    if (outcome.reason === 'target-exists') return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication failed before target creation',
      { systemCode: outcome.systemCode }
    );
  }
  return true;
}

async function replaceHeartbeat(
  holder: string,
  heartbeat: WorkspaceWriteLeaseHeartbeat,
  createId: () => string
): Promise<void> {
  const temporary = path.join(holder, candidateFileName('heartbeat', createId()));
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(jsonFile(heartbeat), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, path.join(holder, HEARTBEAT_FILE));
    await fsyncDirectory(holder);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function readJsonValue(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease record cannot be proven'
    );
  }
}

async function readOwner(filePath: string): Promise<WorkspaceWriteLeaseOwner> {
  const value = await readJsonValue(filePath);
  if (!ownerLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease owner record is invalid'
    );
  }
  return value;
}

async function readHeartbeat(filePath: string): Promise<WorkspaceWriteLeaseHeartbeat> {
  const value = await readJsonValue(filePath);
  if (!heartbeatLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease heartbeat record is invalid'
    );
  }
  return value;
}

async function readOptionalTerminal(filePath: string): Promise<WorkspaceWriteLeaseTerminal | null> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (isMissingError(error)) return null;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease terminal record cannot be proven'
    );
  }
  if (!terminalLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease terminal record is invalid'
    );
  }
  return value;
}

function generationStem(generation: number): string {
  if (!positiveSafeInteger(generation)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease generation is invalid'
    );
  }
  const stem = String(generation).padStart(GENERATION_WIDTH, '0');
  if (stem.length !== GENERATION_WIDTH) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease generation space is exhausted'
    );
  }
  return stem;
}

function generationOwnerPath(root: string, generation: number): string {
  return path.join(root, `${generationStem(generation)}.owner.json`);
}

function generationTerminalPath(root: string, generation: number): string {
  return path.join(root, `${generationStem(generation)}.terminal.json`);
}

function holderDirectory(holders: string, token: Pick<WorkspaceWriteLeaseToken, 'generation' | 'leaseId'>): string {
  const digestHex = rawSha256Hex(JSON.stringify({
    domain: 'workspace-write-lease-holder-v2',
    generation: token.generation,
    leaseId: token.leaseId
  }));
  return path.join(holders, `${generationStem(token.generation)}-${digestHex}`);
}

function workspaceWriteLeasePathsFor(workspaceRoot: string): WorkspaceWriteLeasePaths {
  const parent = resolveWorkspaceLocalStateRoot(workspaceRoot);
  const root = path.join(parent, LEASE_DIRECTORY);
  return { parent, root, holders: path.join(root, HOLDERS_DIRECTORY) };
}

function retirementFenceName(workspaceIdentityDigest: string): string {
  return `.workspace-write-lease-retired-${rawSha256Hex(workspaceIdentityDigest)}.json`;
}

interface WorkspaceWriteLeaseRetirementTransition {
  readonly formatVersion: 'workspace-write-lease-retirement-transition-v1';
  readonly workspaceIdentityDigest: string;
  readonly workspaceDevice: string;
  readonly workspaceInode: string;
  readonly intentDigest: string;
  readonly token: WorkspaceWriteLeaseToken;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
  readonly namespaceTombstoneParentDevice: string;
  readonly namespaceTombstoneParentInode: string;
  readonly namespaceEntries: readonly Readonly<{ relativePath: string; kind: string; device: string; inode: string; size: number; bytes: string | null }>[];
  readonly transitionDigest: string;
}

function retirementTransitionName(transitionDigest: string): string {
  return `.workspace-write-lease-transition-${transitionDigest.slice('sha256:'.length)}.json`;
}

function namespaceTombstoneName(transitionDigest: string): string {
  return `workspace-write-lease-retired-namespace-${transitionDigest.slice('sha256:'.length)}`;
}

function transitionEntries(entries: readonly import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry[]) {
  return entries.map((entry) => Object.freeze({ relativePath: entry.relativePath, kind: entry.kind, device: entry.device, inode: entry.inode, size: entry.size, bytes: entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex') }));
}

function createRetirementTransition(input: Omit<WorkspaceWriteLeaseRetirementTransition, 'formatVersion' | 'transitionDigest'>): WorkspaceWriteLeaseRetirementTransition {
  const material = { formatVersion: 'workspace-write-lease-retirement-transition-v1' as const, ...input };
  return Object.freeze({ ...material, transitionDigest: sha256(material) });
}

const RETIREMENT_TRANSITION_KEYS = [
  'formatVersion', 'workspaceIdentityDigest', 'workspaceDevice', 'workspaceInode',
  'intentDigest', 'token', 'namespaceDevice', 'namespaceInode',
  'namespaceTombstoneParentDevice', 'namespaceTombstoneParentInode',
  'namespaceEntries', 'transitionDigest'
] as const;
const RETIREMENT_TRANSITION_ENTRY_KEYS = [
  'relativePath', 'kind', 'device', 'inode', 'size', 'bytes'
] as const;

function validateRetirementTransition(value: unknown): WorkspaceWriteLeaseRetirementTransition {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !hasExactKeys(value, RETIREMENT_TRANSITION_KEYS)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition has an invalid schema');
  }
  const candidate = value as WorkspaceWriteLeaseRetirementTransition;
  if (candidate.formatVersion !== 'workspace-write-lease-retirement-transition-v1' ||
    !tokenLooksValid(candidate.token) || !/^sha256:[0-9a-f]{64}$/u.test(candidate.intentDigest) ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.transitionDigest) ||
    !Array.isArray(candidate.namespaceEntries) || candidate.namespaceEntries.some((entry) =>
      !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      !hasExactKeys(entry, RETIREMENT_TRANSITION_ENTRY_KEYS) ||
      typeof entry.relativePath !== 'string' || typeof entry.kind !== 'string' ||
      typeof entry.device !== 'string' || typeof entry.inode !== 'string' ||
      !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      (entry.bytes !== null && (typeof entry.bytes !== 'string' || !/^(?:[0-9a-f]{2})*$/u.test(entry.bytes)))) ||
    typeof candidate.workspaceIdentityDigest !== 'string' ||
    typeof candidate.workspaceDevice !== 'string' || typeof candidate.workspaceInode !== 'string' ||
    typeof candidate.namespaceDevice !== 'string' || typeof candidate.namespaceInode !== 'string' ||
    typeof candidate.namespaceTombstoneParentDevice !== 'string' || typeof candidate.namespaceTombstoneParentInode !== 'string') {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is invalid');
  }
  const { formatVersion: _format, transitionDigest: _digest, ...material } = candidate;
  const rebuilt = createRetirementTransition(material);
  if (!canonicalEquals(candidate, rebuilt)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition digest is invalid');
  }
  return rebuilt;
}

function retirementFenceParent(workspaceRoot: string): string {
  return path.dirname(path.resolve(workspaceRoot));
}

function physicalWorkspaceIdentityDigest(workspace: Pick<import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity, 'device' | 'inode'>): string {
  return sha256({
    domain: 'workspace-write-lease-physical-directory-identity-v2',
    dev: workspace.device,
    ino: workspace.inode
  });
}

type WorkspaceWriteLeaseRetirementRecoveryInput = Readonly<{
  workspaceRoot: string;
  intentDigest: string;
  proofParent: PhysicalDirectoryIdentity;
}>;

function snapshotRetirementRecoveryInput(input: WorkspaceWriteLeaseRetirementRecoveryInput): WorkspaceWriteLeaseRetirementRecoveryInput {
  let workspaceRoot: unknown;
  let intentDigest: unknown;
  let suppliedProofParent: unknown;
  try {
    workspaceRoot = input.workspaceRoot;
    intentDigest = input.intentDigest;
    suppliedProofParent = input.proofParent;
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery input cannot be observed');
  }
  if (typeof workspaceRoot !== 'string' || typeof intentDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(intentDigest) || suppliedProofParent === null ||
    typeof suppliedProofParent !== 'object' || Array.isArray(suppliedProofParent)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery input is invalid');
  }
  let proofParent: PhysicalDirectoryIdentity;
  try {
    const candidate = suppliedProofParent as Partial<PhysicalDirectoryIdentity>;
    const snapshot = Object.freeze({
      path: candidate.path,
      finalPath: candidate.finalPath,
      device: candidate.device,
      inode: candidate.inode,
      objectId: candidate.objectId
    });
    if (typeof snapshot.path !== 'string' ||
      typeof snapshot.finalPath !== 'string' || typeof snapshot.device !== 'string' ||
      typeof snapshot.inode !== 'string' || typeof snapshot.objectId !== 'string') {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent is invalid');
    }
    proofParent = assertSameNoFollowDirectoryIdentity(snapshot as PhysicalDirectoryIdentity, 'Workspace lease retirement recovery proof parent').target;
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent cannot be observed');
  }
  return Object.freeze({ workspaceRoot: path.resolve(workspaceRoot), intentDigest, proofParent });
}

function retirementTerminalTokenDigest(token: WorkspaceWriteLeaseToken): string {
  return sha256({ domain: 'workspace-write-lease-retirement-terminal-token-v1', token });
}

const RETIREMENT_RECEIPT_KEYS = [
  'formatVersion', 'workspaceIdentityDigest', 'workspaceDevice', 'workspaceInode',
  'intentDigest', 'tokenGeneration', 'ownerFileIdentityDigest', 'terminalDigest', 'transitionDigest', 'namespaceDevice', 'namespaceInode', 'namespaceTombstoneName', 'fenceName', 'retirementDigest'
] as const;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validateRetirementReceipt(receipt: unknown): WorkspaceWriteLeaseRetirementReceipt {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !hasExactKeys(receipt, RETIREMENT_RECEIPT_KEYS)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement receipt has an invalid schema');
  }
  const candidate = receipt as WorkspaceWriteLeaseRetirementReceipt;
  const material = {
    formatVersion: 'workspace-write-lease-retirement-receipt-v1' as const,
    workspaceIdentityDigest: candidate.workspaceIdentityDigest,
    workspaceDevice: candidate.workspaceDevice,
    workspaceInode: candidate.workspaceInode,
    intentDigest: candidate.intentDigest,
    tokenGeneration: candidate.tokenGeneration,
    ownerFileIdentityDigest: candidate.ownerFileIdentityDigest,
    terminalDigest: candidate.terminalDigest,
    transitionDigest: candidate.transitionDigest,
    namespaceDevice: candidate.namespaceDevice,
    namespaceInode: candidate.namespaceInode,
    namespaceTombstoneName: candidate.namespaceTombstoneName,
    fenceName: candidate.fenceName
  };
  if (candidate.formatVersion !== material.formatVersion ||
    typeof candidate.workspaceIdentityDigest !== 'string' ||
    typeof candidate.workspaceDevice !== 'string' || typeof candidate.workspaceInode !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.intentDigest) || !Number.isSafeInteger(candidate.tokenGeneration) || candidate.tokenGeneration < 1 ||
    typeof candidate.ownerFileIdentityDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(candidate.terminalDigest) || !/^sha256:[0-9a-f]{64}$/u.test(candidate.transitionDigest) ||
    typeof candidate.namespaceDevice !== 'string' || typeof candidate.namespaceInode !== 'string' || candidate.namespaceTombstoneName !== namespaceTombstoneName(candidate.transitionDigest) ||
    typeof candidate.fenceName !== 'string' || typeof candidate.retirementDigest !== 'string' ||
    candidate.retirementDigest !== sha256(material) || candidate.fenceName !== retirementFenceName(candidate.workspaceIdentityDigest)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement receipt is invalid');
  }
  return Object.freeze({ ...candidate });
}

/**
 * Ends the externally-held retirement fence only after the closeout owner has
 * completed its terminal retained cleanup/readback lifecycle.  Acquisition
 * checks this same-parent sibling before it ever creates `.sec`, so a new
 * writer cannot race a retired tree by recreating its local namespace.
 */
export function assertWorkspaceWriteLeaseRetirement(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
}): Readonly<{ parent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity; entry: import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry }> {
  const receipt = validateRetirementReceipt(input.receipt);
  const parent = inspectNoFollowDirectoryChain(retirementFenceParent(input.workspaceRoot), 'Workspace lease retirement fence parent').target;
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Workspace lease retirement workspace').target;
  if (workspace.device !== receipt.workspaceDevice || workspace.inode !== receipt.workspaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement workspace identity changed');
  }
  if (physicalWorkspaceIdentityDigest(workspace) !== receipt.workspaceIdentityDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement identity digest does not bind the live workspace');
  }
  const entry = inspectNoFollowOrdinaryFileEntry(parent, receipt.fenceName);
  if (entry === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence is absent');
  if (entry.kind !== 'file' || entry.bytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence changed before completion');
  }
  const bytes = entry.bytes;
  let current: WorkspaceWriteLeaseRetirementReceipt;
  try { current = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementReceipt; } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence is malformed');
  }
  const currentReceipt = validateRetirementReceipt(current);
  if (currentReceipt.retirementDigest !== receipt.retirementDigest || !canonicalEquals(currentReceipt, receipt)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence differs from its receipt');
  }
  return Object.freeze({ parent, entry });
}

/**
 * A retirement fence is only an index into the retained V3 ledger.  The
 * ledger directory is the authority: it must be the pre-bound inode and must
 * still contain the exact owner/terminal transition before recovery can use
 * it to converge any closeout effect.  This helper deliberately accepts a
 * subset because terminalisation removes the active holder and later retained
 * cleanup may have removed owned children, but it never accepts an added,
 * changed, reparse, or foreign entry.
 */
function assertRetirementLedgerNamespace(
  namespace: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity,
  receipt: WorkspaceWriteLeaseRetirementReceipt,
  transition: WorkspaceWriteLeaseRetirementTransition
): void {
  if (namespace.device !== receipt.namespaceDevice || namespace.inode !== receipt.namespaceInode ||
    namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace identity differs from its bound transition');
  }
  const protocolBytes = readNoFollowOrdinaryFile(namespace, PROTOCOL_FILE);
  const ownerBytes = readNoFollowOrdinaryFile(namespace, generationOwnerPath('', receipt.tokenGeneration));
  const terminalBytes = readNoFollowOrdinaryFile(namespace, generationTerminalPath('', receipt.tokenGeneration));
  if (protocolBytes === null || ownerBytes === null || terminalBytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair is incomplete');
  }
  let protocol: unknown; let owner: unknown; let terminal: unknown;
  try {
    protocol = JSON.parse(Buffer.from(protocolBytes).toString('utf8')) as unknown;
    owner = JSON.parse(Buffer.from(ownerBytes).toString('utf8')) as unknown;
    terminal = JSON.parse(Buffer.from(terminalBytes).toString('utf8')) as unknown;
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair is malformed');
  }
  if (!canonicalEquals(protocol, { formatVersion: WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION }) || !ownerLooksValid(owner) || !terminalLooksValid(terminal) ||
    !sameToken(tokenFromOwner(owner), transition.token) || !sameToken(terminal.token, transition.token) ||
    retirementTerminalTokenDigest(terminal.token) !== receipt.terminalDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair differs from transition');
  }
  const expected = new Map(transition.namespaceEntries.map((entry) => [entry.relativePath, entry]));
  const terminalPath = generationTerminalPath('', receipt.tokenGeneration);
  if (scanNoFollowDirectoryTree(namespace).some((entry) => {
    const prior = expected.get(entry.relativePath);
    return (entry.relativePath !== terminalPath && prior === undefined) ||
      (prior !== undefined && (prior.kind !== entry.kind || prior.device !== entry.device || prior.inode !== entry.inode || prior.size !== entry.size || prior.bytes !== (entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex')))) ||
      entry.relativePath.startsWith(`${HOLDERS_DIRECTORY}/`);
  })) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace is not a terminal expected subset');
  }
}

function readRetirementTransitionProof(
  proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity,
  receipt: WorkspaceWriteLeaseRetirementReceipt
): WorkspaceWriteLeaseRetirementTransition {
  const bytes = readNoFollowOrdinaryFile(proofParent, retirementTransitionName(receipt.transitionDigest));
  if (bytes === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is absent');
  let transition: WorkspaceWriteLeaseRetirementTransition;
  try { transition = validateRetirementTransition(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is malformed');
  }
  if (transition.transitionDigest !== receipt.transitionDigest || transition.intentDigest !== receipt.intentDigest ||
    transition.token.generation !== receipt.tokenGeneration || transition.token.ownerFileIdentityDigest !== receipt.ownerFileIdentityDigest ||
    transition.workspaceDevice !== receipt.workspaceDevice || transition.workspaceInode !== receipt.workspaceInode ||
    transition.workspaceIdentityDigest !== receipt.workspaceIdentityDigest ||
    transition.namespaceTombstoneParentDevice !== proofParent.device || transition.namespaceTombstoneParentInode !== proofParent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition does not bind its retained proof');
  }
  return transition;
}

/**
 * Verifies the target-external V3 owner/terminal ledger after its fence has
 * been deleted.  A receipt and phase remain mere locators: only the exact
 * pre-bound relocated namespace inode plus its canonical terminal pair
 * permits completed closeout consumption or convergence.
 */
export function assertWorkspaceWriteLeaseRetirementProof(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
  readonly proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity;
}): WorkspaceWriteLeaseRetirementReceipt {
  const receipt = validateRetirementReceipt(input.receipt);
  const proofParent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Workspace lease retirement proof parent').target;
  const workspace = inspectExactNoFollowDirectoryPresence(input.workspaceRoot, 'Workspace lease retirement proof workspace');
  if (workspace.state === 'present') {
    const live = workspace.directory.target;
    if (live.device !== receipt.workspaceDevice || live.inode !== receipt.workspaceInode ||
      physicalWorkspaceIdentityDigest(live) !== receipt.workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof workspace identity changed');
    }
    if (inspectExactNoFollowDirectoryPresence(workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Workspace lease retirement proof internal namespace').state === 'present') {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof has an unexpected internal namespace');
    }
  }
  const transition = readRetirementTransitionProof(proofParent, receipt);
  const external = inspectExactNoFollowDirectoryPresence(path.join(proofParent.path, receipt.namespaceTombstoneName), 'Workspace lease retirement proof namespace');
  if (external.state !== 'present') throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof namespace is absent');
  const topLevel = scanNoFollowDirectoryTree(proofParent)
    .filter((entry) => !entry.relativePath.includes('/'));
  const transitionName = retirementTransitionName(receipt.transitionDigest);
  const transitionEntry = topLevel.find((entry) => entry.relativePath === transitionName);
  const namespaceEntry = topLevel.find((entry) => entry.relativePath === receipt.namespaceTombstoneName);
  if (topLevel.length !== 2 || transitionEntry?.kind !== 'file' || namespaceEntry?.kind !== 'directory' ||
    namespaceEntry.device !== receipt.namespaceDevice || namespaceEntry.inode !== receipt.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof root contains an unknown or replaced entry');
  }
  assertRetirementLedgerNamespace(external.directory.target, receipt, transition);
  return receipt;
}

/**
 * Reconstructs a retirement capability only from retained no-follow facts.
 * Callers supply just the live tombstone locator and the already-durable
 * closeout intent digest; no JSON receipt supplied by a caller is trusted.
 */
export function recoverWorkspaceWriteLeaseRetirement(input: WorkspaceWriteLeaseRetirementRecoveryInput): WorkspaceWriteLeaseRetirementReceipt {
  const stableInput = snapshotRetirementRecoveryInput(input);
  const workspace = inspectNoFollowDirectoryChain(stableInput.workspaceRoot, 'Workspace lease retirement recovery workspace').target;
  const parent = inspectNoFollowDirectoryChain(retirementFenceParent(stableInput.workspaceRoot), 'Workspace lease retirement recovery parent').target;
  const proofParent = stableInput.proofParent;
  const expectedFenceName = retirementFenceName(physicalWorkspaceIdentityDigest(workspace));
  const fenceEntry = inspectNoFollowOrdinaryFileEntry(parent, expectedFenceName);
  if (fenceEntry === null || fenceEntry.kind !== 'file' || fenceEntry.bytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence is absent for this tombstone identity');
  }
  let receipt: WorkspaceWriteLeaseRetirementReceipt;
  try {
    receipt = validateRetirementReceipt(JSON.parse(Buffer.from(fenceEntry.bytes).toString('utf8')) as unknown);
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence is malformed');
  }
  if (receipt.fenceName !== expectedFenceName || receipt.intentDigest !== stableInput.intentDigest ||
    receipt.workspaceDevice !== workspace.device || receipt.workspaceInode !== workspace.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence does not bind this tombstone identity and intent');
  }
  if (physicalWorkspaceIdentityDigest(workspace) !== receipt.workspaceIdentityDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery identity digest differs from the live tombstone');
  }
  const transition = readRetirementTransitionProof(proofParent, receipt);
  if (transition.workspaceDevice !== workspace.device || transition.workspaceInode !== workspace.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition does not bind the fence identity');
  }
  const paths = workspaceWriteLeasePathsFor(stableInput.workspaceRoot);
  const namespacePresence = inspectExactNoFollowDirectoryPresence(paths.root, 'Workspace lease retirement recovery namespace');
  if (transition.namespaceTombstoneParentDevice !== proofParent.device || transition.namespaceTombstoneParentInode !== proofParent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent differs from transition');
  }
  const externalNamespacePath = path.join(proofParent.path, receipt.namespaceTombstoneName);
  let convergenceNamespace: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity | null = null;
  const externalPresence = inspectExactNoFollowDirectoryPresence(externalNamespacePath, 'Workspace lease retirement recovery external namespace');
  if (namespacePresence.state === 'present' && externalPresence.state === 'present') {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement has both internal and external namespaces');
  }
  if (namespacePresence.state === 'present') {
    const namespace = namespacePresence.directory.target;
    assertRetirementLedgerNamespace(namespace, receipt, transition);
    convergenceNamespace = relocateRetainedNoFollowDirectoryAcrossParents({
      directory: namespace, destinationParent: proofParent, tombstoneName: receipt.namespaceTombstoneName
    });
  } else if (externalPresence.state === 'present') {
    convergenceNamespace = externalPresence.directory.target;
    assertRetirementLedgerNamespace(convergenceNamespace, receipt, transition);
  } else {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof namespace is absent');
  }
  if (convergenceNamespace !== null) {
    // The proof namespace remains until terminal lifecycle completion.  Its
    // inode and ledger are the only cross-process convergence authority.
  }
  return receipt;
}

function readPreterminalRetirementReceipt(input: {
  readonly workspaceRoot: string;
  readonly intentDigest: string;
  readonly proofParent: PhysicalDirectoryIdentity;
}): WorkspaceWriteLeaseRetirementReceipt | null {
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Preterminal retirement workspace').target;
  const fenceParent = inspectNoFollowDirectoryChain(
    retirementFenceParent(input.workspaceRoot), 'Preterminal retirement fence parent'
  ).target;
  const bytes = readNoFollowOrdinaryFile(fenceParent, retirementFenceName(physicalWorkspaceIdentityDigest(workspace)));
  if (bytes === null) return null;
  let receipt: WorkspaceWriteLeaseRetirementReceipt;
  try { receipt = validateRetirementReceipt(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement fence is malformed');
  }
  if (receipt.intentDigest !== input.intentDigest || receipt.workspaceDevice !== workspace.device ||
    receipt.workspaceInode !== workspace.inode || receipt.workspaceIdentityDigest !== physicalWorkspaceIdentityDigest(workspace)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement fence does not bind the live workspace and intent');
  }
  const proofParent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Preterminal retirement proof parent').target;
  const transition = readRetirementTransitionProof(proofParent, receipt);
  const namespace = inspectNoFollowDirectoryChain(
    workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Preterminal retirement namespace'
  ).target;
  if (namespace.device !== receipt.namespaceDevice || namespace.inode !== receipt.namespaceInode ||
    namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement namespace identity changed');
  }
  return receipt;
}

/**
 * A process can die after publishing its immutable transition but before the
 * same-token fence exists.  That transition is explicitly non-authoritative:
 * while the live namespace is still the exact inode named by it, remove only
 * this verified pre-fence artifact so the canonical stale-takeover path can
 * retire afresh.  Any fence, relocated namespace, changed namespace, or
 * foreign proof-root entry fails closed rather than being swept as "stale".
 */
function discardExactPreFenceTransition(input: {
  readonly workspaceRoot: string;
  readonly intentDigest: string;
  readonly proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity;
}): void {
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Pre-fence transition workspace').target;
  const parent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Pre-fence transition proof parent').target;
  const entries = scanNoFollowDirectoryTree(parent);
  if (entries.length === 0) return;
  const transitionNamePattern = /^\.workspace-write-lease-transition-[0-9a-f]{64}\.json$/u;
  const candidateNamePattern = /^\.(\.workspace-write-lease-transition-[0-9a-f]{64}\.json)\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.candidate$/u;
  if (entries.length > 2 || entries.some((entry) => entry.kind !== 'file')) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence proof root contains unknown content');
  }
  const artifacts = entries.map((entry) => {
    const candidateMatch = entry.relativePath.match(candidateNamePattern);
    const finalName = transitionNamePattern.test(entry.relativePath) ? entry.relativePath : candidateMatch?.[1];
    if (finalName === undefined) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence proof root contains unknown content');
    }
    const bytes = readNoFollowOrdinaryFile(parent, entry.relativePath);
    if (bytes === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition disappeared');
    let transition: WorkspaceWriteLeaseRetirementTransition;
    try { transition = validateRetirementTransition(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition is malformed');
    }
    if (finalName !== retirementTransitionName(transition.transitionDigest)) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence candidate name differs from its transition');
    }
    return Object.freeze({ entry, transition, candidate: candidateMatch !== null });
  });
  const transition = artifacts[0]!.transition;
  if (artifacts.some((artifact) => !canonicalEquals(artifact.transition, transition)) ||
    (artifacts.length === 2 && (
      artifacts.filter((artifact) => artifact.candidate).length !== 1 ||
      artifacts[0]!.entry.device !== artifacts[1]!.entry.device || artifacts[0]!.entry.inode !== artifacts[1]!.entry.inode
    ))) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence publication aliases are inconsistent');
  }
  if (transition.intentDigest !== input.intentDigest || transition.workspaceDevice !== workspace.device || transition.workspaceInode !== workspace.inode ||
    physicalWorkspaceIdentityDigest(workspace) !== transition.workspaceIdentityDigest ||
    transition.namespaceTombstoneParentDevice !== parent.device || transition.namespaceTombstoneParentInode !== parent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition does not bind this live workspace');
  }
  const namespace = inspectNoFollowDirectoryChain(workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Pre-fence transition namespace').target;
  if (namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence namespace identity changed');
  }
  const expected = new Map(transition.namespaceEntries.map((entry) => [entry.relativePath, entry]));
  const terminalPath = generationTerminalPath('', transition.token.generation);
  if (scanNoFollowDirectoryTree(namespace).some((entry) => {
    const prior = expected.get(entry.relativePath);
    return (entry.relativePath !== terminalPath && prior === undefined) ||
      (prior !== undefined && (prior.kind !== entry.kind || prior.device !== entry.device || prior.inode !== entry.inode || prior.size !== entry.size || prior.bytes !== (entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex'))));
  })) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence namespace is not an expected transition subset');
  }
  for (const artifact of [...artifacts].sort((left, right) => Number(right.candidate) - Number(left.candidate))) {
    deleteRetainedNoFollowEntry({
      root: parent, relativePath: artifact.entry.relativePath, kind: 'file',
      device: artifact.entry.device, inode: artifact.entry.inode, ancestorDirectories: []
    });
  }
}

/**
 * Continues the single lease-owner retirement transition across its two
 * publication crash windows.  This is deliberately the only durable resume
 * entrypoint: it accepts a locator and intent digest, rederives all remaining
 * authority from the canonical lease ledger/fence, and never accepts a caller
 * supplied receipt or namespace list.
 */
export async function resumeWorkspaceWriteLeaseRetirement(input: WorkspaceWriteLeaseRetirementRecoveryInput): Promise<WorkspaceWriteLeaseRetirementReceipt> {
  const stableInput = snapshotRetirementRecoveryInput(input);
  try {
    const recovered = recoverWorkspaceWriteLeaseRetirement(stableInput);
    return recovered;
  } catch (error) {
    if (!(error instanceof WorkspaceWriteLeaseError) || error.code !== 'WORKSPACE-WRITE-LEASE-003') throw error;
  }
  const preterminal = readPreterminalRetirementReceipt(stableInput);
  if (preterminal !== null) {
    try {
      const unexpected = await acquireWorkspaceWriteLease(stableInput.workspaceRoot, {
        [RETIREMENT_RECOVERY_ACQUIRE]: preterminal
      } as InternalWorkspaceWriteLeaseAcquireOptions);
      await unexpected.release().catch(() => undefined);
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement recovery unexpectedly acquired a successor generation');
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseRetirementRecoveryReady &&
        error.receipt.retirementDigest === preterminal.retirementDigest) {
        return recoverWorkspaceWriteLeaseRetirement(stableInput);
      }
      throw error;
    }
  }
  discardExactPreFenceTransition(stableInput);
  // No valid completed fence: only an intact canonical active lease can
  // continue the transition.  `acquire` verifies the ledger and refuses live,
  // foreign, malformed, or unknown owner states; it is not a JSON authority.
  const lease = await acquireWorkspaceWriteLease(stableInput.workspaceRoot);
  try {
    await lease.assertOwned();
    return await lease.retireOwnedNamespace(stableInput.intentDigest, stableInput.proofParent);
  } finally {
    await lease.release().catch(() => undefined);
  }
}

export function completeWorkspaceWriteLeaseRetirement(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
}): void {
  // Normal callers complete before deleting their root; closeout deliberately
  // completes the external fence after durable absence readback.  In that
  // terminal shape the root cannot be reopened, so validate the receipt and
  // retained same-parent fence directly, while requiring literal ENOENT for
  // the former root.  Any reappearance remains a hard failure.
  let validated: Readonly<{ parent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity; entry: import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry }>;
  const presence = inspectExactNoFollowDirectoryPresence(input.workspaceRoot, 'Workspace lease retirement completion workspace');
  if (presence.state === 'present') {
    validated = assertWorkspaceWriteLeaseRetirement(input);
  } else {
    const receipt = validateRetirementReceipt(input.receipt);
    const parent = inspectNoFollowDirectoryChain(retirementFenceParent(input.workspaceRoot), 'Workspace lease retirement completion parent').target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, receipt.fenceName);
    if (entry === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence is absent');
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence changed');
    }
    const bytes = entry.bytes;
    let current: unknown;
    try { current = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; } catch {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence is malformed');
    }
    const currentReceipt = validateRetirementReceipt(current);
    if (!canonicalEquals(currentReceipt, receipt)) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence differs from receipt');
    validated = Object.freeze({ parent, entry });
  }
  deleteRetainedNoFollowEntry({
    root: validated.parent, relativePath: validated.entry.relativePath, kind: 'file',
    device: validated.entry.device, inode: validated.entry.inode, ancestorDirectories: []
  });
}

async function ensureProtocolRoot(
  paths: WorkspaceWriteLeasePaths,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary'],
  createId: () => string
): Promise<void> {
  try {
    await fs.mkdir(paths.root);
  } catch (error) {
    if (!isExistsError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease protocol root could not be created'
      );
    }
  }

  let rootMetadata;
  try {
    rootMetadata = await fs.lstat(paths.root);
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol root could not be inspected'
    );
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root is incompatible'
    );
  }
  await assertNoLegacyOwner(paths.root);

  try {
    await fs.mkdir(paths.holders);
  } catch (error) {
    if (!isExistsError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease holder root could not be created'
      );
    }
  }
  await assertProtocolDirectory(paths.parent, paths.root, paths.holders, executionBoundary);

  const protocolPath = path.join(paths.root, PROTOCOL_FILE);
  const protocol = Object.freeze({ formatVersion: WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION });
  await publishImmutableJsonNoReplace(
    paths.holders,
    paths.root,
    protocolPath,
    'protocol',
    protocol,
    createId
  );
  await convergeProtocolMarkerAlias(paths, protocolPath);
  await verifyProtocolRoot(paths, executionBoundary);
}

async function assertNoLegacyOwner(root: string): Promise<void> {
  try {
    await fs.lstat(path.join(root, LEGACY_OWNER_FILE));
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Legacy workspace writer lease requires proven quiescence before migration',
      { reason: 'legacy-v1-owner' }
    );
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    if (!isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Legacy workspace writer lease state could not be classified'
      );
    }
  }
}

async function assertProtocolMarker(protocolPath: string): Promise<void> {
  const existing = await readJsonValue(protocolPath);
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing) ||
    !exactKeys(existing, ['formatVersion']) ||
    (existing as Record<string, unknown>).formatVersion !== WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker is invalid'
    );
  }
}

async function readProtocolMarkerMetadata(protocolPath: string) {
  await assertProtocolMarker(protocolPath);
  try {
    const metadata = await fs.lstat(protocolPath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol marker is noncanonical'
      );
    }
    return metadata;
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol marker could not be inspected'
    );
  }
}

async function sameIdentityEntries(
  directory: string,
  targetMetadata: { readonly dev: bigint | number; readonly ino: bigint | number }
): Promise<readonly Readonly<{
  name: string;
  path: string;
  metadata: Awaited<ReturnType<typeof fs.lstat>>;
}>[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol aliases could not be enumerated'
    );
  }
  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    try {
      const metadata = await fs.lstat(entryPath, { bigint: true });
      if (sameFileIdentity(metadata, targetMetadata)) {
        matches.push(Object.freeze({ name: entry.name, path: entryPath, metadata }));
      }
    } catch (error) {
      if (isMissingError(error)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease protocol alias topology changed during inspection'
        );
      }
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease protocol alias could not be inspected'
      );
    }
  }
  return Object.freeze(matches);
}

async function inspectProtocolMarkerAlias(
  paths: WorkspaceWriteLeasePaths,
  protocolPath: string
): Promise<Readonly<{
  marker: Awaited<ReturnType<typeof readProtocolMarkerMetadata>>;
  alias: Awaited<ReturnType<typeof sameIdentityEntries>>[number] | null;
}>> {
  const initialMarker = await readProtocolMarkerMetadata(protocolPath);
  if (initialMarker.nlink === 1n) {
    return Object.freeze({ marker: initialMarker, alias: null });
  }
  if (initialMarker.nlink !== 2n) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker link topology is not recoverable'
    );
  }

  const initialAliases = await sameIdentityEntries(paths.holders, initialMarker);
  if (initialAliases.length !== 1) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker alias is not uniquely recoverable'
    );
  }
  const [initialAlias] = initialAliases;
  if (!initialAlias || !PROTOCOL_CANDIDATE_PATTERN.test(initialAlias.name) ||
    !initialAlias.metadata.isFile() || initialAlias.metadata.isSymbolicLink() ||
    initialAlias.metadata.nlink !== 2n) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker alias is noncanonical'
    );
  }
  return Object.freeze({ marker: initialMarker, alias: initialAlias });
}

async function convergeProtocolMarkerAlias(
  paths: WorkspaceWriteLeasePaths,
  protocolPath: string
): Promise<void> {
  const inspected = await inspectProtocolMarkerAlias(paths, protocolPath);
  if (inspected.alias === null) return;
  const initialMarker = inspected.marker;
  const initialAlias = inspected.alias;
  await assertProtocolMarker(protocolPath);
  let markerBeforeUnlink;
  let aliasBeforeUnlink;
  try {
    [markerBeforeUnlink, aliasBeforeUnlink] = await Promise.all([
      fs.lstat(protocolPath, { bigint: true }),
      fs.lstat(initialAlias.path, { bigint: true })
    ]);
  } catch (error) {
    if (isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol alias topology changed before recovery'
      );
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias could not be re-inspected'
    );
  }
  if (!markerBeforeUnlink.isFile() || markerBeforeUnlink.isSymbolicLink() ||
    !aliasBeforeUnlink.isFile() || aliasBeforeUnlink.isSymbolicLink() ||
    markerBeforeUnlink.nlink !== 2n || aliasBeforeUnlink.nlink !== 2n ||
    !sameFileIdentity(markerBeforeUnlink, initialMarker) ||
    !sameFileIdentity(aliasBeforeUnlink, initialMarker)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol alias identity changed before recovery'
    );
  }

  try {
    await fs.unlink(initialAlias.path);
  } catch (error) {
    if (isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol alias changed during recovery'
      );
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias could not be removed'
    );
  }
  try {
    await fsyncDirectory(paths.holders);
    await fsyncDirectory(paths.root);
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias recovery could not be persisted'
    );
  }

  const finalMarker = await readProtocolMarkerMetadata(protocolPath);
  if (finalMarker.nlink !== 1n || !sameFileIdentity(finalMarker, initialMarker)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker did not converge'
    );
  }
}

async function verifyProtocolRoot(
  paths: WorkspaceWriteLeasePaths,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
): Promise<void> {
  await assertProtocolDirectory(paths.parent, paths.root, paths.holders, executionBoundary);
  await assertNoLegacyOwner(paths.root);
  await assertProtocolMarker(path.join(paths.root, PROTOCOL_FILE));
}

function generationFromMatch(match: RegExpMatchArray): number {
  const generation = Number(match[1]);
  if (!positiveSafeInteger(generation) || generationStem(generation) !== match[1]) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation record is noncanonical'
    );
  }
  return generation;
}

async function readInventory(root: string): Promise<WorkspaceWriteLeaseInventory> {
  const ownerGenerations: number[] = [];
  const terminalGenerations = new Set<number>();
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === PROTOCOL_FILE) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease protocol marker is noncanonical'
        );
      }
      continue;
    }
    if (entry.name === HOLDERS_DIRECTORY) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease holder root is noncanonical'
        );
      }
      continue;
    }
    const ownerMatch = entry.name.match(OWNER_GENERATION_PATTERN);
    if (ownerMatch) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease owner generation is noncanonical'
        );
      }
      ownerGenerations.push(generationFromMatch(ownerMatch));
      continue;
    }
    const terminalMatch = entry.name.match(TERMINAL_GENERATION_PATTERN);
    if (terminalMatch) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal generation is noncanonical'
        );
      }
      terminalGenerations.add(generationFromMatch(terminalMatch));
      continue;
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root contains an unknown record'
    );
  }
  ownerGenerations.sort((left, right) => left - right);
  if (new Set(ownerGenerations).size !== ownerGenerations.length ||
    [...terminalGenerations].some((generation) => !ownerGenerations.includes(generation))) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation ledger is inconsistent'
    );
  }
  return Object.freeze({
    ownerGenerations: Object.freeze(ownerGenerations),
    terminalGenerations,
    highestGeneration: ownerGenerations.at(-1)
  });
}

async function readGenerationState(
  root: string,
  generation: number
): Promise<WorkspaceWriteLeaseGenerationState> {
  const ownerPath = generationOwnerPath(root, generation);
  const [owner, ownerMetadata, terminal] = await Promise.all([
    readOwner(ownerPath),
    fs.lstat(ownerPath, { bigint: true }),
    readOptionalTerminal(generationTerminalPath(root, generation))
  ]);
  if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease owner generation is not a regular file'
    );
  }
  const identity = ownerFileIdentity(ownerMetadata);
  const token = tokenFromOwner(owner);
  if (owner.generation !== generation || owner.ownerFileIdentityDigest !== identity ||
    (terminal && !sameToken(terminal.token, token))) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease generation identity is inconsistent'
    );
  }
  return Object.freeze({
    owner,
    ownerFileIdentityDigest: identity,
    ownerLinkCount: Number(ownerMetadata.nlink),
    terminal
  });
}

async function readBoundHeartbeat(
  paths: WorkspaceWriteLeasePaths,
  state: WorkspaceWriteLeaseGenerationState
): Promise<WorkspaceWriteLeaseHeartbeat> {
  const token = tokenFromOwner(state.owner);
  const holder = holderDirectory(paths.holders, token);
  const holderOwnerPath = path.join(holder, OWNER_FILE);
  const [holderMetadata, holderOwner, holderOwnerMetadata, heartbeat] = await Promise.all([
    fs.lstat(holder),
    readOwner(holderOwnerPath),
    fs.lstat(holderOwnerPath, { bigint: true }),
    readHeartbeat(path.join(holder, HEARTBEAT_FILE))
  ]);
  if (!holderMetadata.isDirectory() || holderMetadata.isSymbolicLink() ||
    !holderOwnerMetadata.isFile() || holderOwnerMetadata.isSymbolicLink() ||
    ownerFileIdentity(holderOwnerMetadata) !== state.ownerFileIdentityDigest ||
    !sameToken(tokenFromOwner(holderOwner), token) ||
    !sameToken(heartbeat.token, token) ||
    heartbeat.heartbeatAtMs < state.owner.createdAtMs) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease holder state is inconsistent'
    );
  }
  return heartbeat;
}

async function readBoundHeartbeatUnlessTerminalized(
  paths: WorkspaceWriteLeasePaths,
  state: WorkspaceWriteLeaseGenerationState
): Promise<WorkspaceWriteLeaseHeartbeat | null> {
  try {
    return await readBoundHeartbeat(paths, state);
  } catch (error) {
    const inventory = await readInventory(paths.root);
    if (inventory.terminalGenerations.has(state.owner.generation)) return null;
    throw error;
  }
}

export async function inspectWorkspaceWriteLease(
  workspaceRoot: string
): Promise<WorkspaceWriteLeaseInspection> {
  const workspaceIdentityDigest = await workspaceIdentity(workspaceRoot);
  const paths = workspaceWriteLeasePathsFor(workspaceRoot);
  await assertLeaseParent(workspaceRoot, paths.parent);
  await verifyProtocolRoot(paths, undefined);
  const protocolPath = path.join(paths.root, PROTOCOL_FILE);
  const protocol = await inspectProtocolMarkerAlias(paths, protocolPath);
  const inventory = await readInventory(paths.root);
  const authorityPaths = new Set<string>([paths.root, paths.holders, protocolPath]);
  if (protocol.alias !== null) authorityPaths.add(protocol.alias.path);
  const generationSummaries: Array<Readonly<Record<string, unknown>>> = [];
  let activeGeneration: number | null = null;

  for (const generation of inventory.ownerGenerations) {
    const state = await readGenerationState(paths.root, generation);
    if (state.owner.workspaceIdentityDigest !== workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease generation targets a different workspace'
      );
    }
    const ownerPath = generationOwnerPath(paths.root, generation);
    authorityPaths.add(ownerPath);
    let heartbeat: WorkspaceWriteLeaseHeartbeat | null = null;
    if (state.terminal === null) {
      if (generation !== inventory.highestGeneration || activeGeneration !== null ||
        state.ownerLinkCount !== 2) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease active generation topology is inconsistent'
        );
      }
      activeGeneration = generation;
      heartbeat = await readBoundHeartbeat(paths, state);
    } else if (state.ownerLinkCount === 2) {
      heartbeat = await readBoundHeartbeat(paths, state);
    } else if (state.ownerLinkCount !== 1) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease terminalized owner topology is inconsistent'
      );
    }

    if (state.ownerLinkCount === 2) {
      const holder = holderDirectory(paths.holders, tokenFromOwner(state.owner));
      authorityPaths.add(holder);
      authorityPaths.add(path.join(holder, OWNER_FILE));
      authorityPaths.add(path.join(holder, HEARTBEAT_FILE));
    }

    let terminalLinkCount: number | null = null;
    let terminalAlias: string | null = null;
    if (state.terminal !== null) {
      const terminalPath = generationTerminalPath(paths.root, generation);
      authorityPaths.add(terminalPath);
      const terminalMetadata = await fs.lstat(terminalPath, { bigint: true });
      if (!terminalMetadata.isFile() || terminalMetadata.isSymbolicLink() ||
        (terminalMetadata.nlink !== 1n && terminalMetadata.nlink !== 2n)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal publication topology is inconsistent'
        );
      }
      terminalLinkCount = Number(terminalMetadata.nlink);
      if (terminalMetadata.nlink === 2n) {
        const aliases = await sameIdentityEntries(paths.holders, terminalMetadata);
        if (aliases.length !== 1 || !aliases[0] ||
          !TERMINAL_CANDIDATE_PATTERN.test(aliases[0].name) ||
          !aliases[0].metadata.isFile() || aliases[0].metadata.isSymbolicLink() ||
          aliases[0].metadata.nlink !== 2n) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-003',
            'Workspace writer lease terminal publication alias is not canonical'
          );
        }
        terminalAlias = aliases[0].name;
        authorityPaths.add(aliases[0].path);
      }
    }

    generationSummaries.push(Object.freeze({
      generation,
      owner: state.owner,
      ownerLinkCount: state.ownerLinkCount,
      heartbeat,
      terminal: state.terminal,
      terminalLinkCount,
      terminalAlias
    }));
  }

  const terminalGenerations = Object.freeze([...inventory.terminalGenerations].sort(
    (left, right) => left - right
  ));
  const sortedAuthorityPaths = Object.freeze([...authorityPaths].sort());
  const stateDigest = sha256({
    domain: WORKSPACE_WRITE_LEASE_INSPECTION_VERSION,
    workspaceIdentityDigest,
    protocol: {
      identity: ownerFileIdentity(protocol.marker),
      linkCount: Number(protocol.marker.nlink),
      alias: protocol.alias?.name ?? null
    },
    generations: generationSummaries
  });
  return Object.freeze({
    formatVersion: WORKSPACE_WRITE_LEASE_INSPECTION_VERSION,
    protocolRoot: paths.root,
    state: activeGeneration === null ? 'quiescent' : 'active',
    activeGeneration,
    ownerGenerations: inventory.ownerGenerations,
    terminalGenerations,
    authorityPaths: sortedAuthorityPaths,
    stateDigest
  });
}

async function prepareLease(
  paths: WorkspaceWriteLeasePaths,
  workspaceIdentityDigest: string,
  generation: number,
  leaseId: string,
  hostname: string,
  pid: number,
  processNonce: string,
  timestamp: number
): Promise<PreparedWorkspaceWriteLease> {
  const provisional = { generation, leaseId };
  const holder = holderDirectory(paths.holders, provisional);
  await fs.mkdir(holder);
  const ownerPath = path.join(holder, OWNER_FILE);
  let ownerHandle;
  try {
    ownerHandle = await fs.open(ownerPath, 'wx');
    const ownerMetadata = await ownerHandle.stat({ bigint: true });
    const token: WorkspaceWriteLeaseToken = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
      workspaceIdentityDigest,
      generation,
      ownerFileIdentityDigest: ownerFileIdentity(ownerMetadata),
      hostname,
      pid,
      processNonce,
      leaseId
    });
    const owner: WorkspaceWriteLeaseOwner = Object.freeze({ ...token, createdAtMs: timestamp });
    const heartbeat: WorkspaceWriteLeaseHeartbeat = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION,
      token,
      heartbeatAtMs: timestamp
    });
    await ownerHandle.writeFile(jsonFile(owner), 'utf8');
    await ownerHandle.sync();
    await ownerHandle.close();
    ownerHandle = undefined;
    const heartbeatHandle = await fs.open(path.join(holder, HEARTBEAT_FILE), 'wx');
    try {
      await heartbeatHandle.writeFile(jsonFile(heartbeat), 'utf8');
      await heartbeatHandle.sync();
    } finally {
      await heartbeatHandle.close();
    }
    await fsyncDirectory(holder);
    await fsyncDirectory(paths.holders);
    return Object.freeze({ holder, ownerPath, owner, token });
  } catch (error) {
    await ownerHandle?.close().catch(() => undefined);
    await fs.rm(holder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function createWorkspaceWriteLeaseManager(
  options: WorkspaceWriteLeaseManagerOptions = {}
): WorkspaceWriteLeaseManager {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const hostname = options.hostname ?? os.hostname();
  const pid = options.pid ?? process.pid;
  const processNonce = options.processNonce ?? PROCESS_NONCE;
  const nowCapability = options.now ?? Date.now;
  const createIdCapability = options.createId ?? randomUUID;
  const processAliveCapability = options.processAlive ?? defaultProcessAlive;
  const createId = (): string => {
    let value: unknown;
    try {
      value = createIdCapability();
    } catch (error) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease identity generation failed',
        { systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN' }
      );
    }
    if (!nonEmpty(value) || value.length > MAX_LEASE_ID_LENGTH) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease identity generation returned an invalid value'
      );
    }
    return value;
  };
  const processAlive = (observedPid: number): 'alive' | 'dead' | 'unknown' => {
    try {
      const observed = processAliveCapability(observedPid);
      return observed === 'alive' || observed === 'dead' || observed === 'unknown'
        ? observed
        : 'unknown';
    } catch {
      return 'unknown';
    }
  };
  const ownerPublicationDirectorySync =
    options.ownerPublicationDirectorySync ?? fsyncDirectory;
  const controlPlaneTails = new Map<string, Promise<void>>();
  const activeLeaseKeys = new Set<string>();
  const activeLeaseBoundaries = new Map<
    string,
    WorkspaceWriteLeaseAcquireOptions['executionBoundary']
  >();
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 ||
    !Number.isSafeInteger(staleAfterMs) || staleAfterMs <= heartbeatIntervalMs ||
    !nonEmpty(hostname) || !safeInteger(pid) || !nonEmpty(processNonce)) {
    throw new Error('Workspace write lease manager options are invalid');
  }
  const currentTime = (): number => {
    let value: number;
    try {
      value = nowCapability();
    } catch (error) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease clock observation failed',
        { systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN' }
      );
    }
    if (!safeInteger(value)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease clock is invalid'
      );
    }
    return value;
  };

  const pathsFor = workspaceWriteLeasePathsFor;

  const assertManagerHolder = (token: WorkspaceWriteLeaseToken): void => {
    if (token.hostname !== hostname || token.pid !== pid || token.processNonce !== processNonce) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token belongs to a different process holder'
      );
    }
  };

  const tokenKey = (token: WorkspaceWriteLeaseToken): string => JSON.stringify(token);

  const assertActiveLease = (token: WorkspaceWriteLeaseToken): void => {
    assertManagerHolder(token);
    if (!activeLeaseKeys.has(tokenKey(token))) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is not active in this manager'
      );
    }
  };

  const withControlPlaneLock = async <Value>(
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value> => {
    const key = tokenKey(token);
    const previous = controlPlaneTails.get(key) ?? Promise.resolve();
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const current = previous.then(() => gate);
    controlPlaneTails.set(key, current);
    await previous;
    try {
      return await execute();
    } finally {
      releaseGate?.();
      if (controlPlaneTails.get(key) === current) controlPlaneTails.delete(key);
    }
  };

  const ensureRoot = async (
    workspaceRoot: string,
    executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
  ): Promise<WorkspaceWriteLeasePaths> => {
    const paths = pathsFor(workspaceRoot);
    await ensureDir(paths.parent);
    await assertLeaseParent(workspaceRoot, paths.parent, executionBoundary);
    await ensureProtocolRoot(paths, executionBoundary, createId);
    return paths;
  };

  const assertOwnedNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary'] =
      activeLeaseBoundaries.get(tokenKey(token))
  ): Promise<void> => {
    if (!tokenLooksValid(token)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is invalid'
      );
    }
    const expectedWorkspace = await workspaceIdentity(workspaceRoot, executionBoundary).catch(() => '');
    if (expectedWorkspace !== token.workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token targets a different workspace'
      );
    }
    const paths = pathsFor(workspaceRoot);
    await assertLeaseParent(workspaceRoot, paths.parent, executionBoundary);
    await verifyProtocolRoot(paths, executionBoundary);
    const firstInventory = await readInventory(paths.root);
    if (firstInventory.highestGeneration !== token.generation ||
      firstInventory.terminalGenerations.has(token.generation)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is not the active generation'
      );
    }
    const state = await readGenerationState(paths.root, token.generation);
    if (!sameToken(tokenFromOwner(state.owner), token) ||
      state.ownerFileIdentityDigest !== token.ownerFileIdentityDigest ||
      state.ownerLinkCount !== 2 || state.terminal) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token no longer owns the active generation'
      );
    }
    await readBoundHeartbeat(paths, state);
    const finalInventory = await readInventory(paths.root);
    if (finalInventory.highestGeneration !== token.generation ||
      finalInventory.terminalGenerations.has(token.generation)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease generation changed during ownership proof'
      );
    }
  };

  const assertOwned = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      await assertOwnedNative(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease ownership could not be proven'
      );
    }
  };

  const heartbeatNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    await assertOwned(workspaceRoot, token);
    const paths = pathsFor(workspaceRoot);
    const state = await readGenerationState(paths.root, token.generation);
    const previous = await readBoundHeartbeat(paths, state);
    const updated: WorkspaceWriteLeaseHeartbeat = Object.freeze({
      ...previous,
      heartbeatAtMs: Math.max(previous.heartbeatAtMs, currentTime())
    });
    await replaceHeartbeat(holderDirectory(paths.holders, token), updated, createId);
    await assertOwned(workspaceRoot, token);
  };

  const heartbeat = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      assertActiveLease(token);
      await withControlPlaneLock(token, () => heartbeatNative(workspaceRoot, token));
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease heartbeat failed'
      );
    }
  };

  const assertCanonicalControlPlane = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      await assertOwned(workspaceRoot, token);
      const paths = pathsFor(workspaceRoot);
      const holder = holderDirectory(paths.holders, token);
      const [protocolMetadata, ownerMetadata, heartbeatMetadata, children] = await Promise.all([
        fs.lstat(path.join(paths.root, PROTOCOL_FILE), { bigint: true }),
        fs.lstat(path.join(holder, OWNER_FILE), { bigint: true }),
        fs.lstat(path.join(holder, HEARTBEAT_FILE), { bigint: true }),
        fs.readdir(holder)
      ]);
      if (!protocolMetadata.isFile() || protocolMetadata.isSymbolicLink() ||
        Number(protocolMetadata.nlink) !== 1 ||
        !ownerMetadata.isFile() || ownerMetadata.isSymbolicLink() ||
        Number(ownerMetadata.nlink) !== 2 ||
        !heartbeatMetadata.isFile() || heartbeatMetadata.isSymbolicLink() ||
        Number(heartbeatMetadata.nlink) !== 1 ||
        !canonicalEquals(children.sort(), [HEARTBEAT_FILE, OWNER_FILE].sort())) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-002',
          'Workspace writer lease control plane is not canonical'
        );
      }
      await assertOwned(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease control plane could not be proven'
      );
    }
  };

  const withControlPlaneQuiesced = async <Value>(
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value> => {
    assertActiveLease(token);
    return withControlPlaneLock(token, async () => {
      await assertCanonicalControlPlane(workspaceRoot, token);
      try {
        const result = await execute();
        await assertCanonicalControlPlane(workspaceRoot, token);
        return result;
      } catch (error) {
        await assertCanonicalControlPlane(workspaceRoot, token);
        throw error;
      }
    });
  };

  const publishTerminal = async (
    paths: WorkspaceWriteLeasePaths,
    token: WorkspaceWriteLeaseToken,
    outcome: WorkspaceWriteLeaseTerminal['outcome']
  ): Promise<void> => {
    const terminal: WorkspaceWriteLeaseTerminal = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_TERMINAL_VERSION,
      token,
      outcome,
      terminalAtMs: currentTime()
    });
    const target = generationTerminalPath(paths.root, token.generation);
    const published = await publishImmutableJsonNoReplace(
      paths.holders,
      paths.root,
      target,
      'terminal',
      terminal,
      createId
    );
    if (!published) {
      const existing = await readOptionalTerminal(target);
      if (!existing || !sameToken(existing.token, token)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal identity conflicts with its generation'
        );
      }
    }
    await fs.rm(holderDirectory(paths.holders, token), { recursive: true, force: true })
      .catch(() => undefined);
    await fsyncDirectory(paths.holders).catch(() => undefined);
  };

  const terminalizeStaleGeneration = async (
    paths: WorkspaceWriteLeasePaths,
    generation: number
  ): Promise<boolean> => {
    const initialInventory = await readInventory(paths.root);
    if (initialInventory.highestGeneration !== generation) return true;
    if (initialInventory.terminalGenerations.has(generation)) return true;
    const initialState = await readGenerationState(paths.root, generation);
    if (initialState.terminal) return true;
    const initialHeartbeat = await readBoundHeartbeatUnlessTerminalized(paths, initialState);
    if (!initialHeartbeat) return true;
    if (initialState.owner.hostname !== hostname) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Foreign workspace writer lease cannot be reclaimed automatically'
      );
    }
    const age = currentTime() - initialHeartbeat.heartbeatAtMs;
    if (age <= staleAfterMs) return false;
    const initialLiveness = processAlive(initialState.owner.pid);
    if (initialLiveness === 'alive') return false;
    if (initialLiveness !== 'dead') {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease holder liveness is unknown'
      );
    }

    const finalInventory = await readInventory(paths.root);
    if (finalInventory.highestGeneration !== generation) return true;
    if (finalInventory.terminalGenerations.has(generation)) return true;
    const finalState = await readGenerationState(paths.root, generation);
    if (finalState.terminal) return true;
    const finalHeartbeat = await readBoundHeartbeatUnlessTerminalized(paths, finalState);
    if (!finalHeartbeat) return true;
    if (!sameToken(tokenFromOwner(initialState.owner), tokenFromOwner(finalState.owner)) ||
      initialState.ownerFileIdentityDigest !== finalState.ownerFileIdentityDigest ||
      !sameHeartbeat(initialHeartbeat, finalHeartbeat)) {
      return false;
    }
    const finalLiveness = processAlive(finalState.owner.pid);
    if (finalLiveness === 'alive') return false;
    if (finalLiveness !== 'dead') {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease holder liveness changed to unknown'
      );
    }
    await publishTerminal(paths, tokenFromOwner(finalState.owner), 'recovered');
    return true;
  };

  const reclaimTerminalHolderResidue = async (
    paths: WorkspaceWriteLeasePaths,
    generation: number,
    receipt?: WorkspaceWriteLeaseRetirementReceipt
  ): Promise<boolean> => {
    const initialInventory = await readInventory(paths.root);
    if (initialInventory.highestGeneration !== generation ||
      !initialInventory.terminalGenerations.has(generation)) return false;
    const initialState = await readGenerationState(paths.root, generation);
    const token = tokenFromOwner(initialState.owner);
    if (initialState.terminal === null || (receipt !== undefined && (
      receipt.tokenGeneration !== generation ||
      initialState.ownerFileIdentityDigest !== receipt.ownerFileIdentityDigest ||
      retirementTerminalTokenDigest(token) !== receipt.terminalDigest
    ))) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease retirement terminal holder does not bind its recovery receipt'
      );
    }
    const holder = holderDirectory(paths.holders, token);
    let initialHeartbeat: WorkspaceWriteLeaseHeartbeat;
    try {
      initialHeartbeat = await readBoundHeartbeat(paths, initialState);
    } catch (error) {
      try { await fs.lstat(holder); } catch (presenceError) {
        if (isMissingError(presenceError)) return true;
        throw presenceError;
      }
      throw error;
    }
    if (initialState.owner.hostname !== hostname) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Foreign workspace writer lease terminal holder cannot be reclaimed automatically'
      );
    }
    const initialLiveness = processAlive(initialState.owner.pid);
    if (currentTime() - initialHeartbeat.heartbeatAtMs <= staleAfterMs || initialLiveness === 'alive') return false;
    if (initialLiveness !== 'dead') {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease terminal holder liveness is unknown'
      );
    }

    const finalInventory = await readInventory(paths.root);
    if (finalInventory.highestGeneration !== generation ||
      !finalInventory.terminalGenerations.has(generation)) return false;
    const finalState = await readGenerationState(paths.root, generation);
    if (finalState.terminal === null || !sameToken(tokenFromOwner(finalState.owner), token) ||
      finalState.ownerFileIdentityDigest !== initialState.ownerFileIdentityDigest) return false;
    let finalHeartbeat: WorkspaceWriteLeaseHeartbeat;
    try {
      finalHeartbeat = await readBoundHeartbeat(paths, finalState);
    } catch (error) {
      try { await fs.lstat(holder); } catch (presenceError) {
        if (isMissingError(presenceError)) return true;
        throw presenceError;
      }
      throw error;
    }
    const finalLiveness = processAlive(finalState.owner.pid);
    if (!sameHeartbeat(initialHeartbeat, finalHeartbeat) || finalLiveness === 'alive') return false;
    if (finalLiveness !== 'dead') {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease terminal holder liveness changed to unknown'
      );
    }
    // `publishTerminal` revalidates the existing terminal's exact token before
    // deleting the holder.  A public same-token terminal therefore cannot
    // reclaim a live or fresh owner; only the canonical stale/dead path can.
    await publishTerminal(paths, token, 'recovered');
    return true;
  };

  const acquireNative = async (
    workspaceRoot: string,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions
  ): Promise<WorkspaceWriteLeaseHandle> => {
    const executionBoundary = acquireOptions.executionBoundary;
    const workspaceIdentityDigest = await workspaceIdentity(workspaceRoot, executionBoundary).catch(
      (error: unknown) => {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace identity could not be proven',
          {
            operation: 'acquire',
            phase: 'workspace-identity',
            reason: workspaceIdentityFailureReason(error),
            systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN'
          }
        );
      }
    );
    let fenceParent: PhysicalDirectoryIdentity;
    let retirementFenceBytes: Uint8Array | null;
    try {
      fenceParent = inspectNoFollowDirectoryChain(retirementFenceParent(workspaceRoot), 'Workspace writer lease fence parent').target;
      retirementFenceBytes = readNoFollowOrdinaryFile(fenceParent, retirementFenceName(workspaceIdentityDigest));
    } catch (error) {
      throw acquisitionPhaseFailure(
        'retirement-fence-observation',
        error,
        'Workspace writer lease retirement fence could not be observed'
      );
    }
    const recoveryReceipt = (acquireOptions as InternalWorkspaceWriteLeaseAcquireOptions)[RETIREMENT_RECOVERY_ACQUIRE];
    if (retirementFenceBytes !== null) {
      let observed: WorkspaceWriteLeaseRetirementReceipt | null = null;
      try { observed = validateRetirementReceipt(JSON.parse(Buffer.from(retirementFenceBytes).toString('utf8')) as unknown); } catch { /* ordinary acquisition fails below */ }
      if (recoveryReceipt === undefined || observed === null ||
        observed.retirementDigest !== recoveryReceipt.retirementDigest ||
        observed.workspaceIdentityDigest !== workspaceIdentityDigest || !canonicalEquals(observed, recoveryReceipt)) {
        throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease identity is terminally retired');
      }
    }
    let paths: WorkspaceWriteLeasePaths;
    try {
      paths = await ensureRoot(workspaceRoot, executionBoundary);
    } catch (error) {
      throw acquisitionPhaseFailure(
        'lease-root-initialization',
        error,
        'Workspace writer lease root could not be initialized'
      );
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      let inventory: WorkspaceWriteLeaseInventory;
      try {
        inventory = await readInventory(paths.root);
      } catch (error) {
        throw acquisitionPhaseFailure(
          'lease-inventory',
          error,
          'Workspace writer lease inventory could not be observed'
        );
      }
      if (recoveryReceipt !== undefined && inventory.highestGeneration !== recoveryReceipt.tokenGeneration) {
        throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery generation changed');
      }
      if (inventory.highestGeneration !== undefined) {
        if (inventory.terminalGenerations.has(inventory.highestGeneration)) {
          const reclaimed = await reclaimTerminalHolderResidue(
            paths,
            inventory.highestGeneration,
            recoveryReceipt
          );
          if (reclaimed && recoveryReceipt !== undefined) {
            throw new WorkspaceWriteLeaseRetirementRecoveryReady(recoveryReceipt);
          }
          if (!reclaimed) {
            throw new WorkspaceWriteLeaseError(
              'WORKSPACE-WRITE-LEASE-001',
              'Workspace writer lease terminal holder is still live',
              { retryable: true }
            );
          }
        }
        if (recoveryReceipt !== undefined && inventory.terminalGenerations.has(recoveryReceipt.tokenGeneration)) {
          // The branch above either converged this exact highest generation or
          // failed closed.  Reaching here means the inventory changed and must
          // be re-read on the next bounded attempt.
          continue;
        }
        const highestState = await readGenerationState(paths.root, inventory.highestGeneration);
        if (!highestState.terminal) {
          const reclaimed = await terminalizeStaleGeneration(paths, inventory.highestGeneration);
          if (reclaimed) {
            if (recoveryReceipt !== undefined && inventory.highestGeneration === recoveryReceipt.tokenGeneration) {
              throw new WorkspaceWriteLeaseRetirementRecoveryReady(recoveryReceipt);
            }
            continue;
          }
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-001',
            'Workspace writer lease is already held',
            { retryable: true }
          );
        }
      }

      const generation = (inventory.highestGeneration ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease generation space is exhausted'
        );
      }
      let leaseId: string;
      try {
        leaseId = createId();
      } catch (error) {
        throw acquisitionPhaseFailure(
          'owner-preparation',
          error,
          'Workspace writer lease owner preparation failed'
        );
      }
      let timestamp: number;
      try {
        timestamp = currentTime();
      } catch (error) {
        throw acquisitionPhaseFailure(
          'acquisition-clock',
          error,
          'Workspace writer lease acquisition clock failed'
        );
      }
      if (!nonEmpty(leaseId)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease id is invalid'
        );
      }
      let prepared: PreparedWorkspaceWriteLease;
      try {
        prepared = await prepareLease(
          paths,
          workspaceIdentityDigest,
          generation,
          leaseId,
          hostname,
          pid,
          processNonce,
          timestamp
        );
      } catch (error) {
        if (isExistsError(error)) continue;
        throw acquisitionPhaseFailure(
          'owner-preparation',
          error,
          'Workspace writer lease owner preparation failed'
        );
      }

      let ownerPublication: ImmutablePublicationOutcome;
      try {
        ownerPublication = await linkImmutableCandidateNoReplace(
          prepared.ownerPath,
          paths.root,
          generationOwnerPath(paths.root, generation),
          ownerPublicationDirectorySync
        );
      } catch (error) {
        throw acquisitionPhaseFailure(
          'owner-publication',
          error,
          'Workspace writer lease owner publication failed'
        );
      }
      if (ownerPublication.state === 'not-published') {
        await fs.rm(prepared.holder, { recursive: true, force: true }).catch(() => undefined);
        await fsyncDirectory(paths.holders).catch(() => undefined);
        if (ownerPublication.reason === 'target-exists') continue;
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication failed before target creation',
          {
            operation: 'acquire',
            phase: 'owner-publication',
            systemCode: ownerPublication.systemCode,
            reason: 'publication-not-created',
            retryable: false
          }
        );
      }
      if (ownerPublication.state === 'durability-unknown') {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication durability is unknown',
          {
            operation: 'acquire',
            phase: 'owner-publication',
            systemCode: ownerPublication.systemCode,
            reason: 'publication-durability-unknown',
            retryable: true
          }
        );
      }

      const token = prepared.token;
      try {
        await assertOwnedNative(workspaceRoot, token, executionBoundary);
      } catch (error) {
        await publishTerminal(paths, token, 'released').catch(() => undefined);
        throw error;
      }

      let released = false;
      let closing = false;
      let heartbeatFailure: Readonly<{ error: unknown }> | undefined;
      let heartbeatPending: Promise<void> | undefined;
      let currentWorkspaceRoot = workspaceRoot;
      const requestHeartbeat = (): Promise<void> => {
        if (closing || released) {
          return Promise.reject(new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            released
              ? 'Workspace writer lease handle is released'
              : 'Workspace writer lease handle is closing'
          ));
        }
        if (heartbeatPending) return heartbeatPending;
        const pending = heartbeat(currentWorkspaceRoot, token);
        heartbeatPending = pending;
        const clearPending = (): void => {
          if (heartbeatPending === pending) heartbeatPending = undefined;
        };
        void pending.then(clearPending, clearPending);
        return pending;
      };
      activeLeaseKeys.add(tokenKey(token));
      activeLeaseBoundaries.set(tokenKey(token), executionBoundary);
      const timer = setInterval(() => {
        void requestHeartbeat().catch((error) => {
          heartbeatFailure = Object.freeze({ error });
        });
      }, heartbeatIntervalMs);
      timer.unref?.();

      const assertHandleOpen = (): void => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is released'
          );
        }
        if (closing) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is closing'
          );
        }
      };
      const closeHeartbeatAdmission = (): void => {
        closing = true;
        clearInterval(timer);
      };
      const drainHeartbeat = async (): Promise<void> => {
        const pending = heartbeatPending;
        if (pending !== undefined) {
          try {
            await pending;
          } catch (error) {
            if (heartbeatFailure === undefined) heartbeatFailure = Object.freeze({ error });
          }
        }
        if (heartbeatFailure !== undefined) throw heartbeatFailure.error;
      };

      const assertHandle = async (): Promise<void> => {
        assertHandleOpen();
        if (heartbeatFailure !== undefined) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease heartbeat failed'
          );
        }
        await assertOwned(currentWorkspaceRoot, token);
      };
      const relocateHandle = async (nextWorkspaceRoot: string): Promise<void> => {
        assertHandleOpen();
        if (heartbeatFailure !== undefined) throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease heartbeat failed'
        );
        const next = path.resolve(nextWorkspaceRoot);
        // Physical v2 identity deliberately excludes lexical spelling, but
        // this equality check proves the new root is the exact token resource.
        const nextIdentity = await workspaceIdentity(next, executionBoundary).catch(() => '');
        if (nextIdentity !== token.workspaceIdentityDigest) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease relocation targets a different physical directory'
          );
        }
        await assertOwned(next, token);
        currentWorkspaceRoot = next;
        await assertOwned(currentWorkspaceRoot, token);
      };
      const ownedNamespace = async (): Promise<Readonly<{ workspaceRoot: string; relativePath: '.sec/workspace-write-lease' }>> => {
        await assertHandle();
        return Object.freeze({ workspaceRoot: currentWorkspaceRoot, relativePath: '.sec/workspace-write-lease' as const });
      };
      const retireOwnedNamespace = async (intentDigest: string, suppliedProofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity): Promise<WorkspaceWriteLeaseRetirementReceipt> => {
        await assertHandle();
        if (!/^sha256:[0-9a-f]{64}$/u.test(intentDigest)) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement intent digest is invalid');
        closeHeartbeatAdmission();
        await drainHeartbeat();
        return withControlPlaneLock(token, async () => {
          await assertOwned(currentWorkspaceRoot, token);
          const paths = pathsFor(currentWorkspaceRoot);
          const namespace = inspectNoFollowDirectoryChain(paths.root, 'Workspace lease retirement namespace').target;
          // Heartbeat admission was closed and every admitted heartbeat was
          // drained before entering the retirement control-plane mutation.
          // No later heartbeat can mutate this generation while the namespace
          // census, fence, terminal publication and relocation are performed.
          let entries = scanNoFollowDirectoryTree(namespace);
          const known = (relativePath: string): boolean => relativePath === PROTOCOL_FILE ||
            relativePath === HOLDERS_DIRECTORY || relativePath.startsWith(`${HOLDERS_DIRECTORY}/`) ||
            OWNER_GENERATION_PATTERN.test(relativePath) || TERMINAL_GENERATION_PATTERN.test(relativePath);
          if (entries.some((entry) => !known(entry.relativePath))) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement found non-owned namespace content');
          }
          const workspace = inspectNoFollowDirectoryChain(currentWorkspaceRoot, 'Workspace lease retirement workspace').target;
          const fenceParent = inspectNoFollowDirectoryChain(
            retirementFenceParent(currentWorkspaceRoot), 'Workspace lease retirement fence parent'
          ).target;
          const proofParent = assertSameNoFollowDirectoryIdentity(suppliedProofParent, 'Workspace lease retirement proof parent').target;
          const transition = createRetirementTransition({
            workspaceIdentityDigest: token.workspaceIdentityDigest,
            workspaceDevice: workspace.device,
            workspaceInode: workspace.inode,
            intentDigest,
            token,
            namespaceDevice: namespace.device,
            namespaceInode: namespace.inode,
            namespaceTombstoneParentDevice: proofParent.device,
            namespaceTombstoneParentInode: proofParent.inode,
            namespaceEntries: transitionEntries(entries)
          });
          publishExclusiveDurableCanonicalFile({
            // The transition belongs beside the retained relocated namespace
            // in the target-external operation root.  The target parent only
            // holds the physical fence; deleting the target may never delete
            // the owner/terminal proof required for a later convergence.
            parent: proofParent, name: retirementTransitionName(transition.transitionDigest),
            bytes: Buffer.from(`${JSON.stringify(transition)}\n`, 'utf8'),
            validate: (bytes) => {
              const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementTransition;
              if (parsed.transitionDigest !== transition.transitionDigest || !canonicalEquals(parsed, transition)) throw new Error('invalid retirement transition');
            }
          });
          const material = {
            formatVersion: 'workspace-write-lease-retirement-receipt-v1' as const,
            workspaceIdentityDigest: token.workspaceIdentityDigest,
            workspaceDevice: workspace.device,
            workspaceInode: workspace.inode,
            intentDigest,
            tokenGeneration: token.generation,
            ownerFileIdentityDigest: token.ownerFileIdentityDigest,
            // The fence must exist before terminal publication opens the next
            // generation.  Bind the immutable token identity here; recovery
            // later requires the exact retained owner/terminal pair and does
            // not treat this public digest as an issuer credential.
            terminalDigest: retirementTerminalTokenDigest(token),
            transitionDigest: transition.transitionDigest,
            namespaceDevice: namespace.device,
            namespaceInode: namespace.inode,
            namespaceTombstoneName: namespaceTombstoneName(transition.transitionDigest),
            fenceName: retirementFenceName(token.workspaceIdentityDigest)
          };
          const receipt: WorkspaceWriteLeaseRetirementReceipt = Object.freeze({ ...material, retirementDigest: sha256(material) });
          publishExclusiveDurableCanonicalFile({
            parent: fenceParent, name: receipt.fenceName, bytes: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
            validate: (bytes) => {
              const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementReceipt;
              if (parsed.retirementDigest !== receipt.retirementDigest) throw new Error('invalid retirement fence');
            }
          });
          // The acquisition-visible fence is durable before this checkpoint.
          // A real process death can therefore never expose a terminalized
          // generation without also preventing a successor acquisition.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await publishTerminal(paths, token, 'released');
          const terminal = await readOptionalTerminal(generationTerminalPath(paths.root, token.generation));
          if (terminal === null || !sameToken(terminal.token, token)) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement terminal publication is unavailable');
          }
          // Terminal publication removes the active holder directory. Refresh
          // the retained inventory before deleting the remaining canonical
          // ledger, otherwise stale child entries would be used as authority.
          entries = scanNoFollowDirectoryTree(namespace);
          if (entries.some((entry) => entry.relativePath.startsWith(`${HOLDERS_DIRECTORY}/`))) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement holder namespace remains after terminal publication');
          }
          const movedNamespace = relocateRetainedNoFollowDirectoryAcrossParents({
            directory: namespace, destinationParent: proofParent,
            tombstoneName: receipt.namespaceTombstoneName
          });
          if (movedNamespace.device !== receipt.namespaceDevice || movedNamespace.inode !== receipt.namespaceInode) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace relocation changed identity');
          }
          // Keep the atomically relocated namespace as the retained canonical
          // owner/terminal witness until closeout terminal lifecycle cleanup.
          // It is not a durable-file issuer: recovery may only converge the
          // exact inode moved here by this held token transition.
          clearInterval(timer);
          activeLeaseKeys.delete(tokenKey(token));
          activeLeaseBoundaries.delete(tokenKey(token));
          released = true;
          return receipt;
        });
      };
      const releaseHandle = async (): Promise<void> => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is already released'
          );
        }
        closeHeartbeatAdmission();
        let heartbeatCloseout:
          | Readonly<{ status: 'succeeded' }>
          | Readonly<{ status: 'failed'; error: unknown }> = Object.freeze({ status: 'succeeded' });
        let releaseCloseout:
          | Readonly<{ status: 'succeeded' }>
          | Readonly<{ status: 'failed'; error: unknown }> = Object.freeze({ status: 'succeeded' });
        try {
          await drainHeartbeat();
        } catch (error) {
          heartbeatCloseout = Object.freeze({ status: 'failed', error });
        }
        try {
          await release(currentWorkspaceRoot, token);
          released = true;
        } catch (error) {
          releaseCloseout = Object.freeze({ status: 'failed', error });
        }
        if (heartbeatCloseout.status === 'failed' && releaseCloseout.status === 'failed') {
          throw new ResourceCompositeSettlementError([
            { label: 'workspace-write-lease-heartbeat', error: heartbeatCloseout.error },
            { label: 'workspace-write-lease-release', error: releaseCloseout.error }
          ]);
        }
        if (heartbeatCloseout.status === 'failed') throw heartbeatCloseout.error;
        if (releaseCloseout.status === 'failed') throw releaseCloseout.error;
      };
      return Object.freeze({
        token,
        heartbeat: async () => {
          assertHandleOpen();
          if (heartbeatFailure !== undefined) {
            throw new WorkspaceWriteLeaseError(
              'WORKSPACE-WRITE-LEASE-002',
              'Workspace writer lease heartbeat failed'
            );
          }
          await requestHeartbeat();
        },
        assertOwned: assertHandle,
        relocate: relocateHandle,
        ownedNamespace,
        retireOwnedNamespace,
        release: releaseHandle
      });
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-001',
      'Workspace writer lease acquisition did not converge',
      { retryable: true }
    );
  };

  const releaseNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    assertManagerHolder(token);
    await assertOwned(workspaceRoot, token);
    const paths = pathsFor(workspaceRoot);
    await publishTerminal(paths, token, 'released');
    const terminal = await readOptionalTerminal(generationTerminalPath(paths.root, token.generation));
    if (!terminal || !sameToken(terminal.token, token)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease release terminal could not be proven'
      );
    }
  };

  const release = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      assertActiveLease(token);
      await withControlPlaneLock(token, () => releaseNative(workspaceRoot, token));
      activeLeaseKeys.delete(tokenKey(token));
      activeLeaseBoundaries.delete(tokenKey(token));
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease release failed'
      );
    }
  };

  const acquire = async (
    workspaceRoot: string,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions = {}
  ): Promise<WorkspaceWriteLeaseHandle> => {
    try {
      return await acquireNative(workspaceRoot, acquireOptions);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw acquisitionFailure(
        'unclassified',
        error,
        'Workspace writer lease acquisition failed'
      );
    }
  };

  const withLease = async <Value>(
    workspaceRoot: string,
    reentrantToken: WorkspaceWriteLeaseToken | undefined,
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions = {}
  ): Promise<Value> => {
    if (reentrantToken) {
      assertActiveLease(reentrantToken);
      await assertOwned(workspaceRoot, reentrantToken);
      return execute(reentrantToken);
    }
    return withAcquiredResource({
      operationLabel: 'workspace-write-lease-operation',
      resourceLabel: 'workspace-write-lease',
      acquire: () => acquire(workspaceRoot, acquireOptions),
      use: (handle) => execute(handle.token),
      release: (handle) => handle.release()
    });
  };

  return Object.freeze({ acquire, assertOwned, release, withControlPlaneQuiesced, withLease });
}

export const workspaceWriteLeaseManager = createWorkspaceWriteLeaseManager();

export const acquireWorkspaceWriteLease = workspaceWriteLeaseManager.acquire;
export const assertWorkspaceWriteLease = workspaceWriteLeaseManager.assertOwned;
export const releaseWorkspaceWriteLease = workspaceWriteLeaseManager.release;
export const withWorkspaceWriteLeaseControlPlaneQuiesced =
  workspaceWriteLeaseManager.withControlPlaneQuiesced;
export const withWorkspaceWriteLease = workspaceWriteLeaseManager.withLease;

export function createWorkspaceWriteCommitFence(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): CommitFence {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  const commitFence = () => assertWorkspaceWriteLease(canonicalWorkspaceRoot, token);
  workspaceWriteCommitFenceBindings.set(commitFence, Object.freeze({
    workspaceRoot: canonicalWorkspaceRoot,
    token
  }));
  return commitFence;
}

export function isCanonicalWorkspaceWriteCommitFence(
  commitFence: CommitFence,
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): boolean {
  const binding = workspaceWriteCommitFenceBindings.get(commitFence);
  return binding !== undefined &&
    binding.workspaceRoot === path.resolve(workspaceRoot) &&
    binding.token === token;
}

/**
 * Converts one currently-owned workspace lease into the physical executor's
 * single-purpose, process-local AppContainer capability. Workspace admission
 * remains here; the physical substrate never imports or interprets a lease.
 */
export async function issueWindowsAppContainerExecutionCapability(input: {
  readonly workspaceRoot: string;
  readonly stagingRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
}): Promise<WindowsAppContainerExecutionCapability> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const stagingRoot = path.resolve(input.stagingRoot);
  const relativeStagingRoot = path.relative(workspaceRoot, stagingRoot);
  if (
    relativeStagingRoot === ''
    || path.isAbsolute(relativeStagingRoot)
    || relativeStagingRoot === '..'
    || relativeStagingRoot.startsWith(`..${path.sep}`)
  ) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-002',
      'Workspace AppContainer execution root is outside the admitted workspace'
    );
  }
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, input.workspaceWriteLease);
  if (!isCanonicalWorkspaceWriteCommitFence(commitFence, workspaceRoot, input.workspaceWriteLease)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-002',
      'Workspace AppContainer execution capability admission is noncanonical'
    );
  }
  await commitFence();
  return issuePhysicalWindowsAppContainerExecutionCapability({
    stagingRoot,
    authorityBindingDigest: input.workspaceWriteLease.workspaceIdentityDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    assertCurrent: commitFence
  });
}
