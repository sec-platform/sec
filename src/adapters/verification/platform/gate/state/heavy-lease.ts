import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { parseExactJson } from '../../../../../contracts/exact-json.ts';
import { HeavyVerificationGateBusyError, onceHeavyVerificationGateRelease, waitForHeavyVerificationGateLease, withAcquiredHeavyVerificationGateLease } from './heavy-lease-lifecycle.ts';

import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from '../../../../runtime-state/workspace-state/layout.ts';
import { selectRuntimeStateDirectoryGeneration } from '../../../../runtime-state/workspace-state/layout-migration.ts';
import { compilerRoot } from "../../../../workspace-context.ts";

type HeavyVerificationGateOwner = Readonly<{
  command: readonly string[];
  gateId: string;
  host: string;
  pid: number;
  startedAt: string;
  token: string;
}>;

export type HeavyVerificationGateLease = Readonly<{
  owner: HeavyVerificationGateOwner;
  release: () => Promise<void>;
}>;

export type HeavyVerificationGateLeaseOptions = Readonly<{
  gateId: string;
  isProcessAlive?: (pid: number) => boolean;
  lockPath?: string;
  namespace?: string;
  ownerHost?: string;
  ownerPid?: number;
  startedAt?: string;
  token?: string;
  waitTimeoutMs?: number;
}>;

export type HeavyVerificationGateLeaseCallOptions = Readonly<
  Pick<HeavyVerificationGateLeaseOptions, 'namespace' | 'waitTimeoutMs'>
>;

const HEAVY_VERIFICATION_GATE_LOCK_NAME = 'gate';
const LEGACY_HEAVY_VERIFICATION_GATE_LOCK_NAME = 'heavy-verification-gate-v1';
const HEAVY_VERIFICATION_GATE_ID_PATTERN = /^[a-z0-9][a-z0-9:-]*$/u;
const HEAVY_VERIFICATION_GATE_DEFAULT_WAIT_TIMEOUT_MS = 0;
const OWNER_FILE = 'owner.json';
const INITIALIZATION_GRACE_MS = 30_000;
const WINDOWS_WAIT_OBJECT_0 = 0x0000_0000;
const WINDOWS_WAIT_ABANDONED_0 = 0x0000_0080;
const WINDOWS_WAIT_TIMEOUT = 0x0000_0102;

export function heavyVerificationGateLockPath(input: Readonly<{
  physicalWorktreeRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): string {
  const physicalWorktreeRoot = path.resolve(input.physicalWorktreeRoot);
  const cacheRoot = resolveRuntimeCacheRoot({
    platform: currentRuntimePlatform(),
    environment: runtimeStateEnvironment(input.environment ?? process.env),
    repositoryRoot: physicalWorktreeRoot
  });
  const generation = selectRuntimeStateDirectoryGeneration({
    label: 'heavy verification gate leases',
    legacyPath: path.join(cacheRoot, 'heavy-verification-gates', 'v1'),
    currentPath: path.join(cacheRoot, 'heavy-verification-gates', 'locks')
  });
  return path.join(
    generation.path,
    rawSha256Hex(process.platform === 'win32'
      ? physicalWorktreeRoot.toLocaleLowerCase('en-US')
      : physicalWorktreeRoot),
    generation.kind === 'legacy'
      ? LEGACY_HEAVY_VERIFICATION_GATE_LOCK_NAME
      : HEAVY_VERIFICATION_GATE_LOCK_NAME
  );
}

interface HeavyVerificationGateKernel32Symbols {
  CreateMutexW: (security: null, initialOwner: number, name: Buffer) => bigint;
  WaitForSingleObject: (handle: bigint, milliseconds: number) => number;
  ReleaseMutex: (handle: bigint) => number;
  CloseHandle: (handle: bigint) => number;
}

interface HeavyVerificationGateKernel32 {
  symbols: HeavyVerificationGateKernel32Symbols;
}

let heavyVerificationGateKernel32Promise: Promise<HeavyVerificationGateKernel32> | undefined;
const windowsHeavyVerificationGatesHeld = new Map<string, HeavyVerificationGateOwner>();

async function loadHeavyVerificationGateKernel32(): Promise<HeavyVerificationGateKernel32> {
  heavyVerificationGateKernel32Promise ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    return dlopen('kernel32.dll', {
      CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.u64 },
      WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
      ReleaseMutex: { args: [FFIType.u64], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
    } as const) as unknown as HeavyVerificationGateKernel32;
  })();
  return heavyVerificationGateKernel32Promise;
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function heavyVerificationGateMutexName(worktreeRoot: string, namespace?: string): string {
  const canonical = path.resolve(worktreeRoot).toLocaleLowerCase('en-US');
  const digestHex = rawSha256Hex(canonical).slice(0, 32);
  if (!namespace) {
    return `Global\\sec-heavy-verification-gate-${digestHex}`;
  }
  const namespaceDigest = rawSha256Hex(namespace).slice(0, 16);
  return `Global\\sec-heavy-verification-gate-${digestHex}-${namespaceDigest}`;
}

