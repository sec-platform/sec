import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CommitFence } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';

export const WORKSPACE_WRITE_LEASE_TOKEN_VERSION = 'workspace-write-lease-token-v1' as const;

const OWNER_FILE = 'owner.json';
const LEASE_DIRECTORY = 'workspace-write-lease';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const PROCESS_NONCE = randomUUID();
const AT_FDCWD = -100;
const RENAME_NOREPLACE = 1;

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
  readonly leaseDirectoryIdentityDigest: string;
  readonly hostname: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly leaseId: string;
}

interface WorkspaceWriteLeaseOwner extends WorkspaceWriteLeaseToken {
  readonly createdAtMs: number;
  readonly heartbeatAtMs: number;
}

export interface WorkspaceWriteLeaseHandle {
  readonly token: WorkspaceWriteLeaseToken;
  heartbeat(): Promise<void>;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

export interface WorkspaceWriteLeaseManager {
  acquire(workspaceRoot: string): Promise<WorkspaceWriteLeaseHandle>;
  assertOwned(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  release(workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void>;
  withLease<Value>(
    workspaceRoot: string,
    reentrantToken: WorkspaceWriteLeaseToken | undefined,
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>
  ): Promise<Value>;
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
}

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function ownerLooksValid(value: unknown): value is WorkspaceWriteLeaseOwner {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'leaseDirectoryIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId',
    'createdAtMs',
    'heartbeatAtMs'
  ])) return false;
  const owner = value as Record<string, unknown>;
  return owner.formatVersion === WORKSPACE_WRITE_LEASE_TOKEN_VERSION &&
    nonEmpty(owner.workspaceIdentityDigest) && nonEmpty(owner.leaseDirectoryIdentityDigest) &&
    nonEmpty(owner.hostname) && safeInteger(owner.pid) && nonEmpty(owner.processNonce) &&
    nonEmpty(owner.leaseId) && safeInteger(owner.createdAtMs) && safeInteger(owner.heartbeatAtMs) &&
    owner.heartbeatAtMs >= owner.createdAtMs;
}

function tokenLooksValid(value: unknown): value is WorkspaceWriteLeaseToken {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, [
    'formatVersion',
    'workspaceIdentityDigest',
    'leaseDirectoryIdentityDigest',
    'hostname',
    'pid',
    'processNonce',
    'leaseId'
  ])) return false;
  const token = value as Record<string, unknown>;
  return token.formatVersion === WORKSPACE_WRITE_LEASE_TOKEN_VERSION &&
    nonEmpty(token.workspaceIdentityDigest) && nonEmpty(token.leaseDirectoryIdentityDigest) &&
    nonEmpty(token.hostname) && safeInteger(token.pid) && nonEmpty(token.processNonce) &&
    nonEmpty(token.leaseId);
}

function tokenFromOwner(owner: WorkspaceWriteLeaseOwner): WorkspaceWriteLeaseToken {
  return Object.freeze({
    formatVersion: owner.formatVersion,
    workspaceIdentityDigest: owner.workspaceIdentityDigest,
    leaseDirectoryIdentityDigest: owner.leaseDirectoryIdentityDigest,
    hostname: owner.hostname,
    pid: owner.pid,
    processNonce: owner.processNonce,
    leaseId: owner.leaseId
  });
}

function sameToken(left: WorkspaceWriteLeaseToken, right: WorkspaceWriteLeaseToken): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

async function workspaceIdentity(workspaceRoot: string): Promise<string> {
  const canonical = await fs.realpath(workspaceRoot);
  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace identity is not a directory');
  }
  return sha256({
    domain: 'workspace-write-lease-workspace-identity-v1',
    canonical,
    dev: String(stat.dev),
    ino: String(stat.ino)
  });
}

async function assertLeaseParent(workspaceRoot: string, parent: string): Promise<void> {
  const [canonicalWorkspace, parentMetadata, canonicalParent] = await Promise.all([
    fs.realpath(workspaceRoot),
    fs.lstat(parent),
    fs.realpath(parent)
  ]);
  const relative = path.relative(canonicalWorkspace, canonicalParent);
  const escapesWorkspace = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || escapesWorkspace) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease parent is not a real directory inside the workspace'
    );
  }
}

