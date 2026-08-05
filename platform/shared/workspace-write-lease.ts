import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalEquals, digest, sha256 } from './canonical-primitives.ts';
import { ensureDir, type CommitFence } from './fs.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from './process.ts';
import { isSemanticMutationStagingWorkspace } from './semantic-mutation-staging-boundary.ts';
import { resolveWorkspaceLocalStateRoot } from './workspace-path-contract.ts';

export const WORKSPACE_WRITE_LEASE_TOKEN_VERSION = 'workspace-write-lease-token-v2' as const;
export const WORKSPACE_WRITE_LEASE_INSPECTION_VERSION =
  'workspace-write-lease-inspection-v1' as const;
export const WORKSPACE_WRITE_LEASE_DIRECTORY_NAME = 'workspace-write-lease' as const;

const WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION = 'workspace-write-lease-protocol-v2' as const;
const WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION = 'workspace-write-lease-heartbeat-v2' as const;
const WORKSPACE_WRITE_LEASE_TERMINAL_VERSION = 'workspace-write-lease-terminal-v2' as const;
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
const PROCESS_NONCE = randomUUID();
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
  | Readonly<{ state: 'not-published'; reason: 'target-exists' | 'link-failed' }>
  | Readonly<{ state: 'durability-unknown' }>;

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
  release(): Promise<void>;
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
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
}

function workspaceIdentityFailureReason(error: unknown): WorkspaceIdentityFailureReason {
  if (error instanceof WorkspaceWriteLeaseError &&
    error.details.reason === 'not-directory') return 'not-directory';
  switch (systemErrorCode(error)) {
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
  const canonical = await fs.realpath(workspaceRoot);
  const stat = await fs.stat(canonical, { bigint: true });
  if (!stat.isDirectory()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace identity is not a directory',
      { reason: 'not-directory' }
    );
  }
  return sha256({
    domain: 'workspace-write-lease-workspace-identity-v1',
    canonical,
    dev: String(stat.dev),
    ino: String(stat.ino)
  });
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
  const digestHex = digest(JSON.stringify({ kind, id }));
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
    const relationship = await publicationTargetRelationship(candidate, target);
    if (relationship === 'same') return Object.freeze({ state: 'durability-unknown' });
    if (relationship === 'unknown') return Object.freeze({ state: 'durability-unknown' });
    if (relationship === 'different' && isExistsError(error)) {
      return Object.freeze({ state: 'not-published', reason: 'target-exists' });
    }
    if (relationship === 'absent') {
      return Object.freeze({ state: 'not-published', reason: 'link-failed' });
    }
    return Object.freeze({ state: 'durability-unknown' });
  }
  try {
    await syncTargetDirectory(targetDirectory);
    return Object.freeze({ state: 'published' });
  } catch {
    return Object.freeze({ state: 'durability-unknown' });
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
      { reason: 'publication-durability-unknown', retryable: true }
    );
  }
  try {
    await removeImmutableCandidate(candidateDirectory, candidate);
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication cleanup durability is unknown',
      { reason: 'publication-cleanup-durability-unknown', retryable: true }
    );
  }
  if (outcome.state === 'not-published') {
    if (outcome.reason === 'target-exists') return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication failed before target creation'
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
  const digestHex = digest(JSON.stringify({
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
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const processAlive = options.processAlive ?? defaultProcessAlive;
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
    const value = now();
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
            reason: workspaceIdentityFailureReason(error)
          }
        );
      }
    );
    const paths = await ensureRoot(workspaceRoot, executionBoundary);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const inventory = await readInventory(paths.root);
      if (inventory.highestGeneration !== undefined) {
        const highestState = await readGenerationState(paths.root, inventory.highestGeneration);
        if (!highestState.terminal) {
          const reclaimed = await terminalizeStaleGeneration(paths, inventory.highestGeneration);
          if (reclaimed) continue;
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
      const leaseId = createId();
      const timestamp = currentTime();
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
        if (error instanceof WorkspaceWriteLeaseError) throw error;
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner preparation failed'
        );
      }

      const ownerPublication = await linkImmutableCandidateNoReplace(
        prepared.ownerPath,
        paths.root,
        generationOwnerPath(paths.root, generation),
        ownerPublicationDirectorySync
      );
      if (ownerPublication.state === 'not-published') {
        await fs.rm(prepared.holder, { recursive: true, force: true }).catch(() => undefined);
        await fsyncDirectory(paths.holders).catch(() => undefined);
        if (ownerPublication.reason === 'target-exists') continue;
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication failed before target creation'
        );
      }
      if (ownerPublication.state === 'durability-unknown') {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication durability is unknown',
          { reason: 'publication-durability-unknown', retryable: true }
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
      let heartbeatFailure: unknown;
      let heartbeatPending: Promise<void> | undefined;
      const requestHeartbeat = (): Promise<void> => {
        if (heartbeatPending) return heartbeatPending;
        const pending = heartbeat(workspaceRoot, token);
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
          heartbeatFailure = error;
        });
      }, heartbeatIntervalMs);
      timer.unref?.();

      const assertHandle = async (): Promise<void> => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is released'
          );
        }
        if (heartbeatFailure) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease heartbeat failed'
          );
        }
        await assertOwned(workspaceRoot, token);
      };
      const releaseHandle = async (): Promise<void> => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is already released'
          );
        }
        clearInterval(timer);
        await release(workspaceRoot, token);
        released = true;
      };
      return Object.freeze({
        token,
        heartbeat: async () => {
          if (released) {
            throw new WorkspaceWriteLeaseError(
              'WORKSPACE-WRITE-LEASE-002',
              'Workspace writer lease handle is released'
            );
          }
          if (heartbeatFailure) {
            throw new WorkspaceWriteLeaseError(
              'WORKSPACE-WRITE-LEASE-002',
              'Workspace writer lease heartbeat failed'
            );
          }
          await requestHeartbeat();
        },
        assertOwned: assertHandle,
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
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
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
    const handle = await acquire(workspaceRoot, acquireOptions);
    try {
      return await execute(handle.token);
    } finally {
      await handle.release();
    }
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