function validateHeavyVerificationGateNamespace(namespace: string): void {
  if (typeof namespace !== 'string' || !HEAVY_VERIFICATION_GATE_ID_PATTERN.test(namespace)) {
    throw new Error('Heavy verification gate namespace must be canonical.');
  }
}

function heavyVerificationGateNamespaceSegment(namespace: string): string {
  return rawSha256Hex(namespace).slice(0, 16);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH');
  }
}

function isOwner(value: unknown): value is HeavyVerificationGateOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Partial<HeavyVerificationGateOwner>;
  return Array.isArray(owner.command) && owner.command.every((part) => typeof part === 'string') &&
    typeof owner.gateId === 'string' && owner.gateId.length > 0 &&
    typeof owner.host === 'string' && owner.host.length > 0 &&
    Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.startedAt === 'string' && !Number.isNaN(Date.parse(owner.startedAt)) &&
    typeof owner.token === 'string' && /^[0-9a-f]{32}$/u.test(owner.token);
}

async function readOwner(lockPath: string): Promise<HeavyVerificationGateOwner | null> {
  let source: string;
  try { source = await readFile(path.join(lockPath, OWNER_FILE), 'utf8'); }
  catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try { parsed = parseExactJson(source, 'Heavy verification gate owner'); }
  catch (cause) { throw new Error('Heavy verification gate owner publication is invalid and requires recovery.', { cause }); }
  if (!isOwner(parsed)) throw new Error('Heavy verification gate owner publication is invalid and requires recovery.');
  return parsed;
}