async function directoryIdentity(directory: string): Promise<string> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Lease identity is not a real directory');
  }
  return sha256({
    domain: 'workspace-write-lease-directory-identity-v1',
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: Number(stat.mode)
  });
}

async function readOwner(directory: string): Promise<WorkspaceWriteLeaseOwner> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.join(directory, OWNER_FILE), 'utf8'));
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease ownership cannot be proven'
    );
  }
  if (!ownerLooksValid(value)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease owner record is invalid'
    );
  }
  return value;
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function durableWriteOwner(directory: string, owner: WorkspaceWriteLeaseOwner, createId: () => string): Promise<void> {
  const temporary = path.join(directory, `.owner-${createId()}.tmp`);
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, path.join(directory, OWNER_FILE));
    await fsyncDirectory(directory);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error &&
    (error.code === 'EEXIST' || error.code === 'ENOTEMPTY' || error.code === 'EPERM');
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function leasePublishContention(): NodeJS.ErrnoException {
  const error = new Error('Workspace writer lease target already exists') as NodeJS.ErrnoException;
  error.code = 'EEXIST';
  return error;
}

async function leaseTargetExists(lease: string): Promise<boolean> {
  try {
    await fs.lstat(lease);
    return true;
  } catch (error) {
    if (isMissingError(error)) return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease target state could not be proven'
    );
  }
}

async function publishLinuxLeaseNoReplace(candidate: string, lease: string): Promise<void> {
  let published = false;
  let closeLibrary: (() => void) | undefined;
  try {
    const { dlopen, FFIType } = await import('bun:ffi');
    const library = dlopen('libc.so.6', {
      renameat2: {
        args: [FFIType.i32, FFIType.cstring, FFIType.i32, FFIType.cstring, FFIType.u32],
        returns: FFIType.i32
      }
    } as const);
    closeLibrary = () => library.close();
    const candidatePath = Buffer.from(`${candidate}\0`);
    const leasePath = Buffer.from(`${lease}\0`);
    published = library.symbols.renameat2(
      AT_FDCWD,
      candidatePath,
      AT_FDCWD,
      leasePath,
      RENAME_NOREPLACE
    ) === 0;
  } catch {
    // Native failures are classified only from the fixed target below.
  } finally {
    try {
      closeLibrary?.();
    } catch {
      // Closing the FFI handle cannot change a successful atomic publish.
    }
  }
  if (published) return;
  if (await leaseTargetExists(lease)) throw leasePublishContention();
  throw new WorkspaceWriteLeaseError(
    'WORKSPACE-WRITE-LEASE-004',
    'Workspace writer lease no-replace publish failed'
  );
}

async function publishLeaseCandidateNoReplace(candidate: string, lease: string): Promise<void> {
  if (await leaseTargetExists(lease)) throw leasePublishContention();
  if (process.platform === 'linux') {
    await publishLinuxLeaseNoReplace(candidate, lease);
    return;
  }

  if (process.platform !== 'win32') {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease no-replace publish is unsupported on this platform'
    );
  }

  // Windows directory rename does not replace an existing target. Linux uses
  // renameat2 above; every other platform fails closed until it has an atomic
  // no-replace directory primitive rather than relying on a racy precheck.
  try {
    await fs.rename(candidate, lease);
  } catch {
    if (await leaseTargetExists(lease)) throw leasePublishContention();
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease no-replace publish failed'
    );
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
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 ||
    !Number.isSafeInteger(staleAfterMs) || staleAfterMs <= heartbeatIntervalMs ||
    !nonEmpty(hostname) || !safeInteger(pid) || !nonEmpty(processNonce)) {
    throw new Error('Workspace write lease manager options are invalid');
  }

  const pathsFor = (workspaceRoot: string): { parent: string; lease: string } => {
    const parent = getWorkspacePaths(workspaceRoot).localStateRoot;
    return { parent, lease: path.join(parent, LEASE_DIRECTORY) };
  };

  const assertManagerHolder = (token: WorkspaceWriteLeaseToken): void => {
    if (token.hostname !== hostname || token.pid !== pid || token.processNonce !== processNonce) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token belongs to a different process holder'
      );
    }
  };

  const assertOwnedNative = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
    if (!tokenLooksValid(token)) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease token is invalid');
    }
    const expectedWorkspace = await workspaceIdentity(workspaceRoot).catch(() => '');
    if (expectedWorkspace !== token.workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease token targets a different workspace');
    }
    const { parent, lease } = pathsFor(workspaceRoot);
    await assertLeaseParent(workspaceRoot, parent);
    let owner: WorkspaceWriteLeaseOwner;
    let identity: string;
    try {
      [owner, identity] = await Promise.all([readOwner(lease), directoryIdentity(lease)]);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease is no longer owned');
    }
    if (identity !== token.leaseDirectoryIdentityDigest || !sameToken(tokenFromOwner(owner), token)) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease token no longer owns the lease');
    }
  };

  const assertOwned = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
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

  const heartbeatNative = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
    await assertOwned(workspaceRoot, token);
    const { lease } = pathsFor(workspaceRoot);
    const owner = await readOwner(lease);
    const updated = Object.freeze({ ...owner, heartbeatAtMs: now() });
    await durableWriteOwner(lease, updated, createId);
    await assertOwned(workspaceRoot, token);
  };

  const heartbeat = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
    try {
      await heartbeatNative(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease heartbeat failed'
      );
    }
  };

  const quarantineStaleLease = async (workspaceRoot: string): Promise<boolean> => {
    const { parent, lease } = pathsFor(workspaceRoot);
    const [owner, leaseIdentity] = await Promise.all([
      readOwner(lease),
      directoryIdentity(lease)
    ]);
    if (leaseIdentity !== owner.leaseDirectoryIdentityDigest) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease directory identity does not match its owner record'
      );
    }
    if (owner.hostname !== hostname) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Foreign workspace writer lease cannot be reclaimed automatically'
      );
    }
    const age = now() - owner.heartbeatAtMs;
    if (age <= staleAfterMs) return false;
    const liveness = processAlive(owner.pid);
    if (liveness === 'alive') return false;
    if (liveness !== 'dead') {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease holder liveness is unknown'
      );
    }
    const current = await readOwner(lease);
    if (!sameToken(tokenFromOwner(current), tokenFromOwner(owner)) || current.heartbeatAtMs !== owner.heartbeatAtMs) {
      return false;
    }
    const quarantine = path.join(parent, `${LEASE_DIRECTORY}.quarantine-${createId()}`);
    try {
      await fs.rename(lease, quarantine);
      await fsyncDirectory(parent);
    } catch (error) {
      if (isExistsError(error) || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) return false;
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace writer lease quarantine failed');
    }
    const [quarantinedOwner, quarantinedIdentity] = await Promise.all([
      readOwner(quarantine).catch(() => null),
      directoryIdentity(quarantine).catch(() => '')
    ]);
    if (!quarantinedOwner || quarantinedIdentity !== owner.leaseDirectoryIdentityDigest ||
      !sameToken(tokenFromOwner(quarantinedOwner), tokenFromOwner(owner))) {
      await fs.rename(quarantine, lease).catch(() => undefined);
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Quarantined workspace writer lease ownership changed unexpectedly'
      );
    }
    await fs.rm(quarantine, { recursive: true, force: true });
    await fsyncDirectory(parent);
    return true;
  };

  const acquireNative = async (workspaceRoot: string): Promise<WorkspaceWriteLeaseHandle> => {
    const workspaceIdentityDigest = await workspaceIdentity(workspaceRoot).catch(() => {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace identity could not be proven');
    });
    const { parent, lease } = pathsFor(workspaceRoot);
    await fs.mkdir(parent, { recursive: true });
    await assertLeaseParent(workspaceRoot, parent);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const leaseId = createId();
      const candidate = path.join(parent, `${LEASE_DIRECTORY}.candidate-${leaseId}`);
      try {
        await fs.mkdir(candidate);
        const leaseDirectoryIdentityDigest = await directoryIdentity(candidate);
        const timestamp = now();
        const owner: WorkspaceWriteLeaseOwner = Object.freeze({
          formatVersion: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
          workspaceIdentityDigest,
          leaseDirectoryIdentityDigest,
          hostname,
          pid,
          processNonce,
          leaseId,
          createdAtMs: timestamp,
          heartbeatAtMs: timestamp
        });
        await durableWriteOwner(candidate, owner, createId);
        await publishLeaseCandidateNoReplace(candidate, lease);
        await fsyncDirectory(parent);
        const token = tokenFromOwner(owner);
        await assertOwned(workspaceRoot, token);

        let released = false;
        let heartbeatFailure: unknown;
        const timer = setInterval(() => {
          void heartbeat(workspaceRoot, token).catch((error) => {
            heartbeatFailure = error;
          });
        }, heartbeatIntervalMs);
        timer.unref?.();

        const assertHandle = async (): Promise<void> => {
          if (released) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease handle is released');
          }
          if (heartbeatFailure) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease heartbeat failed');
          }
          await assertOwned(workspaceRoot, token);
        };
        const releaseHandle = async (): Promise<void> => {
          if (released) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease handle is already released');
          }
          clearInterval(timer);
          await release(workspaceRoot, token);
          released = true;
        };
        return Object.freeze({
          token,
          heartbeat: async () => {
            await assertHandle();
            await heartbeat(workspaceRoot, token);
          },
          assertOwned: assertHandle,
          release: releaseHandle
        });
      } catch (error) {
        await fs.rm(candidate, { recursive: true, force: true }).catch(() => undefined);
        if (!isExistsError(error)) {
          if (error instanceof WorkspaceWriteLeaseError) throw error;
          throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-004', 'Workspace writer lease acquisition failed');
        }
        const reclaimed = await quarantineStaleLease(workspaceRoot);
        if (reclaimed) continue;
        throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-001', 'Workspace writer lease is already held', {
          retryable: true
        });
      }
    }
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-001', 'Workspace writer lease is already held', {
      retryable: true
    });
  };

  const releaseNative = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
    assertManagerHolder(token);
    await assertOwned(workspaceRoot, token);
    const { parent, lease } = pathsFor(workspaceRoot);
    const released = path.join(parent, `${LEASE_DIRECTORY}.released-${createId()}`);
    try {
      await fs.rename(lease, released);
      await fsyncDirectory(parent);
    } catch {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease release lost ownership');
    }
    const owner = await readOwner(released).catch(() => null);
    if (!owner || !sameToken(tokenFromOwner(owner), token)) {
      await fs.rename(released, lease).catch(() => undefined);
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-002', 'Released workspace writer lease token mismatched');
    }
    await fs.rm(released, { recursive: true, force: true });
    await fsyncDirectory(parent);
  };

  const release = async (workspaceRoot: string, token: WorkspaceWriteLeaseToken): Promise<void> => {
    try {
      await releaseNative(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease release failed'
      );
    }
  };

  const acquire = async (workspaceRoot: string): Promise<WorkspaceWriteLeaseHandle> => {
    try {
      return await acquireNative(workspaceRoot);
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
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>
  ): Promise<Value> => {
    if (reentrantToken) {
      assertManagerHolder(reentrantToken);
      await assertOwned(workspaceRoot, reentrantToken);
      return execute(reentrantToken);
    }
    const handle = await acquire(workspaceRoot);
    try {
      return await execute(handle.token);
    } finally {
      await handle.release();
    }
  };

  return Object.freeze({ acquire, assertOwned, release, withLease });
}

export const workspaceWriteLeaseManager = createWorkspaceWriteLeaseManager();

export const acquireWorkspaceWriteLease = workspaceWriteLeaseManager.acquire;
export const assertWorkspaceWriteLease = workspaceWriteLeaseManager.assertOwned;
export const releaseWorkspaceWriteLease = workspaceWriteLeaseManager.release;
export const withWorkspaceWriteLease = workspaceWriteLeaseManager.withLease;

export function createWorkspaceWriteCommitFence(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): CommitFence {
  return () => assertWorkspaceWriteLease(workspaceRoot, token);
}