async function publishCandidate(
  lockPath: string,
  owner: HeavyVerificationGateOwner
): Promise<string> {
  const candidatePath = `${lockPath}.candidate-${owner.token}`;
  await mkdir(candidatePath);
  try {
    await writeFile(
      path.join(candidatePath, OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    await rename(candidatePath, lockPath);
    return candidatePath;
  } catch (error) {
    try { await rm(candidatePath, { recursive: true, force: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Heavy gate publication and candidate cleanup failed', { cause: error }); }
    throw error;
  }
}

async function reclaimStaleLock(lockPath: string, token: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim-${token}`;
  try {
    await rename(lockPath, reclaimPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'ENOTEMPTY')) {
      return false;
    }
    throw error;
  }
  await rm(reclaimPath, { recursive: true, force: false });
  return true;
}

async function acquireWindowsHeavyVerificationGateLease(
  owner: HeavyVerificationGateOwner,
  mutexIdentity: string,
  namespace: string | undefined,
  waitTimeoutMs: number
): Promise<HeavyVerificationGateLease> {
  const mutexName = heavyVerificationGateMutexName(mutexIdentity, namespace);
  const held = windowsHeavyVerificationGatesHeld.get(mutexName);
  if (held !== undefined) {
    throw new HeavyVerificationGateBusyError('active',
      `Heavy verification gate ${held.gateId} is already active ` +
      `(pid ${held.pid}, started ${held.startedAt}).`
    );
  }
  // Reserve synchronously before the first await. Windows mutexes are
  // thread-reentrant, so concurrent async callers in this JS thread must not
  // both enter the kernel acquisition and overwrite the local owner.
  windowsHeavyVerificationGatesHeld.set(mutexName, owner);
  let kernel32: HeavyVerificationGateKernel32 | null = null;
  let handle = 0n;
  try {
    kernel32 = await loadHeavyVerificationGateKernel32();
    handle = kernel32.symbols.CreateMutexW(
      null,
      0,
      windowsWide(mutexName)
    );
    if (handle === 0n) {
      throw new Error('Heavy verification gate mutex could not be created.');
    }
    const wait = kernel32.symbols.WaitForSingleObject(handle, waitTimeoutMs);
    if (wait !== WINDOWS_WAIT_OBJECT_0 && wait !== WINDOWS_WAIT_ABANDONED_0) {
      kernel32.symbols.CloseHandle(handle);
      handle = 0n;
      if (wait === WINDOWS_WAIT_TIMEOUT) {
        throw new HeavyVerificationGateBusyError('active', 'Another heavy verification gate is already active in this worktree.');
      }
      throw new Error('Heavy verification gate mutex wait failed.');
    }
  } catch (error) {
    if (handle !== 0n && kernel32 !== null) kernel32.symbols.CloseHandle(handle);
    if (windowsHeavyVerificationGatesHeld.get(mutexName)?.token === owner.token) {
      windowsHeavyVerificationGatesHeld.delete(mutexName);
    }
    throw error;
  }
  const acquiredKernel32 = kernel32;
  const acquiredHandle = handle;
  return Object.freeze({
    owner,
    release: onceHeavyVerificationGateRelease(async (): Promise<void> => {
      const current = windowsHeavyVerificationGatesHeld.get(mutexName);
      if (current?.token !== owner.token) {
        throw new Error('Heavy verification gate lease ownership was lost before release.');
      }
      const releaseResult = acquiredKernel32.symbols.ReleaseMutex(acquiredHandle);
      const closeResult = acquiredKernel32.symbols.CloseHandle(acquiredHandle);
      windowsHeavyVerificationGatesHeld.delete(mutexName);
      if (releaseResult === 0 || closeResult === 0) {
        throw new Error('Heavy verification gate mutex release failed.');
      }
    })
  });
}

export async function acquireHeavyVerificationGateLease(
  options: HeavyVerificationGateLeaseOptions
): Promise<HeavyVerificationGateLease> {
  const { gateId, isProcessAlive: liveness, lockPath: suppliedPath, namespace: suppliedNamespace,
    ownerHost, ownerPid, startedAt, token: suppliedToken, waitTimeoutMs: suppliedWait } = options;
  options = Object.freeze({ gateId, isProcessAlive: liveness,
    lockPath: suppliedPath === undefined ? undefined : path.resolve(suppliedPath),
    namespace: suppliedNamespace, ownerHost, ownerPid, startedAt, token: suppliedToken, waitTimeoutMs: suppliedWait });
  const environment = Object.freeze({ ...process.env });
  if (typeof options.gateId !== 'string' || !HEAVY_VERIFICATION_GATE_ID_PATTERN.test(options.gateId)) {
    throw new Error('Heavy verification gate id must be canonical.');
  }
  const namespace = options.namespace;
  if (namespace !== undefined) {
    validateHeavyVerificationGateNamespace(namespace);
  }
  const waitTimeoutMs = options.waitTimeoutMs === undefined ? HEAVY_VERIFICATION_GATE_DEFAULT_WAIT_TIMEOUT_MS : options.waitTimeoutMs;
  // Windows uses a DWORD; 0xffffffff is INFINITE, never a bounded wait.
  if (!Number.isSafeInteger(waitTimeoutMs) || waitTimeoutMs < 0 || waitTimeoutMs >= 0xffffffff) throw new TypeError('Heavy gate wait must be a bounded non-negative integer');
  if (options.isProcessAlive !== undefined && typeof options.isProcessAlive !== 'function') throw new TypeError('Process liveness observer must be callable');
  const namespaceSegment = namespace
    ? heavyVerificationGateNamespaceSegment(namespace)
    : undefined;
  const physicalWorktreeRoot = options.lockPath === undefined
    ? await realpath(compilerRoot)
    : null;
  const baseLockPath = options.lockPath
    ?? heavyVerificationGateLockPath({ physicalWorktreeRoot: physicalWorktreeRoot!, environment });
  const lockPath = namespaceSegment
    ? path.join(baseLockPath, namespaceSegment)
    : path.resolve(baseLockPath);
  const token = options.token ?? randomUUID().replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(token)) {
    throw new Error('Heavy verification gate token must be 128-bit lowercase hex.');
  }
  const owner = Object.freeze({
    command: Object.freeze([...process.argv]),
    gateId: options.gateId,
    host: options.ownerHost ?? hostname(),
    pid: options.ownerPid ?? process.pid,
    startedAt: options.startedAt ?? new Date().toISOString(),
    token
  });
  if (!isOwner(owner)) throw new TypeError('Heavy gate owner identity is invalid');
  if (process.platform === 'win32') {
    return acquireWindowsHeavyVerificationGateLease(
      owner,
      options.lockPath === undefined ? physicalWorktreeRoot! : path.resolve(options.lockPath),
      namespace,
      waitTimeoutMs
    );
  }
  const ownerIsAlive = options.isProcessAlive ?? isProcessAlive;
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await publishCandidate(lockPath, owner);
      return Object.freeze({
        owner,
        release: onceHeavyVerificationGateRelease(async (): Promise<void> => {
          const current = await readOwner(lockPath);
          if (!current || current.token !== owner.token) {
            throw new Error('Heavy verification gate lease ownership was lost before release.');
          }
          const releasePath = `${lockPath}.release-${owner.token}`;
          await rename(lockPath, releasePath);
          await rm(releasePath, { recursive: true, force: false });
        })
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error &&
        (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'ENOTEMPTY'))) {
        throw error;
      }
    }

    const current = await readOwner(lockPath);
    if (current) {
      if (current.host !== owner.host) {
        throw new Error(
          `Heavy verification gate ${current.gateId} is owned by another host (${current.host}).`
        );
      }
      if (ownerIsAlive(current.pid)) {
        throw new HeavyVerificationGateBusyError('active',
          `Heavy verification gate ${current.gateId} is already active ` +
          `(pid ${current.pid}, started ${current.startedAt}).`
        );
      }
    }
    if (!current) {
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs < INITIALIZATION_GRACE_MS) {
        throw new HeavyVerificationGateBusyError('initializing', 'Heavy verification gate owner publication is still initializing.');
      }
      throw new Error('Heavy verification gate owner publication is invalid and requires recovery.');
    }
    await reclaimStaleLock(lockPath, owner.token);
  }
  throw new Error('Heavy verification gate could not acquire its worktree-local lease.');
}

export async function withHeavyVerificationGateLease<T>(
  gateId: string,
  callback: () => Promise<T>,
  options?: HeavyVerificationGateLeaseCallOptions
): Promise<T> {
  const { namespace, waitTimeoutMs } = options ?? {};
  if (typeof callback !== 'function') throw new TypeError('Heavy gate operation must be callable');
  const lease = await waitForHeavyVerificationGateLease(
    () => acquireHeavyVerificationGateLease({ gateId, namespace, waitTimeoutMs: 0 }), waitTimeoutMs === undefined ? 0 : waitTimeoutMs
  );
  return withAcquiredHeavyVerificationGateLease(lease, callback);
}
